from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from app.models.schema import BLINK_CSV_COLUMNS

EyeSide = Literal["left", "right", "bilateral"]

AUTO_DEEP_CLOSED_PERCENT = 8.0
AUTO_RELAXED_CLOSED_PERCENT = 20.0
AUTO_DIP_PROMINENCE = 20.0
AUTO_EXPAND_MAX_PERCENT = 40.0
AUTO_MIN_DURATION_SEC = 0.03
AUTO_MAX_DURATION_SEC = 0.32
AUTO_PARTIAL_MAX_DURATION_SEC = 1.20
AUTO_BASELINE_WINDOW = 31
AUTO_SMOOTH_WINDOW = 3
AUTO_RECOVERY_MIN_PERCENT = 28.0
AUTO_SHALLOW_DROP_MIN_PROMINENCE = 15.0
AUTO_MIN_BASELINE_PERCENT = 30.0
AUTO_EDGE_PAD_SEC = 0.04
AUTO_EDGE_MAX_PERCENT = 55.0
AUTO_MERGE_GAP_SEC = 0.12
AUTO_SPLIT_RECOVERY_PERCENT = 50.0
AUTO_SPLIT_MIN_GAP_SEC = 0.08
GAZE_FLAG_MAX_CLOSING_VELOCITY_PERCENT_PER_MS = 0.20
GAZE_FLAG_MAX_OPENING_VELOCITY_PERCENT_PER_MS = 0.20
GAZE_FLAG_MIN_DURATION_SEC = 0.35
GAZE_FLAG_MIN_RECOVERY_GAP_PERCENT = 8.0


@dataclass(frozen=True, slots=True)
class BlinkClassificationThresholds:
    complete_min_closure_percent: float = 75.0
    partial_min_closure_percent: float = 20.0
    partial_max_closure_percent: float = 75.0


def _classify_blink(
    peak_closure_percent: float | None,
    _duration_sec: float,
    thresholds: BlinkClassificationThresholds,
) -> str:
    if peak_closure_percent is None:
        return ""

    if peak_closure_percent > thresholds.complete_min_closure_percent:
        return "complete"

    if thresholds.partial_min_closure_percent <= peak_closure_percent < thresholds.partial_max_closure_percent:
        return "partial"

    return ""


@dataclass(slots=True)
class BlinkEvent:
    session_id: str
    blink_id: str
    eye_side: EyeSide
    start_frame: int | None
    start_time_sec: float
    peak_frame: int | None
    peak_time_sec: float | None
    end_frame: int | None
    end_time_sec: float
    duration_sec: float
    closing_duration_sec: float | None
    opening_duration_sec: float | None
    min_opening_px: float | None
    min_opening_percent: float | None
    peak_closure_percent: float | None
    blink_classification: str
    is_auto_detected: int
    is_manually_edited: int
    is_deleted: int
    quality_flag: str
    notes: str

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)


def _framewise_path(session_folder: str) -> Path:
    return Path(session_folder).expanduser().resolve() / "framewise_measurements.csv"


def _blink_path(session_folder: str) -> Path:
    return Path(session_folder).expanduser().resolve() / "blink_events.csv"


def _audit_path(session_folder: str) -> Path:
    return Path(session_folder).expanduser().resolve() / "audit_log.json"


def _append_blink_rejection_log(session_folder: str, rejected_candidates: list[dict[str, Any]]) -> None:
    if not rejected_candidates:
        return

    path = _audit_path(session_folder)
    if path.exists():
        with path.open("r", encoding="utf-8") as handle:
            audit_entries = json.load(handle)
    else:
        audit_entries = []

    audit_entries.append(
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": "blink_candidates_rejected",
            "note": "Short or same-frame blink candidates were not saved as real blink events.",
            "new_value": {
                "minimum_duration_sec": AUTO_MIN_DURATION_SEC,
                "candidates": rejected_candidates,
            },
        }
    )

    with path.open("w", encoding="utf-8") as handle:
        json.dump(audit_entries, handle, indent=2)


def _read_framewise(session_folder: str) -> pd.DataFrame:
    path = _framewise_path(session_folder)
    if not path.exists():
      raise FileNotFoundError(f"Framewise CSV not found: {path}")
    frame = pd.read_csv(path)
    if frame.empty:
        return frame

    numeric_columns = [
        "frame_index",
        "timestamp_sec",
        "left_opening_px",
        "right_opening_px",
        "left_opening_percent",
        "right_opening_percent",
        "left_tracking_confidence",
        "right_tracking_confidence",
        "left_visible",
        "right_visible",
    ]
    for column in numeric_columns:
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def _empty_events_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=BLINK_CSV_COLUMNS)


