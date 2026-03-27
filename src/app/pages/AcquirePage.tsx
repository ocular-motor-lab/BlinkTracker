import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { useAppStore } from '@app/state/useAppStore';
import { StatusBanner } from '@app/components/StatusBanner';
import { createTrackingState, getSharedFaceLandmarker, trackFrame, warmupFaceLandmarker } from '@app/utils/liveTracking';
import type { FrameProbeResponse, VideoSourceInfo } from '@ipc/schemas';

const TRACE_WINDOW_OPTIONS = [5, 10, 20, 60] as const;
const UI_UPDATE_INTERVAL_MS = 120;
const PERSIST_FLUSH_INTERVAL_MS = 350;
const INFERENCE_MAX_WIDTH = 480;

const toFileUrl = (filePath: string): string => {
  const normalized = filePath.replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
};

type TraceSample = {
  timestampSec: number;
  fps: number;
  leftOpeningPercent: number | null;
  rightOpeningPercent: number | null;
};

const smoothNullableSeries = (values: Array<number | null>, radius = 2): Array<number | null> =>
  values.map((_, index) => {
    const window = values.slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1));
    const present = window.filter((value): value is number => value != null);
    if (!present.length) {
      return null;
    }
    return present.reduce((total, value) => total + value, 0) / present.length;
  });

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

