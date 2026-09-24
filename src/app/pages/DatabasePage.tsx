import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBanner } from '@app/components/StatusBanner';
import { useAppStore } from '@app/state/useAppStore';
import type { SessionDatabaseRow } from '@ipc/schemas';

const formatDate = (row: SessionDatabaseRow): string => {
  if (row.sessionDate) {
    return row.sessionDate;
  }
  if (!row.createdAt) {
    return 'NA';
  }
  const date = new Date(row.createdAt);
  return Number.isNaN(date.getTime()) ? row.createdAt : date.toLocaleDateString();
};

const formatDuration = (durationSec: number): string => {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 'NA';
  }
  const minutes = Math.floor(durationSec / 60);
  const seconds = Math.round(durationSec % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

export const DatabasePage = (): JSX.Element => {
  const sessionForm = useAppStore((state) => state.sessionForm);
  const lastCreatedSession = useAppStore((state) => state.lastCreatedSession);
  const setSessionFormValue = useAppStore((state) => state.setSessionFormValue);
  const setAnalysisSession = useAppStore((state) => state.setAnalysisSession);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const [rootFolder, setRootFolder] = useState(sessionForm.outputFolder);
  const [sessions, setSessions] = useState<SessionDatabaseRow[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [openingFolder, setOpeningFolder] = useState<string | null>(null);
  const [notesByFolder, setNotesByFolder] = useState<Record<string, string>>({});
  const [savingNotesFolder, setSavingNotesFolder] = useState<string | null>(null);
  const notesSaveTimersRef = useRef<Record<string, number>>({});

  const loadDatabase = async (folder = rootFolder) => {
    if (!window.electronAPI) {
      setError('Electron preload API unavailable.');
      return;
    }
    if (!folder.trim()) {
      setError('Choose the folder where BlinkTracker saves sessions.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await window.electronAPI.listSessions({ rootFolder: folder });
      setRootFolder(response.rootFolder);
      setSessions(response.sessions);
      setNotesByFolder(
        Object.fromEntries(response.sessions.map((session) => [session.sessionFolder, session.databaseNotes || '']))
      );
      setSuccessMessage(
        `Found ${response.sessions.length} session${response.sessions.length === 1 ? '' : 's'}. Spreadsheet updated: ${response.sessionIndexXlsxPath}. CSV updated: ${response.sessionIndexPath}`
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load sessions.');
    } finally {
      setIsLoading(false);
    }
  };

  const chooseDatabaseFolder = async () => {
    const selected = await window.electronAPI?.chooseOutputFolder();
    if (!selected) {
      return;
    }
    setRootFolder(selected);
    setSessionFormValue('outputFolder', selected);
    await loadDatabase(selected);
  };

  const openForAnalysis = async (sessionFolder: string) => {
    if (!window.electronAPI) {
      setError('Electron preload API unavailable.');
      return;
    }

    setOpeningFolder(sessionFolder);
    setError(null);
      setSuccessMessage(null);
    try {
      let session = await window.electronAPI.loadSession({ sessionFolder });
      const hasSavedBlinkRows = session.blinkRows.length > 0;

      if (!hasSavedBlinkRows && session.frameRows.length > 0) {
        await window.electronAPI.detectBlinks({
          sessionFolder
        });
        session = await window.electronAPI.loadSession({ sessionFolder });
      }

      setAnalysisSession(session);
      setActiveTab('analysis');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open session.');
    } finally {
      setOpeningFolder(null);
    }
  };

  const saveSessionNotes = async (sessionFolder: string, notes: string) => {
    if (!window.electronAPI) {
      return;
    }

    setSavingNotesFolder(sessionFolder);
    setError(null);
    setSuccessMessage(null);
    try {
      await window.electronAPI.updateSessionMetadata({
        sessionFolder,
        updates: {
          database_notes: notes,
          database_notes_updated_at: new Date().toISOString()
        }
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save session notes.');
    } finally {
      setSavingNotesFolder((current) => (current === sessionFolder ? null : current));
    }
  };

  const updateSessionNotes = (sessionFolder: string, notes: string) => {
    setNotesByFolder((previous) => ({ ...previous, [sessionFolder]: notes }));
    setSessions((previous) =>
      previous.map((session) =>
        session.sessionFolder === sessionFolder ? { ...session, databaseNotes: notes } : session
      )
    );
    window.clearTimeout(notesSaveTimersRef.current[sessionFolder]);
    notesSaveTimersRef.current[sessionFolder] = window.setTimeout(() => {
      void saveSessionNotes(sessionFolder, notes);
    }, 700);
  };

  useEffect(() => {
    if (rootFolder) {
      void loadDatabase(rootFolder);
    }
  }, []);

  useEffect(() => {
    if (rootFolder && lastCreatedSession?.paths.sessionFolder) {
      void loadDatabase(rootFolder);
    }
  }, [lastCreatedSession?.paths.sessionFolder]);

  useEffect(() => {
    return () => {
      Object.values(notesSaveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const filteredSessions = useMemo(() => {
    const normalizedSubject = subjectFilter.trim().toLowerCase();
    const normalizedDate = dateFilter.trim().toLowerCase();
    return sessions.filter((session) => {
      const subjectMatches = !normalizedSubject || session.subjectId.toLowerCase().includes(normalizedSubject);
      const dateText = `${session.sessionDate} ${session.createdAt}`.toLowerCase();
      const dateMatches = !normalizedDate || dateText.includes(normalizedDate);
      return subjectMatches && dateMatches;
    });
  }, [dateFilter, sessions, subjectFilter]);

  return (
    <section className="database-layout">
      <div className="card">
        <div className="section-heading compact">
          <div>
            <h3>Past sessions</h3>
          </div>
          <p className="section-copy">Find a saved session and open it directly in Analysis.</p>
        </div>

        {error ? <StatusBanner tone="error" message={error} /> : null}
        {successMessage ? <StatusBanner tone="success" message={successMessage} /> : null}

        <div className="database-toolbar">
          <div className="path-picker database-folder-picker">
            <input
              aria-label="Session database folder"
              onChange={(event) => setRootFolder(event.target.value)}
              placeholder="Folder where sessions are saved"
              value={rootFolder}
            />
            <button onClick={() => void chooseDatabaseFolder()} type="button">
              Choose Folder
            </button>
            <button disabled={isLoading} onClick={() => void loadDatabase()} type="button">
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="compact-field-grid two-column">
            <input
              aria-label="Filter by subject ID"
              onChange={(event) => setSubjectFilter(event.target.value)}
              placeholder="Search Subject ID"
              value={subjectFilter}
            />
            <input
              aria-label="Filter by date"
              onChange={(event) => setDateFilter(event.target.value)}
              placeholder="Search Date"
              value={dateFilter}
            />
          </div>
        </div>

        <div className="database-table-shell">
            <table className="database-table">
              <thead>
                <tr>
                  <th>Subject ID</th>
                  <th>Date</th>
                  <th>Session</th>
                  <th>Duration</th>
                  <th>Blinks</th>
                  <th>Source</th>
                  <th>Analysis</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <span className="field-helper">No sessions match the current filters.</span>
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((session) => (
                    <tr key={session.sessionFolder}>
                      <td>{session.subjectId || 'NA'}</td>
                      <td>{formatDate(session)}</td>
                      <td>
                        <span className="database-session-name">{session.sessionName}</span>
                        <small>{session.sessionFolder}</small>
                        {session.error ? <small className="database-row-error">{session.error}</small> : null}
                      </td>
                      <td>{formatDuration(session.durationSec)}</td>
                      <td>{session.blinkCount}</td>
                      <td>{session.sourceType || 'NA'}</td>
                      <td>
                        <div className="database-row-actions">
                          <button
                            className="primary-button database-open-button"
                            disabled={openingFolder === session.sessionFolder}
                            onClick={(event) => {
                              event.stopPropagation();
                              void openForAnalysis(session.sessionFolder);
                            }}
                            type="button"
                          >
                            {openingFolder === session.sessionFolder ? 'Opening...' : 'Open Analysis'}
                          </button>
                        </div>
                      </td>
                      <td>
                        <textarea
                          aria-label={`Notes for ${session.sessionName}`}
                          className="database-inline-notes"
                          onChange={(event) => updateSessionNotes(session.sessionFolder, event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          placeholder="Type session notes here."
                          value={notesByFolder[session.sessionFolder] ?? session.databaseNotes ?? ''}
                        />
                        {savingNotesFolder === session.sessionFolder ? (
                          <small className="database-notes-saving">Saving...</small>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
        </div>
      </div>
    </section>
  );
};