def _events_from_payload(rows: list[dict[str, Any]]) -> list[BlinkEvent]:
    events: list[BlinkEvent] = []
    for row in rows:
        events.append(
            BlinkEvent(
                session_id=str(row.get("session_id", "")),
                blink_id=str(row.get("blink_id", "")),
                eye_side=str(row.get("eye_side", "left")),  # type: ignore[arg-type]
                start_frame=_maybe_int(row.get("start_frame")),
                start_time_sec=float(row.get("start_time_sec", 0)),
                peak_frame=_maybe_int(row.get("peak_frame")),
                peak_time_sec=_maybe_float(row.get("peak_time_sec")),
                end_frame=_maybe_int(row.get("end_frame")),
                end_time_sec=float(row.get("end_time_sec", 0)),
                duration_sec=float(row.get("duration_sec", 0)),
                closing_duration_sec=_maybe_float(row.get("closing_duration_sec")),
                opening_duration_sec=_maybe_float(row.get("opening_duration_sec")),
                min_opening_px=_maybe_float(row.get("min_opening_px")),
                min_opening_percent=_maybe_float(row.get("min_opening_percent")),
                peak_closure_percent=_maybe_float(row.get("peak_closure_percent")),
                blink_classification=str(row.get("blink_classification", "")),
                is_auto_detected=int(row.get("is_auto_detected", 0) or 0),
                is_manually_edited=int(row.get("is_manually_edited", 0) or 0),
                is_deleted=int(row.get("is_deleted", 0) or 0),
                quality_flag=str(row.get("quality_flag", "")),
                notes=str(row.get("notes", "")),
            )
        )
    return events


def _maybe_float(value: Any) -> float | None:
    if value in (None, "", "None"):
        return None
    number = float(value)
    return number


def _maybe_int(value: Any) -> int | None:
    if value in (None, "", "None"):
        return None
    number = int(float(value))
    return number


def _event_rejection_reason(event: BlinkEvent) -> str | None:
    if event.start_frame is not None and event.end_frame is not None and event.start_frame == event.end_frame:
        return "same_frame_start_end"
    if event.duration_sec < AUTO_MIN_DURATION_SEC:
        return "below_minimum_duration"
    return None


def _event_rejection_payload(event: BlinkEvent, reason: str, source: str) -> dict[str, Any]:
    return {
        "source": source,
        "reason": reason,
        "blink_id": event.blink_id,
        "eye_side": event.eye_side,
        "start_frame": event.start_frame,
        "end_frame": event.end_frame,
        "start_time_sec": event.start_time_sec,
        "end_time_sec": event.end_time_sec,
        "duration_sec": event.duration_sec,
        "peak_closure_percent": event.peak_closure_percent,
    }


def _segment_rejection_payload(
    side: EyeSide,
    segment: pd.DataFrame,
    reason: str,
    source: str,
) -> dict[str, Any]:
    start_row = segment.iloc[0]
    end_row = segment.iloc[-1]
    start_time = float(start_row["timestamp_sec"])
    end_time = float(end_row["timestamp_sec"])
    return {
        "source": source,
        "reason": reason,
        "eye_side": side,
        "start_frame": _maybe_int(start_row["frame_index"]),
        "end_frame": _maybe_int(end_row["frame_index"]),
        "start_time_sec": start_time,
        "end_time_sec": end_time,
        "duration_sec": max(0.0, end_time - start_time),
    }


def _eye_visible_series(frame: pd.DataFrame, side: Literal["left", "right"]) -> pd.Series:
    visible_column = f"{side}_visible"
    if visible_column not in frame.columns:
        return pd.Series([False] * len(frame), index=frame.index)
    return pd.to_numeric(frame[visible_column], errors="coerce").fillna(0).eq(1)


def _peak_closure_from_local_reference(opening_percent_series: pd.Series, min_opening_percent: float | None) -> float | None:
    if min_opening_percent is None:
        return None

    local_reference = _maybe_float(opening_percent_series.quantile(0.85))
    if local_reference is None or local_reference <= 0:
        return None

    return max(0.0, min(100.0, ((local_reference - min_opening_percent) / local_reference) * 100.0))