export const AcquirePage = (): JSX.Element => {
  const lastCreatedSession = useAppStore((state) => state.lastCreatedSession);
  const sessionForm = useAppStore((state) => state.sessionForm);
  const cameras = useAppStore((state) => state.cameras);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const tracePlotRef = useRef<HTMLDivElement | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const frameIndexRef = useRef<number>(0);
  const statusRef = useRef<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const trackingStateRef = useRef(createTrackingState());
  const trackerRef = useRef<Awaited<ReturnType<typeof getSharedFaceLandmarker>> | null>(null);
  const pendingRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const lastUiUpdateAtRef = useRef<number>(0);
  const lastPersistFlushAtRef = useRef<number>(0);
  const persistFlushPromiseRef = useRef<Promise<void> | null>(null);

  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = useState<VideoSourceInfo | null>(null);
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [traceWindowSec, setTraceWindowSec] = useState<number>(10);
  const [traceMode, setTraceMode] = useState<'raw' | 'smoothed' | 'both'>('raw');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [estimatedFps, setEstimatedFps] = useState(0);
  const [latestProbe, setLatestProbe] = useState<FrameProbeResponse | null>(null);
  const [traceSamples, setTraceSamples] = useState<TraceSample[]>([]);
  const [sourceSummary, setSourceSummary] = useState<{ width: number; height: number; fps: number; name: string } | null>(
    null
  );

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.deviceId === sessionForm.cameraDeviceId),
    [cameras, sessionForm.cameraDeviceId]
  );
  const highestMode = useMemo(() => {
    if (!selectedCamera?.modes?.length) {
      return null;
    }

    return [...selectedCamera.modes].sort((left, right) => {
      const leftPixels = left.width * left.height;
      const rightPixels = right.width * right.height;
      if (leftPixels !== rightPixels) {
        return rightPixels - leftPixels;
      }
      return right.fps - left.fps;
    })[0];
  }, [selectedCamera]);

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
    const leftSmoothed = smoothNullableSeries(leftRaw);
    const rightSmoothed = smoothNullableSeries(rightRaw);
    const showRaw = traceMode === 'raw' || traceMode === 'both';
    const showSmoothed = traceMode === 'smoothed' || traceMode === 'both';

    const traces = [
      showRaw
        ? {
            x: timestamps,
            y: leftRaw,
            type: 'scatter',
            mode: 'lines',
            name: 'Left raw',
            line: { color: '#f59e0b', width: 2 }
          }
        : null,
      showRaw
        ? {
            x: timestamps,
            y: rightRaw,
            type: 'scatter',
            mode: 'lines',
            name: 'Right raw',
            line: { color: '#38bdf8', width: 2 }
          }
        : null,
      showSmoothed
        ? {
            x: timestamps,
            y: leftSmoothed,
            type: 'scatter',
            mode: 'lines',
            name: 'Left smoothed',
            line: { color: '#fcd34d', width: 3, dash: 'solid' }
          }
        : null,
      showSmoothed
        ? {
            x: timestamps,
            y: rightSmoothed,
            type: 'scatter',
            mode: 'lines',
            name: 'Right smoothed',
            line: { color: '#7dd3fc', width: 3, dash: 'solid' }
          }
        : null
    ].filter(Boolean);

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
  }, [traceMode, traceSamples]);

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

  const runFrameLoop = (nominalFps: number, sourceName: string, width: number, height: number) => {
    const loop = async () => {
      if (!lastCreatedSession || !window.electronAPI) {
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        if (statusRef.current === 'running') {
          animationFrameRef.current = requestAnimationFrame(() => {
            void loop();
          });
        }
        return;
      }

      const timestampSec =
        sessionForm.sourceType === 'video_file' ? video.currentTime : (performance.now() - startedAtRef.current) / 1000;
      const frameIndex = frameIndexRef.current++;
      const inferenceCanvas = drawInferenceFrame(video, width, height);
      if (!inferenceCanvas) {
        if (statusRef.current === 'running') {
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
      pendingRowsRef.current.push(row);
      void flushPendingRows();

      const now = performance.now();
      if (now - lastUiUpdateAtRef.current >= UI_UPDATE_INTERVAL_MS) {
        lastUiUpdateAtRef.current = now;
        setElapsedSec(timestampSec);
        setLatestProbe(probe);
        setTraceSamples((previous) => {
          const next = [
            ...previous,
            {
              timestampSec,
              fps: nominalFps,
              leftOpeningPercent: probe.leftOpeningPercent,
              rightOpeningPercent: probe.rightOpeningPercent
            }
          ];
          return next.filter((entry) => timestampSec - entry.timestampSec <= traceWindowSec);
        });
        setEstimatedFps(timestampSec > 0 ? frameIndex / timestampSec : nominalFps);
      }

      if (statusRef.current === 'running') {
        animationFrameRef.current = requestAnimationFrame(() => {
          void loop();
        });
      }
    };

    animationFrameRef.current = requestAnimationFrame(() => {
      void loop();
    });
  };

  const stopLiveResources = async () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const recorder = mediaRecorderRef.current;
        recorder?.addEventListener(
          'stop',
          async () => {
            const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'video/webm' });
            if (lastCreatedSession?.paths.rawVideoPath && window.electronAPI && blob.size > 0) {
              const targetPath = recorder.mimeType.includes('mp4')
                ? lastCreatedSession.paths.rawVideoPath.replace(/\.webm$/i, '.mp4')
                : lastCreatedSession.paths.rawVideoPath;
              await window.electronAPI.saveRawVideo({
                targetPath,
                data: new Uint8Array(await blob.arrayBuffer())
              });
              await updateSessionMetadata({ raw_video_path: targetPath });
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

  const handleStart = async () => {
    if (!lastCreatedSession || !window.electronAPI) {
      setError('Create a session in the Session tab before starting acquisition.');
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    setError(null);
    frameIndexRef.current = 0;
    startedAtRef.current = performance.now();
    trackingStateRef.current = createTrackingState();
    pendingRowsRef.current = [];
    lastUiUpdateAtRef.current = 0;
    lastPersistFlushAtRef.current = 0;
    setTraceSamples([]);
    setLatestProbe(null);

    await stopLiveResources();

    if (sessionForm.sourceType === 'camera') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: selectedCamera?.browserDeviceId
            ? {
                deviceId: { exact: selectedCamera.browserDeviceId },
                width: sessionForm.preferHighResolution && highestMode ? { ideal: highestMode.width } : undefined,
                height: sessionForm.preferHighResolution && highestMode ? { ideal: highestMode.height } : undefined,
                frameRate: sessionForm.preferHighResolution && highestMode ? { ideal: highestMode.fps } : undefined
              }
            : true,
          audio: false
        });
        liveStreamRef.current = stream;
        video.srcObject = stream;
        await video.play();

        const trackSettings = stream.getVideoTracks()[0]?.getSettings();
        const width = video.videoWidth || trackSettings?.width || 0;
        const height = video.videoHeight || trackSettings?.height || 0;
        const nominalFps =
          (sessionForm.preferHighResolution ? highestMode?.fps : undefined) ?? Number(trackSettings?.frameRate ?? 30);
        const sourceName = selectedCamera?.label ?? 'Live Camera';

        setSourceSummary({ width, height, fps: nominalFps, name: sourceName });
        await updateSessionMetadata({
          source_name: sourceName,
          resolution_width: width,
          resolution_height: height,
          nominal_fps: nominalFps,
          acquisition_started_at: new Date().toISOString()
        });
        await appendAuditLog('acquisition_started', 'Live camera acquisition started.', {
          sourceName,
          width,
          height,
          nominalFps
        });

        if (sessionForm.saveRawVideo && lastCreatedSession.paths.rawVideoPath) {
          const mimeType =
            ['video/mp4;codecs=h264', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find((candidate) =>
              MediaRecorder.isTypeSupported(candidate)
            ) ?? 'video/webm';
          const recorder = new MediaRecorder(stream, { mimeType });
          mediaRecorderRef.current = recorder;
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };
          recorder.start(1000);
        }

        statusRef.current = 'running';
        setStatus('running');
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
      video.src = toFileUrl(info.path);
      await video.play();

      await updateSessionMetadata({
        source_name: info.sourceName,
        resolution_width: info.width,
        resolution_height: info.height,
        nominal_fps: info.fps,
        source_path: info.path,
        acquisition_started_at: new Date().toISOString()
      });
      await appendAuditLog('processing_started', 'Video-file processing started.', info);

      statusRef.current = 'running';
      setStatus('running');
      runFrameLoop(info.fps || 30, info.sourceName, info.width, info.height);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load video file preview.');
    }
  };

  const handleStop = async () => {
    statusRef.current = 'stopped';
    setStatus('stopped');
    await flushPendingRows(true);
    await stopLiveResources();
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      if (sessionForm.sourceType === 'video_file') {
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    }
    await updateSessionMetadata({
      actual_processing_fps: estimatedFps,
      elapsed_sec: elapsedSec,
      acquisition_stopped_at: new Date().toISOString()
    });
    await appendAuditLog('acquisition_stopped', 'Acquisition/processing stopped.', {
      elapsedSec,
      estimatedFps
    });
  };

  const handlePause = async () => {
    if (sessionForm.sourceType !== 'video_file' || !videoRef.current) {
      return;
    }
    if (status === 'paused') {
      await videoRef.current.play();
      statusRef.current = 'running';
      setStatus('running');
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
            <p className="eyebrow">Acquire</p>
            <h3>{sessionForm.sourceType === 'camera' ? 'Live camera preview' : 'Video-file preview'}</h3>
          </div>
          <p className="section-copy">
            Milestone 2 wires preview, timestamps, metadata capture, and the backend frame-pipeline stub.
          </p>
        </div>

        <div className="preview-status-stack">
          {error ? <StatusBanner tone="error" message={error} /> : null}
          {latestProbe?.warning ? <StatusBanner tone="info" message={latestProbe.warning} /> : null}
        </div>

        <div className="preview-frame">
          <video ref={videoRef} autoPlay muted playsInline controls={sessionForm.sourceType === 'video_file'} />
          {overlayEnabled ? <div className="preview-overlay">Live landmark overlay</div> : null}
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
        <canvas ref={inferenceCanvasRef} className="capture-canvas" />
      </div>

      <div className="acquire-side">
        <div className="card controls-card">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Controls</p>
              <h3>Run pipeline</h3>
            </div>
          </div>
          <div className="control-stack">
            <div className="toggle-row">
              <button className="primary-button" onClick={() => void handleStart()} type="button">
                Start
              </button>
              <button onClick={() => void handleStop()} type="button">
                Stop
              </button>
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
            <label className="field-group">
              <span className="field-label">Trace Window</span>
              <select value={traceWindowSec} onChange={(event) => setTraceWindowSec(Number(event.target.value))}>
                {TRACE_WINDOW_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} s
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">Trace Mode</span>
              <select value={traceMode} onChange={(event) => setTraceMode(event.target.value as typeof traceMode)}>
                <option value="raw">Raw</option>
                <option value="smoothed">Smoothed</option>
                <option value="both">Both</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card metrics-card">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Status</p>
              <h3>Acquisition metrics</h3>
            </div>
          </div>
          <dl className="metric-grid">
            <div>
              <dt>Status</dt>
              <dd>{status}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{elapsedSec.toFixed(2)} s</dd>
            </div>
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
              <dd>{latestProbe?.trackingStatus ?? 'idle'}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>
                {latestProbe
                  ? `${latestProbe.leftTrackingConfidence.toFixed(2)} / ${latestProbe.rightTrackingConfidence.toFixed(2)}`
                  : 'Pending'}
              </dd>
            </div>
            <div>
              <dt>Opening px</dt>
              <dd>
                {latestProbe
                  ? `${latestProbe.leftOpeningPx?.toFixed(1) ?? 'NaN'} / ${latestProbe.rightOpeningPx?.toFixed(1) ?? 'NaN'}`
                  : 'Pending'}
              </dd>
            </div>
            <div>
              <dt>Opening %</dt>
              <dd>
                {latestProbe
                  ? `${latestProbe.leftOpeningPercent?.toFixed(1) ?? 'NaN'} / ${latestProbe.rightOpeningPercent?.toFixed(1) ?? 'NaN'}`
                  : 'Pending'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="card trace-card">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Rolling Trace</p>
              <h3>Live opening trace</h3>
            </div>
          </div>
          <div ref={tracePlotRef} className="plotly-trace" />
          <dl className="metric-grid compact-grid">
            <div>
              <dt>Frames processed</dt>
              <dd>{frameIndexRef.current}</dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>{traceWindowSec} s</dd>
            </div>
            <div>
              <dt>Recent avg fps</dt>
              <dd>{averageRecentFps.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Latest timestamp</dt>
              <dd>{elapsedSec.toFixed(3)} s</dd>
            </div>
          </dl>
          <p className="section-copy">
            Left and right eyelid opening are plotted over the selected rolling window.
          </p>
          {sourceInfo ? (
            <p className="field-helper">
              File source: {sourceInfo.sourceName} ({sourceInfo.frameCount} frames, {sourceInfo.durationSec.toFixed(2)} s)
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
};
