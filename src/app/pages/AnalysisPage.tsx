import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Plotly from 'plotly.js-dist-min';
import { StatusBanner } from '@app/components/StatusBanner';
import { useAppStore } from '@app/state/useAppStore';
import type { AnalysisRowValue, BlinkEventRow, VideoSourceInfo } from '@ipc/schemas';

const ANALYSIS_PLOT_MARGIN = { left: 44, right: 18 } as const;
const BLINK_EDGE_HIT_WIDTH_PX = 14;
const PLAYHEAD_HIT_WIDTH_PX = 18;
const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const;
type AnalysisView = 'review' | 'summary' | 'velocity' | 'questionnaire';
type ReviewDecisionMode = 'confirm' | 'reject' | 'reject_other' | null;
type RejectionReason = 'flutter' | 'downward_gaze' | 'other';

const HUMAN_REVIEW_FLAGS = [
  'human_confirmed',
  'human_rejected',
  'rejected_flutter',
  'rejected_downward_gaze',
  'rejected_other'
];

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

type TraceSeries = {
  timestamps: Array<number | null>;
  validTimestamps: number[];
  left: Array<number | null>;
  right: Array<number | null>;
};

type TraceSeriesBuilder = TraceSeries & {
  previousFrameIndex: number | null;
};

type VelocitySeries = {
  timestamps: Array<number | null>;
  left: Array<number | null>;
  right: Array<number | null>;
  bilateral: Array<number | null>;
};

type BlinkVelocityMetric = {
  row: BlinkEventRow;
  index: number;
  blinkNumber: number;
  closingTimeMs: number | null;
  openingTimeMs: number | null;
};

type BlinkTaskLabelAssignments = Record<string, string>;

type QuestionnaireComparisonRow = {
  key: string;
  label: string;
  before: number | null;
  after: number | null;
  change: number | null;
};

type SessionSummaryItem = {
  title: string;
  body: string;
  tone?: 'neutral' | 'attention' | 'positive';
};