def _append_quality_flag(existing: str, flag: str) -> str:
    flags = [entry.strip() for entry in existing.split(";") if entry.strip()]
    if flag not in flags:
        flags.append(flag)
    return ";".join(flags)


def _looks_like_possible_gaze_or_downward_look(
    opening_percent_series: pd.Series,
    peak_closure_percent: float | None,
    closing_duration_sec: float | None,
    opening_duration_sec: float | None,
    duration_sec: float,
) -> bool:
    if peak_closure_percent is None or peak_closure_percent <= 0:
        return False

    local_reference = _maybe_float(opening_percent_series.quantile(0.85))
    final_opening = _maybe_float(opening_percent_series.iloc[-1])
    if local_reference is None or final_opening is None:
        incomplete_recovery = False
    else:
        recovery_gap = max(GAZE_FLAG_MIN_RECOVERY_GAP_PERCENT, peak_closure_percent * 0.35)
        incomplete_recovery = final_opening < local_reference - recovery_gap

    closing_velocity = (
        peak_closure_percent / (closing_duration_sec * 1000)
        if closing_duration_sec is not None and closing_duration_sec > 0
        else None
    )
    opening_velocity = (
        peak_closure_percent / (opening_duration_sec * 1000)
        if opening_duration_sec is not None and opening_duration_sec > 0
        else None
    )
    slow_closing = (
        closing_velocity is not None
        and closing_velocity < GAZE_FLAG_MAX_CLOSING_VELOCITY_PERCENT_PER_MS
    )
    slow_opening = (
        opening_velocity is not None
        and opening_velocity < GAZE_FLAG_MAX_OPENING_VELOCITY_PERCENT_PER_MS
    )
    slow_event = duration_sec >= GAZE_FLAG_MIN_DURATION_SEC and (slow_closing or slow_opening)

    return slow_event or incomplete_recovery


def _build_event_from_segment(
    side: EyeSide,
    session_id: str,
    segment: pd.DataFrame,
    blink_id: str,
    *,
    is_auto_detected: int,
    is_manually_edited: int,
    classification_thresholds: BlinkClassificationThresholds,
    notes: str = "",
    quality_flag: str = "",
) -> BlinkEvent:
    opening_percent_column = "left_opening_percent" if side == "left" else "right_opening_percent"
    opening_px_column = "left_opening_px" if side == "left" else "right_opening_px"
    confidence_column = "left_tracking_confidence" if side == "left" else "right_tracking_confidence"
    if side == "bilateral":
        left_percent = pd.to_numeric(segment["left_opening_percent"], errors="coerce")
        right_percent = pd.to_numeric(segment["right_opening_percent"], errors="coerce")
        opening_percent_series = pd.concat([left_percent, right_percent], axis=1).mean(axis=1)
        left_px = pd.to_numeric(segment["left_opening_px"], errors="coerce")
        right_px = pd.to_numeric(segment["right_opening_px"], errors="coerce")
        opening_px_series = pd.concat([left_px, right_px], axis=1).mean(axis=1)
        confidence_series = pd.concat(
            [
                pd.to_numeric(segment["left_tracking_confidence"], errors="coerce"),
                pd.to_numeric(segment["right_tracking_confidence"], errors="coerce"),
            ],
            axis=1,
        ).mean(axis=1)
    else:
        opening_percent_series = pd.to_numeric(segment[opening_percent_column], errors="coerce")
        opening_px_series = pd.to_numeric(segment[opening_px_column], errors="coerce")
        confidence_series = pd.to_numeric(segment[confidence_column], errors="coerce")

    peak_idx = opening_percent_series.idxmin()
    peak_row = segment.loc[peak_idx]
    start_row = segment.iloc[0]
    end_row = segment.iloc[-1]
    quality = quality_flag
    if confidence_series.mean(skipna=True) < 0.45:
        quality = _append_quality_flag(quality, "low_confidence")

    min_opening_percent = _maybe_float(opening_percent_series.loc[peak_idx])
    min_opening_px = _maybe_float(opening_px_series.loc[peak_idx])
    start_time = float(start_row["timestamp_sec"])
    end_time = float(end_row["timestamp_sec"])
    peak_time = _maybe_float(peak_row["timestamp_sec"])

    peak_closure_percent = _peak_closure_from_local_reference(opening_percent_series, min_opening_percent)
    duration_sec = max(0.0, end_time - start_time)
    closing_duration_sec = max(0.0, (peak_time or start_time) - start_time) if peak_time is not None else None
    opening_duration_sec = max(0.0, end_time - (peak_time or end_time)) if peak_time is not None else None
    if is_auto_detected and _looks_like_possible_gaze_or_downward_look(
        opening_percent_series,
        peak_closure_percent,
        closing_duration_sec,
        opening_duration_sec,
        duration_sec,
    ):
        quality = _append_quality_flag(quality, "possible_gaze_or_downward_look")

    return BlinkEvent(
        session_id=session_id,
        blink_id=blink_id,
        eye_side=side,
        start_frame=_maybe_int(start_row["frame_index"]),
        start_time_sec=start_time,
        peak_frame=_maybe_int(peak_row["frame_index"]),
        peak_time_sec=peak_time,
        end_frame=_maybe_int(end_row["frame_index"]),
        end_time_sec=end_time,
        duration_sec=duration_sec,
        closing_duration_sec=closing_duration_sec,
        opening_duration_sec=opening_duration_sec,
        min_opening_px=min_opening_px,
        min_opening_percent=min_opening_percent,
        peak_closure_percent=peak_closure_percent,
        blink_classification=_classify_blink(peak_closure_percent, duration_sec, classification_thresholds),
        is_auto_detected=is_auto_detected,
        is_manually_edited=is_manually_edited,
        is_deleted=0,
        quality_flag=quality,
        notes=notes,
    )


