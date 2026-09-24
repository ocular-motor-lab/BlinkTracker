import { useEffect, useMemo, useRef, useState } from 'react';
import { useCameraDiscovery } from '@app/hooks/useCameraDiscovery';
import { useAppStore } from '@app/state/useAppStore';
import { FieldGroup } from '@app/components/FieldGroup';
import { StatusBanner } from '@app/components/StatusBanner';
import { formatStatusLabel } from '@app/utils/display';
import { validateSessionForm } from '@app/utils/validation';
import { createTrackingState, getSharedFaceLandmarker, trackFrame, warmupFaceLandmarker } from '@app/utils/liveTracking';
import { createTrackingAudioAlertController } from '@app/utils/trackingAudioAlert';
import type { CameraInfo, FrameProbeResponse, SessionFormValues } from '@ipc/schemas';

const CALIBRATION_DURATION_SEC = 10;
const INFERENCE_MAX_WIDTH = 480;
type SessionTextKey = {
  [Key in keyof SessionFormValues]: SessionFormValues[Key] extends string ? Key : never;
}[keyof SessionFormValues];
const PRE_SESSION_TEXT_KEYS: SessionTextKey[] = [
  'subjectId',
  'subjectAge',
  'subjectSex',
  'subjectRaceEthnicity',
  'notes',
  'diagnosedDryEye',
  'usesEyeDrops',
  'eyeDropsDetails',
  'eyeDropsLastTwoHours',
  'wearsContactLenses',
  'contactLensType',
  'wornContactsToday',
  'wearingContactLensesNow',
  'wearsGlasses',
  'wearingGlassesToday',
  'recentEyeSurgery',
  'eyeSurgeryDetails',
  'eyeAllergies',
  'eyeAllergyDetails',
  'symptomDryness',
  'symptomTiredness',
  'symptomBurningStinging',
  'symptomBlurryVision',
  'symptomLightSensitivity',
  'sleepHours',
  'consumedCaffeine',
  'caffeineTiming',
  'consumedAlcohol24h',
  'alertnessEyeMeds',
  'feelingSick',
  'stressLevel',
  'energyLevel',
  'screenReadingDurationToday',
  'priorAirConditioningHeating',
  'priorWindSun',
  'dryEnvironmentToday',
  'roomTemperature',
  'deviceUsed',
  'screenBrightness',
  'viewingDistanceCm',
  'currentEmotion'
];

const toMediaUrl = (filePath: string): string => `app-media://local?path=${encodeURIComponent(filePath)}`;

const average = (values: number[]): number | null => {
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
};

const formatCameraMode = (mode: CameraInfo['modes'][number]): string =>
  `${mode.width} x ${mode.height} @ ${mode.fps} FPS`;

const formatCameraModeValue = (mode: CameraInfo['modes'][number]): string =>
  `${mode.width}x${mode.height}@${mode.fps}`;

const formatActualCameraMode = (mode: { width: number; height: number; fps: number }): string =>
  `${mode.width} x ${mode.height} @ ${Number.isFinite(mode.fps) ? mode.fps.toFixed(1) : 'NA'} FPS`;

const formatCameraOptionLabel = (camera: CameraInfo): string => {
  if (!camera.available && !camera.browserDeviceId) {
    return `${camera.label} (not previewable)`;
  }

  return camera.label;
};

const requestCameraStream = async (camera: CameraInfo | undefined): Promise<MediaStream> => {
  if (camera?.browserDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: camera.browserDeviceId } },
        audio: false
      });
    } catch {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }

  return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
};

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
      reject(new Error('Unable to load video metadata for baseline calibration. This file may use a codec the desktop shell cannot decode.'));
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
};

const countBlinkTransitions = (rows: Array<Record<string, unknown>>): number => {
  let count = 0;
  let wasClosed = false;

  for (const row of rows) {
    const isClosed = row.left_closed_touching === 1 || row.right_closed_touching === 1;
    if (isClosed && !wasClosed) {
      count += 1;
    }
    wasClosed = isClosed;
  }

  return count;
};

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

