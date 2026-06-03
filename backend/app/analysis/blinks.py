from __future__ import annotations

from dataclasses import asdict, dataclass
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
AUTO_BASELINE_WINDOW = 31
AUTO_SMOOTH_WINDOW = 3
AUTO_RECOVERY_MIN_PERCENT = 28.0
AUTO_MIN_BASELINE_PERCENT = 30.0
AUTO_EDGE_PAD_SEC = 0.04
AUTO_EDGE_MAX_PERCENT = 55.0
AUTO_MERGE_GAP_SEC = 0.12


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


def _build_event_from_segment(
    side: EyeSide,
    session_id: str,
    segment: pd.DataFrame,
    blink_id: str,
    *,
    is_auto_detected: int,
    is_manually_edited: int,
    notes: str = "",
    quality_flag: str = "",
) -> BlinkEvent:
    opening_percent_column = "left_opening_percent" if side == "left" else "right_opening_percent"
    opening_px_column = "left_opening_px" if side == "left" else "right_opening_px"
    confidence_column = "left_tracking_confidence" if side == "left" else "right_tracking_confidence"
    if side == "bilateral":
        left_percent = pd.to_numeric(segment["left_opening_percent"], errors="coerce")
        right_percent = pd.to_numeric(segment["right_opening_percent"], errors="coerce")
        opening_percent_series = pd.concat([left_percent, right_percent], axis=1).min(axis=1)
        left_px = pd.to_numeric(segment["left_opening_px"], errors="coerce")
        right_px = pd.to_numeric(segment["right_opening_px"], errors="coerce")
        opening_px_series = pd.concat([left_px, right_px], axis=1).min(axis=1)
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
        quality = "low_confidence" if not quality else quality

    min_opening_percent = _maybe_float(opening_percent_series.loc[peak_idx])
    min_opening_px = _maybe_float(opening_px_series.loc[peak_idx])
    start_time = float(start_row["timestamp_sec"])
    end_time = float(end_row["timestamp_sec"])
    peak_time = _maybe_float(peak_row["timestamp_sec"])

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
        duration_sec=max(0.0, end_time - start_time),
        closing_duration_sec=max(0.0, (peak_time or start_time) - start_time) if peak_time is not None else None,
        opening_duration_sec=max(0.0, end_time - (peak_time or end_time)) if peak_time is not None else None,
        min_opening_px=min_opening_px,
        min_opening_percent=min_opening_percent,
        peak_closure_percent=(100.0 - min_opening_percent) if min_opening_percent is not None else None,
        is_auto_detected=is_auto_detected,
        is_manually_edited=is_manually_edited,
        is_deleted=0,
        quality_flag=quality,
        notes=notes,
    )


