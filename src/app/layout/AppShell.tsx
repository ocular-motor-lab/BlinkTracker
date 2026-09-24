import { useState } from 'react';
import type { AppTab } from '@ipc/schemas';
import { NAV_ITEMS } from '@app/utils/navigation';
import { useAppStore } from '@app/state/useAppStore';
import { PreSessionPage } from '@app/pages/PreSessionPage';
import { SessionPage } from '@app/pages/SessionPage';
import { AcquirePage } from '@app/pages/AcquirePage';
import { PostSessionPage } from '@app/pages/PostSessionPage';
import { DatabasePage } from '@app/pages/DatabasePage';
import { AnalysisPage } from '@app/pages/AnalysisPage';
import { CompareSessionsPage } from '@app/pages/CompareSessionsPage';
import { ExportPage } from '@app/pages/ExportPage';
import { SettingsPage } from '@app/pages/SettingsPage';
import { PlaceholderPage } from '@app/pages/PlaceholderPage';

const PAGE_TITLES: Record<string, string> = {
  preSession: 'Pre-Session',
  session: 'Session',
  acquire: 'Recording',
  postSession: 'Post-Session',
  database: 'Database',
  analysis: 'Analysis',
  compare: 'Compare Sessions',
  export: 'Export',
  settings: 'Settings'
};

const PAGE_DESCRIPTIONS: Partial<Record<string, string>> = {
  preSession: 'Enter subject details and check-in information before session setup.',
  session: 'Set up recording source, baseline calibration, and output details.',
  acquire: 'Preview Recording and click start.',
  postSession: 'Record symptoms and reading feedback after the session.',
  compare: 'Compare blink metrics and traces across two sessions.'
};

const SIDEBAR_NAV_ITEMS = NAV_ITEMS.filter((item) => item.id !== 'settings');

const NavIcon = ({ tab }: { tab: AppTab }): JSX.Element => {
  if (tab === 'preSession') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <path d="M8 6.5a4 4 0 0 1 8 0c0 2.4-1.8 4.5-4 4.5s-4-2.1-4-4.5z" />
        <path d="M5.5 20c.8-4 3.1-6.2 6.5-6.2s5.7 2.2 6.5 6.2" />
        <path d="M16.5 4.5h3" />
        <path d="M18 3v3" />
      </svg>
    );
  }

  if (tab === 'session') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <path d="M6.5 4.5h8l3 3v12h-11z" />
        <path d="M14.5 4.5v3h3" />
        <path d="M9 16.5l5.8-5.8 1.7 1.7-5.8 5.8-2.4.7z" />
      </svg>
    );
  }

  if (tab === 'acquire') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <rect x="5" y="7" width="10" height="10" rx="2.5" />
        <path d="M15 10.5l4-2.4v7.8l-4-2.4z" />
        <circle cx="10" cy="12" r="2.1" />
      </svg>
    );
  }

  if (tab === 'analysis') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <path d="M5 19V5" />
        <path d="M5 19h14" />
        <path d="M7.5 15.5l3.3-4 3.1 2.4 4.1-6" />
      </svg>
    );
  }

  if (tab === 'compare') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <path d="M5 19V5" />
        <path d="M5 19h14" />
        <path d="M7 15l3-4 3 3 4-6" />
        <path d="M7 9l3 2 3-4 4 6" />
      </svg>
    );
  }

  if (tab === 'postSession') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <path d="M6.5 5.5h11v15h-11z" />
        <path d="M9 9h6" />
        <path d="M9 12.5h6" />
        <path d="M9 16h3.5" />
        <path d="M15.2 16.4l1.1 1.1 2.2-2.6" />
      </svg>
    );
  }

  if (tab === 'database') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <ellipse cx="12" cy="5.5" rx="6.5" ry="2.8" />
        <path d="M5.5 5.5v6c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-6" />
        <path d="M5.5 11.5v6c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-6" />
      </svg>
    );
  }

  if (tab === 'export') {
    return (
      <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
        <rect x="4.5" y="6.5" width="15" height="11" rx="2" />
        <path d="M5.5 8l6.5 5 6.5-5" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.8v2.1" />
      <path d="M12 18.1v2.1" />
      <path d="M5.9 5.9l1.5 1.5" />
      <path d="M16.6 16.6l1.5 1.5" />
      <path d="M3.8 12h2.1" />
      <path d="M18.1 12h2.1" />
      <path d="M5.9 18.1l1.5-1.5" />
      <path d="M16.6 7.4l1.5-1.5" />
    </svg>
  );
};