def _detect_eye_blinks(
    frame: pd.DataFrame,
    side: Literal["left", "right"],
    session_id: str,
    classification_thresholds: BlinkClassificationThresholds,
    rejected_candidates: list[dict[str, Any]],
) -> list[BlinkEvent]:
    opening = pd.to_numeric(frame[f"{side}_opening_percent"], errors="coerce")
    visible = _eye_visible_series(frame, side)
    smoothed = opening.rolling(window=AUTO_SMOOTH_WINDOW, center=True, min_periods=1).median()
    baseline = smoothed.rolling(window=AUTO_BASELINE_WINDOW, center=True, min_periods=1).quantile(0.85)
    dip = baseline - smoothed
    raw_dip = baseline - opening
    timestamps = pd.to_numeric(frame["timestamp_sec"], errors="coerce")
    events: list[BlinkEvent] = []
    counter = 1
    index = 1

    def has_recovery_around(
        center_index: int,
        center_time: float,
        seed_opening: float,
        seed_dip: float,
        window_sec: float,
    ) -> bool:
        recovery_target = min(
            float(baseline.iloc[center_index]) - 2.0,
            max(AUTO_RECOVERY_MIN_PERCENT, seed_opening + max(5.0, seed_dip * 0.5)),
        )
        previous_window = frame.iloc[:center_index]
        previous_times = pd.to_numeric(previous_window["timestamp_sec"], errors="coerce")
        previous_values = smoothed.iloc[:center_index]
        previous_recovery = previous_values[
            previous_times.ge(center_time - window_sec) & previous_values.ge(recovery_target)
        ]

        next_window = frame.iloc[center_index + 1 :]
        next_times = pd.to_numeric(next_window["timestamp_sec"], errors="coerce")
        next_values = smoothed.iloc[center_index + 1 :]
        next_recovery = next_values[
            next_times.le(center_time + window_sec) & next_values.ge(recovery_target)
        ]
        return not previous_recovery.empty and not next_recovery.empty

    def split_end_before_next_valley(segment: pd.DataFrame, center_index: int, center_time: float) -> int | None:
        segment_indices = list(segment.index)
        if frame.index[center_index] not in segment_indices:
            return None
        center_segment_position = segment_indices.index(frame.index[center_index])
        for segment_position in range(center_segment_position + 2, len(segment_indices) - 1):
            candidate_index = int(frame.index.get_loc(segment_indices[segment_position]))
            candidate_time = float(timestamps.iloc[candidate_index])
            if candidate_time - center_time < AUTO_SPLIT_MIN_GAP_SEC:
                continue
            candidate_opening = opening.iloc[candidate_index]
            candidate_smoothed = smoothed.iloc[candidate_index]
            candidate_dip = raw_dip.iloc[candidate_index]
            candidate_smoothed_dip = dip.iloc[candidate_index]
            if (
                pd.isna(candidate_opening)
                or pd.isna(candidate_smoothed)
                or pd.isna(candidate_dip)
                or pd.isna(candidate_smoothed_dip)
            ):
                continue
            if not (
                bool(visible.iloc[candidate_index - 1])
                and bool(visible.iloc[candidate_index])
                and bool(visible.iloc[candidate_index + 1])
            ):
                continue
            left_neighbor = opening.iloc[candidate_index - 1]
            right_neighbor = opening.iloc[candidate_index + 1]
            if pd.isna(left_neighbor) or pd.isna(right_neighbor):
                continue
            if not (float(candidate_opening) <= float(left_neighbor) and float(candidate_opening) <= float(right_neighbor)):
                continue
            candidate_seed_opening = min(float(candidate_opening), float(candidate_smoothed))
            candidate_seed_dip = max(float(candidate_dip), float(candidate_smoothed_dip))
            if not (
                candidate_seed_opening <= partial_seed_threshold
                and candidate_seed_dip >= AUTO_SHALLOW_DROP_MIN_PROMINENCE
            ):
                continue
            recovery_between = smoothed.iloc[center_index + 1 : candidate_index].max(skipna=True)
            if pd.isna(recovery_between) or float(recovery_between) < AUTO_SPLIT_RECOVERY_PERCENT:
                continue
            return max(center_index + 1, candidate_index - 1)
        return None

    while index < len(frame) - 1:
        if not bool(visible.iloc[index]):
            index += 1
            continue
        raw_opening = opening.iloc[index]
        current_opening = smoothed.iloc[index]
        current_baseline = baseline.iloc[index]
        if pd.isna(raw_opening) or pd.isna(current_opening) or pd.isna(current_baseline):
            index += 1
            continue
        current_dip = dip.iloc[index]
        current_raw_dip = raw_dip.iloc[index]
        if pd.isna(current_dip) or pd.isna(current_raw_dip):
            index += 1
            continue
        deep_or_relative_seed_threshold = min(
            AUTO_RELAXED_CLOSED_PERCENT,
            max(AUTO_DEEP_CLOSED_PERCENT, float(current_baseline) * 0.38),
        )
        partial_seed_threshold = max(0.0, min(100.0, 100.0 - classification_thresholds.partial_min_closure_percent))
        seed_threshold = max(deep_or_relative_seed_threshold, partial_seed_threshold)
        seed_opening = min(float(raw_opening), float(current_opening))
        seed_dip = max(float(current_raw_dip), float(current_dip))
        is_deep_valley = seed_opening <= AUTO_DEEP_CLOSED_PERCENT
        is_relative_valley = (
            seed_opening <= seed_threshold
            and seed_dip >= AUTO_DIP_PROMINENCE
            and float(current_baseline) >= AUTO_MIN_BASELINE_PERCENT
        )
        is_any_drop = seed_opening <= partial_seed_threshold and seed_dip >= AUTO_SHALLOW_DROP_MIN_PROMINENCE
        is_recovered_partial_dip = is_any_drop and not is_deep_valley
        if not (is_deep_valley or is_relative_valley or is_any_drop):
            index += 1
            continue

        left_value = opening.iloc[index - 1]
        right_value = opening.iloc[index + 1]
        if pd.isna(left_value) or pd.isna(right_value):
            index += 1
            continue
        if not (bool(visible.iloc[index - 1]) and bool(visible.iloc[index + 1])):
            index += 1
            continue
        if not (float(raw_opening) <= float(left_value) and float(raw_opening) <= float(right_value)):
            index += 1
            continue
        center_time = float(timestamps.iloc[index])
        if events and center_time <= events[-1].end_time_sec:
            index += 1
            continue
        max_candidate_duration_sec = AUTO_PARTIAL_MAX_DURATION_SEC if is_recovered_partial_dip else AUTO_MAX_DURATION_SEC
        if not is_deep_valley and not has_recovery_around(
            index,
            center_time,
            seed_opening,
            seed_dip,
            max_candidate_duration_sec,
        ):
            index += 1
            continue

        event_expand_threshold = min(
            max(AUTO_EXPAND_MAX_PERCENT, partial_seed_threshold),
            seed_opening + max(5.0, seed_dip * 0.55),
        )
        start_index = index
        while start_index > 0:
            previous_time = float(timestamps.iloc[start_index - 1])
            if center_time - previous_time > max_candidate_duration_sec:
                break
            previous_opening = smoothed.iloc[start_index - 1]
            if pd.isna(previous_opening) or float(previous_opening) > event_expand_threshold:
                break
            start_index -= 1

        end_index = index
        while end_index < len(frame) - 1:
            next_time = float(timestamps.iloc[end_index + 1])
            if next_time - center_time > max_candidate_duration_sec:
                break
            next_opening = smoothed.iloc[end_index + 1]
            if pd.isna(next_opening) or float(next_opening) > event_expand_threshold:
                break
            end_index += 1

        if start_index == index and index > 0:
            start_index -= 1
        if end_index == index and index < len(frame) - 1:
            end_index += 1

        segment = frame.iloc[start_index : end_index + 1]
        segment_visible = visible.loc[segment.index]
        if not bool(segment_visible.all()):
            rejected_candidates.append(
                _segment_rejection_payload(side, segment, "missing_eye_landmarks", "single_eye_candidate")
            )
            index += 1
            continue
        segment = _expand_segment(
            frame,
            segment,
            start_time=float(timestamps.iloc[start_index]),
            end_time=float(timestamps.iloc[end_index]),
            edge_max_percent=max(AUTO_EDGE_MAX_PERCENT, partial_seed_threshold),
        )
        split_end_index = split_end_before_next_valley(segment, index, center_time)
        if split_end_index is not None:
            end_index = split_end_index
            segment = frame.iloc[start_index : end_index + 1]
        if events:
            segment_times = pd.to_numeric(segment["timestamp_sec"], errors="coerce")
            segment = segment.loc[segment_times.gt(events[-1].end_time_sec)]
            if segment.empty:
                index += 1
                continue
        segment_visible = visible.loc[segment.index]
        if not bool(segment_visible.all()):
            rejected_candidates.append(
                _segment_rejection_payload(side, segment, "missing_eye_landmarks", "single_eye_candidate")
            )
            index += 1
            continue
        segment_times = pd.to_numeric(segment["timestamp_sec"], errors="coerce")
        start_time = float(segment_times.iloc[0])
        end_time = float(segment_times.iloc[-1])
        duration = end_time - start_time
        start_frame = _maybe_int(segment.iloc[0]["frame_index"])
        end_frame = _maybe_int(segment.iloc[-1]["frame_index"])
        if start_frame is not None and end_frame is not None and start_frame == end_frame:
            rejected_candidates.append(
                _segment_rejection_payload(side, segment, "same_frame_start_end", "single_eye_candidate")
            )
            index += 1
            continue
        if duration < AUTO_MIN_DURATION_SEC:
            rejected_candidates.append(
                _segment_rejection_payload(side, segment, "below_minimum_duration", "single_eye_candidate")
            )
            index += 1
            continue
        if duration > max_candidate_duration_sec:
            index += 1
            continue

        events.append(
            _build_event_from_segment(
                side,
                session_id,
                segment,
                blink_id=f"auto_{side}_{counter:03d}",
                is_auto_detected=1,
                is_manually_edited=0,
                classification_thresholds=classification_thresholds,
            )
        )
        counter += 1
        index = end_index + 1
        continue
    return events


