import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { StatusBanner } from '@app/components/StatusBanner';
import { useAppStore } from '@app/state/useAppStore';
import type { AnalysisRowValue, BlinkEventRow } from '@ipc/schemas';

const ANALYSIS_PLOT_MARGIN = { left: 44, right: 18 } as const;
const BLINK_EDGE_HIT_WIDTH_PX = 14;

const toMediaUrl = (filePath: string): string => `app-media://local?path=${encodeURIComponent(filePath)}`;

const toNumber = (value: AnalysisRowValue | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatMetric = (value: number | null, digits = 1): string => (value == null ? 'NA' : value.toFixed(digits));

const createManualBlinkDraft = (sessionId: string, centerTimeSec: number): BlinkEventRow => ({
  session_id: sessionId,
  blink_id: '',
  eye_side: 'bilateral',
  start_frame: null,
  start_time_sec: Math.max(0, centerTimeSec - 0.12),
  peak_frame: null,
  peak_time_sec: null,
  end_frame: null,
  end_time_sec: centerTimeSec + 0.12,
  duration_sec: 0.24,
  closing_duration_sec: null,
  opening_duration_sec: null,
  min_opening_px: null,
  min_opening_percent: null,
  peak_closure_percent: null,
  is_auto_detected: 0,
  is_manually_edited: 1,
  is_deleted: 0,
  quality_flag: '',
  notes: ''
});

export const AnalysisPage = (): JSX.Element => {
  const analysisSession = useAppStore((state) => state.analysisSession);
  const lastCreatedSession = useAppStore((state) => state.lastCreatedSession);
  const setAnalysisSession = useAppStore((state) => state.setAnalysisSession);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plotShellRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const xRangeRef = useRef<[number, number] | null>(null);
  const dragStateRef = useRef<{ index: number; boundary: 'start' | 'end' } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSavingBlinks, setIsSavingBlinks] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [blinkRowsDraft, setBlinkRowsDraft] = useState<BlinkEventRow[]>([]);
  const [selectedBlinkIndex, setSelectedBlinkIndex] = useState<number | null>(null);
  const [hoveredBlinkIndex, setHoveredBlinkIndex] = useState<number | null>(null);
  const [hoveredBlinkBoundary, setHoveredBlinkBoundary] = useState<'start' | 'end' | null>(null);
  const [hoveredBlinkEdgeIndex, setHoveredBlinkEdgeIndex] = useState<number | null>(null);
  const [isAddingBlinkFromTrace, setIsAddingBlinkFromTrace] = useState(false);
  const [pendingBlinkStartSec, setPendingBlinkStartSec] = useState<number | null>(null);
  const [xRangeState, setXRangeState] = useState<[number, number] | null>(null);

  const mediaSyncOffsetSec = analysisSession?.mediaSyncOffsetSec ?? analysisSession?.timelineStartSec ?? 0;
  const timelineStartSec = analysisSession?.timelineStartSec ?? 0;

  const loadSession = async (sessionFolder: string) => {
    if (!window.electronAPI) {
      setError('Electron preload API unavailable.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const session = await window.electronAPI.loadSession({ sessionFolder });
      setAnalysisSession(session);
      setBlinkRowsDraft(session.blinkRows);
      setCurrentTimeSec(session.timelineStartSec ?? 0);
      setVideoError(null);
      setSelectedBlinkIndex(null);
      setIsAddingBlinkFromTrace(false);
      setPendingBlinkStartSec(null);
      xRangeRef.current = null;
      setXRangeState(null);
      if (videoRef.current) {
        videoRef.current.pause();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load session.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDetectBlinks = async () => {
    if (!analysisSession || !window.electronAPI) {
      return;
    }
    const confirmed = window.confirm(
      'Auto-detect will regenerate the blink list and replace any existing manual blink edits for this session. Continue?'
    );
    if (!confirmed) {
      return;
    }
    setIsDetecting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await window.electronAPI.detectBlinks({ sessionFolder: analysisSession.paths.sessionFolder });
      await loadSession(analysisSession.paths.sessionFolder);
      setSuccessMessage('Blink detection completed and blink CSV regenerated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to detect blinks.');
    } finally {
      setIsDetecting(false);
    }
  };

  const handleSaveBlinkEdits = async () => {
    if (!analysisSession || !window.electronAPI) {
      return;
    }
    setIsSavingBlinks(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await window.electronAPI.saveBlinkEdits({
        sessionFolder: analysisSession.paths.sessionFolder,
        blinkRows: blinkRowsDraft
      });
      await loadSession(analysisSession.paths.sessionFolder);
      setSuccessMessage('Blink edits saved and blink/framewise CSVs updated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save blink edits.');
    } finally {
      setIsSavingBlinks(false);
    }
  };

  const updateBlinkDraft = (index: number, updates: Partial<BlinkEventRow>) => {
    setBlinkRowsDraft((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              ...updates,
              duration_sec: Math.max(
                0,
                Number(updates.end_time_sec ?? row.end_time_sec) - Number(updates.start_time_sec ?? row.start_time_sec)
              )
            }
          : row
      )
    );
  };

  const addManualBlink = () => {
    if (!analysisSession) {
      return;
    }
    setSelectedBlinkIndex(blinkRowsDraft.length);
    setBlinkRowsDraft((previous) => [
      ...previous,
      createManualBlinkDraft(String(analysisSession.metadata.session_id ?? ''), currentTimeSec)
    ]);
  };

  const addManualBlinkFromRange = (startTimeSec: number, endTimeSec: number) => {
    if (!analysisSession) {
      return;
    }
    const start = Math.max(0, Math.min(startTimeSec, endTimeSec));
    const end = Math.max(start, Math.max(startTimeSec, endTimeSec));
    setSelectedBlinkIndex(blinkRowsDraft.length);
    setBlinkRowsDraft((previous) => [
      ...previous,
      {
        ...createManualBlinkDraft(String(analysisSession.metadata.session_id ?? ''), (start + end) / 2),
        start_time_sec: start,
        end_time_sec: end,
        duration_sec: end - start,
      }
    ]);
  };

  const handleChooseSessionFolder = async () => {
    const selected = await window.electronAPI?.chooseSessionFolder();
    if (selected) {
      await loadSession(selected);
    }
  };

  const handleLoadLatest = async () => {
    if (lastCreatedSession) {
      await loadSession(lastCreatedSession.paths.sessionFolder);
    }
  };

  const activeBlinkEntries = useMemo(
    () =>
      blinkRowsDraft
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.is_deleted !== 1),
    [blinkRowsDraft]
  );

  useEffect(() => {
    return () => {
      if (plotRef.current) {
        void Plotly.purge(plotRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !analysisSession?.mediaPath) {
      return;
    }

    setVideoError(null);
    video.pause();
    video.load();
  }, [analysisSession?.mediaPath]);

  useEffect(() => {
    const container = plotRef.current as ((HTMLDivElement & { on?: (...args: any[]) => void; removeListener?: (...args: any[]) => void }) | null);
    if (!container?.on) {
      return;
    }

    const handleRelayout = (event: Record<string, unknown>) => {
      const start = event['xaxis.range[0]'];
      const end = event['xaxis.range[1]'];
      if (typeof start === 'number' && typeof end === 'number') {
        xRangeRef.current = [start, end];
        setXRangeState([start, end]);
      } else if (typeof start === 'string' && typeof end === 'string') {
        const parsedStart = Number(start);
        const parsedEnd = Number(end);
        if (Number.isFinite(parsedStart) && Number.isFinite(parsedEnd)) {
          xRangeRef.current = [parsedStart, parsedEnd];
          setXRangeState([parsedStart, parsedEnd]);
        }
      } else if (event['xaxis.autorange'] === true) {
        xRangeRef.current = null;
        setXRangeState(null);
      }

      if (event['yaxis.autorange'] === true || event['yaxis.range[0]'] != null || event['yaxis.range[1]'] != null) {
        queueMicrotask(() => {
          if (plotRef.current) {
            void (Plotly as unknown as { relayout: (target: HTMLDivElement, update: Record<string, unknown>) => Promise<void> }).relayout(
              plotRef.current,
              { 'yaxis.range': [0, 110] }
            );
          }
        });
      }

    };

    container.on('plotly_relayout', handleRelayout);
    return () => {
      container.removeListener?.('plotly_relayout', handleRelayout);
    };
  }, [activeBlinkEntries, analysisSession?.paths.sessionFolder]);

  const traceSeries = useMemo(() => {
    if (!analysisSession) {
      return null;
    }

    const timestamps = analysisSession.frameRows.map((row) => toNumber(row.timestamp_sec)).filter((value): value is number => value != null);
    const left = analysisSession.frameRows.map((row) => toNumber(row.left_opening_percent));
    const right = analysisSession.frameRows.map((row) => toNumber(row.right_opening_percent));

    return { timestamps, left, right };
  }, [analysisSession]);

  const zoomTrace = (factor: number) => {
    if (!traceSeries?.timestamps.length) {
      return;
    }

    const minTime = traceSeries.timestamps[0];
    const maxTime = traceSeries.timestamps[traceSeries.timestamps.length - 1];
    const currentRange = xRangeRef.current ?? [minTime, maxTime];
    const currentSpan = Math.max(0.25, currentRange[1] - currentRange[0]);
    const nextSpan = Math.max(0.25, Math.min(maxTime - minTime, currentSpan * factor));
    const center = (currentRange[0] + currentRange[1]) / 2;
    let nextStart = center - nextSpan / 2;
    let nextEnd = center + nextSpan / 2;

    if (nextStart < minTime) {
      nextEnd += minTime - nextStart;
      nextStart = minTime;
    }
    if (nextEnd > maxTime) {
      nextStart -= nextEnd - maxTime;
      nextEnd = maxTime;
    }

    xRangeRef.current = [Math.max(minTime, nextStart), Math.min(maxTime, nextEnd)];
    setXRangeState(xRangeRef.current);
    setBlinkRowsDraft((previous) => [...previous]);
  };

  const resetTraceZoom = () => {
    xRangeRef.current = null;
    setXRangeState(null);
    setBlinkRowsDraft((previous) => [...previous]);
  };

  useEffect(() => {
    const container = plotRef.current;
    if (!container || !traceSeries) {
      return;
    }

    const blinkShapes = activeBlinkEntries.map(({ row, index }) => {
        const color =
          row.eye_side === 'left'
            ? 'rgba(245, 158, 11, 0.28)'
            : row.eye_side === 'right'
              ? 'rgba(56, 189, 248, 0.28)'
              : 'rgba(244, 114, 182, 0.32)';
        const isSelected = index === selectedBlinkIndex;
        const isHovered = index === hoveredBlinkIndex;
        return {
          type: 'rect' as const,
          x0: row.start_time_sec,
          x1: row.end_time_sec,
          y0: 0,
          y1: 1,
          yref: 'paper',
          fillcolor: color,
          line: {
            color: isSelected || isHovered ? '#f8fafc' : color.replace(/0\.\d+\)/, '0.8)'),
            width: isSelected ? 3 : isHovered ? 2 : 1
          }
        };
      });

    const blinkMarkers = activeBlinkEntries
      .filter(({ row }) => row.peak_time_sec != null)
      .map(({ row, index }) => ({
        x: [row.peak_time_sec],
        y: [Math.max(0, row.min_opening_percent ?? 0)],
        type: 'scatter' as const,
        mode: 'markers',
        name: `${row.eye_side} blink`,
        hoverinfo: 'skip',
        showlegend: false,
        marker: {
          size: index === selectedBlinkIndex ? 12 : row.eye_side === 'bilateral' ? 10 : 8,
          symbol: row.eye_side === 'bilateral' ? 'diamond' : 'circle',
          color:
            row.eye_side === 'left'
              ? '#f59e0b'
              : row.eye_side === 'right'
                ? '#38bdf8'
                : '#f472b6',
          line: { color: '#f8fafc', width: 1 }
        }
      }));

    const pendingShapes =
      pendingBlinkStartSec == null
        ? []
        : [
            {
              type: 'line' as const,
              x0: pendingBlinkStartSec,
              x1: pendingBlinkStartSec,
              y0: 0,
              y1: 1,
              yref: 'paper',
              line: { color: '#34d399', width: 2, dash: 'dot' }
            }
          ];

    const traces = [
      {
        x: traceSeries.timestamps,
        y: traceSeries.left,
        type: 'scatter',
        mode: 'lines',
        name: 'Left',
        line: { color: '#f59e0b', width: 2 }
      },
      {
        x: traceSeries.timestamps,
        y: traceSeries.right,
        type: 'scatter',
        mode: 'lines',
        name: 'Right',
        line: { color: '#38bdf8', width: 2 }
      },
      ...blinkMarkers
    ];

    void Plotly.react(
      container,
      traces,
      {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(8,17,29,0.55)',
        margin: { l: 44, r: 18, t: 24, b: 40 },
        dragmode: isAddingBlinkFromTrace || hoveredBlinkBoundary != null ? false : 'zoom',
        showlegend: true,
        uirevision: 'analysis-trace',
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
          zeroline: false,
          fixedrange: false,
          autorange: xRangeRef.current == null,
          range: xRangeRef.current ?? undefined
        },
        yaxis: {
          title: 'Opening (%)',
          color: '#cbd5e1',
          gridcolor: 'rgba(148,163,184,0.14)',
          range: [0, 110],
          fixedrange: true
        },
        shapes: [
          ...blinkShapes,
          {
            type: 'line',
            x0: currentTimeSec,
            x1: currentTimeSec,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: { color: '#fb7185', width: 2 }
          },
          ...pendingShapes
        ]
      },
      {
        displayModeBar: false,
        edits: { shapePosition: false },
        scrollZoom: !isAddingBlinkFromTrace && hoveredBlinkBoundary == null,
        responsive: true
      }
    );
  }, [activeBlinkEntries, currentTimeSec, hoveredBlinkBoundary, hoveredBlinkIndex, isAddingBlinkFromTrace, pendingBlinkStartSec, selectedBlinkIndex, traceSeries]);

  const currentFrame = useMemo(() => {
    if (!analysisSession?.frameRows.length) {
      return null;
    }

    let bestRow = analysisSession.frameRows[0];
    let bestDistance = Math.abs((toNumber(bestRow.timestamp_sec) ?? 0) - currentTimeSec);
    for (const row of analysisSession.frameRows) {
      const timestamp = toNumber(row.timestamp_sec);
      if (timestamp == null) {
        continue;
      }
      const distance = Math.abs(timestamp - currentTimeSec);
      if (distance < bestDistance) {
        bestRow = row;
        bestDistance = distance;
      }
    }
    return bestRow;
  }, [analysisSession, currentTimeSec]);

  const activeBlinkCount = useMemo(
    () => blinkRowsDraft.filter((row) => row.is_deleted !== 1).length,
    [blinkRowsDraft]
  );

  const orderedFrameTimes = useMemo(
    () =>
      analysisSession?.frameRows
        .map((row) => toNumber(row.timestamp_sec))
        .filter((value): value is number => value != null) ?? [],
    [analysisSession]
  );

  const visibleXRange = useMemo<[number, number] | null>(() => {
    if (!traceSeries?.timestamps.length) {
      return null;
    }
    return xRangeState ?? [traceSeries.timestamps[0], traceSeries.timestamps[traceSeries.timestamps.length - 1]];
  }, [traceSeries, xRangeState]);

  const selectedBlink = selectedBlinkIndex == null ? null : blinkRowsDraft[selectedBlinkIndex] ?? null;

  const clientXToTraceTime = (clientX: number): number | null => {
    const shell = plotShellRef.current;
    if (!shell || !visibleXRange) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    const innerWidth = rect.width - ANALYSIS_PLOT_MARGIN.left - ANALYSIS_PLOT_MARGIN.right;
    if (innerWidth <= 0) {
      return null;
    }

    const x = Math.max(0, Math.min(innerWidth, clientX - rect.left - ANALYSIS_PLOT_MARGIN.left));
    return visibleXRange[0] + (x / innerWidth) * (visibleXRange[1] - visibleXRange[0]);
  };

  const edgeHitThresholdSec = (): number | null => {
    const shell = plotShellRef.current;
    if (!shell || !visibleXRange) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    const innerWidth = rect.width - ANALYSIS_PLOT_MARGIN.left - ANALYSIS_PLOT_MARGIN.right;
    if (innerWidth <= 0) {
      return null;
    }

    return (BLINK_EDGE_HIT_WIDTH_PX / innerWidth) * (visibleXRange[1] - visibleXRange[0]);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      await video.play();
      return;
    }
    video.pause();
  };

  const toTraceTime = (mediaTimeSec: number): number => mediaTimeSec + mediaSyncOffsetSec;

  const toMediaTime = (traceTimeSec: number): number => Math.max(0, traceTimeSec - mediaSyncOffsetSec);

  const seekTo = (timeSec: number) => {
    const clamped = Math.max(timelineStartSec, Math.min(timeSec, analysisSession?.durationSec ?? timeSec));
    setCurrentTimeSec(clamped);
    if (videoRef.current && analysisSession?.mediaPath) {
      videoRef.current.currentTime = toMediaTime(clamped);
    }
  };

  const stepFrame = (direction: -1 | 1) => {
    if (!orderedFrameTimes.length) {
      return;
    }

    let nextIndex = orderedFrameTimes.findIndex((time) => time >= currentTimeSec - 1e-6);
    if (nextIndex === -1) {
      nextIndex = orderedFrameTimes.length - 1;
    }
    if (direction < 0) {
      if (orderedFrameTimes[nextIndex] >= currentTimeSec + 1e-6) {
        nextIndex = Math.max(0, nextIndex - 1);
      } else {
        nextIndex = Math.max(0, nextIndex - 1);
      }
    } else if (orderedFrameTimes[nextIndex] <= currentTimeSec + 1e-6) {
      nextIndex = Math.min(orderedFrameTimes.length - 1, nextIndex + 1);
    }

    seekTo(orderedFrameTimes[nextIndex]);
  };

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      const shell = plotShellRef.current;
      if (!dragState || !shell || !visibleXRange) {
        return;
      }

      const rect = shell.getBoundingClientRect();
      const innerWidth = rect.width - ANALYSIS_PLOT_MARGIN.left - ANALYSIS_PLOT_MARGIN.right;
      if (innerWidth <= 0) {
        return;
      }

      const x = Math.max(
        0,
        Math.min(innerWidth, event.clientX - rect.left - ANALYSIS_PLOT_MARGIN.left)
      );
      const timeSec = visibleXRange[0] + (x / innerWidth) * (visibleXRange[1] - visibleXRange[0]);
      const row = blinkRowsDraft[dragState.index];
      if (!row) {
        return;
      }

      const nextStart = dragState.boundary === 'start' ? timeSec : row.start_time_sec;
      const nextEnd = dragState.boundary === 'end' ? timeSec : row.end_time_sec;
      updateBlinkDraft(dragState.index, {
        start_time_sec: Math.min(nextStart, nextEnd),
        end_time_sec: Math.max(nextStart, nextEnd),
        is_manually_edited: 1
      });
    };

    const handleUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [blinkRowsDraft, visibleXRange]);

  if (!analysisSession) {
    return (
      <section className="placeholder-card">
        <h3>Load a completed session</h3>
        <p>Open a session folder to review synchronized traces and video before blink editing lands in Milestone 6.</p>
        {error ? <StatusBanner tone="error" message={error} /> : null}
        {successMessage ? <StatusBanner tone="success" message={successMessage} /> : null}
        <div className="action-row">
          <button className="primary-button" disabled={isLoading} onClick={() => void handleChooseSessionFolder()} type="button">
            {isLoading ? 'Loading...' : 'Open Session Folder'}
          </button>
          {lastCreatedSession ? (
            <button disabled={isLoading} onClick={() => void handleLoadLatest()} type="button">
              Load Latest Session
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="analysis-layout">
      <div className="card trace-card analysis-primary-card">
        {error ? <StatusBanner tone="error" message={error} /> : null}
        {successMessage ? <StatusBanner tone="success" message={successMessage} /> : null}

        <div className="action-row">
          <button className="primary-button" disabled={isLoading} onClick={() => void handleChooseSessionFolder()} type="button">
            {isLoading ? 'Loading...' : 'Open Another Session'}
          </button>
          {lastCreatedSession ? (
            <button disabled={isLoading} onClick={() => void handleLoadLatest()} type="button">
              Reload Latest Session
            </button>
          ) : null}
          <button disabled={isDetecting} onClick={() => void handleDetectBlinks()} type="button">
            {isDetecting ? 'Detecting...' : 'Auto-Detect Blinks'}
          </button>
          <button disabled={isSavingBlinks} onClick={() => void handleSaveBlinkEdits()} type="button">
            {isSavingBlinks ? 'Saving...' : 'Save Blink Edits'}
          </button>
          <button onClick={() => addManualBlink()} type="button">
            Add Manual Blink
          </button>
          <button
            className={isAddingBlinkFromTrace ? 'selected' : ''}
            title={isAddingBlinkFromTrace ? 'Trace-add mode is active' : 'Click once for one edge, then click again for the other edge'}
            onClick={() => {
              setSuccessMessage(null);
              setIsAddingBlinkFromTrace((value) => {
                const next = !value;
                if (!next) {
                  setPendingBlinkStartSec(null);
                }
                return next;
              });
            }}
            type="button"
          >
            {isAddingBlinkFromTrace ? 'Cancel Trace Add' : 'Add Blink From Trace'}
          </button>
          <button onClick={() => zoomTrace(0.7)} type="button">
            Zoom In
          </button>
          <button onClick={() => zoomTrace(1.4)} type="button">
            Zoom Out
          </button>
          <button onClick={() => resetTraceZoom()} type="button">
            Reset Zoom
          </button>
        </div>
        <div
          ref={plotShellRef}
          className={`analysis-plot-shell ${isAddingBlinkFromTrace ? 'is-trace-add-mode' : ''} ${hoveredBlinkBoundary ? `is-edge-drag is-edge-${hoveredBlinkBoundary}` : ''}`}
          onMouseDown={(event) => {
            const clickedTime = clientXToTraceTime(event.clientX);
            if (clickedTime == null) {
              return;
            }

            if (hoveredBlinkEdgeIndex != null && hoveredBlinkBoundary) {
              event.preventDefault();
              event.stopPropagation();
              setSelectedBlinkIndex(hoveredBlinkEdgeIndex);
              dragStateRef.current = { index: hoveredBlinkEdgeIndex, boundary: hoveredBlinkBoundary };
              return;
            }

            seekTo(clickedTime);

            if (isAddingBlinkFromTrace) {
              event.preventDefault();
              if (pendingBlinkStartSec == null) {
                setPendingBlinkStartSec(clickedTime);
                setSuccessMessage('First blink edge marked. Click again to set the second edge.');
                return;
              }

              addManualBlinkFromRange(pendingBlinkStartSec, clickedTime);
              setPendingBlinkStartSec(null);
              setIsAddingBlinkFromTrace(false);
              setSuccessMessage('Manual blink added from the trace. Save blink edits to persist it.');
              return;
            }

            const containing = activeBlinkEntries.find(
              ({ row }) => clickedTime >= row.start_time_sec && clickedTime <= row.end_time_sec
            );
            if (containing) {
              setSelectedBlinkIndex(containing.index);
              return;
            }

            const nearest = activeBlinkEntries
              .map((entry) => ({
                ...entry,
                distance: Math.abs(((entry.row.start_time_sec + entry.row.end_time_sec) / 2) - clickedTime)
              }))
              .sort((a, b) => a.distance - b.distance)[0];
            if (nearest && nearest.distance <= 0.35) {
              setSelectedBlinkIndex(nearest.index);
            }
          }}
          onMouseMove={(event) => {
            const hoveredTime = clientXToTraceTime(event.clientX);
            if (hoveredTime == null) {
              setHoveredBlinkIndex(null);
              setHoveredBlinkBoundary(null);
              setHoveredBlinkEdgeIndex(null);
              return;
            }
            const edgeThreshold = edgeHitThresholdSec();
            const hovered = activeBlinkEntries.find(
              ({ row }) => hoveredTime >= row.start_time_sec && hoveredTime <= row.end_time_sec
            );
            setHoveredBlinkIndex(hovered?.index ?? null);
            if (edgeThreshold == null) {
              setHoveredBlinkBoundary(null);
              setHoveredBlinkEdgeIndex(null);
              return;
            }

            const nearestEdge = activeBlinkEntries
              .flatMap((entry) => [
                { index: entry.index, boundary: 'start' as const, distance: Math.abs(hoveredTime - entry.row.start_time_sec) },
                { index: entry.index, boundary: 'end' as const, distance: Math.abs(hoveredTime - entry.row.end_time_sec) }
              ])
              .sort((a, b) => a.distance - b.distance)[0];

            if (nearestEdge && nearestEdge.distance <= edgeThreshold) {
              setHoveredBlinkBoundary(nearestEdge.boundary);
              setHoveredBlinkEdgeIndex(nearestEdge.index);
            } else {
              setHoveredBlinkBoundary(null);
              setHoveredBlinkEdgeIndex(null);
            }

            if (hovered) {
              const startDistance = Math.abs(hoveredTime - hovered.row.start_time_sec);
              const endDistance = Math.abs(hoveredTime - hovered.row.end_time_sec);
              if (startDistance <= edgeThreshold || endDistance <= edgeThreshold) {
                setHoveredBlinkIndex(hovered.index);
              }
            }
          }}
          onMouseLeave={() => {
            setHoveredBlinkIndex(null);
            setHoveredBlinkBoundary(null);
            setHoveredBlinkEdgeIndex(null);
          }}
        >
          <div ref={plotRef} className="plotly-trace analysis-plot analysis-plot-large" />
        </div>
        <div className="analysis-scrubber-row analysis-main-scrubber">
          <button onClick={() => void togglePlayback()} type="button">
            {videoRef.current?.paused === false ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => stepFrame(-1)} title="Previous frame" type="button">
            Prev Frame
          </button>
          <input
            max={Math.max(analysisSession.durationSec, timelineStartSec + 0.001)}
            min={timelineStartSec}
            onChange={(event) => seekTo(Number(event.target.value))}
            step={0.01}
            type="range"
            value={currentTimeSec}
          />
          <button onClick={() => stepFrame(1)} title="Next frame" type="button">
            Next Frame
          </button>
          <span>{currentTimeSec.toFixed(2)} s</span>
        </div>
        <p className="field-helper analysis-hint">
          Click a blink to select it. Move near the left or right edge until the cursor changes, then drag to adjust timing.
        </p>
        {isAddingBlinkFromTrace ? (
          <p className="field-helper analysis-hint">
            Trace-add mode is on. Zoom is temporarily disabled. Click once for one edge and click again for the other edge.
          </p>
        ) : null}

        <div className="analysis-support-grid">
          <div className="card analysis-video-card">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Video</p>
                <h3>Reference view</h3>
              </div>
            </div>
            {analysisSession.mediaPath ? (
              <div className="analysis-video-stack">
                {videoError ? <StatusBanner tone="info" message={videoError} /> : null}
                <div className="preview-frame analysis-video-frame">
                  <video
                    key={analysisSession.mediaPath}
                    ref={videoRef}
                    autoPlay={false}
                    controls
                    muted
                    onLoadedData={(event) => {
                      setVideoError(null);
                      if (event.currentTarget.currentTime === 0) {
                        event.currentTarget.currentTime = 0.05;
                      }
                    }}
                    onError={() =>
                      setVideoError(
                        'This media file could not be decoded in the desktop shell. The trace is still available for review.'
                      )
                    }
                    onLoadedMetadata={(event) => {
                      setCurrentTimeSec(toTraceTime(event.currentTarget.currentTime));
                      if (event.currentTarget.duration > 0 && event.currentTarget.currentTime === 0) {
                        event.currentTarget.currentTime = 0.05;
                      }
                    }}
                    onPause={(event) => setCurrentTimeSec(toTraceTime(event.currentTarget.currentTime))}
                    onSeeked={(event) => setCurrentTimeSec(toTraceTime(event.currentTarget.currentTime))}
                    onTimeUpdate={(event) => setCurrentTimeSec(toTraceTime(event.currentTarget.currentTime))}
                    playsInline
                    preload="auto"
                    src={toMediaUrl(analysisSession.mediaPath)}
                  />
                </div>
              </div>
            ) : (
              <div className="analysis-trace-only">
                <p className="field-helper">No playable media file was found for this session.</p>
              </div>
            )}
          </div>

          <div className="card metrics-card">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Current Frame</p>
                <h3>Review metrics</h3>
              </div>
            </div>
            <dl className="metric-grid">
              <div>
                <dt>Current time</dt>
                <dd>{currentTimeSec.toFixed(2)} s</dd>
              </div>
              <div>
                <dt>Frames loaded</dt>
                <dd>{analysisSession.frameCount}</dd>
              </div>
              <div>
                <dt>Left opening %</dt>
                <dd>{formatMetric(toNumber(currentFrame?.left_opening_percent))}</dd>
              </div>
              <div>
                <dt>Right opening %</dt>
                <dd>{formatMetric(toNumber(currentFrame?.right_opening_percent))}</dd>
              </div>
              <div>
                <dt>Left confidence</dt>
                <dd>{formatMetric(toNumber(currentFrame?.left_tracking_confidence), 2)}</dd>
              </div>
              <div>
                <dt>Right confidence</dt>
                <dd>{formatMetric(toNumber(currentFrame?.right_tracking_confidence), 2)}</dd>
              </div>
              <div>
                <dt>Blinks</dt>
                <dd>{activeBlinkCount}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{analysisSession.durationSec.toFixed(2)} s</dd>
              </div>
            </dl>
          </div>

          <div className="card metrics-card">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Metadata</p>
                <h3>Session details</h3>
              </div>
            </div>
            <dl className="metric-grid">
              <div>
                <dt>Session</dt>
                <dd>{String(analysisSession.metadata.session_name ?? 'Unnamed')}</dd>
              </div>
              <div>
                <dt>Subject ID</dt>
                <dd>{String(analysisSession.metadata.subject_id ?? 'NA')}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{String(analysisSession.metadata.source_name ?? 'NA')}</dd>
              </div>
              <div>
                <dt>Tracking model</dt>
                <dd>{String(analysisSession.metadata.tracking_model ?? 'NA')}</dd>
              </div>
            </dl>
            <p className="field-helper session-folder-path" title={analysisSession.paths.sessionFolder}>
              {analysisSession.paths.sessionFolder}
            </p>
          </div>
        </div>

        <div className="card metrics-card">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Blink Events</p>
              <h3>Manual review</h3>
            </div>
          </div>
          <div className="blink-editor-list">
            {blinkRowsDraft.length === 0 ? (
              <p className="field-helper">Run auto-detect or add a manual blink from the trace to begin curation.</p>
            ) : (
              blinkRowsDraft.map((row, index) => (
                <div
                  key={`${row.blink_id || 'manual'}-${index}`}
                  className={`blink-editor-row ${row.is_deleted === 1 ? 'is-deleted' : ''} ${selectedBlinkIndex === index ? 'is-selected' : ''}`}
                >
                  <strong className="blink-id">{row.blink_id || `manual_${index + 1}`}</strong>
                  <select
                    value={row.eye_side}
                    onChange={(event) =>
                      updateBlinkDraft(index, {
                        eye_side: event.target.value as BlinkEventRow['eye_side'],
                        is_manually_edited: 1
                      })
                    }
                  >
                    <option value="left">L</option>
                    <option value="right">R</option>
                    <option value="bilateral">Bi</option>
                  </select>
                  <button onClick={() => seekTo(row.start_time_sec)} type="button">
                    Jump
                  </button>
                  <span>{row.start_time_sec.toFixed(2)}-{row.end_time_sec.toFixed(2)} s</span>
                  <input
                    className="blink-note-input"
                    placeholder="notes"
                    value={row.notes}
                    onChange={(event) =>
                      updateBlinkDraft(index, {
                        notes: event.target.value,
                        is_manually_edited: 1
                      })
                    }
                  />
                  <button onClick={() => setSelectedBlinkIndex(index)} type="button">
                    Select
                  </button>
                  <button
                    onClick={() =>
                      updateBlinkDraft(index, {
                        is_deleted: row.is_deleted === 1 ? 0 : 1,
                        is_manually_edited: 1
                      })
                    }
                    type="button"
                  >
                    {row.is_deleted === 1 ? 'Restore' : 'Delete'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