export const AppShell = (): JSX.Element => {
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setAnalysisSession = useAppStore((state) => state.setAnalysisSession);
  const setLastCreatedSession = useAppStore((state) => state.setLastCreatedSession);
  const lastCreatedSession = useAppStore((state) => state.lastCreatedSession);
  const analysisSession = useAppStore((state) => state.analysisSession);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(true);
  const [lastNonSettingsTab, setLastNonSettingsTab] = useState<AppTab>('preSession');
  const [isSessionEditOpen, setIsSessionEditOpen] = useState(false);
  const [sessionEditError, setSessionEditError] = useState<string | null>(null);
  const [isSavingSessionEdit, setIsSavingSessionEdit] = useState(false);
  const [sessionEditDraft, setSessionEditDraft] = useState({
    session_name: '',
    session_date: '',
    subject_id: '',
    subject_age: '',
    subject_sex: '',
    subject_race_ethnicity: '',
    notes: ''
  });
  const currentSessionMetadata = analysisSession?.metadata ?? lastCreatedSession?.metadata ?? null;
  const currentSessionFolder =
    analysisSession?.paths.sessionFolder ?? lastCreatedSession?.paths.sessionFolder ?? currentSessionMetadata?.session_folder ?? '';
  const currentSessionName = String(currentSessionMetadata?.session_name || 'No active session');
  const currentSubjectId = String(currentSessionMetadata?.subject_id || 'No subject ID');
  const currentSessionDate = String(currentSessionMetadata?.session_date || '');

  const navigateToTab = (tab: AppTab) => {
    if (tab !== 'settings') {
      setLastNonSettingsTab(tab);
    }
    setActiveTab(tab);
  };

  const toggleSettings = () => {
    if (activeTab === 'settings') {
      setActiveTab(lastNonSettingsTab);
      return;
    }
    setLastNonSettingsTab(activeTab);
    setActiveTab('settings');
  };

  const openSessionEditor = () => {
    if (!currentSessionMetadata || !currentSessionFolder) {
      setSessionEditError('Open or create a session before editing session information.');
      setIsSessionEditOpen(true);
      return;
    }
    setSessionEditDraft({
      session_name: String(currentSessionMetadata.session_name ?? ''),
      session_date: String(currentSessionMetadata.session_date ?? ''),
      subject_id: String(currentSessionMetadata.subject_id ?? ''),
      subject_age: String(currentSessionMetadata.subject_age ?? ''),
      subject_sex: String(currentSessionMetadata.subject_sex ?? ''),
      subject_race_ethnicity: String(currentSessionMetadata.subject_race_ethnicity ?? ''),
      notes: String(currentSessionMetadata.notes ?? '')
    });
    setSessionEditError(null);
    setIsSessionEditOpen(true);
  };

  const saveSessionEditor = async () => {
    if (!window.electronAPI || !currentSessionFolder) {
      setSessionEditError('Open or create a session before editing session information.');
      return;
    }
    setIsSavingSessionEdit(true);
    setSessionEditError(null);
    try {
      const metadata = await window.electronAPI.updateSessionMetadata({
        sessionFolder: currentSessionFolder,
        updates: sessionEditDraft
      });
      if (analysisSession?.paths.sessionFolder === currentSessionFolder) {
        setAnalysisSession({
          ...analysisSession,
          metadata: {
            ...analysisSession.metadata,
            ...metadata
          }
        });
      }
      if (lastCreatedSession?.paths.sessionFolder === currentSessionFolder) {
        setLastCreatedSession({
          ...lastCreatedSession,
          metadata: {
            ...lastCreatedSession.metadata,
            ...metadata
          }
        });
      }
      setIsSessionEditOpen(false);
    } catch (reason) {
      setSessionEditError(reason instanceof Error ? reason.message : 'Unable to save session information.');
    } finally {
      setIsSavingSessionEdit(false);
    }
  };

  const chooseStartTab = (tab: 'preSession' | 'database') => {
    navigateToTab(tab);
    setIsStartDialogOpen(false);
  };

  return (
    <div className={`app-shell ${isSidebarOpen ? '' : 'sidebar-is-collapsed'}`}>
      <aside
        className="sidebar"
        onMouseEnter={() => setIsSidebarOpen(true)}
        onMouseLeave={() => setIsSidebarOpen(false)}
      >
        <div className="sidebar-topline">
          <img src="./brand/uc-berkeley-seal.png" alt="UC Berkeley seal" className="sidebar-collapsed-logo" />
          <div className="sidebar-brand">
            <div className="brand-lockup">
              <img src="./brand/uc-berkeley-seal.png" alt="UC Berkeley seal" className="brand-logo" />
              <h1>
                <span className="brand-prefix">OM Lab</span>
                <span>BlinkTracker</span>
              </h1>
            </div>
            <p className="sidebar-copy">
              Record and analyze eyelid movement directly on this computer.
            </p>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => navigateToTab(item.id)}
              title={item.label}
              type="button"
            >
              <span className="nav-icon-frame" aria-hidden="true">
                <NavIcon tab={item.id} />
              </span>
              <span className="nav-copy">
                <span>{item.label}</span>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="page-header">
          <div>
            <h2>{PAGE_TITLES[activeTab]}</h2>
            {PAGE_DESCRIPTIONS[activeTab] ? <p>{PAGE_DESCRIPTIONS[activeTab]}</p> : null}
            <p className="current-session-label">
              Current session: <strong>{currentSessionName}</strong>
              {currentSessionMetadata ? ` · ${currentSubjectId}${currentSessionDate ? ` · ${currentSessionDate}` : ''}` : ''}
            </p>
          </div>
          <div className="page-header-actions">
            <button
              aria-label="Edit current session information"
              className="settings-button"
              onClick={openSessionEditor}
              title="Edit current session information"
              type="button"
            >
              Edit Session
            </button>
            <button
              aria-label="Settings"
              className={`settings-button ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={toggleSettings}
              title="Settings"
              type="button"
            >
              Settings
            </button>
          </div>
        </header>
        {activeTab === 'preSession' ? (
          <PreSessionPage />
        ) : activeTab === 'session' ? (
          <SessionPage />
        ) : activeTab === 'acquire' ? (
          <AcquirePage />
        ) : activeTab === 'postSession' ? (
          <PostSessionPage />
        ) : activeTab === 'database' ? (
          <DatabasePage />
        ) : activeTab === 'analysis' ? (
          <AnalysisPage />
        ) : activeTab === 'compare' ? (
          <CompareSessionsPage />
        ) : activeTab === 'export' ? (
          <ExportPage />
        ) : activeTab === 'settings' ? (
          <SettingsPage />
        ) : (
          <PlaceholderPage tab={activeTab} />
        )}
      </main>
      {isStartDialogOpen ? (
        <div className="start-dialog-backdrop" role="presentation">
          <section className="start-dialog" aria-labelledby="start-dialog-title" role="dialog" aria-modal="true">
            <div className="brand-lockup start-dialog-brand">
              <img src="./brand/uc-berkeley-seal.png" alt="UC Berkeley seal" className="brand-logo" />
              <h1>
                <span className="brand-prefix">OM Lab</span>
                <span>BlinkTracker</span>
              </h1>
            </div>
            <h2 id="start-dialog-title">What would you like to do?</h2>
            <div className="start-dialog-actions">
              <button className="primary-button" onClick={() => chooseStartTab('preSession')} type="button">
                I would like to record a new Session
              </button>
              <button onClick={() => chooseStartTab('database')} type="button">
                I would like to access past Sessions
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isSessionEditOpen ? (
        <div className="start-dialog-backdrop" role="presentation">
          <section className="session-edit-dialog" aria-labelledby="session-edit-title" role="dialog" aria-modal="true">
            <div className="session-edit-header">
              <div>
                <h2 id="session-edit-title">Edit Session Information</h2>
                <p className="field-helper">Update the basic details saved with the current session.</p>
              </div>
              <button onClick={() => setIsSessionEditOpen(false)} type="button">
                Close
              </button>
            </div>
            {sessionEditError ? <p className="form-error">{sessionEditError}</p> : null}
            {currentSessionMetadata && currentSessionFolder ? (
              <>
                <div className="session-edit-grid">
                  <input
                    aria-label="Session name"
                    onChange={(event) => setSessionEditDraft((draft) => ({ ...draft, session_name: event.target.value }))}
                    placeholder="Session Name"
                    value={sessionEditDraft.session_name}
                  />
                  <input
                    aria-label="Session date"
                    onChange={(event) => setSessionEditDraft((draft) => ({ ...draft, session_date: event.target.value }))}
                    type="date"
                    value={sessionEditDraft.session_date}
                  />
                  <input
                    aria-label="Subject ID"
                    onChange={(event) => setSessionEditDraft((draft) => ({ ...draft, subject_id: event.target.value }))}
                    placeholder="Subject ID"
                    value={sessionEditDraft.subject_id}
                  />
                  <input
                    aria-label="Subject age"
                    onChange={(event) => setSessionEditDraft((draft) => ({ ...draft, subject_age: event.target.value }))}
                    placeholder="Age (in years)"
                    value={sessionEditDraft.subject_age}
                  />
                  <select
                    aria-label="Subject sex"
                    className={sessionEditDraft.subject_sex ? '' : 'is-placeholder'}
                    onChange={(event) => setSessionEditDraft((draft) => ({ ...draft, subject_sex: event.target.value }))}
                    value={sessionEditDraft.subject_sex}
                  >
                    <option value="">Sex (optional)</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Intersex">Intersex</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                  <input
                    aria-label="Subject ethnicity or race"
                    onChange={(event) =>
                      setSessionEditDraft((draft) => ({ ...draft, subject_race_ethnicity: event.target.value }))
                    }
                    placeholder="Ethnicity/Race (optional)"
                    value={sessionEditDraft.subject_race_ethnicity}
                  />
                </div>
                <textarea
                  aria-label="Session notes"
                  onChange={(event) => setSessionEditDraft((draft) => ({ ...draft, notes: event.target.value }))}
                  placeholder="Type any additional notes here."
                  value={sessionEditDraft.notes}
                />
                <div className="session-edit-actions">
                  <button onClick={() => setIsSessionEditOpen(false)} type="button">
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    disabled={isSavingSessionEdit}
                    onClick={() => void saveSessionEditor()}
                    type="button"
                  >
                    {isSavingSessionEdit ? 'Saving...' : 'Save Session Info'}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
};