def _overlap(start_a: float, end_a: float, start_b: float, end_b: float) -> bool:
    return max(start_a, start_b) <= min(end_a, end_b)


def _segment_for_time_range(frame: pd.DataFrame, start_time: float, end_time: float) -> pd.DataFrame:
    timestamps = pd.to_numeric(frame["timestamp_sec"], errors="coerce")
    segment = frame[timestamps.between(start_time, end_time, inclusive="both")]
    if segment.empty:
        nearest = frame.iloc[(timestamps - start_time).abs().argsort()[:1]]
        return nearest
    return segment


def _expand_segment(
    frame: pd.DataFrame,
    segment: pd.DataFrame,
    *,
    start_time: float,
    end_time: float,
    edge_max_percent: float = AUTO_EDGE_MAX_PERCENT,
) -> pd.DataFrame:
    left_threshold = min(100.0, edge_max_percent)
    padded = _segment_for_time_range(frame, max(0.0, start_time - AUTO_EDGE_PAD_SEC), end_time + AUTO_EDGE_PAD_SEC)
    if padded.empty:
        return segment

    left_min = pd.to_numeric(padded["left_opening_percent"], errors="coerce")
    right_min = pd.to_numeric(padded["right_opening_percent"], errors="coerce")
    combined = pd.concat([left_min, right_min], axis=1).min(axis=1)
    timestamps = pd.to_numeric(padded["timestamp_sec"], errors="coerce")
    keep_mask = combined.le(left_threshold)
    if not keep_mask.any():
        return padded
    kept = padded.loc[keep_mask]
    kept_times = pd.to_numeric(kept["timestamp_sec"], errors="coerce")
    return _segment_for_time_range(
        frame,
        min(start_time, float(kept_times.iloc[0])),
        max(end_time, float(kept_times.iloc[-1])),
    )


