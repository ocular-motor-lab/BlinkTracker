import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { useAppStore } from '@app/state/useAppStore';
import { StatusBanner } from '@app/components/StatusBanner';
import { formatStatusLabel } from '@app/utils/display';
import { createTrackingState, getSharedFaceLandmarker, trackFrame, warmupFaceLandmarker } from '@app/utils/liveTracking';
import { createTrackingAudioAlertController } from '@app/utils/trackingAudioAlert';
import type { CameraInfo, FrameProbeResponse, VideoSourceInfo } from '@ipc/schemas';

const DEFAULT_TRACE_WINDOW_SEC = 10;
const UI_UPDATE_INTERVAL_MS = 120;
const PERSIST_FLUSH_INTERVAL_MS = 350;
const INFERENCE_MAX_WIDTH = 480;
const MIN_ACCEPTABLE_RECORDING_FPS = 25;
const FPS_WARNING_GRACE_SEC = 2;
const RECORDING_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=h264',
  'video/mp4',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm'
] as const;

const recordingExtensionForMimeType = (mimeType: string): 'mp4' | 'webm' =>
  mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';

const parseCameraMode = (value: string): { width: number; height: number; fps: number } | null => {
  const match = /^(\d+)x(\d+)@(\d+)$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
    fps: Number(match[3])
  };
};

const toMediaUrl = (filePath: string): string => `app-media://local?path=${encodeURIComponent(filePath)}`;

const cameraModeConstraints = (mode: ReturnType<typeof parseCameraMode>): MediaTrackConstraints => ({
  width: mode ? { ideal: mode.width } : undefined,
  height: mode ? { ideal: mode.height } : undefined,
  frameRate: mode ? { ideal: mode.fps } : undefined
});

const requestCameraStream = async (
  camera: CameraInfo | undefined,
  mode: ReturnType<typeof parseCameraMode>
): Promise<MediaStream> => {
  const modeConstraints = cameraModeConstraints(mode);

  if (camera?.browserDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: camera.browserDeviceId },
          ...modeConstraints
        },
        audio: false
      });
    } catch {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: mode ? modeConstraints : true,
          audio: false
        });
      } catch {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: mode ? modeConstraints : true,
      audio: false
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
};

type TraceSample = {
  timestampSec: number;
  fps: number;
  leftOpeningPercent: number | null;
  rightOpeningPercent: number | null;
};

type AcquireStatus = 'idle' | 'previewing' | 'recording' | 'paused' | 'stopped';

const getDisplayedVideoRect = (
  video: HTMLVideoElement | null,
  sourceSummary: { width: number; height: number } | null
): { left: number; top: number; width: number; height: number } | null => {
  if (!video || !sourceSummary?.width || !sourceSummary?.height) {
    return null;
  }

  const containerWidth = video.clientWidth;
  const containerHeight = video.clientHeight;
  if (!containerWidth || !containerHeight) {
    return null;
  }

  const sourceAspect = sourceSummary.width / sourceSummary.height;
  const containerAspect = containerWidth / containerHeight;

  if (sourceAspect > containerAspect) {
    const width = containerWidth;
    const height = width / sourceAspect;
    return {
      left: 0,
      top: (containerHeight - height) / 2,
      width,
      height
    };
  }

  const height = containerHeight;
  const width = height * sourceAspect;
  return {
    left: (containerWidth - width) / 2,
    top: 0,
    width,
    height
  };
};

const isInterruptedPlayRequest = (reason: unknown): boolean =>
  reason instanceof DOMException &&
  reason.name === 'AbortError' &&
  reason.message.includes('interrupted by a new load request');

const waitForVideoMetadata = (video: HTMLVideoElement): Promise<void> => {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
    };
    const handleLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('Unable to load video metadata. This file may use a codec the desktop shell cannot decode.'));
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
};

const playPreviewVideo = async (video: HTMLVideoElement): Promise<void> => {
  await waitForVideoMetadata(video);
  try {
    await video.play();
  } catch (reason) {
    if (isInterruptedPlayRequest(reason)) {
      return;
    }
    throw reason;
  }
};

const getSupportedRecordingMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined') {
    return 'video/webm';
  }

  return RECORDING_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? 'video/webm';
};

const formatClockTime = (value: number | null | undefined, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) {
    return 'NA';
  }
  const safeValue = Math.max(0, value);
  const minutes = Math.floor(safeValue / 60);
  const seconds = (safeValue % 60).toFixed(digits);
  return `${minutes}:${seconds.padStart(digits > 0 ? digits + 3 : 2, '0')}`;
};

export const AcquirePage = (): JSX.Element => {
  const lastCreatedSession = useAppStore((state) => state.lastCreatedSession);
  const sessionForm = useAppStore((state) => state.sessionForm);
  const cameras = useAppStore((state) => state.cameras);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setAnalysisSession = useAppStore((state) => state.setAnalysisSession);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const tracePlotRef = useRef<HTMLDivElement | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previewStartedAtRef = useRef<number>(0);
  const previewFrameIndexRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const frameIndexRef = useRef<number>(0);
  const statusRef = useRef<AcquireStatus>('idle');
  const isRecordingRef = useRef(false);
  const trackingStateRef = useRef(createTrackingState());
  const trackerRef = useRef<Awaited<ReturnType<typeof getSharedFaceLandmarker>> | null>(null);
  const pendingRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const lastUiUpdateAtRef = useRef<number>(0);
  const lastPersistFlushAtRef = useRef<number>(0);
  const persistFlushPromiseRef = useRef<Promise<void> | null>(null);
  const minRecordingFpsRef = useRef<number | null>(null);
  const trackingAudioAlertRef = useRef(createTrackingAudioAlertController());

  const [status, setStatus] = useState<AcquireStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = useState<VideoSourceInfo | null>(null);
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const traceWindowSec = DEFAULT_TRACE_WINDOW_SEC;
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const [estimatedFps, setEstimatedFps] = useState(0);
  const [recordingComplete, setRecordingComplete] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [latestProbe, setLatestProbe] = useState<FrameProbeResponse | null>(null);
  const [traceSamples, setTraceSamples] = useState<TraceSample[]>([]);
  const [sourceSummary, setSourceSummary] = useState<{ width: number; height: number; fps: number; name: string } | null>(
    null
  );

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.deviceId === sessionForm.cameraDeviceId),
    [cameras, sessionForm.cameraDeviceId]
  );
  const createSessionTrackingState = () =>
    createTrackingState({
      leftReferenceMax:
        typeof sessionForm.calibrationSummary?.left_reference_max_px === 'number'
          ? sessionForm.calibrationSummary.left_reference_max_px
          : null,
      rightReferenceMax:
        typeof sessionForm.calibrationSummary?.right_reference_max_px === 'number'
          ? sessionForm.calibrationSummary.right_reference_max_px
          : null
    });
  const selectedCameraMode = useMemo(() => parseCameraMode(sessionForm.cameraMode), [sessionForm.cameraMode]);

  useEffect(() => {
    warmupFaceLandmarker();
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      isRecordingRef.current = false;
      trackingAudioAlertRef.current.reset();
      liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (tracePlotRef.current) {
        void Plotly.purge(tracePlotRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = tracePlotRef.current;
    if (!container) {
      return;
    }

    const timestamps = traceSamples.map((sample) => sample.timestampSec);
    const leftRaw = traceSamples.map((sample) => sample.leftOpeningPercent);
    const rightRaw = traceSamples.map((sample) => sample.rightOpeningPercent);

    const traces = [
      {
        x: timestamps,
        y: leftRaw,
        type: 'scatter',
        mode: 'lines',
        name: 'Left raw',
        line: { color: '#f59e0b', width: 2 }
      },
      {
        x: timestamps,
        y: rightRaw,
        type: 'scatter',
        mode: 'lines',
        name: 'Right raw',
        line: { color: '#38bdf8', width: 2 }
      }
    ];

    void Plotly.react(
      container,
      traces,
      {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(8,17,29,0.55)',
        margin: { l: 42, r: 18, t: 18, b: 36 },
        showlegend: true,
        legend: {
          orientation: 'h',
          x: 0,
          y: 1.16,
          font: { color: '#cbd5e1', size: 11 }
        },
        xaxis: {
          title: 'Time (s)',
          color: '#cbd5e1',
          gridcolor: 'rgba(148,163,184,0.14)',
          zeroline: false
        },
        yaxis: {
          title: 'Opening (%)',
          color: '#cbd5e1',
          gridcolor: 'rgba(148,163,184,0.14)',
          range: [0, 110]
        }
      },
      {
        displayModeBar: false,
        responsive: true
      }
    );
  }, [traceSamples]);

  const updateSessionMetadata = async (updates: Record<string, unknown>) => {
    if (!lastCreatedSession || !window.electronAPI) {
      return;
    }
    await window.electronAPI.updateSessionMetadata({
      sessionFolder: lastCreatedSession.paths.sessionFolder,
      updates
    });
  };

  const appendAuditLog = async (action: string, note?: string, newValue?: unknown) => {
    if (!lastCreatedSession || !window.electronAPI) {
      return;
    }
    await window.electronAPI.appendAuditLog({
      sessionFolder: lastCreatedSession.paths.sessionFolder,
      action,
      note,
      newValue
    });
  };

  const drawInferenceFrame = (video: HTMLVideoElement, width: number, height: number): HTMLCanvasElement | null => {
    const canvas = inferenceCanvasRef.current;
    if (!canvas) {
      return null;
    }

    const scale = width > INFERENCE_MAX_WIDTH ? INFERENCE_MAX_WIDTH / width : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    return canvas;
  };

  const flushPendingRows = async (force = false) => {
    if (!window.electronAPI || !lastCreatedSession || pendingRowsRef.current.length === 0) {
      return;
    }

    if (persistFlushPromiseRef.current) {
      await persistFlushPromiseRef.current;
      if (!force || pendingRowsRef.current.length === 0) {
        return;
      }
    }

    const now = performance.now();
    if (!force && now - lastPersistFlushAtRef.current < PERSIST_FLUSH_INTERVAL_MS) {
      return;
    }

    const rows = pendingRowsRef.current.splice(0, pendingRowsRef.current.length);
    lastPersistFlushAtRef.current = now;

    const flushPromise = window.electronAPI
      .persistFrameMeasurements({
        sessionFolder: lastCreatedSession.paths.sessionFolder,
        rows
      })
      .then(() => undefined)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'Unable to persist frame measurements.');
      })
      .finally(() => {
        persistFlushPromiseRef.current = null;
      });

    persistFlushPromiseRef.current = flushPromise;
    await flushPromise;

    if (force && pendingRowsRef.current.length > 0) {
      await flushPendingRows(true);
    }
  };

  const pipelineIsActive = () => statusRef.current === 'previewing' || statusRef.current === 'recording';

  const runFrameLoop = (nominalFps: number, sourceName: string, width: number, height: number) => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const loop = async () => {
      if (!lastCreatedSession || !window.electronAPI) {
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        if (pipelineIsActive()) {
          animationFrameRef.current = requestAnimationFrame(() => {
            void loop();
          });
        }
        return;
      }

      const recording = isRecordingRef.current;
      const previewTimestampSec =
        sessionForm.sourceType === 'video_file'
          ? video.currentTime
          : (performance.now() - previewStartedAtRef.current) / 1000;
      const recordingTimestampSec =
        sessionForm.sourceType === 'video_file' ? video.currentTime : (performance.now() - startedAtRef.current) / 1000;
      const timestampSec = recording ? recordingTimestampSec : previewTimestampSec;
      const frameIndex = recording ? frameIndexRef.current++ : previewFrameIndexRef.current++;
      const inferenceCanvas = drawInferenceFrame(video, width, height);
      if (!inferenceCanvas) {
        if (pipelineIsActive()) {
          animationFrameRef.current = requestAnimationFrame(() => {
            void loop();
          });
        }
        return;
      }

      const tracker = trackerRef.current ?? (await getSharedFaceLandmarker());
      trackerRef.current = tracker;
      const { probe, row } = await trackFrame(
        tracker,
        inferenceCanvas,
        frameIndex,
        timestampSec,
        nominalFps,
        sessionForm.sourceType,
        sourceName,
        lastCreatedSession.metadata.session_id,
        trackingStateRef.current
      );
      trackingAudioAlertRef.current.maybeAlert(
        probe.trackingAlertReason,
        sessionForm.sourceType === 'camera' && pipelineIsActive()
      );
      if (recording) {
        pendingRowsRef.current.push(row);
        void flushPendingRows();
      }

      const now = performance.now();
      if (now - lastUiUpdateAtRef.current >= UI_UPDATE_INTERVAL_MS) {
        lastUiUpdateAtRef.current = now;
        setElapsedSec(timestampSec);
        if (recording) {
          setRecordingElapsedSec(recordingTimestampSec);
        }
        setLatestProbe(probe);
        if (recording) {
          setTraceSamples((previous) => {
            const next = [
              ...previous,
              {
                timestampSec: recordingTimestampSec,
                fps: nominalFps,
                leftOpeningPercent: probe.leftOpeningPercent,
                rightOpeningPercent: probe.rightOpeningPercent
              }
            ];
            return next.filter((entry) => recordingTimestampSec - entry.timestampSec <= traceWindowSec);
          });
        }
        const processedFrameCount = recording ? frameIndexRef.current : previewFrameIndexRef.current;
        const currentEstimatedFps = timestampSec > 0 ? processedFrameCount / timestampSec : nominalFps;
        setEstimatedFps(currentEstimatedFps);
        if (recording && recordingTimestampSec >= FPS_WARNING_GRACE_SEC && Number.isFinite(currentEstimatedFps)) {
          minRecordingFpsRef.current =
            minRecordingFpsRef.current == null
              ? currentEstimatedFps
              : Math.min(minRecordingFpsRef.current, currentEstimatedFps);
        }
      }

      if (pipelineIsActive()) {
        animationFrameRef.current = requestAnimationFrame(() => {
          void loop();
        });
      }
    };

    animationFrameRef.current = requestAnimationFrame(() => {
      void loop();
    });
  };

  const stopRawVideoRecording = async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const recorder = mediaRecorderRef.current;
        recorder?.addEventListener(
          'stop',
          async () => {
            const mimeType = recorder.mimeType || 'video/webm';
            const blob = new Blob(recordedChunksRef.current, { type: mimeType });
            if (lastCreatedSession?.paths.rawVideoPath && window.electronAPI && blob.size > 0) {
              const extension = recordingExtensionForMimeType(mimeType);
              const targetPath = lastCreatedSession.paths.rawVideoPath.replace(/\.(mp4|mov|mkv|avi|webm)$/i, `.${extension}`);
              await window.electronAPI.saveRawVideo({
                targetPath,
                data: new Uint8Array(await blob.arrayBuffer())
              });
              await updateSessionMetadata({
                raw_video_path: targetPath,
                raw_video_mime_type: mimeType,
                raw_video_container: extension
              });
            }
            resolve();
          },
          { once: true }
        );
        recorder?.stop();
      });
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
  };

  const stopLiveResources = async () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    await stopRawVideoRecording();

    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;
    trackingAudioAlertRef.current.reset();
  };

  const startPreview = async () => {
    if (!lastCreatedSession || !window.electronAPI) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    setError(null);
    previewFrameIndexRef.current = 0;
    previewStartedAtRef.current = performance.now();
    trackingStateRef.current = createSessionTrackingState();
    trackingAudioAlertRef.current.reset();
    lastUiUpdateAtRef.current = 0;
    setTraceSamples([]);
    setLatestProbe(null);

    await stopLiveResources();

    if (sessionForm.sourceType === 'camera') {
      try {
        const stream = await requestCameraStream(selectedCamera, selectedCameraMode);
        liveStreamRef.current = stream;
        video.srcObject = stream;
        await playPreviewVideo(video);

        const trackSettings = stream.getVideoTracks()[0]?.getSettings();
        const width = video.videoWidth || trackSettings?.width || 0;
        const height = video.videoHeight || trackSettings?.height || 0;
        const nominalFps = Number(trackSettings?.frameRate ?? selectedCameraMode?.fps ?? 30);
        const sourceName = selectedCamera?.label ?? 'Live Camera';

        setSourceSummary({ width, height, fps: nominalFps, name: sourceName });
        await updateSessionMetadata({
          source_name: sourceName,
          resolution_width: width,
          resolution_height: height,
          nominal_fps: nominalFps,
          requested_camera_mode: sessionForm.cameraMode || 'auto'
        });
        await appendAuditLog('preview_started', 'Live camera preview started.', {
          sourceName,
          width,
          height,
          nominalFps,
          requestedCameraMode: sessionForm.cameraMode || 'auto'
        });

        statusRef.current = 'previewing';
        setStatus('previewing');
        runFrameLoop(nominalFps, sourceName, width, height);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to start live camera preview.');
      }
      return;
    }

    try {
      const info = await window.electronAPI.probeVideo(sessionForm.videoFilePath);
      setSourceInfo(info);
      setSourceSummary({ width: info.width, height: info.height, fps: info.fps, name: info.sourceName });
      video.src = toMediaUrl(info.path);
      video.load();
      await playPreviewVideo(video);

      await updateSessionMetadata({
        source_name: info.sourceName,
        resolution_width: info.width,
        resolution_height: info.height,
        nominal_fps: info.fps,
        source_path: info.path
      });
      await appendAuditLog('preview_started', 'Video-file preview started.', info);

      statusRef.current = 'previewing';
      setStatus('previewing');
      runFrameLoop(info.fps || 30, info.sourceName, info.width, info.height);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load video file preview.');
    }
  };

  useEffect(() => {
    if (!lastCreatedSession || statusRef.current !== 'idle') {
      return;
    }

    setRecordingComplete(false);
    setRecordingElapsedSec(0);
    setElapsedSec(0);
    setTraceSamples([]);
    setLatestProbe(null);
    setError(null);
    void startPreview();
  }, [lastCreatedSession?.metadata.session_id]);

  const handleStart = async () => {
    if (!lastCreatedSession || !window.electronAPI) {
      setError('Create a session in the Session tab before starting acquisition.');
      return;
    }

    if (recordingComplete) {
      setError(
        'This session already has a completed recording. Continue to Post-Session or Analysis, or create a new session before recording again.'
      );
      return;
    }

    try {
      const existingSession = await window.electronAPI.loadSession({
        sessionFolder: lastCreatedSession.paths.sessionFolder
      });
      const alreadyHasRecording =
        existingSession.frameRows.length > 0 || Boolean(existingSession.metadata.acquisition_stopped_at);
      if (alreadyHasRecording) {
        setAnalysisSession(existingSession);
        setRecordingComplete(true);
        setError(
          'This session already contains recorded data. Continue to Post-Session or Analysis, or create a new session before recording again.'
        );
        return;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to confirm whether this session already has data.');
      return;
    }

    if (!sourceSummary || !videoRef.current) {
      await startPreview();
    }

    const stream = liveStreamRef.current;
    isRecordingRef.current = true;
    frameIndexRef.current = 0;
    startedAtRef.current = performance.now();
    setRecordingElapsedSec(0);
    setRecordingComplete(false);
    setTraceSamples([]);
    setLatestProbe(null);
    pendingRowsRef.current = [];
    recordedChunksRef.current = [];
    lastPersistFlushAtRef.current = 0;
    minRecordingFpsRef.current = null;

    if (sessionForm.sourceType === 'camera' && sessionForm.saveRawVideo && lastCreatedSession.paths.rawVideoPath && stream) {
      const mimeType = getSupportedRecordingMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.start(1000);
    }

    statusRef.current = 'recording';
    setStatus('recording');
    await updateSessionMetadata({
      acquisition_started_at: new Date().toISOString()
    });
    await appendAuditLog('recording_started', 'Recording started while live preview remained active.', {
      sourceName: sourceSummary?.name,
      width: sourceSummary?.width,
      height: sourceSummary?.height,
      nominalFps: sourceSummary?.fps,
      rawVideoMimeType: mediaRecorderRef.current?.mimeType ?? null,
      rawVideoContainer: mediaRecorderRef.current?.mimeType ? recordingExtensionForMimeType(mediaRecorderRef.current.mimeType) : null,
      rawVideoFallbackUsed: mediaRecorderRef.current?.mimeType
        ? recordingExtensionForMimeType(mediaRecorderRef.current.mimeType) !== 'mp4'
        : null
    });
  };

  const handleStop = async () => {
    const sessionFolder = lastCreatedSession?.paths.sessionFolder;
    isRecordingRef.current = false;
    statusRef.current = 'previewing';
    setStatus('previewing');
    await flushPendingRows(true);
    await stopRawVideoRecording();
    const minRecordingFps = minRecordingFpsRef.current;
    const lowFpsWarning =
      minRecordingFps != null && minRecordingFps < MIN_ACCEPTABLE_RECORDING_FPS
        ? {
            code: 'low_recording_fps',
            message: `Recording FPS dropped below ${MIN_ACCEPTABLE_RECORDING_FPS}.`,
            threshold_fps: MIN_ACCEPTABLE_RECORDING_FPS,
            minimum_estimated_fps: Number(minRecordingFps.toFixed(2)),
            final_estimated_fps: Number(estimatedFps.toFixed(2))
          }
        : null;
    await updateSessionMetadata({
      actual_processing_fps: estimatedFps,
      minimum_recording_fps: minRecordingFps,
      data_quality_warnings: lowFpsWarning ? [lowFpsWarning] : [],
      elapsed_sec: recordingElapsedSec,
      acquisition_stopped_at: new Date().toISOString()
    });
    await appendAuditLog('recording_stopped', 'Recording stopped while live preview remained active.', {
      elapsedSec: recordingElapsedSec,
      estimatedFps
    });
    if (lowFpsWarning) {
      await appendAuditLog('data_quality_warning', lowFpsWarning.message, lowFpsWarning);
    }
    try {
      const session = sessionFolder ? await window.electronAPI?.loadSession({ sessionFolder }) : null;
      if (session) {
        setAnalysisSession(session);
      }
    } catch {
      // The recording is still complete even if the analysis view cannot refresh immediately.
    }
    setRecordingComplete(true);
  };

  const handleProcessVideoForAnalysis = async () => {
    if (!lastCreatedSession || !window.electronAPI) {
      setError('Create a session before processing the uploaded video.');
      return;
    }
    if (typeof window.electronAPI.processVideo !== 'function') {
      setError('Restart BlinkTracker to finish enabling uploaded-video analysis.');
      return;
    }
    if (!sessionForm.videoFilePath.trim()) {
      setError('Choose a video file in the Session screen before processing.');
      return;
    }

    setIsProcessingVideo(true);
    setError(null);
    try {
      const result = await window.electronAPI.processVideo({
        sessionFolder: lastCreatedSession.paths.sessionFolder,
        videoFilePath: sessionForm.videoFilePath
      });
      await appendAuditLog('video_processed', 'Uploaded video processed for analysis.', result);
      const session = await window.electronAPI.loadSession({ sessionFolder: lastCreatedSession.paths.sessionFolder });
      setAnalysisSession(session);
      setRecordingComplete(true);
      setActiveTab('analysis');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to process uploaded video.');
    } finally {
      setIsProcessingVideo(false);
    }
  };

  const handlePause = async () => {
    if (sessionForm.sourceType !== 'video_file' || !videoRef.current) {
      return;
    }
    if (status === 'paused') {
      await videoRef.current.play();
      statusRef.current = isRecordingRef.current ? 'recording' : 'previewing';
      setStatus(statusRef.current);
      if (sourceSummary) {
        runFrameLoop(sourceSummary.fps || 30, sourceSummary.name, sourceSummary.width, sourceSummary.height);
      }
      return;
    }
    videoRef.current.pause();
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    statusRef.current = 'paused';
    setStatus('paused');
  };

  const recentWindow = traceSamples.slice(-20);
  const averageRecentFps =
    recentWindow.length > 0
      ? recentWindow.reduce((total, entry) => total + entry.fps, 0) / recentWindow.length
      : 0;
  const displayedVideoRect = getDisplayedVideoRect(videoRef.current, sourceSummary);
  const overlaySourceWidth = inferenceCanvasRef.current?.width || sourceSummary?.width || 1;
  const overlaySourceHeight = inferenceCanvasRef.current?.height || sourceSummary?.height || 1;
  const showRecordingMetrics = status === 'recording';
  const hasRecordingStarted = showRecordingMetrics || recordingElapsedSec > 0;
  const trackingStatus = latestProbe?.trackingStatus ?? 'idle';
  const trackingConfidenceMessage =
    latestProbe?.warning ??
    (trackingStatus === 'tracked'
      ? 'Tracking is stable.'
      : trackingStatus === 'low_confidence'
        ? 'Tracking confidence is limited for this frame.'
        : trackingStatus === 'no_face'
          ? 'No face is currently detected.'
          : 'Waiting for tracking data.');
  const trackingConfidenceClass =
    latestProbe?.trackingAlertReason && latestProbe.trackingAlertReason !== 'no_face'
      ? 'is-limited'
      : trackingStatus === 'tracked'
      ? 'is-stable'
      : trackingStatus === 'low_confidence'
        ? 'is-limited'
        : trackingStatus === 'no_face'
          ? 'is-missing'
          : 'is-pending';

  if (!lastCreatedSession) {
    return (
      <section className="placeholder-card">
        <h3>No active session yet</h3>
        <p>Create a session in the Session tab first, then come back here to preview and process the selected source.</p>
      </section>
    );
  }

  return (
    <section className="acquire-layout">
      <div className="card preview-card">
        <div className="section-heading">
          <div>
            <h3>{sessionForm.sourceType === 'camera' ? 'Live camera preview' : 'Video-file preview'}</h3>
          </div>
          <p className="section-copy">
            Click Start Recording to begin recording.
          </p>
        </div>

        <div className="preview-status-stack">
          {error ? <StatusBanner tone="error" message={error} /> : null}
        </div>

        <div className="preview-frame">
          <video ref={videoRef} autoPlay muted playsInline controls={sessionForm.sourceType === 'video_file'} />
          {overlayEnabled ? <div className="preview-overlay">Live landmark overlay</div> : null}
          {status === 'recording' ? <div className="recording-badge" aria-label="Recording" /> : null}
          {overlayEnabled && latestProbe?.landmarkPreview?.length ? (
            <div className="landmark-layer">
              {latestProbe.landmarkPreview.map((point, index) => (
                <span
                  key={`${point.kind}-${index}`}
                  className={`landmark-dot ${point.kind}`}
                  style={
                    displayedVideoRect && sourceSummary
                      ? {
                          left: `${displayedVideoRect.left + (point.x / overlaySourceWidth) * displayedVideoRect.width}px`,
                          top: `${displayedVideoRect.top + (point.y / overlaySourceHeight) * displayedVideoRect.height}px`
                        }
                      : {
                          left: `${(point.x / overlaySourceWidth) * 100}%`,
                          top: `${(point.y / overlaySourceHeight) * 100}%`
                        }
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className={`tracking-confidence-panel ${trackingConfidenceClass}`}>
          <div>
            <span>Tracking confidence</span>
            <strong>{formatStatusLabel(trackingStatus)}</strong>
          </div>
          <div>
            <span>Left / Right</span>
            <strong>
              {latestProbe
                ? `${latestProbe.leftTrackingConfidence.toFixed(2)} / ${latestProbe.rightTrackingConfidence.toFixed(2)}`
                : 'Pending'}
            </strong>
          </div>
          <p>{trackingConfidenceMessage}</p>
        </div>
        <canvas ref={inferenceCanvasRef} className="capture-canvas" />
      </div>

      <div className="acquire-side">
        <div className="card controls-card">
          <div className="section-heading compact">
            <div>
              <h3>Run pipeline</h3>
            </div>
          </div>
          <div className="control-stack">
            <div className="toggle-row">
              {sessionForm.sourceType === 'video_file' ? (
                <button
                  className="primary-button record-button"
                  disabled={isProcessingVideo}
                  onClick={() => void handleProcessVideoForAnalysis()}
                  type="button"
                >
                  {isProcessingVideo ? 'Processing Video...' : 'Process Video for Analysis'}
                </button>
              ) : (
                <>
                  <button
                    className={status === 'recording' ? 'record-button is-recording' : 'primary-button record-button'}
                    disabled={status === 'recording' || recordingComplete}
                    onClick={() => void handleStart()}
                    type="button"
                  >
                    {recordingComplete ? 'Recording Complete' : status === 'recording' ? 'Recording' : 'Start Recording'}
                  </button>
                  <button disabled={status !== 'recording'} onClick={() => void handleStop()} type="button">
                    Stop Recording
                  </button>
                </>
              )}
              {sessionForm.sourceType === 'video_file' ? (
                <button onClick={() => void handlePause()} type="button">
                  {status === 'paused' ? 'Resume' : 'Pause'}
                </button>
              ) : null}
            </div>
            <label className="checkbox-row">
              <input checked={overlayEnabled} onChange={() => setOverlayEnabled((value) => !value)} type="checkbox" />
              <span>Overlay On/Off</span>
            </label>
            {recordingComplete ? (
              <div className="action-row recording-next-actions">
                <button className="primary-button" onClick={() => setActiveTab('postSession')} type="button">
                  Go to Post-Session
                </button>
                <button className="primary-button" onClick={() => setActiveTab('analysis')} type="button">
                  Go to Analysis
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card metrics-card">
          <div className="section-heading compact">
            <div>
              <h3>Acquisition metrics</h3>
            </div>
          </div>
          <dl className="metric-grid">
            <div>
              <dt>Status</dt>
              <dd>{formatStatusLabel(status)}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatClockTime(recordingElapsedSec)}</dd>
            </div>
            {showRecordingMetrics ? (
              <div>
                <dt>Preview Time</dt>
                <dd>{formatClockTime(elapsedSec)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Estimated FPS</dt>
              <dd>{estimatedFps.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>{sourceSummary ? `${sourceSummary.width} x ${sourceSummary.height}` : 'Pending'}</dd>
            </div>
            <div>
              <dt>Tracking status</dt>
              <dd>{showRecordingMetrics ? formatStatusLabel(latestProbe?.trackingStatus ?? 'idle') : 'Pending'}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>
                {showRecordingMetrics && latestProbe
                  ? `${latestProbe.leftTrackingConfidence.toFixed(2)} / ${latestProbe.rightTrackingConfidence.toFixed(2)}`
                  : 'Pending'}
              </dd>
            </div>
            <div>
              <dt>Opening px</dt>
              <dd>
                {showRecordingMetrics && latestProbe
                  ? `${latestProbe.leftOpeningPx?.toFixed(1) ?? 'NaN'} / ${latestProbe.rightOpeningPx?.toFixed(1) ?? 'NaN'}`
                  : 'Pending'}
              </dd>
            </div>
            <div>
              <dt>Opening %</dt>
              <dd>
                {showRecordingMetrics && latestProbe
                  ? `${latestProbe.leftOpeningPercent?.toFixed(1) ?? 'NaN'} / ${latestProbe.rightOpeningPercent?.toFixed(1) ?? 'NaN'}`
                  : 'Pending'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="card trace-card">
          <div className="section-heading compact">
            <div>
              <h3>Live opening trace</h3>
            </div>
          </div>
          <div ref={tracePlotRef} className="plotly-trace" />
          <dl className="metric-grid compact-grid">
            <div>
              <dt>Frames processed</dt>
              <dd>{showRecordingMetrics ? frameIndexRef.current : 0}</dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>{traceWindowSec} s</dd>
            </div>
            <div>
              <dt>Recent avg fps</dt>
              <dd>{averageRecentFps.toFixed(1)}</dd>
            </div>
            {hasRecordingStarted ? (
              <div>
                <dt>Latest timestamp</dt>
                <dd>{formatClockTime(recordingElapsedSec, 3)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="section-copy">
            Left and right eyelid opening are plotted over the selected rolling window.
          </p>
          {sourceInfo ? (
            <p className="field-helper">
              File source: {sourceInfo.sourceName} ({sourceInfo.frameCount} frames, {formatClockTime(sourceInfo.durationSec)})
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
};