export const SessionPage = (): JSX.Element => {
  const refreshCameras = useCameraDiscovery();
  const calibrationVideoRef = useRef<HTMLVideoElement | null>(null);
  const calibrationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const calibrationStreamRef = useRef<MediaStream | null>(null);
  const calibrationAnimationRef = useRef<number | null>(null);
  const calibrationRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const calibrationTrackingStateRef = useRef(createTrackingState());
  const calibrationTrackerRef = useRef<Awaited<ReturnType<typeof getSharedFaceLandmarker>> | null>(null);
  const calibrationStartRef = useRef(0);
  const calibrationFrameIndexRef = useRef(0);
  const calibrationAudioAlertRef = useRef(createTrackingAudioAlertController());

  const {
    cameras,
    cameraPermissionState,
    sessionForm,
    errorMessage,
    successMessage,
    isLoadingCameras,
    isCreatingSession,
    setErrorMessage,
    setSuccessMessage,
    setLastCreatedSession,
    setActiveTab,
    setSessionFormValue,
    setIsCreatingSession,
    toCreateSessionPayload
  } = useAppStore();
  const [calibrationStatus, setCalibrationStatus] = useState<'idle' | 'previewing' | 'recording' | 'complete'>('idle');
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [calibrationElapsedSec, setCalibrationElapsedSec] = useState(0);
  const [latestCalibrationProbe, setLatestCalibrationProbe] = useState<FrameProbeResponse | null>(null);
  const [autoCameraModeSummary, setAutoCameraModeSummary] = useState<{
    width: number;
    height: number;
    fps: number;
  } | null>(null);

  const availableCameras = useMemo(() => cameras.filter((camera) => camera.available), [cameras]);
  const selectableCameras = useMemo(
    () => cameras.filter((camera) => camera.label !== 'No available camera detected'),
    [cameras]
  );
  const validationErrors = useMemo(() => validateSessionForm(sessionForm), [sessionForm]);
  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.deviceId === sessionForm.cameraDeviceId),
    [cameras, sessionForm.cameraDeviceId]
  );
  const calibrationOverlaySourceWidth = calibrationCanvasRef.current?.width || 1;
  const calibrationOverlaySourceHeight = calibrationCanvasRef.current?.height || 1;
  const calibrationDisplayedVideoRect = getDisplayedVideoRect(
    calibrationVideoRef.current,
    calibrationCanvasRef.current
      ? { width: calibrationOverlaySourceWidth, height: calibrationOverlaySourceHeight }
      : null
  );

  useEffect(() => {
    warmupFaceLandmarker();
    return () => {
      if (calibrationAnimationRef.current !== null) {
        cancelAnimationFrame(calibrationAnimationRef.current);
      }
      calibrationAudioAlertRef.current.reset();
      calibrationStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    setAutoCameraModeSummary(null);
  }, [sessionForm.cameraDeviceId, sessionForm.sourceType]);

  const browseOutputFolder = async () => {
    const selected = await window.electronAPI?.chooseOutputFolder();
    if (selected) {
      setSessionFormValue('outputFolder', selected);
    }
  };

  const browseVideoFile = async () => {
    const selected = await window.electronAPI?.chooseVideoFile();
    if (selected) {
      setSessionFormValue('videoFilePath', selected);
    }
  };

  const drawCalibrationFrame = (video: HTMLVideoElement, width: number, height: number): HTMLCanvasElement | null => {
    const canvas = calibrationCanvasRef.current;
    if (!canvas) {
      return null;
    }

    const scale = width > INFERENCE_MAX_WIDTH ? INFERENCE_MAX_WIDTH / width : 1;
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const startCalibrationPreview = async (): Promise<{
    width: number;
    height: number;
    fps: number;
    sourceName: string;
    sourceType: typeof sessionForm.sourceType;
  } | null> => {
    const video = calibrationVideoRef.current;
    if (!video) {
      return null;
    }

    setCalibrationError(null);

    if (sessionForm.sourceType === 'video_file') {
      setAutoCameraModeSummary(null);
      if (!sessionForm.videoFilePath.trim()) {
        setCalibrationError('Choose a video file before recording the baseline.');
        return null;
      }

      calibrationStreamRef.current?.getTracks().forEach((track) => track.stop());
      calibrationStreamRef.current = null;
      video.srcObject = null;
      video.src = toMediaUrl(sessionForm.videoFilePath);
      video.muted = true;
      video.load();

      try {
        await waitForVideoMetadata(video);
        video.currentTime = 0;
        await video.play();
        const summary = {
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          fps: 30,
          sourceName: sessionForm.videoFilePath.split(/[\\/]/).pop() || 'Video File',
          sourceType: sessionForm.sourceType
        };
        setCalibrationStatus('previewing');
        return summary;
      } catch (reason) {
        setCalibrationError(reason instanceof Error ? reason.message : 'Unable to start video baseline calibration.');
        return null;
      }
    }

    if (calibrationStreamRef.current) {
      await video.play();
      const trackSettings = calibrationStreamRef.current.getVideoTracks()[0]?.getSettings();
      const summary = {
        width: video.videoWidth || trackSettings?.width || 0,
        height: video.videoHeight || trackSettings?.height || 0,
        fps: Number(trackSettings?.frameRate ?? 30),
        sourceName: selectedCamera?.label ?? 'Live Camera',
        sourceType: sessionForm.sourceType
      };
      setAutoCameraModeSummary({ width: summary.width, height: summary.height, fps: summary.fps });
      return summary;
    }

    try {
      const stream = await requestCameraStream(selectedCamera);
      calibrationStreamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      const trackSettings = stream.getVideoTracks()[0]?.getSettings();
      const summary = {
        width: video.videoWidth || trackSettings?.width || 0,
        height: video.videoHeight || trackSettings?.height || 0,
        fps: Number(trackSettings?.frameRate ?? 30),
        sourceName: selectedCamera?.label ?? 'Live Camera',
        sourceType: sessionForm.sourceType
      };
      setAutoCameraModeSummary({ width: summary.width, height: summary.height, fps: summary.fps });
      setCalibrationStatus('previewing');
      return summary;
    } catch (reason) {
      setCalibrationError(reason instanceof Error ? reason.message : 'Unable to start live camera calibration.');
      return null;
    }
  };

  const finishCalibrationRecording = (rows: Array<Record<string, unknown>>) => {
    const leftOpeningPx = rows
      .map((row) => row.left_opening_px)
      .filter((value): value is number => typeof value === 'number');
    const rightOpeningPx = rows
      .map((row) => row.right_opening_px)
      .filter((value): value is number => typeof value === 'number');
    const leftOpeningPercent = rows
      .map((row) => row.left_opening_percent)
      .filter((value): value is number => typeof value === 'number');
    const rightOpeningPercent = rows
      .map((row) => row.right_opening_percent)
      .filter((value): value is number => typeof value === 'number');
    const leftClosedFrames = rows.filter((row) => row.left_closed_touching === 1).length;
    const rightClosedFrames = rows.filter((row) => row.right_closed_touching === 1).length;
    const baselineBlinkCount = countBlinkTransitions(rows);

    const summary = {
      duration_sec: CALIBRATION_DURATION_SEC,
      frame_count: rows.length,
      baseline_blink_count: baselineBlinkCount,
      baseline_blink_rate_per_min: (baselineBlinkCount / CALIBRATION_DURATION_SEC) * 60,
      left_mean_opening_px: average(leftOpeningPx),
      right_mean_opening_px: average(rightOpeningPx),
      left_reference_max_px: calibrationTrackingStateRef.current.leftReferenceMax,
      right_reference_max_px: calibrationTrackingStateRef.current.rightReferenceMax,
      left_mean_opening_percent: average(leftOpeningPercent),
      right_mean_opening_percent: average(rightOpeningPercent),
      left_closed_frame_count: leftClosedFrames,
      right_closed_frame_count: rightClosedFrames
    };

    setSessionFormValue('calibrationFrameRows', rows);
    setSessionFormValue('calibrationSummary', summary);
    setSessionFormValue('calibrationReminderAcknowledged', true);
    setSessionFormValue(
      'restingPalpebralAperture',
      `L ${summary.left_mean_opening_px?.toFixed(1) ?? 'NA'} px / R ${summary.right_mean_opening_px?.toFixed(1) ?? 'NA'} px`
    );
    setCalibrationStatus('complete');
  };

  const startCalibrationRecording = async () => {
    if (calibrationAnimationRef.current !== null) {
      cancelAnimationFrame(calibrationAnimationRef.current);
      calibrationAnimationRef.current = null;
    }

    const source = await startCalibrationPreview();
    const video = calibrationVideoRef.current;
    if (!source || !video) {
      return;
    }

    calibrationRowsRef.current = [];
    calibrationTrackingStateRef.current = createTrackingState();
    calibrationAudioAlertRef.current.reset();
    calibrationFrameIndexRef.current = 0;
    calibrationStartRef.current = performance.now();
    setSessionFormValue('calibrationFrameRows', []);
    setSessionFormValue('calibrationSummary', null);
    setSessionFormValue('calibrationReminderAcknowledged', false);
    setCalibrationElapsedSec(0);
    setLatestCalibrationProbe(null);
    setCalibrationStatus('recording');

    const loop = async () => {
      if (!video || video.readyState < 2) {
        calibrationAnimationRef.current = requestAnimationFrame(() => {
          void loop();
        });
        return;
      }

      const elapsedSec =
        source.sourceType === 'video_file'
          ? video.currentTime
          : (performance.now() - calibrationStartRef.current) / 1000;
      if (elapsedSec >= CALIBRATION_DURATION_SEC) {
        calibrationAnimationRef.current = null;
        if (source.sourceType === 'video_file') {
          video.pause();
        }
        finishCalibrationRecording([...calibrationRowsRef.current]);
        return;
      }

      const canvas = drawCalibrationFrame(video, source.width, source.height);
      if (canvas) {
        const tracker = calibrationTrackerRef.current ?? (await getSharedFaceLandmarker());
        calibrationTrackerRef.current = tracker;
        const { probe, row } = await trackFrame(
          tracker,
          canvas,
          calibrationFrameIndexRef.current++,
          elapsedSec,
          source.fps,
          source.sourceType,
          `${source.sourceName} baseline calibration`,
          'baseline_calibration',
          calibrationTrackingStateRef.current
        );
        calibrationRowsRef.current.push(row);
        setLatestCalibrationProbe(probe);
        calibrationAudioAlertRef.current.maybeAlert(probe.trackingAlertReason, source.sourceType === 'camera');
      }

      setCalibrationElapsedSec(elapsedSec);
      calibrationAnimationRef.current = requestAnimationFrame(() => {
        void loop();
      });
    };

    calibrationAnimationRef.current = requestAnimationFrame(() => {
      void loop();
    });
  };

  const handleSubmit = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (validationErrors.length > 0) {
      setErrorMessage(validationErrors.join(' '));
      return;
    }

    if (!window.electronAPI) {
      setErrorMessage('Electron preload API unavailable.');
      return;
    }

    setIsCreatingSession(true);

    try {
      const response = await window.electronAPI.createSession(toCreateSessionPayload());
      setLastCreatedSession(response);
      PRE_SESSION_TEXT_KEYS.forEach((key) => setSessionFormValue(key, ''));
      setSuccessMessage(`Session created at ${response.paths.sessionFolder}`);
      setActiveTab('acquire');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create session.');
    } finally {
      setIsCreatingSession(false);
    }
  };

  return (
    <section className="session-layout">
      <div className="card session-form-card">
        <div className="section-heading">
          <div>
            <h3>Recording Setup</h3>
          </div>
          <p className="section-copy">
            Choose the recording source, baseline calibration, output folder, and camera capture settings.
          </p>
        </div>

        {errorMessage ? <StatusBanner tone="error" message={errorMessage} /> : null}
        {successMessage ? <StatusBanner tone="success" message={successMessage} /> : null}

        <div className="form-grid">
          <div className="compact-field-grid two-column">
            <input
              aria-label="Session name"
              value={sessionForm.sessionName}
              onChange={(event) => setSessionFormValue('sessionName', event.target.value)}
              placeholder="Session name"
            />
            <input
              aria-label="Session date"
              value={sessionForm.sessionDate}
              onChange={(event) => setSessionFormValue('sessionDate', event.target.value)}
              type="date"
            />
          </div>

          <FieldGroup label="Source Type">
            <div className="toggle-row">
              <button
                className={sessionForm.sourceType === 'camera' ? 'selected' : ''}
                onClick={() => setSessionFormValue('sourceType', 'camera')}
                type="button"
              >
                Live Camera
              </button>
              <button
                className={sessionForm.sourceType === 'video_file' ? 'selected' : ''}
                onClick={() => setSessionFormValue('sourceType', 'video_file')}
                type="button"
              >
                Video File
              </button>
            </div>
          </FieldGroup>

          {sessionForm.sourceType === 'camera' ? (
            <FieldGroup
              label="Camera"
              helper={isLoadingCameras ? 'Enumerating cameras...' : 'Defaults to the first available device.'}
            >
              <div className="picker-stack">
                <div className="path-picker">
                  <select
                    className={!sessionForm.cameraDeviceId ? 'select-placeholder' : ''}
                    value={sessionForm.cameraDeviceId}
                    onChange={(event) => {
                      setSessionFormValue('cameraDeviceId', event.target.value);
                      setSessionFormValue('cameraMode', '');
                    }}
                    disabled={isLoadingCameras || selectableCameras.length === 0}
                  >
                    <option value="">
                      {selectableCameras.length > 0 ? 'Select camera' : 'No cameras detected'}
                    </option>
                    {selectableCameras.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {formatCameraOptionLabel(camera)}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => void refreshCameras()} type="button">
                    Refresh
                  </button>
                </div>
                <span className="field-helper">
                  {cameraPermissionState === 'denied'
                    ? 'Camera permission was denied in the renderer. Grant access in macOS and refresh.'
                    : availableCameras.length > 0
                      ? `${availableCameras.length} available camera${availableCameras.length === 1 ? '' : 's'} detected.`
                      : selectableCameras.length > 0
                        ? `${selectableCameras.length} camera device${selectableCameras.length === 1 ? '' : 's'} detected. Browser preview will use the matched browser camera when available.`
                        : 'No cameras are currently detectable. Check camera permissions or device access.'}
                </span>
              </div>
            </FieldGroup>
          ) : (
            <FieldGroup label="Video File">
              <div className="path-picker">
                <input
                  value={sessionForm.videoFilePath}
                  onChange={(event) => setSessionFormValue('videoFilePath', event.target.value)}
                  placeholder="Choose an .mp4, .mov, .avi, or .mkv file"
                />
                <button onClick={() => void browseVideoFile()} type="button">
                  Browse
                </button>
              </div>
            </FieldGroup>
          )}

          <div className="form-section">
            <div className="section-heading compact calibration-heading">
              <div>
                <h3>Blink Calibration</h3>
              </div>
              <p className="section-copy">
                Record 10 seconds of the subject blinking naturally, then record the resting palpebral aperture before any task begins.
              </p>
              <p className="field-helper">
                Use bright, even frontal lighting and keep the eyes clearly in frame; poor lighting can make blinks harder to classify.
              </p>
            </div>
            {calibrationError ? <StatusBanner tone="error" message={calibrationError} /> : null}
            <div className="calibration-recorder">
              <div className="calibration-preview-frame">
                <video ref={calibrationVideoRef} autoPlay muted playsInline />
                {latestCalibrationProbe?.landmarkPreview?.length ? (
                  <div className="landmark-layer">
                    {latestCalibrationProbe.landmarkPreview.map((point, index) => (
                      <span
                        key={`${point.kind}-${index}`}
                        className={`landmark-dot ${point.kind}`}
                        style={
                          calibrationDisplayedVideoRect
                            ? {
                                left: `${
                                  calibrationDisplayedVideoRect.left +
                                  (point.x / calibrationOverlaySourceWidth) * calibrationDisplayedVideoRect.width
                                }px`,
                                top: `${
                                  calibrationDisplayedVideoRect.top +
                                  (point.y / calibrationOverlaySourceHeight) * calibrationDisplayedVideoRect.height
                                }px`
                              }
                            : {
                                left: `${(point.x / calibrationOverlaySourceWidth) * 100}%`,
                                top: `${(point.y / calibrationOverlaySourceHeight) * 100}%`
                              }
                        }
                      />
                    ))}
                  </div>
                ) : null}
                <canvas ref={calibrationCanvasRef} className="capture-canvas" />
                <div className="calibration-preview-badge">
                  {calibrationStatus === 'recording'
                    ? `Recording ${Math.min(CALIBRATION_DURATION_SEC, calibrationElapsedSec).toFixed(1)}s`
                    : calibrationStatus === 'complete'
                      ? 'Baseline complete'
                      : 'Live baseline preview'}
                </div>
              </div>
              <div className="calibration-controls">
                <button
                  className="primary-button"
                  disabled={
                    calibrationStatus === 'recording' ||
                    (sessionForm.sourceType === 'camera' && !sessionForm.cameraDeviceId) ||
                    (sessionForm.sourceType === 'video_file' && !sessionForm.videoFilePath.trim())
                  }
                  onClick={() => void startCalibrationRecording()}
                  type="button"
                >
                  {calibrationStatus === 'recording' ? 'Recording Baseline...' : 'Record 10-Second Baseline'}
                </button>
                <div className="calibration-metrics">
                  <div>
                    <span>Status</span>
                    <strong>{formatStatusLabel(calibrationStatus)}</strong>
                  </div>
                  <div>
                    <span>Frames</span>
                    <strong>{sessionForm.calibrationFrameRows.length || calibrationRowsRef.current.length}</strong>
                  </div>
                  <div>
                    <span>Opening px</span>
                    <strong>
                      {latestCalibrationProbe
                        ? `${latestCalibrationProbe.leftOpeningPx?.toFixed(1) ?? 'NA'} / ${latestCalibrationProbe.rightOpeningPx?.toFixed(1) ?? 'NA'}`
                        : 'Pending'}
                    </strong>
                  </div>
                  <div>
                    <span>Closed</span>
                    <strong>
                      {latestCalibrationProbe
                        ? `${latestCalibrationProbe.leftClosedTouching ? 'L' : '-'} / ${latestCalibrationProbe.rightClosedTouching ? 'R' : '-'}`
                        : 'Pending'}
                    </strong>
                  </div>
                </div>
                {latestCalibrationProbe?.warning ? (
                  <p className="field-helper quality-flag-note">{latestCalibrationProbe.warning}</p>
                ) : null}
                <input
                  aria-label="Resting palpebral aperture"
                  value={sessionForm.restingPalpebralAperture}
                  onChange={(event) => setSessionFormValue('restingPalpebralAperture', event.target.value)}
                  placeholder="Resting palpebral aperture"
                />
                {sessionForm.calibrationSummary ? (
                  <p className="field-helper">
                    Baseline saved from {String(sessionForm.calibrationSummary.frame_count ?? 0)} frames. This will be saved
                    with the session for subject-specific blink interpretation.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <FieldGroup label="Output Folder">
            <div className="path-picker">
              <input
                value={sessionForm.outputFolder}
                onChange={(event) => setSessionFormValue('outputFolder', event.target.value)}
                placeholder="Choose where the session bundle will be created"
              />
              <button onClick={() => void browseOutputFolder()} type="button">
                Browse
              </button>
            </div>
            {sessionForm.outputFolder ? (
              <span className="field-helper">Last used output folder is remembered for the next session.</span>
            ) : null}
          </FieldGroup>

          <FieldGroup label="Save Raw Video" helper="Only applies to live camera sessions.">
            <label className="checkbox-row">
              <input
                checked={sessionForm.saveRawVideo}
                onChange={(event) => setSessionFormValue('saveRawVideo', event.target.checked)}
                type="checkbox"
              />
              <span>Save raw camera recording into the session bundle</span>
            </label>
          </FieldGroup>

          {sessionForm.sourceType === 'camera' ? (
            <FieldGroup
              label="Capture Mode"
              helper="Higher FPS can improve blink timing. Higher resolution can improve detail but may reduce FPS."
            >
              <select
                className={!sessionForm.cameraMode ? 'select-placeholder' : ''}
                value={sessionForm.cameraMode}
                onChange={(event) => setSessionFormValue('cameraMode', event.target.value)}
                disabled={!selectedCamera?.modes?.length}
              >
                <option value="">
                  {autoCameraModeSummary
                    ? `Auto - currently ${formatActualCameraMode(autoCameraModeSummary)}`
                    : 'Auto - default resolution/FPS detected when camera opens'}
                </option>
                {selectedCamera?.modes
                  ?.slice()
                  .sort((left, right) => {
                    if (left.fps !== right.fps) {
                      return right.fps - left.fps;
                    }
                    return right.width * right.height - left.width * left.height;
                  })
                  .map((mode) => (
                    <option key={formatCameraModeValue(mode)} value={formatCameraModeValue(mode)}>
                      {formatCameraMode(mode)}
                    </option>
                  ))}
              </select>
              <span className="field-helper">
                Auto shows the actual resolution and FPS after BlinkTracker opens the camera. Preset modes request a
                target setting, but the camera may still negotiate the closest supported mode.
              </span>
            </FieldGroup>
          ) : null}

        </div>

        <div className="action-row">
          <button className="primary-button" disabled={isCreatingSession} onClick={() => void handleSubmit()} type="button">
            {isCreatingSession ? 'Creating Session...' : 'Create Session'}
          </button>
        </div>
      </div>

    </section>
  );
};