def _detect_bilateral_blinks(
    frame: pd.DataFrame,
    session_id: str,
    left: list[BlinkEvent],
    right: list[BlinkEvent],
    classification_thresholds: BlinkClassificationThresholds,
) -> list[BlinkEvent]:
    bilateral: list[BlinkEvent] = []
    counter = 1
    for left_event in left:
        for right_event in right:
            if not _overlap(
                left_event.start_time_sec,
                left_event.end_time_sec,
                right_event.start_time_sec,
                right_event.end_time_sec,
            ):
                continue
            union = frame[
                pd.to_numeric(frame["timestamp_sec"], errors="coerce").between(
                    min(left_event.start_time_sec, right_event.start_time_sec),
                    max(left_event.end_time_sec, right_event.end_time_sec),
                    inclusive="both",
                )
            ]
            if union.empty:
                continue
            bilateral.append(
                _build_event_from_segment(
                    "bilateral",
                    session_id,
                    union,
                    blink_id=f"auto_bilateral_{counter:03d}",
                    is_auto_detected=1,
                    is_manually_edited=0,
                    classification_thresholds=classification_thresholds,
                )
            )
            counter += 1
    return bilateral


def _remove_event_overlaps(
    frame: pd.DataFrame,
    session_id: str,
    events: list[BlinkEvent],
    classification_thresholds: BlinkClassificationThresholds,
) -> list[BlinkEvent]:
    adjusted: list[BlinkEvent] = []
    for event in events:
        segment = _segment_for_time_range(frame, event.start_time_sec, event.end_time_sec)
        if adjusted:
            previous_end = adjusted[-1].end_time_sec
            segment_times = pd.to_numeric(segment["timestamp_sec"], errors="coerce")
            segment = segment.loc[segment_times.gt(previous_end)]
        if segment.empty:
            continue
        adjusted.append(
            _build_event_from_segment(
                event.eye_side,
                session_id,
                segment,
                blink_id=event.blink_id,
                is_auto_detected=event.is_auto_detected,
                is_manually_edited=event.is_manually_edited,
                classification_thresholds=classification_thresholds,
            )
        )
    return adjusted


