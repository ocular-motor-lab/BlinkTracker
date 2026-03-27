import { useMemo } from 'react';
import { useCameraDiscovery } from '@app/hooks/useCameraDiscovery';
import { useAppStore } from '@app/state/useAppStore';
import { FieldGroup } from '@app/components/FieldGroup';
import { StatusBanner } from '@app/components/StatusBanner';
import { validateSessionForm } from '@app/utils/validation';

export const SessionPage = (): JSX.Element => {
  const refreshCameras = useCameraDiscovery();

  const {
    cameras,
    cameraPermissionState,
    sessionForm,
    errorMessage,
    successMessage,
    isLoadingCameras,
    isCreatingSession,
    lastCreatedSession,
    setErrorMessage,
    setSuccessMessage,
    setLastCreatedSession,
    setActiveTab,
    setSessionFormValue,
    setIsCreatingSession,
    toCreateSessionPayload
  } = useAppStore();

  const availableCameras = useMemo(() => cameras.filter((camera) => camera.available), [cameras]);
  const selectableCameras = useMemo(
    () => cameras.filter((camera) => camera.label !== 'No available camera detected'),
    [cameras]
  );
  const validationErrors = useMemo(() => validateSessionForm(sessionForm), [sessionForm]);

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
            <p className="eyebrow">Source</p>
            <h3>Create a recording session</h3>
          </div>
          <p className="section-copy">
            Start with the source, output destination, and metadata stub required by later acquisition milestones.
          </p>
        </div>

        {errorMessage ? <StatusBanner tone="error" message={errorMessage} /> : null}
        {successMessage ? <StatusBanner tone="success" message={successMessage} /> : null}

        <div className="form-grid">
          <FieldGroup label="Session Name">
            <input
              value={sessionForm.sessionName}
              onChange={(event) => setSessionFormValue('sessionName', event.target.value)}
              placeholder="subject_001_day1"
            />
          </FieldGroup>

          <FieldGroup label="Subject ID" helper="Optional, stored in session metadata.">
            <input
              value={sessionForm.subjectId}
              onChange={(event) => setSessionFormValue('subjectId', event.target.value)}
              placeholder="SUBJ-001"
            />
          </FieldGroup>

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
                    value={sessionForm.cameraDeviceId}
                    onChange={(event) => setSessionFormValue('cameraDeviceId', event.target.value)}
                    disabled={isLoadingCameras || selectableCameras.length === 0}
                  >
                    <option value="">
                      {selectableCameras.length > 0 ? 'Select camera' : 'No cameras detected'}
                    </option>
                    {selectableCameras.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {camera.available || camera.browserDeviceId
                          ? camera.label
                          : `${camera.label} (not previewable)`}
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
            <FieldGroup label="Capture Resolution" helper="Higher resolution can improve detail but may reduce FPS.">
              <label className="checkbox-row">
                <input
                  checked={sessionForm.preferHighResolution}
                  onChange={(event) => setSessionFormValue('preferHighResolution', event.target.checked)}
                  type="checkbox"
                />
                <span>Prefer highest advertised camera mode</span>
              </label>
            </FieldGroup>
          ) : null}

          <FieldGroup label="Notes" helper="Optional session notes stored in the metadata stub.">
            <textarea
              value={sessionForm.notes}
              onChange={(event) => setSessionFormValue('notes', event.target.value)}
              rows={5}
              placeholder="Frontal lighting, no glasses, minimal head motion."
            />
          </FieldGroup>
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={isCreatingSession} onClick={() => void handleSubmit()} type="button">
            {isCreatingSession ? 'Creating Session...' : 'Create Session'}
          </button>
        </div>
      </div>

      <div className="card session-summary-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Session Bundle</p>
            <h3>Milestone 1 outputs</h3>
          </div>
          <p className="section-copy">
            The app writes the metadata stub and initializes the files needed by later tracking and analysis milestones.
          </p>
        </div>

        <ul className="summary-list">
          <li>Creates a session folder under the selected output directory.</li>
          <li>Initializes `framewise_measurements.csv`, `blink_events.csv`, `session_metadata.json`, and `audit_log.json`.</li>
          <li>Preserves exact schema constants for framewise and blink exports.</li>
        </ul>

        {lastCreatedSession ? (
          <div className="session-paths">
            <h4>Latest session</h4>
            <p>{lastCreatedSession.paths.sessionFolder}</p>
            <code>{lastCreatedSession.paths.metadataJsonPath}</code>
            <div className="action-row">
              <button onClick={() => setActiveTab('analysis')} type="button">
                Open In Analysis
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};
