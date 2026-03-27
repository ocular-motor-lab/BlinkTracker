import { useAppStore } from '@app/state/useAppStore';

export const ExportPage = (): JSX.Element => {
  const analysisSession = useAppStore((state) => state.analysisSession);
  const lastCreatedSession = useAppStore((state) => state.lastCreatedSession);

  const session = analysisSession ?? lastCreatedSession;

  if (!session) {
    return (
      <section className="placeholder-card">
        <h3>No session loaded</h3>
        <p>Load a session in Analysis or create one in Session Setup to review the CSV export bundle.</p>
      </section>
    );
  }

  const blinkCount = 'blinkRows' in session ? session.blinkRows.length : 0;
  const frameCount = 'frameRows' in session ? session.frameRows.length : 0;

  return (
    <section className="session-layout">
      <div className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Export</p>
            <h3>Session outputs</h3>
          </div>
          <p className="section-copy">
            Blink detection and manual edits write directly into the session bundle. These are the current export targets.
          </p>
        </div>
        <dl className="metric-grid">
          <div>
            <dt>Framewise rows</dt>
            <dd>{frameCount}</dd>
          </div>
          <div>
            <dt>Blink rows</dt>
            <dd>{blinkCount}</dd>
          </div>
        </dl>
        <div className="session-paths">
          <h4>Export paths</h4>
          <p>{session.paths.sessionFolder}</p>
          <code>{session.paths.framewiseCsvPath}</code>
          <code>{session.paths.blinkCsvPath}</code>
          <code>{session.paths.metadataJsonPath}</code>
        </div>
      </div>

      <div className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Notes</p>
            <h3>Current behavior</h3>
          </div>
        </div>
        <ul className="summary-list">
          <li>`framewise_measurements.csv` includes the four required blink columns.</li>
          <li>`blink_events.csv` is regenerated after auto-detection and after saving manual edits.</li>
          <li>The session folder remains the single local-first source of truth for exports.</li>
        </ul>
      </div>
    </section>
  );
};
