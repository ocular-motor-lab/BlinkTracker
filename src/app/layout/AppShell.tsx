import { NAV_ITEMS } from '@app/utils/navigation';
import { useAppStore } from '@app/state/useAppStore';
import { SessionPage } from '@app/pages/SessionPage';
import { AcquirePage } from '@app/pages/AcquirePage';
import { AnalysisPage } from '@app/pages/AnalysisPage';
import { ExportPage } from '@app/pages/ExportPage';
import { SettingsPage } from '@app/pages/SettingsPage';
import { PlaceholderPage } from '@app/pages/PlaceholderPage';

const PAGE_TITLES: Record<string, string> = {
  session: 'Session Setup',
  acquire: 'Acquire / Process',
  analysis: 'Analysis',
  export: 'Export',
  settings: 'Settings'
};

export const AppShell = (): JSX.Element => {
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">OMlab</p>
          <h1>Blink Tracker</h1>
          <p className="sidebar-copy">
            Local-first eyelid acquisition and analysis for bilateral recordings.
          </p>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="page-header">
          <div>
            <h2>{PAGE_TITLES[activeTab]}</h2>
          </div>
        </header>
        {activeTab === 'session' ? (
          <SessionPage />
        ) : activeTab === 'acquire' ? (
          <AcquirePage />
        ) : activeTab === 'analysis' ? (
          <AnalysisPage />
        ) : activeTab === 'export' ? (
          <ExportPage />
        ) : activeTab === 'settings' ? (
          <SettingsPage />
        ) : (
          <PlaceholderPage tab={activeTab} />
        )}
      </main>
    </div>
  );
};