def _merge_detected_blinks(
    frame: pd.DataFrame,
    session_id: str,
    left: list[BlinkEvent],
    right: list[BlinkEvent],
    classification_thresholds: BlinkClassificationThresholds,
) -> list[BlinkEvent]:
    combined = sorted([*left, *right], key=lambda event: (event.start_time_sec, event.end_time_sec))
    if not combined:
        return []

    merged: list[BlinkEvent] = []
    cluster: list[BlinkEvent] = [combined[0]]
    cluster_end = combined[0].end_time_sec

    def flush_cluster(events: list[BlinkEvent], counter: int) -> BlinkEvent:
        start_time = min(event.start_time_sec for event in events)
        end_time = max(event.end_time_sec for event in events)
        sides = {event.eye_side for event in events}
        eye_side: EyeSide = "bilateral" if len(sides) > 1 else events[0].eye_side
        segment = _segment_for_time_range(frame, start_time, end_time)
        blink_prefix = "auto_bilateral" if eye_side == "bilateral" else f"auto_{eye_side}"
        return _build_event_from_segment(
            eye_side,
            session_id,
            segment,
            blink_id=f"{blink_prefix}_{counter:03d}",
            is_auto_detected=1,
            is_manually_edited=0,
            classification_thresholds=classification_thresholds,
        )

    counter = 1
    for event in combined[1:]:
        cluster_sides = {cluster_event.eye_side for cluster_event in cluster}
        overlaps_cluster = event.start_time_sec <= cluster_end
        is_opposite_eye_pair = event.eye_side not in cluster_sides
        if overlaps_cluster and is_opposite_eye_pair:
            cluster.append(event)
            cluster_end = max(cluster_end, event.end_time_sec)
            continue
        merged.append(flush_cluster(cluster, counter))
        counter += 1
        cluster = [event]
        cluster_end = event.end_time_sec

    merged.append(flush_cluster(cluster, counter))
    return _remove_event_overlaps(frame, session_id, merged, classification_thresholds)


