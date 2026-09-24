import { useEffect, useMemo, useState } from 'react';
import { StatusBanner } from '@app/components/StatusBanner';
import { useAppStore } from '@app/state/useAppStore';
import type { BlinkEventRow, LoadedSessionResponse, SessionDatabaseRow } from '@ipc/schemas';

type CompareSlot = 'A' | 'B';

type CompareMetrics = {
  total: number;
  complete: number;
  partial: number;
  unclassified: number;
  blinkRate: number | null;
  averageIntervalSec: number | null;
  maxIntervalSec: number | null;
  intervalRegularityPercent: number | null;
  averageClosingVelocity: number | null;
  averageOpeningVelocity: number | null;
  averageBlinkDurationMs: number | null;
};

const average = (values: number[]): number | null =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

const formatDate = (row: SessionDatabaseRow): string => row.sessionDate || row.createdAt || 'NA';

const formatMetric = (value: number | null, digits = 1): string => (value == null ? 'NA' : value.toFixed(digits));

const formatRate = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(1)} / min`);

const formatSeconds = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(2)} s`);

const formatMilliseconds = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(0)} ms`);

const formatPercent = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(1)}%`);

const formatVelocity = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(3)} %/ms`);

const formatDelta = (value: number | null, formatter: (metric: number | null) => string): string => {
  if (value == null) {
    return 'NA';
  }
  return `${value > 0 ? '+' : ''}${formatter(value)}`;
};

const formatDirectionalDelta = (
  value: number | null,
  formatter: (metric: number | null) => string,
  labels: { positive: string; negative: string; same?: string }
): string => {
  if (value == null) {
    return 'NA';
  }
  if (Math.abs(value) < 0.0001) {
    return labels.same ?? 'stayed the same';
  }
  const direction = value > 0 ? labels.positive : labels.negative;
  return `${formatDelta(value, formatter)} (${direction})`;
};

const classifyCount = (rows: BlinkEventRow[], classification: string): number =>
  rows.filter((row) => row.is_deleted !== 1 && row.blink_classification === classification).length;

const completeCount = (rows: BlinkEventRow[]): number =>
  rows.filter(
    (row) =>
      row.is_deleted !== 1 && (row.blink_classification === 'complete' || row.blink_classification === 'near_complete')
  ).length;

const calculateMetrics = (session: LoadedSessionResponse | null): CompareMetrics => {
  if (!session) {
    return {
      total: 0,
      complete: 0,
      partial: 0,
      unclassified: 0,
      blinkRate: null,
      averageIntervalSec: null,
      maxIntervalSec: null,
      intervalRegularityPercent: null,
      averageClosingVelocity: null,
      averageOpeningVelocity: null,
      averageBlinkDurationMs: null
    };
  }

  const activeRows = session.blinkRows.filter((row) => row.is_deleted !== 1);
  const complete = completeCount(activeRows);
  const partial = classifyCount(activeRows, 'partial');
  const unclassified = activeRows.length - complete - partial;
  const durationMin = session.durationSec > 0 ? session.durationSec / 60 : 0;
  const starts = activeRows
    .map((row) => row.start_time_sec)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const intervals = starts.slice(1).map((start, index) => start - starts[index]);
  const averageIntervalSec = average(intervals);
  const intervalStdDev =
    averageIntervalSec != null && intervals.length > 1
      ? Math.sqrt(intervals.reduce((total, interval) => total + (interval - averageIntervalSec) ** 2, 0) / intervals.length)
      : null;
  const closingVelocity = activeRows
    .map((row) =>
      row.peak_closure_percent != null && row.closing_duration_sec != null && row.closing_duration_sec > 0
        ? row.peak_closure_percent / (row.closing_duration_sec * 1000)
        : null
    )
    .filter((value): value is number => value != null);
  const openingVelocity = activeRows
    .map((row) =>
      row.peak_closure_percent != null && row.opening_duration_sec != null && row.opening_duration_sec > 0
        ? row.peak_closure_percent / (row.opening_duration_sec * 1000)
        : null
    )
    .filter((value): value is number => value != null);
  const durations = activeRows.map((row) => row.duration_sec * 1000).filter((value) => Number.isFinite(value));

  return {
    total: activeRows.length,
    complete,
    partial,
    unclassified,
    blinkRate: durationMin > 0 ? activeRows.length / durationMin : null,
    averageIntervalSec,
    maxIntervalSec: intervals.length ? Math.max(...intervals) : null,
    intervalRegularityPercent:
      averageIntervalSec != null && averageIntervalSec > 0 && intervalStdDev != null
        ? (intervalStdDev / averageIntervalSec) * 100
        : null,
    averageClosingVelocity: average(closingVelocity),
    averageOpeningVelocity: average(openingVelocity),
    averageBlinkDurationMs: average(durations)
  };
};

const selectedLabel = (session: LoadedSessionResponse | null): string =>
  session
    ? `${String(session.metadata.session_name || 'Untitled session')} · ${String(session.metadata.subject_id || 'No ID')}`
    : 'No session selected';

export const CompareSessionsPage = (): JSX.Element => {
  const sessionForm = useAppStore((state) => state.sessionForm);
  const setSessionFormValue = useAppStore((state) => state.setSessionFormValue);
  const [rootFolder, setRootFolder] = useState(sessionForm.outputFolder);
  const [sessions, setSessions] = useState<SessionDatabaseRow[]>([]);
  const [sessionA, setSessionA] = useState<LoadedSessionResponse | null>(null);
  const [sessionB, setSessionB] = useState<LoadedSessionResponse | null>(null);
  const [loadingSlot, setLoadingSlot] = useState<CompareSlot | null>(null);
  const [isLoadingDatabase, setIsLoadingDatabase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const metricsA = useMemo(() => calculateMetrics(sessionA), [sessionA]);
  const metricsB = useMemo(() => calculateMetrics(sessionB), [sessionB]);

  const loadDatabase = async (folder = rootFolder) => {
    if (!window.electronAPI) {
      setError('Electron preload API unavailable.');
      return;
    }
    if (!folder.trim()) {
      setError('Choose the folder where BlinkTracker saves sessions.');
      return;
    }

    setIsLoadingDatabase(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await window.electronAPI.listSessions({ rootFolder: folder });
      setRootFolder(response.rootFolder);
      setSessions(response.sessions);
      setSuccessMessage(`Found ${response.sessions.length} session${response.sessions.length === 1 ? '' : 's'}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load sessions.');
    } finally {
      setIsLoadingDatabase(false);
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

  const loadSessionIntoSlot = async (slot: CompareSlot, sessionFolder: string) => {
    if (!window.electronAPI || !sessionFolder) {
      return;
    }

    setLoadingSlot(slot);
    setError(null);
    try {
      let session = await window.electronAPI.loadSession({ sessionFolder });
      const hasSavedBlinkRows = session.blinkRows.length > 0;
      if (!hasSavedBlinkRows && session.frameRows.length > 0) {
        await window.electronAPI.detectBlinks({ sessionFolder });
        session = await window.electronAPI.loadSession({ sessionFolder });
      }
      if (slot === 'A') {
        setSessionA(session);
      } else {
        setSessionB(session);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load comparison session.');
    } finally {
      setLoadingSlot(null);
    }
  };

  useEffect(() => {
    if (rootFolder) {
      void loadDatabase(rootFolder);
    }
  }, []);

  const renderSessionPicker = (slot: CompareSlot, selectedSession: LoadedSessionResponse | null) => (
    <div className="compare-picker">
      <label className="field-label" htmlFor={`compare-session-${slot}`}>
        Session {slot}
      </label>
      <select
        id={`compare-session-${slot}`}
        value={selectedSession?.paths.sessionFolder ?? ''}
        onChange={(event) => void loadSessionIntoSlot(slot, event.target.value)}
      >
        <option value="">Choose a session</option>
        {sessions.map((session) => (
          <option key={`${slot}-${session.sessionFolder}`} value={session.sessionFolder}>
            {session.subjectId || 'No ID'} · {formatDate(session)} · {session.sessionName}
          </option>
        ))}
      </select>
      <p className="field-helper">{loadingSlot === slot ? 'Loading and detecting blinks...' : selectedLabel(selectedSession)}</p>
    </div>
  );

  const metricRows = [
    {
      label: 'Blink rate',
      get: (metrics: CompareMetrics) => metrics.blinkRate,
      format: formatRate,
      direction: { positive: 'increased blink rate', negative: 'decreased blink rate' }
    },
    {
      label: 'Avg inter-blink interval',
      get: (metrics: CompareMetrics) => metrics.averageIntervalSec,
      format: formatSeconds,
      direction: { positive: 'longer intervals', negative: 'shorter intervals' }
    },
    {
      label: 'Max inter-blink interval',
      get: (metrics: CompareMetrics) => metrics.maxIntervalSec,
      format: formatSeconds,
      direction: { positive: 'longer maximum gap', negative: 'shorter maximum gap' }
    },
    {
      label: 'Interval regularity',
      get: (metrics: CompareMetrics) => metrics.intervalRegularityPercent,
      format: formatPercent,
      direction: { positive: 'less regular', negative: 'more regular' }
    },
    {
      label: 'Avg closing velocity (%/ms)',
      get: (metrics: CompareMetrics) => metrics.averageClosingVelocity,
      format: formatVelocity,
      direction: { positive: 'faster closing', negative: 'slower closing' }
    },
    {
      label: 'Avg opening velocity (%/ms)',
      get: (metrics: CompareMetrics) => metrics.averageOpeningVelocity,
      format: formatVelocity,
      direction: { positive: 'faster opening', negative: 'slower opening' }
    },
    {
      label: 'Avg blink duration',
      get: (metrics: CompareMetrics) => metrics.averageBlinkDurationMs,
      format: formatMilliseconds,
      direction: { positive: 'longer blinks', negative: 'shorter blinks' }
    }
  ];

  return (
    <section className="compare-layout">
      <div className="card">
        <div className="section-heading compact">
          <div>
            <h3>Compare Sessions</h3>
          </div>
          <p className="section-copy">
            Select two saved sessions to compare blink classification, timing metrics, and opening traces.
          </p>
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
            <button disabled={isLoadingDatabase} onClick={() => void loadDatabase()} type="button">
              {isLoadingDatabase ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="compare-picker-grid">
          {renderSessionPicker('A', sessionA)}
          {renderSessionPicker('B', sessionB)}
        </div>
      </div>

      <div className="compare-panels">
        {[
          { label: 'Session A', session: sessionA, metrics: metricsA },
          { label: 'Session B', session: sessionB, metrics: metricsB }
        ].map((panel) => (
          <div className="card metrics-card" key={panel.label}>
            <div className="section-heading compact">
              <div>
                <h3>{panel.label}</h3>
              </div>
              <p className="field-helper">{selectedLabel(panel.session)}</p>
            </div>
            <dl className="metric-grid">
              <div>
                <dt>Total blinks</dt>
                <dd>{panel.metrics.total}</dd>
              </div>
              <div>
                <dt>Complete</dt>
                <dd>{panel.metrics.complete} / {panel.metrics.total}</dd>
              </div>
              <div>
                <dt>Partial</dt>
                <dd>{panel.metrics.partial} / {panel.metrics.total}</dd>
              </div>
              <div>
                <dt>Unclassified</dt>
                <dd>{panel.metrics.unclassified} / {panel.metrics.total}</dd>
              </div>
              <div>
                <dt>Blink rate</dt>
                <dd>{formatRate(panel.metrics.blinkRate)}</dd>
              </div>
              <div>
                <dt>Avg interval</dt>
                <dd>{formatSeconds(panel.metrics.averageIntervalSec)}</dd>
              </div>
              <div>
                <dt>Max interval</dt>
                <dd>{formatSeconds(panel.metrics.maxIntervalSec)}</dd>
              </div>
              <div>
                <dt>Interval regularity</dt>
                <dd>{formatPercent(panel.metrics.intervalRegularityPercent)}</dd>
              </div>
              <div>
                <dt>Avg closing velocity (%/ms)</dt>
                <dd>{formatVelocity(panel.metrics.averageClosingVelocity)}</dd>
              </div>
              <div>
                <dt>Avg opening velocity (%/ms)</dt>
                <dd>{formatVelocity(panel.metrics.averageOpeningVelocity)}</dd>
              </div>
              <div>
                <dt>Avg blink duration</dt>
                <dd>{formatMilliseconds(panel.metrics.averageBlinkDurationMs)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="section-heading compact">
          <div>
            <h3>Difference Summary</h3>
          </div>
          <p className="section-copy">Change is calculated as Session B minus Session A.</p>
        </div>
        <div className="database-table-shell">
          <table className="database-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Session A</th>
                <th>Session B</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map((row) => {
                const aValue = row.get(metricsA);
                const bValue = row.get(metricsB);
                const delta = aValue == null || bValue == null ? null : bValue - aValue;
                return (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.format(aValue)}</td>
                    <td>{row.format(bValue)}</td>
                    <td>{formatDirectionalDelta(delta, row.format, row.direction)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