const formatMetric = (value: number | null, digits = 1): string => (value == null ? 'NA' : value.toFixed(digits));
const formatRate = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(1)} / min`);
const formatMilliseconds = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(0)} ms`);
const formatSeconds = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(2)} s`);
const formatClockTime = (value: number | null | undefined, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) {
    return 'NA';
  }
  const safeValue = Math.max(0, value);
  const minutes = Math.floor(safeValue / 60);
  const seconds = (safeValue % 60).toFixed(digits);
  return `${minutes}:${seconds.padStart(digits > 0 ? digits + 3 : 2, '0')}`;
};
const formatPercent = (value: number | null): string => (value == null ? 'NA' : `${value.toFixed(1)}%`);
const formatPositiveMetric = (value: number | null | undefined, digits = 1): string =>
  value == null || value <= 0 ? 'NA' : value.toFixed(digits);
const formatPositiveInteger = (value: number | null | undefined): string =>
  value == null || value <= 0 ? 'NA' : value.toString();
const formatIntervalPair = (pair: { previousBlinkNumber: number; nextBlinkNumber: number } | null): string =>
  pair == null ? '' : `between blink ${pair.previousBlinkNumber} and blink ${pair.nextBlinkNumber}`;
const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const parseBlinkTaskLabels = (value: unknown): BlinkTaskLabelAssignments =>
  Object.entries(asRecord(value)).reduce<BlinkTaskLabelAssignments>((assignments, [key, label]) => {
    if (typeof label === 'string' && label.trim()) {
      assignments[key] = label.trim();
    }
    return assignments;
  }, {});
const blinkAssignmentKey = (row: BlinkEventRow, index: number): string =>
  row.blink_id || `manual_${index + 1}_${row.start_time_sec.toFixed(3)}_${row.end_time_sec.toFixed(3)}`;
const toQuestionnaireNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const formatIntervalTrend = (value: number | null): string => {
  if (value == null) {
    return 'NA';
  }
  if (Math.abs(value) < 0.01) {
    return 'Stable';
  }
  return `${value > 0 ? 'Longer' : 'Shorter'} (${value > 0 ? '+' : ''}${value.toFixed(2)} s/min)`;
};

const blinkClassificationColor = (row: BlinkEventRow): [number, number, number] => {
  if (row.blink_classification === 'complete') {
    return [34, 197, 94];
  }
  // Older saved sessions may still contain the old near_complete label.
  if (row.blink_classification === 'near_complete') {
    return [34, 197, 94];
  }
  if (row.blink_classification === 'partial') {
    return [244, 114, 182];
  }
  return [148, 163, 184];
};

const blinkHighlightColor = (
  row: BlinkEventRow,
  opacity: number
): string => {
  const [red, green, blue] = blinkClassificationColor(row);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
};

const qualityFlagExplanation = (row: BlinkEventRow): string => {
  if (!row.quality_flag) {
    return '';
  }
  const flags = row.quality_flag
    .split(';')
    .map((flag) => flag.trim())
    .filter(Boolean);
  const explanations = flags.map((flag) => {
    if (flag === 'low_confidence') {
      return 'Low confidence: landmark tracking confidence averaged below 0.45 during this blink, often from dim lighting, blur, face angle, or eyes partly out of frame.';
    }
    if (flag === 'possible_gaze_or_downward_look') {
      return 'Possible gaze/downward look: the opening drop was saved as a blink candidate, but movement was slow or recovery was incomplete compared with a typical blink.';
    }
    if (flag === 'human_confirmed') {
      return 'Human review: confirmed as a blink.';
    }
    if (flag === 'human_rejected') {
      return 'Human review: marked as not a blink.';
    }
    if (flag === 'rejected_flutter') {
      return 'Human review reason: flutter.';
    }
    if (flag === 'rejected_downward_gaze') {
      return 'Human review reason: downward gaze.';
    }
    if (flag === 'rejected_other') {
      return 'Human review reason: other.';
    }
    return `Quality flag: ${flag.replace(/_/g, ' ')}.`;
  });
  if (explanations.length) {
    return explanations.join(' ');
  }
  return '';
};

const addQualityFlag = (value: string, flag: string): string => {
  const flags = value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!flags.includes(flag)) {
    flags.push(flag);
  }
  return flags.join(';');
};

const removeQualityFlags = (value: string, flagsToRemove: string[]): string =>
  value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry && !flagsToRemove.includes(entry))
    .join(';');

const appendReviewNote = (value: string | null | undefined, note: string): string => {
  const existing = (value ?? '').trim();
  if (!existing) {
    return note;
  }
  if (existing.includes(note)) {
    return existing;
  }
  return `${existing}\n${note}`;
};

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
  blink_classification: '',
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
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plotShellRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const blinkReviewTraceRef = useRef<HTMLDivElement | null>(null);
  const blinkReviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const velocityPlotRef = useRef<HTMLDivElement | null>(null);
  const xRangeRef = useRef<[number, number] | null>(null);
  const dragStateRef = useRef<{ index: number; boundary: 'start' | 'end' } | null>(null);
  const graphClickRef = useRef<{ clientX: number; clientY: number; timeSec: number } | null>(null);
  const playheadDragRef = useRef(false);
  const blinkPlaybackTimeoutRef = useRef<number | null>(null);
  const blinkReviewRangeRef = useRef<[number, number] | null>(null);
  const blinkReviewDragRef = useRef<'start' | 'end' | null>(null);
  const blinkReviewAddStartRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSavingBlinks, setIsSavingBlinks] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoMetrics, setVideoMetrics] = useState<VideoSourceInfo | null>(null);
  const [blinkRowsDraft, setBlinkRowsDraft] = useState<BlinkEventRow[]>([]);
  const [selectedBlinkIndex, setSelectedBlinkIndex] = useState<number | null>(null);
  const [hoveredBlinkIndex, setHoveredBlinkIndex] = useState<number | null>(null);
  const [hoveredBlinkBoundary, setHoveredBlinkBoundary] = useState<'start' | 'end' | null>(null);
  const [hoveredBlinkEdgeIndex, setHoveredBlinkEdgeIndex] = useState<number | null>(null);
  const [isAddingBlinkFromTrace, setIsAddingBlinkFromTrace] = useState(false);
  const [pendingBlinkStartSec, setPendingBlinkStartSec] = useState<number | null>(null);
  const [xRangeState, setXRangeState] = useState<[number, number] | null>(null);
  const [videoMetricsRefreshKey, setVideoMetricsRefreshKey] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1);
  const [analysisView, setAnalysisView] = useState<AnalysisView>('review');
  const [blinkTaskLabelsDraft, setBlinkTaskLabelsDraft] = useState<BlinkTaskLabelAssignments>({});
  const [isBlinkReviewOpen, setIsBlinkReviewOpen] = useState(false);
  const [reviewDecisionMode, setReviewDecisionMode] = useState<ReviewDecisionMode>(null);
  const [rejectionOtherNotes, setRejectionOtherNotes] = useState('');
  const [isAddingBlinkFromReview, setIsAddingBlinkFromReview] = useState(false);

  const mediaSyncOffsetSec = analysisSession?.mediaSyncOffsetSec ?? analysisSession?.timelineStartSec ?? 0;
  const timelineStartSec = analysisSession?.timelineStartSec ?? 0;

  const refreshVideoMetrics = async (mediaPath: string | null | undefined) => {
    if (!mediaPath || !window.electronAPI) {
      setVideoMetrics(null);
      return;
    }

    try {
      const info = await window.electronAPI.probeVideo(mediaPath);
      setVideoMetrics(info);
    } catch {
      setVideoMetrics(null);
    }
  };

  const loadSession = async (sessionFolder: string) => {
    if (!window.electronAPI) {
      setError('Electron preload API unavailable.');
      return null;
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
      setVideoMetrics(null);
      setSelectedBlinkIndex(null);
      setReviewDecisionMode(null);
      setRejectionOtherNotes('');
      setIsAddingBlinkFromTrace(false);
      setPendingBlinkStartSec(null);
      setBlinkTaskLabelsDraft(parseBlinkTaskLabels(session.metadata.blink_task_labels));
      setIsAddingBlinkFromReview(false);
      xRangeRef.current = null;
      setXRangeState(null);
      if (videoRef.current) {
        videoRef.current.pause();
      }
      return session;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load session.');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleDetectBlinks = async () => {
    if (!analysisSession || !window.electronAPI) {
      return;
    }
    setIsDetecting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await window.electronAPI.detectBlinks({
        sessionFolder: analysisSession.paths.sessionFolder
      });
      const loadedSession = await loadSession(analysisSession.paths.sessionFolder);
      await refreshVideoMetrics(loadedSession?.mediaPath ?? analysisSession.mediaPath);
      setVideoMetricsRefreshKey((key) => key + 1);
      setSuccessMessage('Blink detection completed and blink CSV regenerated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to detect blinks.');
    } finally {
      setIsDetecting(false);
    }
  };

  const persistBlinkRows = async (
    rows: BlinkEventRow[],
    message: string
  ) => {
    if (!analysisSession || !window.electronAPI) {
      return null;
    }
    setIsSavingBlinks(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await window.electronAPI.saveBlinkEdits({
        sessionFolder: analysisSession.paths.sessionFolder,
        blinkRows: rows
      });
      const metadata = await window.electronAPI.updateSessionMetadata({
        sessionFolder: analysisSession.paths.sessionFolder,
        updates: {
          blink_task_labels: blinkTaskLabelsDraft,
          blink_review_saved_at: new Date().toISOString()
        }
      });
      const nextSession = {
        ...analysisSession,
        metadata: {
          ...analysisSession.metadata,
          ...metadata
        },
        blinkRows: response.blinkRows
      };
      setAnalysisSession(nextSession);
      setBlinkRowsDraft(response.blinkRows);
      setSuccessMessage(message);
      return response.blinkRows;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save blink edits.');
      return null;
    } finally {
      setIsSavingBlinks(false);
    }
  };

  const handleSaveBlinkEdits = async () => {
    await persistBlinkRows(blinkRowsDraft, 'Blink edits and task labels saved.');
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

  const updateSelectedBlinkTiming = (edge: 'start' | 'end', value: number) => {
    if (selectedBlinkIndex == null || !selectedBlink || !Number.isFinite(value)) {
      return;
    }
    const minimumDurationSec = 0.03;
    const nextStart =
      edge === 'start'
        ? Math.max(timelineStartSec, Math.min(value, selectedBlink.end_time_sec - minimumDurationSec))
        : selectedBlink.start_time_sec;
    const nextEnd =
      edge === 'end'
        ? Math.min(analysisSession?.durationSec ?? value, Math.max(value, selectedBlink.start_time_sec + minimumDurationSec))
        : selectedBlink.end_time_sec;
    updateBlinkDraft(selectedBlinkIndex, {
      start_time_sec: nextStart,
      peak_frame: null,
      peak_time_sec: null,
      end_time_sec: nextEnd,
      closing_duration_sec: null,
      opening_duration_sec: null,
      min_opening_px: null,
      min_opening_percent: null,
      peak_closure_percent: null,
      blink_classification: '',
      is_manually_edited: 1
    });
  };

  const saveReviewTiming = async () => {
    if (selectedBlinkIndex == null || !selectedBlink) {
      return;
    }
    await persistBlinkRows(blinkRowsDraft, 'Blink timing saved.');
  };

  const splitSelectedBlinkAtCurrentTime = async () => {
    if (selectedBlinkIndex == null || !selectedBlink) {
      return;
    }
    const minimumDurationSec = 0.03;
    const fallbackSplit = selectedBlink.start_time_sec + selectedBlink.duration_sec / 2;
    const splitTime =
      currentTimeSec > selectedBlink.start_time_sec + minimumDurationSec &&
      currentTimeSec < selectedBlink.end_time_sec - minimumDurationSec
        ? currentTimeSec
        : fallbackSplit;

    if (
      splitTime - selectedBlink.start_time_sec < minimumDurationSec ||
      selectedBlink.end_time_sec - splitTime < minimumDurationSec
    ) {
      setError('This candidate is too short to split into two blink events.');
      return;
    }

    const baseId = selectedBlink.blink_id || `manual_${selectedBlinkIndex + 1}`;
    const splitId = `${baseId}_split_${Date.now()}`;
    const resetMetrics: Pick<
      BlinkEventRow,
      | 'peak_frame'
      | 'peak_time_sec'
      | 'closing_duration_sec'
      | 'opening_duration_sec'
      | 'min_opening_px'
      | 'min_opening_percent'
      | 'peak_closure_percent'
      | 'blink_classification'
      | 'is_manually_edited'
    > = {
      peak_frame: null,
      peak_time_sec: null,
      closing_duration_sec: null,
      opening_duration_sec: null,
      min_opening_px: null,
      min_opening_percent: null,
      peak_closure_percent: null,
      blink_classification: '',
      is_manually_edited: 1
    };
    const first: BlinkEventRow = {
      ...selectedBlink,
      ...resetMetrics,
      blink_id: `${splitId}_1`,
      end_frame: null,
      end_time_sec: splitTime,
      duration_sec: splitTime - selectedBlink.start_time_sec
    };
    const second: BlinkEventRow = {
      ...selectedBlink,
      ...resetMetrics,
      blink_id: `${splitId}_2`,
      start_frame: null,
      start_time_sec: splitTime,
      duration_sec: selectedBlink.end_time_sec - splitTime
    };
    const nextRows = [
      ...blinkRowsDraft.slice(0, selectedBlinkIndex),
      first,
      second,
      ...blinkRowsDraft.slice(selectedBlinkIndex + 1)
    ];
    setBlinkRowsDraft(nextRows);
    const savedRows = await persistBlinkRows(
      nextRows,
      'Blink split into two events.'
    );
    if (savedRows) {
      setSelectedBlinkIndex(selectedBlinkIndex);
      seekToBlink(savedRows[selectedBlinkIndex]);
    }
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
  const selectedBlink = selectedBlinkIndex == null ? null : blinkRowsDraft[selectedBlinkIndex] ?? null;

  useEffect(() => {
    setReviewDecisionMode(null);
    setRejectionOtherNotes('');
  }, [selectedBlinkIndex]);

  useEffect(() => {
    return () => {
      if (blinkPlaybackTimeoutRef.current != null) {
        window.clearTimeout(blinkPlaybackTimeoutRef.current);
      }
      if (plotRef.current) {
        void Plotly.purge(plotRef.current);
      }
      if (blinkReviewTraceRef.current) {
        void Plotly.purge(blinkReviewTraceRef.current);
      }
      if (velocityPlotRef.current) {
        void Plotly.purge(velocityPlotRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !analysisSession?.mediaPath) {
      return;
    }

    setVideoError(null);
    video.playbackRate = playbackRate;
    video.pause();
    video.load();
  }, [analysisSession?.mediaPath, videoMetricsRefreshKey]);

  useEffect(() => {
    if (analysisView !== 'review') {
      setIsAddingBlinkFromTrace(false);
      setPendingBlinkStartSec(null);
      setHoveredBlinkIndex(null);
      setHoveredBlinkBoundary(null);
      setHoveredBlinkEdgeIndex(null);
      playheadDragRef.current = false;
      graphClickRef.current = null;
    }
  }, [analysisView]);

  useEffect(() => {
    let isCurrent = true;

    const loadVideoMetrics = async () => {
      if (!analysisSession?.mediaPath || !window.electronAPI) {
        setVideoMetrics(null);
        return;
      }

      try {
        const info = await window.electronAPI.probeVideo(analysisSession.mediaPath);
        if (isCurrent) {
          setVideoMetrics(info);
        }
      } catch {
        if (isCurrent) {
          setVideoMetrics(null);
        }
      }
    };

    void loadVideoMetrics();

    return () => {
      isCurrent = false;
    };
  }, [analysisSession?.mediaPath, videoMetricsRefreshKey]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, analysisSession?.mediaPath]);

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

    const series = analysisSession.frameRows.reduce<TraceSeriesBuilder>(
      (accumulator, row) => {
        const timestamp = toNumber(row.timestamp_sec);
        const frameIndex = toNumber(row.frame_index);
        const previousTimestamp = accumulator.validTimestamps[accumulator.validTimestamps.length - 1] ?? null;
        const previousFrameIndex = accumulator.previousFrameIndex;
        const startsNewRun =
          accumulator.timestamps.length > 0 &&
          ((timestamp != null && previousTimestamp != null && timestamp < previousTimestamp) ||
            (frameIndex != null && previousFrameIndex != null && frameIndex <= previousFrameIndex));

        if (startsNewRun) {
          accumulator.timestamps.push(null);
          accumulator.left.push(null);
          accumulator.right.push(null);
        }

        accumulator.timestamps.push(timestamp);
        accumulator.left.push(toNumber(row.left_opening_percent));
        accumulator.right.push(toNumber(row.right_opening_percent));
        if (timestamp != null) {
          accumulator.validTimestamps.push(timestamp);
        }
        accumulator.previousFrameIndex = frameIndex;
        return accumulator;
      },
      { timestamps: [], validTimestamps: [], left: [], right: [], previousFrameIndex: null }
    );

    return {
      timestamps: series.timestamps,
      validTimestamps: series.validTimestamps,
      left: series.left,
      right: series.right
    };
  }, [analysisSession]);

  const velocitySeries = useMemo<VelocitySeries | null>(() => {
    if (!traceSeries) {
      return null;
    }

    const timestamps: Array<number | null> = [];
    const left: Array<number | null> = [];
    const right: Array<number | null> = [];
    const bilateral: Array<number | null> = [];

    for (let index = 1; index < traceSeries.timestamps.length; index += 1) {
      const previousTime = traceSeries.timestamps[index - 1];
      const currentTime = traceSeries.timestamps[index];
      const previousLeft = traceSeries.left[index - 1];
      const currentLeft = traceSeries.left[index];
      const previousRight = traceSeries.right[index - 1];
      const currentRight = traceSeries.right[index];

      if (previousTime == null || currentTime == null || currentTime <= previousTime) {
        timestamps.push(null);
        left.push(null);
        right.push(null);
        bilateral.push(null);
        continue;
      }

      const deltaTimeMs = (currentTime - previousTime) * 1000;
      const leftVelocity =
        previousLeft != null && currentLeft != null ? (currentLeft - previousLeft) / deltaTimeMs : null;
      const rightVelocity =
        previousRight != null && currentRight != null ? (currentRight - previousRight) / deltaTimeMs : null;
      const bilateralVelocity =
        leftVelocity == null ? rightVelocity : rightVelocity == null ? leftVelocity : (leftVelocity + rightVelocity) / 2;

      timestamps.push(currentTime);
      left.push(leftVelocity);
      right.push(rightVelocity);
      bilateral.push(bilateralVelocity);
    }

    return { timestamps, left, right, bilateral };
  }, [traceSeries]);

  const zoomTrace = (factor: number) => {
    if (!traceSeries?.validTimestamps.length) {
      return;
    }

    const minTime = traceSeries.validTimestamps[0];
    const maxTime = traceSeries.validTimestamps[traceSeries.validTimestamps.length - 1];
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
        const color = blinkHighlightColor(row, 0.32);
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
            color: isSelected || isHovered
              ? '#f8fafc'
              : blinkHighlightColor(row, 0.8),
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
          color: blinkHighlightColor(row, 1),
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
        dragmode: isAddingBlinkFromTrace ? false : 'zoom',
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
        scrollZoom: !isAddingBlinkFromTrace,
        responsive: true
      }
    );
  }, [
    activeBlinkEntries,
    analysisSession?.frameRows,
    currentTimeSec,
    hoveredBlinkBoundary,
    hoveredBlinkIndex,
    isAddingBlinkFromTrace,
    pendingBlinkStartSec,
    selectedBlinkIndex,
    traceSeries
  ]);

  useEffect(() => {
    const container = velocityPlotRef.current;
    if (!container || !velocitySeries) {
      return;
    }

    const blinkShapes = activeBlinkEntries.map(({ row, index }) => {
      const isSelected = index === selectedBlinkIndex;
      return {
        type: 'rect' as const,
        x0: row.start_time_sec,
        x1: row.end_time_sec,
        y0: 0,
        y1: 1,
        yref: 'paper',
        fillcolor: blinkHighlightColor(row, 0.2),
        line: {
          color: isSelected ? '#f8fafc' : blinkHighlightColor(row, 0.65),
          width: isSelected ? 3 : 1
        }
      };
    });

    void Plotly.react(
      container,
      [
        {
          x: velocitySeries.timestamps,
          y: velocitySeries.left,
          type: 'scatter',
          mode: 'lines',
          name: 'Left velocity',
          line: { color: '#f59e0b', width: 2 },
          connectgaps: false
        },
        {
          x: velocitySeries.timestamps,
          y: velocitySeries.right,
          type: 'scatter',
          mode: 'lines',
          name: 'Right velocity',
          line: { color: '#38bdf8', width: 2 },
          connectgaps: false
        },
        {
          x: velocitySeries.timestamps,
          y: velocitySeries.bilateral,
          type: 'scatter',
          mode: 'lines',
          name: 'Average',
          line: { color: '#e2e8f0', width: 1.5, dash: 'dot' },
          connectgaps: false,
          visible: 'legendonly'
        }
      ],
      {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(8,17,29,0.55)',
        margin: { l: 62, r: 18, t: 24, b: 42 },
        showlegend: true,
        uirevision: 'analysis-velocity',
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
          autorange: xRangeRef.current == null,
          range: xRangeRef.current ?? undefined
        },
        yaxis: {
          title: 'Opening change (%/ms)',
          color: '#cbd5e1',
          gridcolor: 'rgba(148,163,184,0.14)',
          zerolinecolor: 'rgba(248,250,252,0.5)'
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
          }
        ]
      },
      {
        displayModeBar: false,
        scrollZoom: true,
        responsive: true
      }
    );
  }, [activeBlinkEntries, analysisView, currentTimeSec, selectedBlinkIndex, velocitySeries, xRangeState]);

  useEffect(() => {
    const container = blinkReviewTraceRef.current;
    if (!container || !traceSeries || !selectedBlink || !isBlinkReviewOpen) {
      return;
    }

    const paddingSec = Math.max(0.25, selectedBlink.duration_sec * 1.5);
    const rangeStart = Math.max(timelineStartSec, selectedBlink.start_time_sec - paddingSec);
    const rangeEnd = Math.min(analysisSession?.durationSec ?? selectedBlink.end_time_sec + paddingSec, selectedBlink.end_time_sec + paddingSec);
    blinkReviewRangeRef.current = [rangeStart, rangeEnd];

    void Plotly.react(
      container,
      [
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
        }
      ],
      {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(8,17,29,0.55)',
        margin: { l: 42, r: 18, t: 18, b: 36 },
        dragmode: false,
        showlegend: true,
        legend: { orientation: 'h', x: 0, y: 1.14, font: { color: '#cbd5e1', size: 11 } },
        xaxis: {
          title: 'Time (s)',
          color: '#cbd5e1',
          gridcolor: 'rgba(148,163,184,0.14)',
          zeroline: false,
          fixedrange: true,
          range: [rangeStart, rangeEnd]
        },
        yaxis: {
          title: 'Opening (%)',
          color: '#cbd5e1',
          gridcolor: 'rgba(148,163,184,0.14)',
          range: [0, 110],
          fixedrange: true
        },
        shapes: [
          {
            type: 'rect',
            x0: selectedBlink.start_time_sec,
            x1: selectedBlink.end_time_sec,
            y0: 0,
            y1: 1,
            yref: 'paper',
            fillcolor: blinkHighlightColor(selectedBlink, 0.28),
            line: { color: blinkHighlightColor(selectedBlink, 0.9), width: 2 }
          },
          {
            type: 'line',
            x0: selectedBlink.start_time_sec,
            x1: selectedBlink.start_time_sec,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: { color: '#f8fafc', width: 3 }
          },
          {
            type: 'line',
            x0: selectedBlink.end_time_sec,
            x1: selectedBlink.end_time_sec,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: { color: '#f8fafc', width: 3 }
          },
          {
            type: 'line',
            x0: selectedBlink.peak_time_sec ?? selectedBlink.start_time_sec,
            x1: selectedBlink.peak_time_sec ?? selectedBlink.start_time_sec,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: { color: '#fb7185', width: 2 }
          }
        ]
      },
      { displayModeBar: false, scrollZoom: false, responsive: true }
    );
  }, [analysisSession?.durationSec, isBlinkReviewOpen, selectedBlink, timelineStartSec, traceSeries]);

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

  const blinkSummaryMetrics = useMemo(() => {
    const activeRows = blinkRowsDraft.filter((row) => row.is_deleted !== 1);
    const countByClassification = (classification: string) =>
      activeRows.filter((row) => row.blink_classification === classification).length;
    const completeCount = activeRows.filter((row) =>
      row.blink_classification === 'complete' || row.blink_classification === 'near_complete'
    ).length;
    const durationMin = analysisSession?.durationSec ? analysisSession.durationSec / 60 : 0;
    const blinkRate = durationMin > 0 ? activeRows.length / durationMin : null;
    const closingTimesMs = activeRows
      .map((row) => (row.closing_duration_sec != null ? row.closing_duration_sec * 1000 : null))
      .filter((value): value is number => value != null);
    const openingTimesMs = activeRows
      .map((row) => (row.opening_duration_sec != null ? row.opening_duration_sec * 1000 : null))
      .filter((value): value is number => value != null);
    const blinkDurationsMs = activeRows
      .map((row) => row.duration_sec * 1000)
      .filter((value): value is number => value != null);
    const average = (values: number[]): number | null =>
      values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
    const sortedStarts = activeRows
      .map((row) => ({ startTimeSec: row.start_time_sec }))
      .filter((entry) => Number.isFinite(entry.startTimeSec))
      .sort((left, right) => left.startTimeSec - right.startTimeSec)
      .map((entry, index) => ({ ...entry, blinkNumber: index + 1 }));
    const intervalPoints = sortedStarts.slice(1).map((entry, index) => ({
      timeMin: entry.startTimeSec / 60,
      intervalSec: entry.startTimeSec - sortedStarts[index].startTimeSec,
      previousBlinkNumber: sortedStarts[index].blinkNumber,
      nextBlinkNumber: entry.blinkNumber
    }));
    const intervals = intervalPoints.map((point) => point.intervalSec);
    const maxIntervalPoint = intervalPoints.length
      ? intervalPoints.reduce((largest, point) => (point.intervalSec > largest.intervalSec ? point : largest), intervalPoints[0])
      : null;
    const averageIntervalSec = average(intervals);
    const intervalStdDevSec =
      averageIntervalSec != null && intervals.length > 1
        ? Math.sqrt(
            intervals.reduce((total, interval) => total + (interval - averageIntervalSec) ** 2, 0) / intervals.length
          )
        : null;
    const intervalRegularityPercent =
      averageIntervalSec != null && averageIntervalSec > 0 && intervalStdDevSec != null
        ? (intervalStdDevSec / averageIntervalSec) * 100
        : null;
    const intervalTrendSecPerMin =
      intervalPoints.length > 1
        ? (() => {
            const meanX = average(intervalPoints.map((point) => point.timeMin));
            const meanY = average(intervalPoints.map((point) => point.intervalSec));
            if (meanX == null || meanY == null) {
              return null;
            }
            const numerator = intervalPoints.reduce(
              (total, point) => total + (point.timeMin - meanX) * (point.intervalSec - meanY),
              0
            );
            const denominator = intervalPoints.reduce((total, point) => total + (point.timeMin - meanX) ** 2, 0);
            return denominator > 0 ? numerator / denominator : null;
          })()
        : null;

    return {
      total: activeRows.length,
      complete: completeCount,
      partial: countByClassification('partial'),
      blinkRate,
      averageClosingTimeMs: average(closingTimesMs),
      averageOpeningTimeMs: average(openingTimesMs),
      averageBlinkDurationMs: average(blinkDurationsMs),
      averageIntervalSec,
      maxIntervalSec: maxIntervalPoint?.intervalSec ?? null,
      maxIntervalPair:
        maxIntervalPoint == null
          ? null
          : {
              previousBlinkNumber: maxIntervalPoint.previousBlinkNumber,
              nextBlinkNumber: maxIntervalPoint.nextBlinkNumber
            },
      intervalRegularityPercent,
      intervalTrendSecPerMin
    };
  }, [analysisSession?.durationSec, blinkRowsDraft]);

  const dataFrameMetrics = useMemo(() => {
    const rows = analysisSession?.frameRows ?? [];
    const timestamps = rows.map((row) => toNumber(row.timestamp_sec)).filter((value): value is number => value != null);
    if (timestamps.length < 2) {
      return {
        fps: null,
        frameCount: rows.length
      };
    }
    const durationSec = timestamps[timestamps.length - 1] - timestamps[0];
    return {
      fps: durationSec > 0 ? (timestamps.length - 1) / durationSec : null,
      frameCount: rows.length
    };
  }, [analysisSession?.frameRows]);

  const sessionSummaryItems = useMemo<SessionSummaryItem[]>(() => {
    if (!analysisSession) {
      return [];
    }

    const items: SessionSummaryItem[] = [];
    const totalBlinks = blinkSummaryMetrics.total;
    const completeShare = totalBlinks > 0 ? (blinkSummaryMetrics.complete / totalBlinks) * 100 : null;
    const partialShare = totalBlinks > 0 ? (blinkSummaryMetrics.partial / totalBlinks) * 100 : null;
    const flaggedRows = activeBlinkEntries.filter(({ row }) => row.quality_flag?.trim());
    const lowConfidenceCount = activeBlinkEntries.filter(({ row }) => row.quality_flag?.includes('low_confidence')).length;
    const possibleGazeCount = activeBlinkEntries.filter(({ row }) =>
      row.quality_flag?.includes('possible_gaze_or_downward_look')
    ).length;
    const lowDataFps = dataFrameMetrics.fps != null && dataFrameMetrics.fps < 25;
    const videoMetricStatus =
      videoMetrics == null || videoMetrics.fps == null || videoMetrics.frameCount == null || videoMetrics.frameCount <= 0
        ? 'Video frame details are not available for this session.'
        : `The reference video reports ${videoMetrics.fps.toFixed(1)} FPS and ${videoMetrics.frameCount} frames.`;

    items.push({
      title: 'Blink pattern',
      body:
        totalBlinks === 0
          ? 'No saved blinks are available yet. Run Auto-Detect Blinks or add manual blinks before interpreting this session.'
          : `${totalBlinks} blinks were saved, with a recording blink rate of ${formatRate(blinkSummaryMetrics.blinkRate)}.`,
      tone: totalBlinks === 0 ? 'attention' : 'neutral'
    });

    if (totalBlinks > 0) {
      items.push({
        title: 'Classification mix',
        body: `Complete: ${blinkSummaryMetrics.complete} (${formatPercent(completeShare)}). Partial: ${blinkSummaryMetrics.partial} (${formatPercent(partialShare)}).`
      });
    }

    items.push({
      title: 'Blink timing',
      body:
        blinkSummaryMetrics.averageBlinkDurationMs == null
          ? 'Average blink duration is not available yet.'
          : `Average blink duration was ${formatMilliseconds(
              blinkSummaryMetrics.averageBlinkDurationMs
            )}, with average closing time ${formatMilliseconds(
              blinkSummaryMetrics.averageClosingTimeMs
            )} and average opening time ${formatMilliseconds(blinkSummaryMetrics.averageOpeningTimeMs)}.`
    });

    items.push({
      title: 'Inter-blink intervals',
      body:
        blinkSummaryMetrics.averageIntervalSec == null
          ? 'There are not enough blinks to calculate inter-blink intervals.'
          : `Average time between blinks was ${formatSeconds(
              blinkSummaryMetrics.averageIntervalSec
            )}. The longest gap was ${formatSeconds(blinkSummaryMetrics.maxIntervalSec)} ${
              blinkSummaryMetrics.maxIntervalPair ? formatIntervalPair(blinkSummaryMetrics.maxIntervalPair) : ''
            }, and the interval trend was ${formatIntervalTrend(blinkSummaryMetrics.intervalTrendSecPerMin)}.`
    });

    items.push({
      title: 'Review flags',
      body:
        flaggedRows.length === 0
          ? 'No low-confidence or possible gaze/downward-look flags are currently saved for detected blinks.'
          : `${flaggedRows.length} blink${flaggedRows.length === 1 ? '' : 's'} should be reviewed: ${lowConfidenceCount} low-confidence and ${possibleGazeCount} possible gaze/downward-look.`,
      tone: flaggedRows.length === 0 ? 'positive' : 'attention'
    });

    items.push({
      title: 'Recording quality',
      body: `The data file contains ${dataFrameMetrics.frameCount} measurement frames${
        dataFrameMetrics.fps == null ? '' : ` at ${dataFrameMetrics.fps.toFixed(1)} FPS`
      }. ${videoMetricStatus}`,
      tone: lowDataFps ? 'attention' : 'neutral'
    });

    const labeledBlinkTasks = Object.values(blinkTaskLabelsDraft).filter((label) => label.trim());
    if (labeledBlinkTasks.length) {
      items.push({
        title: 'Task labels',
        body: `${labeledBlinkTasks.length} blink${labeledBlinkTasks.length === 1 ? ' has' : 's have'} a task label saved in Manual Review.`
      });
    } else {
      items.push({
        title: 'Task labels',
        body: 'No blink task labels are saved yet. Type task labels in Manual Review if you want to connect individual blinks to resting, reading, screen, print, or brightness conditions.'
      });
    }

    return items;
  }, [
    activeBlinkEntries,
    analysisSession,
    blinkSummaryMetrics,
    dataFrameMetrics,
    blinkTaskLabelsDraft,
    videoMetrics
  ]);

  const questionnaireComparisonRows = useMemo<QuestionnaireComparisonRow[]>(() => {
    const preSymptoms = asRecord(analysisSession?.metadata.todays_symptoms);
    const postSession = asRecord(analysisSession?.metadata.post_session);
    const postSymptoms = asRecord(postSession.ocular_symptoms);
    const fields = [
      { key: 'dryness_0_to_5', label: 'Eye dryness' },
      { key: 'tiredness_0_to_5', label: 'Eye tiredness' },
      { key: 'burning_stinging_0_to_5', label: 'Burning or stinging' },
      { key: 'blurry_vision_0_to_5', label: 'Blurry vision' },
      { key: 'light_sensitivity_0_to_5', label: 'Light sensitivity' }
    ];

    return fields.map((field) => {
      const before = toQuestionnaireNumber(preSymptoms[field.key]);
      const after = toQuestionnaireNumber(postSymptoms[field.key]);
      return {
        key: field.key,
        label: field.label,
        before,
        after,
        change: before == null || after == null ? null : after - before
      };
    });
  }, [analysisSession?.metadata]);

  const matchedQuestionnaireComparisonRows = useMemo(
    () => questionnaireComparisonRows.filter((row) => row.before != null && row.after != null),
    [questionnaireComparisonRows]
  );

  const hasPostSessionComparison = matchedQuestionnaireComparisonRows.length > 0;

  useEffect(() => {
    if (analysisView === 'questionnaire' && !hasPostSessionComparison) {
      setAnalysisView('summary');
    }
  }, [analysisView, hasPostSessionComparison]);

  const blinkVelocityMetrics = useMemo<BlinkVelocityMetric[]>(() => {
    return activeBlinkEntries.map(({ row, index }, blinkListIndex) => {
      return {
        row,
        index,
        blinkNumber: blinkListIndex + 1,
        closingTimeMs: row.closing_duration_sec == null ? null : row.closing_duration_sec * 1000,
        openingTimeMs: row.opening_duration_sec == null ? null : row.opening_duration_sec * 1000
      };
    });
  }, [activeBlinkEntries]);

  const orderedFrameTimes = useMemo(
    () =>
      analysisSession?.frameRows
        .map((row) => toNumber(row.timestamp_sec))
        .filter((value): value is number => value != null) ?? [],
    [analysisSession]
  );

  const visibleXRange = useMemo<[number, number] | null>(() => {
    if (!traceSeries?.validTimestamps.length) {
      return null;
    }
    return xRangeState ?? [traceSeries.validTimestamps[0], traceSeries.validTimestamps[traceSeries.validTimestamps.length - 1]];
  }, [traceSeries, xRangeState]);

  const taskLabelForBlink = (row: BlinkEventRow, index: number): string => {
    const assignmentKey = blinkAssignmentKey(row, index);
    return blinkTaskLabelsDraft[assignmentKey] ?? '';
  };

  const updateBlinkTaskLabel = (row: BlinkEventRow, index: number, label: string) => {
    const assignmentKey = blinkAssignmentKey(row, index);
    setBlinkTaskLabelsDraft((previous) => {
      const next = { ...previous };
      if (label) {
        next[assignmentKey] = label;
      } else {
        delete next[assignmentKey];
      }
      return next;
    });
  };

  const confidenceDescription = (row: BlinkEventRow): string => {
    const explanation = qualityFlagExplanation(row);
    if (explanation) {
      return explanation;
    }
    return 'Tracking confidence looked acceptable for this blink. No low-confidence or possible gaze/downward-look flag is saved.';
  };

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

  const playheadHitThresholdSec = (): number | null => {
    const shell = plotShellRef.current;
    if (!shell || !visibleXRange) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    const innerWidth = rect.width - ANALYSIS_PLOT_MARGIN.left - ANALYSIS_PLOT_MARGIN.right;
    if (innerWidth <= 0) {
      return null;
    }

    return (PLAYHEAD_HIT_WIDTH_PX / innerWidth) * (visibleXRange[1] - visibleXRange[0]);
  };

  const clientXToReviewTime = (clientX: number): number | null => {
    const shell = blinkReviewTraceRef.current;
    const range = blinkReviewRangeRef.current;
    if (!shell || !range) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    const innerWidth = rect.width - 42 - 18;
    if (innerWidth <= 0) {
      return null;
    }

    const x = Math.max(0, Math.min(innerWidth, clientX - rect.left - 42));
    return range[0] + (x / innerWidth) * (range[1] - range[0]);
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

  const seekToBlink = (row: BlinkEventRow) => {
    seekTo(row.start_time_sec);
  };

  const reviewClipRange = (row: BlinkEventRow): [number, number] => {
    const clipStart = Math.max(timelineStartSec, row.start_time_sec - 1);
    const closingEnd = row.peak_time_sec ?? row.end_time_sec;
    const clipEnd = Math.min(analysisSession?.durationSec ?? closingEnd + 1, closingEnd + 1);
    return [clipStart, Math.max(clipStart + 0.1, clipEnd)];
  };

  const nextActiveBlinkIndexAfter = (rows: BlinkEventRow[], currentIndex: number): number | null => {
    const next = rows.findIndex((row, index) => index > currentIndex && row.is_deleted !== 1);
    return next === -1 ? null : next;
  };

  const nextUnreviewedBlinkIndexAfter = (rows: BlinkEventRow[], currentIndex: number): number | null => {
    const next = rows.findIndex((row, index) => {
      if (index <= currentIndex || row.is_deleted === 1) {
        return false;
      }
      const flags = row.quality_flag.split(';').map((flag) => flag.trim());
      return !flags.includes('human_confirmed') && !flags.includes('human_rejected');
    });
    return next === -1 ? null : next;
  };

  const selectBlinkForReview = (index: number) => {
    const row = blinkRowsDraft[index];
    if (!row) {
      return;
    }
    setSelectedBlinkIndex(index);
    setIsBlinkReviewOpen(true);
    window.setTimeout(() => {
      plotShellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
    seekToBlink(row);
  };

  const playSelectedBlinkClip = async () => {
    if (!selectedBlink) {
      return;
    }
    seekToBlink(selectedBlink);
    const video = isBlinkReviewOpen ? blinkReviewVideoRef.current ?? videoRef.current : videoRef.current;
    if (!video || !analysisSession?.mediaPath) {
      return;
    }
    if (blinkPlaybackTimeoutRef.current != null) {
      window.clearTimeout(blinkPlaybackTimeoutRef.current);
    }
    const [clipStart, clipEnd] = reviewClipRange(selectedBlink);
    video.currentTime = toMediaTime(clipStart);
    await video.play();
    const durationMs = Math.max(350, ((clipEnd - clipStart) / playbackRate) * 1000);
    blinkPlaybackTimeoutRef.current = window.setTimeout(() => {
      video.pause();
      blinkPlaybackTimeoutRef.current = null;
    }, durationMs);
  };

  const selectFirstUnreviewedBlink = () => {
    const firstUnreviewed = blinkRowsDraft.findIndex(
      (row) => row.is_deleted !== 1 && !row.quality_flag.split(';').map((flag) => flag.trim()).includes('human_confirmed')
    );
    const firstActive = activeBlinkEntries[0]?.index ?? null;
    const nextIndex = firstUnreviewed === -1 ? firstActive : firstUnreviewed;
    if (nextIndex != null) {
      selectBlinkForReview(nextIndex);
    }
  };

  const handleStartBlinkReview = async () => {
    const firstActiveIndex = blinkRowsDraft.findIndex((row) => row.is_deleted !== 1);

    if (firstActiveIndex === -1) {
      setError('No active blink candidates are available for confirmation.');
      return;
    }
    selectBlinkForReview(firstActiveIndex);
  };

  const handleReviewTraceMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectedBlink) {
      return;
    }
    const clickedTime = clientXToReviewTime(event.clientX);
    if (clickedTime == null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (isAddingBlinkFromReview) {
      blinkReviewAddStartRef.current = clickedTime;
      return;
    }

    const range = blinkReviewRangeRef.current;
    const edgeThreshold = range ? Math.max(0.03, (12 / Math.max(1, blinkReviewTraceRef.current?.clientWidth ?? 1)) * (range[1] - range[0])) : 0.05;
    const startDistance = Math.abs(clickedTime - selectedBlink.start_time_sec);
    const endDistance = Math.abs(clickedTime - selectedBlink.end_time_sec);
    if (Math.min(startDistance, endDistance) <= edgeThreshold) {
      blinkReviewDragRef.current = startDistance <= endDistance ? 'start' : 'end';
    }
  };

  const handleReviewTraceMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const draggedTime = clientXToReviewTime(event.clientX);
    if (draggedTime == null) {
      return;
    }
    if (blinkReviewDragRef.current) {
      updateSelectedBlinkTiming(blinkReviewDragRef.current, draggedTime);
      return;
    }
  };

  const handleReviewTraceMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    const releasedTime = clientXToReviewTime(event.clientX);
    if (blinkReviewDragRef.current) {
      if (releasedTime != null) {
        updateSelectedBlinkTiming(blinkReviewDragRef.current, releasedTime);
      }
      blinkReviewDragRef.current = null;
      return;
    }

    if (isAddingBlinkFromReview && blinkReviewAddStartRef.current != null && releasedTime != null) {
      addManualBlinkFromRange(blinkReviewAddStartRef.current, releasedTime);
      blinkReviewAddStartRef.current = null;
      setIsAddingBlinkFromReview(false);
    }
  };

  const handleBlinkConfirmation = async (
    confirmed: boolean,
    options?: {
      classification?: Extract<BlinkEventRow['blink_classification'], 'complete' | 'partial'>;
      rejectionReason?: RejectionReason;
      rejectionNotes?: string;
    }
  ) => {
    if (selectedBlinkIndex == null || !selectedBlink) {
      return;
    }

    const nextRows = blinkRowsDraft.map((row, index) => {
      if (index !== selectedBlinkIndex) {
        return row;
      }
      const qualityWithoutHumanReview = removeQualityFlags(row.quality_flag, HUMAN_REVIEW_FLAGS);
      if (confirmed) {
        return {
          ...row,
          is_deleted: 0,
          is_manually_edited: 1,
          blink_classification: options?.classification ?? row.blink_classification,
          quality_flag: addQualityFlag(qualityWithoutHumanReview, 'human_confirmed')
        };
      }

      const rejectionReason = options?.rejectionReason ?? 'other';
      const rejectionFlag =
        rejectionReason === 'flutter'
          ? 'rejected_flutter'
          : rejectionReason === 'downward_gaze'
            ? 'rejected_downward_gaze'
            : 'rejected_other';
      const rejectionLabel =
        rejectionReason === 'flutter'
          ? 'flutter'
          : rejectionReason === 'downward_gaze'
            ? 'downward gaze'
            : (options?.rejectionNotes ?? '').trim() || 'other';
      const flaggedQuality = addQualityFlag(addQualityFlag(qualityWithoutHumanReview, 'human_rejected'), rejectionFlag);
      return {
        ...row,
        is_deleted: 1,
        is_manually_edited: 1,
        quality_flag: flaggedQuality,
        notes: appendReviewNote(row.notes, `Human review rejection: ${rejectionLabel}.`)
      };
    });
    const nextIndex = nextUnreviewedBlinkIndexAfter(nextRows, selectedBlinkIndex) ?? nextActiveBlinkIndexAfter(nextRows, selectedBlinkIndex);
    setBlinkRowsDraft(nextRows);
    setSelectedBlinkIndex(nextIndex);
    setReviewDecisionMode(null);
    setRejectionOtherNotes('');
    setSuccessMessage('Saving review choice...');
    if (nextIndex != null) {
      seekToBlink(nextRows[nextIndex]);
    }

    const savedRows = await persistBlinkRows(
      nextRows,
      nextIndex == null
        ? 'Review choice saved. You have reached the end of the active blink list.'
        : `Review choice saved. Moved to Blink ${nextIndex + 1}.`
    );
    if (savedRows && nextIndex != null) {
      setSelectedBlinkIndex(nextIndex);
      seekToBlink(savedRows[nextIndex]);
    } else if (savedRows && nextIndex == null) {
      setIsBlinkReviewOpen(false);
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
        <p>Open a session folder to review synchronized traces and video before blink editing lands.</p>
        {error ? <StatusBanner tone="error" message={error} /> : null}
        {successMessage ? <StatusBanner tone="success" message={successMessage} /> : null}
        <div className="action-row placeholder-actions">
          <button className="primary-button" disabled={isLoading} onClick={() => setActiveTab('database')} type="button">
            Go to Database
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
          <button className="primary-button" disabled={isLoading} onClick={() => setActiveTab('database')} type="button">
            Go to Database
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

        <div className="analysis-toolbar-row">
          <div className="analysis-subtabs" aria-label="Analysis views">
            <button
              className={analysisView === 'review' ? 'selected' : ''}
              onClick={() => setAnalysisView('review')}
              type="button"
            >
              Review
            </button>
            <button
              className={analysisView === 'summary' ? 'selected' : ''}
              onClick={() => setAnalysisView('summary')}
              type="button"
            >
              Session Summary
            </button>
            <button
              className={analysisView === 'velocity' ? 'selected' : ''}
              onClick={() => setAnalysisView('velocity')}
              type="button"
            >
              Velocity
            </button>
            {hasPostSessionComparison ? (
              <button
                className={analysisView === 'questionnaire' ? 'selected' : ''}
                onClick={() => setAnalysisView('questionnaire')}
                type="button"
              >
                Before / After
              </button>
            ) : null}
          </div>
        </div>

        {analysisView === 'summary' ? (
          <div className="summary-layout">
            <div className="card metrics-card">
              <div className="section-heading compact">
                <div>
                  <h3>Session Summary</h3>
                </div>
                <p className="section-copy">
                  Plain-English review notes from the saved blink metrics. This is not a diagnosis or medical recommendation.
                </p>
              </div>
              <div className="session-summary-grid">
                {sessionSummaryItems.map((item) => (
                  <article className={`session-summary-item ${item.tone ? `is-${item.tone}` : ''}`} key={item.title}>
                    <h4>{item.title}</h4>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {analysisView === 'review' ? (
          <>
        <div className="analysis-review-stage">
        {isBlinkReviewOpen ? (
          <div className="blink-review-modal-backdrop" role="presentation">
            <div className="blink-review-modal" role="dialog" aria-modal="true" aria-label="Blink confirmation review">
              <div className="blink-review-modal-header">
                <div>
                  <h3>{selectedBlinkIndex == null ? 'Blink Review' : `Blink ${selectedBlinkIndex + 1}`}</h3>
                  <p className="field-helper">
                    {selectedBlink
                      ? `${selectedBlink.start_time_sec.toFixed(2)}-${selectedBlink.end_time_sec.toFixed(2)} s - ${
                          selectedBlink.blink_classification
                            ? selectedBlink.blink_classification.replace('_', '-')
                            : 'below threshold'
                        }`
                      : 'No blink selected'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsBlinkReviewOpen(false);
                    setReviewDecisionMode(null);
                    setRejectionOtherNotes('');
                    setIsAddingBlinkFromReview(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>

              {selectedBlink ? (
                <>
                  <div className="blink-review-modal-grid">
                    <div className="blink-review-modal-panel">
                      <h4>Trace crop</h4>
                      <div
                        ref={blinkReviewTraceRef}
                        className={`plotly-trace blink-review-trace ${isAddingBlinkFromReview ? 'is-review-add-mode' : ''}`}
                        onMouseDownCapture={handleReviewTraceMouseDown}
                        onMouseLeave={() => {
                          blinkReviewDragRef.current = null;
                          blinkReviewAddStartRef.current = null;
                        }}
                        onMouseMoveCapture={handleReviewTraceMouseMove}
                        onMouseUpCapture={handleReviewTraceMouseUp}
                      />
                    </div>
                    <div className="blink-review-modal-panel">
                      <h4>Video clip</h4>
                      {analysisSession.mediaPath ? (
                        <>
                          <div className="preview-frame blink-review-video-frame">
                            <video
                              key={`${analysisSession.mediaPath}-${selectedBlinkIndex ?? 'none'}`}
                              ref={blinkReviewVideoRef}
                              controls
                              muted
                              onError={() =>
                                setVideoError('This review video could not be decoded in the desktop shell. The trace crop is still available for review.')
                              }
                              onLoadedMetadata={(event) => {
                                event.currentTarget.playbackRate = playbackRate;
                                event.currentTarget.currentTime = toMediaTime(reviewClipRange(selectedBlink)[0]);
                              }}
                              onTimeUpdate={(event) => {
                                const [clipStart, clipEnd] = reviewClipRange(selectedBlink);
                                const traceTime = toTraceTime(event.currentTarget.currentTime);
                                setCurrentTimeSec(traceTime);
                                if (traceTime >= clipEnd) {
                                  event.currentTarget.pause();
                                }
                              }}
                              playsInline
                              preload="auto"
                              src={toMediaUrl(analysisSession.mediaPath)}
                            />
                          </div>
                          <div className="playback-speed-row blink-review-speed-row" aria-label="Blink review playback speed">
                            {PLAYBACK_RATES.map((rate) => (
                              <button
                                key={rate}
                                className={playbackRate === rate ? 'selected' : ''}
                                onClick={() => setPlaybackRate(rate)}
                                type="button"
                              >
                                {rate}x
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="analysis-trace-only">
                          <p className="field-helper">No playable media file was found for this session.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="blink-review-modal-details">
                    <p className="quality-flag-note">{confidenceDescription(selectedBlink)}</p>
                    <div className="blink-review-edit-tools">
                      <p className="field-helper">
                        Drag the white left or right edge on the trace crop to adjust this blink's duration.
                      </p>
                      <button
                        className={isAddingBlinkFromReview ? 'selected' : ''}
                        onClick={() => {
                          blinkReviewAddStartRef.current = null;
                          setIsAddingBlinkFromReview((value) => !value);
                        }}
                        type="button"
                      >
                        {isAddingBlinkFromReview ? 'Cancel Add Blink' : 'Add Blink'}
                      </button>
                      <button disabled={isSavingBlinks} onClick={() => void splitSelectedBlinkAtCurrentTime()} type="button">
                        Split at Current Time
                      </button>
                    </div>
                    <textarea
                      aria-label={`Review notes for blink ${selectedBlinkIndex == null ? '' : selectedBlinkIndex + 1}`}
                      value={selectedBlink.notes ?? ''}
                      onChange={(event) =>
                        selectedBlinkIndex == null
                          ? undefined
                          : updateBlinkDraft(selectedBlinkIndex, {
                              notes: event.target.value,
                              is_manually_edited: 1
                            })
                      }
                      placeholder="Optional notes for this blink candidate"
                    />
                    <div className="blink-confirmation-actions">
                      <button onClick={() => void playSelectedBlinkClip()} type="button">
                        Replay Blink
                      </button>
                      <button
                        className="confirm-button"
                        disabled={isSavingBlinks}
                        onClick={() => setReviewDecisionMode('confirm')}
                        type="button"
                      >
                        Confirm
                      </button>
                      <button
                        className="reject-button"
                        disabled={isSavingBlinks}
                        onClick={() => setReviewDecisionMode('reject')}
                        type="button"
                      >
                        Not a Blink
                      </button>
                    </div>
                    {reviewDecisionMode === 'confirm' ? (
                      <div className="blink-review-decision-panel">
                        <p className="field-helper">How should this confirmed blink be classified?</p>
                        <div className="blink-review-choice-row">
                          <button
                            className="confirm-button"
                            disabled={isSavingBlinks}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleBlinkConfirmation(true, { classification: 'complete' });
                            }}
                            type="button"
                          >
                            Complete
                          </button>
                          <button
                            className="partial-button"
                            disabled={isSavingBlinks}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleBlinkConfirmation(true, { classification: 'partial' });
                            }}
                            type="button"
                          >
                            Partial
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {reviewDecisionMode === 'reject' || reviewDecisionMode === 'reject_other' ? (
                      <div className="blink-review-decision-panel">
                        <p className="field-helper">Why is this not a blink?</p>
                        <div className="blink-review-choice-row">
                          <button
                            disabled={isSavingBlinks}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleBlinkConfirmation(false, { rejectionReason: 'flutter' });
                            }}
                            type="button"
                          >
                            Flutter
                          </button>
                          <button
                            disabled={isSavingBlinks}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleBlinkConfirmation(false, { rejectionReason: 'downward_gaze' });
                            }}
                            type="button"
                          >
                            Downward Gaze
                          </button>
                          <button
                            className={reviewDecisionMode === 'reject_other' ? 'selected' : ''}
                            disabled={isSavingBlinks}
                            onClick={() => setReviewDecisionMode('reject_other')}
                            type="button"
                          >
                            Other
                          </button>
                        </div>
                        {reviewDecisionMode === 'reject_other' ? (
                          <div className="blink-review-other-panel">
                            <textarea
                              aria-label="Other reason this candidate is not a blink"
                              className="blink-review-other-notes"
                              onChange={(event) => setRejectionOtherNotes(event.target.value)}
                              placeholder="Type why this is not a blink."
                              value={rejectionOtherNotes}
                            />
                            <button
                              className="reject-button"
                              disabled={isSavingBlinks || !rejectionOtherNotes.trim()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleBlinkConfirmation(false, {
                                  rejectionReason: 'other',
                                  rejectionNotes: rejectionOtherNotes
                                });
                              }}
                              type="button"
                            >
                              Save Not a Blink
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="blink-confirmation-empty">
                  <p className="field-helper">You have reached the end of the active blink list.</p>
                  <button
                    onClick={() => {
                      setIsBlinkReviewOpen(false);
                      setReviewDecisionMode(null);
                      setRejectionOtherNotes('');
                      setIsAddingBlinkFromReview(false);
                    }}
                    type="button"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}
        <div
          ref={plotShellRef}
          className={`analysis-plot-shell ${isAddingBlinkFromTrace ? 'is-trace-add-mode' : ''} ${hoveredBlinkBoundary ? `is-edge-drag is-edge-${hoveredBlinkBoundary}` : ''}`}
          onMouseDownCapture={(event) => {
            const clickedTime = clientXToTraceTime(event.clientX);
            if (clickedTime == null) {
              return;
            }

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

            const playheadThreshold = playheadHitThresholdSec();
            if (playheadThreshold != null && Math.abs(clickedTime - currentTimeSec) <= playheadThreshold) {
              event.preventDefault();
              event.stopPropagation();
              playheadDragRef.current = true;
              seekTo(clickedTime);
              return;
            }

            graphClickRef.current = {
              clientX: event.clientX,
              clientY: event.clientY,
              timeSec: clickedTime
            };
          }}
          onMouseUpCapture={(event) => {
            if (playheadDragRef.current) {
              event.preventDefault();
              event.stopPropagation();
              playheadDragRef.current = false;
              const releasedTime = clientXToTraceTime(event.clientX);
              if (releasedTime != null) {
                seekTo(releasedTime);
              }
              return;
            }
            if (isAddingBlinkFromTrace) {
              return;
            }
            const graphClick = graphClickRef.current;
            graphClickRef.current = null;
            if (!graphClick) {
              return;
            }

            const movementPx = Math.hypot(event.clientX - graphClick.clientX, event.clientY - graphClick.clientY);
            if (movementPx <= 4) {
              seekTo(graphClick.timeSec);
            }
          }}
          onMouseMoveCapture={(event) => {
            if (playheadDragRef.current) {
              const draggedTime = clientXToTraceTime(event.clientX);
              if (draggedTime != null) {
                seekTo(draggedTime);
              }
              return;
            }
            if (!isAddingBlinkFromTrace) {
              setHoveredBlinkIndex(null);
              setHoveredBlinkBoundary(null);
              setHoveredBlinkEdgeIndex(null);
              return;
            }
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
            playheadDragRef.current = false;
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
          <span>{formatClockTime(currentTimeSec)}</span>
        </div>
        <p className="field-helper analysis-hint">
          Click a blink to select it. Move near the left or right edge until the cursor changes, then drag to adjust timing.
        </p>
        {isAddingBlinkFromTrace ? (
          <p className="field-helper analysis-hint">
            Trace-add mode is on. Zoom is temporarily disabled. Click once for one edge and click again for the other edge.
          </p>
        ) : null}
        </div>

        <div className="analysis-support-grid">
          <div className="card analysis-video-card">
            <div className="section-heading compact">
              <div>
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
                        `This media file could not be decoded in the desktop shell. The trace is still available for review. Media path: ${analysisSession.mediaPath}`
                      )
                    }
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate = playbackRate;
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
                <div className="playback-speed-row" aria-label="Reference video playback speed">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      className={playbackRate === rate ? 'selected' : ''}
                      onClick={() => setPlaybackRate(rate)}
                      type="button"
                    >
                      {rate}x
                    </button>
                  ))}
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
                <h3>Review metrics</h3>
              </div>
            </div>
            <dl className="metric-grid">
              <div>
                <dt>Current time</dt>
                <dd>{formatClockTime(currentTimeSec)}</dd>
              </div>
              <div>
                <dt>Data FPS</dt>
                <dd>{formatMetric(dataFrameMetrics.fps, 1)}</dd>
              </div>
              <div>
                <dt>Data frames</dt>
                <dd>{dataFrameMetrics.frameCount}</dd>
              </div>
              <div>
                <dt>Video FPS</dt>
                <dd>{formatPositiveMetric(videoMetrics?.fps)}</dd>
              </div>
              <div>
                <dt>Video frames</dt>
                <dd>{formatPositiveInteger(videoMetrics?.frameCount)}</dd>
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
                <dd>{formatClockTime(analysisSession.durationSec)}</dd>
              </div>
            </dl>
          </div>

          <div className="card metrics-card">
            <div className="section-heading compact">
              <div>
                <h3>Blink classification output</h3>
              </div>
            </div>
            <dl className="metric-grid">
              <div>
                <dt>Total blinks</dt>
                <dd>{blinkSummaryMetrics.total}</dd>
              </div>
              <div>
                <dt>Complete</dt>
                <dd>{blinkSummaryMetrics.complete} / {blinkSummaryMetrics.total}</dd>
              </div>
              <div>
                <dt>Partial</dt>
                <dd>{blinkSummaryMetrics.partial} / {blinkSummaryMetrics.total}</dd>
              </div>
              <div>
                <dt>Recording blink rate</dt>
                <dd>{formatRate(blinkSummaryMetrics.blinkRate)}</dd>
              </div>
              <div>
                <dt>Avg closing time</dt>
                <dd>{formatMilliseconds(blinkSummaryMetrics.averageClosingTimeMs)}</dd>
              </div>
              <div>
                <dt>Avg opening time</dt>
                <dd>{formatMilliseconds(blinkSummaryMetrics.averageOpeningTimeMs)}</dd>
              </div>
              <div>
                <dt>Avg blink duration</dt>
                <dd>{formatMilliseconds(blinkSummaryMetrics.averageBlinkDurationMs)}</dd>
              </div>
              <div>
                <dt>Avg inter-blink interval</dt>
                <dd>{formatSeconds(blinkSummaryMetrics.averageIntervalSec)}</dd>
              </div>
              <div>
                <dt>Max inter-blink interval</dt>
                <dd>
                  {formatSeconds(blinkSummaryMetrics.maxIntervalSec)}
                  {blinkSummaryMetrics.maxIntervalPair ? (
                    <small className="metric-detail">{formatIntervalPair(blinkSummaryMetrics.maxIntervalPair)}</small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Interval regularity</dt>
                <dd>{formatPercent(blinkSummaryMetrics.intervalRegularityPercent)}</dd>
              </div>
              <div>
                <dt>Interval trend</dt>
                <dd>{formatIntervalTrend(blinkSummaryMetrics.intervalTrendSecPerMin)}</dd>
              </div>
            </dl>
            <p className="field-helper metric-helper">
              Complete: above 75% closure. Partial: 20% to under 75% closure.
            </p>
          </div>
        </div>

        <div className="card metrics-card">
          <div className="section-heading compact">
            <div>
              <h3>Manual review</h3>
            </div>
            <p className="section-copy">
              Confirm each selected candidate in a popup with its trace crop and video clip. Each choice saves immediately and advances to the next active blink.
            </p>
          </div>
          <div className="blink-confirmation-panel">
            {activeBlinkEntries.length === 0 ? (
              <p className="field-helper">No active blink candidates are available for confirmation.</p>
            ) : (
              <div className="blink-confirmation-empty">
                <p className="field-helper">
                  {selectedBlink && selectedBlink.is_deleted !== 1
                    ? `Selected Blink ${selectedBlinkIndex == null ? '' : selectedBlinkIndex + 1}.`
                    : 'Start quick confirmation from the first active blink.'}
                </p>
                <button onClick={() => void handleStartBlinkReview()} type="button">
                  {selectedBlink && selectedBlink.is_deleted !== 1 ? 'Open Review Popup' : 'Start Review'}
                </button>
              </div>
            )}
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
                  <strong className="blink-id">
                    Blink {index + 1}
                    <small>{row.blink_id || `manual_${index + 1}`}</small>
                  </strong>
                  <span>{row.blink_classification ? row.blink_classification.replace('_', '-') : 'below threshold'}</span>
                  <input
                    aria-label={`Task label for blink ${index + 1}`}
                    value={taskLabelForBlink(row, index)}
                    onChange={(event) => updateBlinkTaskLabel(row, index, event.target.value)}
                    placeholder="Task"
                  />
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
                  <small className="quality-flag-note">{confidenceDescription(row)}</small>
                  <button onClick={() => selectBlinkForReview(index)} type="button">
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
          </>
        ) : analysisView === 'velocity' ? (
          <div className="velocity-layout">
            <div className="section-heading compact">
              <div>
                <h3>Eyelid velocity (%/ms)</h3>
              </div>
              <p className="section-copy">
                Velocity is shown as opening percent change per millisecond. Negative values show eyelid closing. Positive values show eyelid opening.
              </p>
            </div>
            <div ref={velocityPlotRef} className="plotly-trace analysis-plot analysis-plot-large" />

            <div className="card metrics-card">
              <div className="section-heading compact">
                <div>
                  <h3>Blink velocity summary</h3>
                </div>
              </div>
              <div className="velocity-table-shell">
                <table className="velocity-table">
                  <thead>
                    <tr>
                      <th>Blink</th>
                      <th>Class</th>
                      <th>Time</th>
                      <th>Total time</th>
                      <th>Closing time</th>
                      <th>Opening time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blinkVelocityMetrics.length === 0 ? (
                      <tr>
                        <td colSpan={6}>Run auto-detect or add blinks to review blink timing values.</td>
                      </tr>
                    ) : (
                      blinkVelocityMetrics.map((metric) => (
                        <tr
                          key={`${metric.row.blink_id || 'manual'}-${metric.index}`}
                          className={selectedBlinkIndex === metric.index ? 'is-selected' : ''}
                          onClick={() => setSelectedBlinkIndex(metric.index)}
                        >
                          <td>{metric.blinkNumber}</td>
                          <td>{metric.row.blink_classification ? metric.row.blink_classification.replace('_', '-') : 'below threshold'}</td>
                          <td>{metric.row.start_time_sec.toFixed(2)}-{metric.row.end_time_sec.toFixed(2)} s</td>
                          <td>{formatMilliseconds(metric.row.duration_sec * 1000)}</td>
                          <td>{formatMilliseconds(metric.closingTimeMs)}</td>
                          <td>{formatMilliseconds(metric.openingTimeMs)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="velocity-layout">
            <div className="section-heading compact">
              <div>
                <h3>Before / After symptoms</h3>
              </div>
              <p className="section-copy">
                Ratings compare matching 0-5 symptom questions from the pre-session and post-session screens.
              </p>
            </div>
            <div className="comparison-list">
              {matchedQuestionnaireComparisonRows.map((row) => {
                const beforePercent = row.before == null ? 0 : Math.max(0, Math.min(100, (row.before / 5) * 100));
                const afterPercent = row.after == null ? 0 : Math.max(0, Math.min(100, (row.after / 5) * 100));
                const changeLabel =
                  row.change == null ? 'NA' : row.change > 0 ? `+${row.change}` : row.change.toString();

                return (
                  <div className="comparison-row" key={row.key}>
                    <div className="comparison-summary">
                      <strong>{row.label}</strong>
                      <span>
                        Before {row.before ?? 'NA'} / 5 · After {row.after ?? 'NA'} / 5 · Change {changeLabel}
                      </span>
                    </div>
                    <div className="comparison-bars">
                      <div className="comparison-bar-row">
                        <span>Before</span>
                        <div className="comparison-bar" aria-label={`${row.label} before`}>
                          <i style={{ width: `${beforePercent}%` }} />
                        </div>
                      </div>
                      <div className="comparison-bar-row">
                        <span>After</span>
                        <div className="comparison-bar" aria-label={`${row.label} after`}>
                          <i className="is-after" style={{ width: `${afterPercent}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
