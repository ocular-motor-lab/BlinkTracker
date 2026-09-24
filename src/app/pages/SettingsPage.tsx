import { useAppStore } from '@app/state/useAppStore';

export const SettingsPage = (): JSX.Element => {
  const preferences = useAppStore((state) => state.preferences);
  const sessionForm = useAppStore((state) => state.sessionForm);
  const setPreference = useAppStore((state) => state.setPreference);
  const clearRememberedOutputFolder = useAppStore((state) => state.clearRememberedOutputFolder);
  const resetSessionForm = useAppStore((state) => state.resetSessionForm);

  return (
    <section className="session-layout">
      <div className="card session-form-card">
        <div className="section-heading">
          <div>
            <h3>Application settings</h3>
          </div>
          <p className="section-copy">
            Tune the defaults used when you start a new session. These preferences are stored locally on this machine.
          </p>
        </div>

        <div className="form-grid">
          <div className="field-group">
            <label>Default Source Type</label>
            <div className="toggle-row">
              <button
                className={preferences.defaultSourceType === 'camera' ? 'selected' : ''}
                onClick={() => setPreference('defaultSourceType', 'camera')}
                type="button"
              >
                Live Camera
              </button>
              <button
                className={preferences.defaultSourceType === 'video_file' ? 'selected' : ''}
                onClick={() => setPreference('defaultSourceType', 'video_file')}
                type="button"
              >
                Video File
              </button>
            </div>
            <span className="field-helper">Used as the default source type when you reset or start a fresh session setup.</span>
          </div>

          <div className="field-group">
            <label>Acquisition Defaults</label>
            <label className="checkbox-row">
              <input
                checked={preferences.defaultSaveRawVideo}
                onChange={(event) => setPreference('defaultSaveRawVideo', event.target.checked)}
                type="checkbox"
              />
              <span>Save raw video by default for live camera sessions</span>
            </label>
          </div>

          <div className="field-group">
            <label>Stored Output Folder</label>
            <div className="settings-inline-row">
              <code className="settings-value">{sessionForm.outputFolder || 'No folder remembered yet.'}</code>
              <button onClick={() => clearRememberedOutputFolder()} type="button">
                Clear
              </button>
            </div>
            <span className="field-helper">The last output folder is remembered and prefilled on the Session page.</span>
          </div>

          <div className="field-group">
            <label>Session Form</label>
            <div className="settings-inline-row">
              <span className="field-helper">Reset the Session page to the current defaults while keeping the rest of the app unchanged.</span>
              <button onClick={() => resetSessionForm()} type="button">
                Reset Session Form
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card session-summary-card">
        <div className="section-heading">
          <div>
            <h3>At a glance</h3>
          </div>
          <p className="section-copy">These values are currently active and will be applied to future session setup by default.</p>
        </div>

        <ul className="summary-list">
          <li>Default source: {preferences.defaultSourceType === 'camera' ? 'Live camera' : 'Video file'}</li>
          <li>Default raw video saving: {preferences.defaultSaveRawVideo ? 'On' : 'Off'}</li>
          <li>Remembered output folder: {sessionForm.outputFolder || 'None stored'}</li>
        </ul>
      </div>
    </section>
  );
};