def _detect_eye_blinks(frame: pd.DataFrame, side: Literal["left", "right"], session_id: str) -> list[BlinkEvent]:
    opening = pd.to_numeric(frame[f"{side}_opening_percent"], errors="coerce")
    smoothed = opening.rolling(window=AUTO_SMOOTH_WINDOW, center=True, min_periods=1).median()
    baseline = smoothed.rolling(window=AUTO_BASELINE_WINDOW, center=True, min_periods=1).quantile(0.85)
    dip = baseline - smoothed
    raw_dip = baseline - opening
    timestamps = pd.to_numeric(frame["timestamp_sec"], errors="coerce")
    events: list[BlinkEvent] = []
    counter = 1
    index = 1

    while index < len(frame) - 1:
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
        seed_threshold = min(
            AUTO_RELAXED_CLOSED_PERCENT,
            max(AUTO_DEEP_CLOSED_PERCENT, float(current_baseline) * 0.38),
        )
        seed_opening = min(float(raw_opening), float(current_opening))
        seed_dip = max(float(current_raw_dip), float(current_dip))
        is_deep_valley = seed_opening <= AUTO_DEEP_CLOSED_PERCENT
        is_relative_valley = (
            seed_opening <= seed_threshold
            and seed_dip >= AUTO_DIP_PROMINENCE
            and float(current_baseline) >= AUTO_MIN_BASELINE_PERCENT
        )
        if not (is_deep_valley or is_relative_valley):
            index += 1
            continue

        left_value = opening.iloc[index - 1]
        right_value = opening.iloc[index + 1]
        if pd.isna(left_value) or pd.isna(right_value):
            index += 1
            continue
        if not (float(raw_opening) <= float(left_value) and float(raw_opening) <= float(right_value)):
            index += 1
            continue
        center_time = float(timestamps.iloc[index])
        if events and center_time <= events[-1].end_time_sec:
            index += 1
            continue

        start_index = index
        while start_index > 0:
            previous_time = float(timestamps.iloc[start_index - 1])
            if center_time - previous_time > AUTO_MAX_DURATION_SEC:
                break
            previous_opening = smoothed.iloc[start_index - 1]
            if pd.isna(previous_opening) or float(previous_opening) > AUTO_EXPAND_MAX_PERCENT:
                break
            start_index -= 1

        end_index = index
        while end_index < len(frame) - 1:
            next_time = float(timestamps.iloc[end_index + 1])
            if next_time - center_time > AUTO_MAX_DURATION_SEC:
                break
            next_opening = smoothed.iloc[end_index + 1]
            if pd.isna(next_opening) or float(next_opening) > AUTO_EXPAND_MAX_PERCENT:
                break
            end_index += 1

        segment = frame.iloc[start_index : end_index + 1]
        segment = _expand_segment(frame, segment, start_time=float(timestamps.iloc[start_index]), end_time=float(timestamps.iloc[end_index]))
        segment_times = pd.to_numeric(segment["timestamp_sec"], errors="coerce")
        start_time = float(segment_times.iloc[0])
        end_time = float(segment_times.iloc[-1])
        duration = end_time - start_time
        if duration > AUTO_MAX_DURATION_SEC or duration < AUTO_MIN_DURATION_SEC:
            index += 1
            continue

        pre_window = smoothed.iloc[max(0, start_index - 4) : start_index]
        post_window = smoothed.iloc[end_index + 1 : min(len(frame), end_index + 5)]
        pre_recovery = float(pre_window.max()) if not pre_window.empty else float("nan")
        post_recovery = float(post_window.max()) if not post_window.empty else float("nan")
        recovery_threshold = min(
            AUTO_RECOVERY_MIN_PERCENT,
            max(18.0, float(current_baseline) * 0.65),
        )
        if pd.isna(pre_recovery) or pd.isna(post_recovery):
            index += 1
            continue
        if pre_recovery < recovery_threshold or post_recovery < recovery_threshold:
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


def _expand_segment(frame: pd.DataFrame, segment: pd.DataFrame, *, start_time: float, end_time: float) -> pd.DataFrame:
    left_threshold = min(100.0, AUTO_EDGE_MAX_PERCENT)
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
    return _segment_for_time_range(
        frame,
        float(pd.to_numeric(kept["timestamp_sec"], errors="coerce").iloc[0]),
        float(pd.to_numeric(kept["timestamp_sec"], errors="coerce").iloc[-1]),
    )


def _detect_bilateral_blinks(frame: pd.DataFrame, session_id: str, left: list[BlinkEvent], right: list[BlinkEvent]) -> list[BlinkEvent]:
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
                )
            )
            counter += 1
    return bilateral


def _merge_detected_blinks(frame: pd.DataFrame, session_id: str, left: list[BlinkEvent], right: list[BlinkEvent]) -> list[BlinkEvent]:
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
        segment = _expand_segment(frame, segment, start_time=start_time, end_time=end_time)
        blink_prefix = "auto_bilateral" if eye_side == "bilateral" else f"auto_{eye_side}"
        return _build_event_from_segment(
            eye_side,
            session_id,
            segment,
            blink_id=f"{blink_prefix}_{counter:03d}",
            is_auto_detected=1,
            is_manually_edited=0,
        )

    counter = 1
    for event in combined[1:]:
        if event.start_time_sec <= cluster_end + AUTO_MERGE_GAP_SEC:
            cluster.append(event)
            cluster_end = max(cluster_end, event.end_time_sec)
            continue
        merged.append(flush_cluster(cluster, counter))
        counter += 1
        cluster = [event]
        cluster_end = event.end_time_sec

    merged.append(flush_cluster(cluster, counter))
    return merged


def detect_blinks(session_folder: str) -> list[dict[str, Any]]:
    frame = _read_framewise(session_folder)
    if frame.empty:
        write_blink_events(session_folder, [])
        return []

    session_id = str(frame.iloc[0].get("session_id", ""))
    left = _detect_eye_blinks(frame, "left", session_id)
    right = _detect_eye_blinks(frame, "right", session_id)
    events = _merge_detected_blinks(frame, session_id, left, right)
    write_blink_events(session_folder, [event.to_payload() for event in events])
    update_framewise_blink_columns(session_folder, [event.to_payload() for event in events])
    return [event.to_payload() for event in events]


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


def save_blink_edits(session_folder: str, blink_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