def detect_blinks(session_folder: str) -> list[dict[str, Any]]:
    classification_thresholds = BlinkClassificationThresholds()
    frame = _read_framewise(session_folder)
    if frame.empty:
        write_blink_events(session_folder, [])
        return []

    session_id = str(frame.iloc[0].get("session_id", ""))
    rejected_candidates: list[dict[str, Any]] = []
    left = _detect_eye_blinks(frame, "left", session_id, classification_thresholds, rejected_candidates)
    right = _detect_eye_blinks(frame, "right", session_id, classification_thresholds, rejected_candidates)
    events = _merge_detected_blinks(frame, session_id, left, right, classification_thresholds)
    kept_events: list[BlinkEvent] = []
    for event in events:
        reason = _event_rejection_reason(event)
        if reason is not None:
            rejected_candidates.append(_event_rejection_payload(event, reason, "merged_event"))
            continue
        kept_events.append(event)

    _append_blink_rejection_log(session_folder, rejected_candidates)
    kept_payload = [event.to_payload() for event in kept_events]
    write_blink_events(session_folder, kept_payload)
    update_framewise_blink_columns(session_folder, kept_payload)
    return kept_payload


def _write_blink_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    frame = pd.DataFrame(rows)
    if frame.empty:
        frame = _empty_events_frame()
    frame = frame.reindex(columns=BLINK_CSV_COLUMNS, fill_value="")
    frame.to_csv(path, index=False)


def write_blink_events(session_folder: str, rows: list[dict[str, Any]]) -> None:
    _write_blink_csv(_blink_path(session_folder), rows)


def _segment_for_manual_event(frame: pd.DataFrame, start_time: float, end_time: float) -> pd.DataFrame:
    return _segment_for_time_range(frame, start_time, end_time)


def save_blink_edits(
    session_folder: str,
    blink_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    classification_thresholds = BlinkClassificationThresholds()
    frame = _read_framewise(session_folder)
    events = _events_from_payload(blink_rows)
    if frame.empty:
        write_blink_events(session_folder, [event.to_payload() for event in events])
        return [event.to_payload() for event in events]

    session_id = str(frame.iloc[0].get("session_id", ""))
    rebuilt: list[dict[str, Any]] = []
    manual_counter = 1
    for event in events:
        segment = _segment_for_manual_event(frame, event.start_time_sec, event.end_time_sec)
        blink_id = event.blink_id or f"manual_{manual_counter:03d}"
        manual_counter += 1
        rebuilt_event = _build_event_from_segment(
            event.eye_side,
            session_id,
            segment,
            blink_id=blink_id,
            is_auto_detected=event.is_auto_detected,
            is_manually_edited=1,
            classification_thresholds=classification_thresholds,
            notes=event.notes,
            quality_flag=event.quality_flag,
        )
        rebuilt_event.is_deleted = event.is_deleted
        rebuilt.append(rebuilt_event.to_payload())

    write_blink_events(session_folder, rebuilt)
    update_framewise_blink_columns(session_folder, rebuilt)
    return rebuilt


def update_framewise_blink_columns(session_folder: str, blink_rows: list[dict[str, Any]]) -> None:
    path = _framewise_path(session_folder)
    frame = pd.read_csv(path)
    if frame.empty:
        return

    for column in ("blink_yes_no", "left_blink", "right_blink", "bilateral_blink"):
        frame[column] = 0

    timestamps = pd.to_numeric(frame["timestamp_sec"], errors="coerce")
    for row in blink_rows:
        if int(row.get("is_deleted", 0) or 0) == 1:
            continue
        start = _maybe_float(row.get("start_time_sec"))
        end = _maybe_float(row.get("end_time_sec"))
        if start is None or end is None:
            continue
        mask = timestamps.between(start, end, inclusive="both")
        frame.loc[mask, "blink_yes_no"] = 1
        eye_side = row.get("eye_side")
        if eye_side == "left":
            frame.loc[mask, "left_blink"] = 1
        elif eye_side == "right":
            frame.loc[mask, "right_blink"] = 1
        elif eye_side == "bilateral":
            frame.loc[mask, "left_blink"] = 1
            frame.loc[mask, "right_blink"] = 1
            frame.loc[mask, "bilateral_blink"] = 1

    frame.to_csv(path, index=False)
