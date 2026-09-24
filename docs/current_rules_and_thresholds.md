# BlinkTracker Current Rules and Thresholds

Last audited: 2026-07-25

This is the living reference for the rules BlinkTracker is currently using. When a threshold or analysis rule changes, update this document in the same turn as the code change.

## How To Read This

- **Parameter name** is the code or app setting name.
- **Current value** is what the app uses now.
- **What it controls** explains the plain-English effect.
- **Source** points to the code location or setting that supplies the value.
- **Last changed** is the last known date this value or rule was changed. If the exact original date is not known, it is marked as "audited 2026-07-09."

## Blink Classification

These rules decide the label assigned after the app has already detected a blink event.

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| `complete_min_closure_percent` | 75% closure | A detected blink is classified as **Complete** when peak closure is above 75%. | `backend/app/analysis/blinks.py` | 2026-07-25 |
| `partial_min_closure_percent` | 20% closure | A detected blink can be classified as **Partial** starting at 20% local closure. | `backend/app/analysis/blinks.py` | 2026-07-21 |
| `partial_max_closure_percent` | 75% closure | A detected blink is classified as **Partial** when peak closure is from 20% up to, but not including, 75%. | `backend/app/analysis/blinks.py` | 2026-07-25 |
| In-app threshold editing | Removed | Blink classification thresholds cannot be changed from Settings. Change them in the backend dataclass only. | `backend/app/analysis/blinks.py`; `src/app/pages/SettingsPage.tsx` | 2026-07-21 |
| Classification duration thresholds | None | Duration is measured and displayed, but it does **not** classify Complete vs Partial. | `backend/app/analysis/blinks.py` | 2026-07-09 |
| Slow-motion classification checkbox | Removed | There is no separate slow-motion classification mode. All sessions classify by closure amount only. | `src/app/pages/SettingsPage.tsx` | 2026-07-09 |
| In-app classification helper | Visible under Analysis blink classification metrics | The Analysis blink classification output lists the Complete and Partial closure thresholds as a helper line under the metrics. Gray trace selections are still used as a visual fallback for saved blink rows without one of those labels. | `src/app/pages/AnalysisPage.tsx` | 2026-07-25 |

Current classification outcomes:

- **Complete:** peak closure is `> 75%`.
- **Partial:** peak closure is `>= 20%` and `< 75%`.
- **Below threshold:** peak closure is `< 20%`, or closure cannot be calculated. The app no longer reports this as an Unclassified category.

Peak closure is calculated as:

```text
((local open-eye reference - minimum eyelid opening percent) / local open-eye reference) * 100
```

The local open-eye reference is the 85th percentile of eyelid opening within the detected event. This avoids treating a generally low but mostly stable eye-opening trace as a blink.

For bilateral blink events, the closure calculation uses the average of left and right eyelid-opening percent. Single-eye events use that eye's opening percent.

## Blink Auto-Detection

These rules decide whether a dip in the eyelid-opening signal becomes a saved blink event.

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| `AUTO_SMOOTH_WINDOW` | 3 frames | The eyelid-opening trace is smoothed with a 3-frame centered median before detection. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_BASELINE_WINDOW` | 31 frames | The local opening baseline is calculated with a 31-frame centered rolling 85th percentile. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| Baseline percentile | 85th percentile | The detection baseline is based on the upper/open part of nearby eyelid-opening values. | `backend/app/analysis/blinks.py` rolling quantile call | Audited 2026-07-09 |
| `AUTO_DEEP_CLOSED_PERCENT` | 8% opening | Any local valley at or below 8% opening is treated as a deep-closure blink candidate. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_RELAXED_CLOSED_PERCENT` | 20% opening | Caps part of the relative-valley seed threshold so very low openings can seed detection. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| Relative threshold multiplier | 38% of local baseline | Helps define whether a local valley is low enough relative to recent baseline. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_DIP_PROMINENCE` | 20 percentage points | A relative valley must drop at least 20 opening-percentage points below baseline. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_SHALLOW_DROP_MIN_PROMINENCE` | 15 percentage points | A shallower blink-like drop must fall at least 15 opening-percentage points below baseline. | `backend/app/analysis/blinks.py` | 2026-07-21 |
| `AUTO_MIN_BASELINE_PERCENT` | 30% opening | Relative-valley detection requires a local baseline of at least 30% opening. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| Partial seed threshold | `100 - partialMinClosurePercent`, currently 80% opening | A drop can seed detection if opening is at or below the amount corresponding to the Partial threshold. | `backend/app/analysis/blinks.py` | 2026-07-25 |
| Landmark visibility gate | Relevant eye `*_visible` must equal 1 | Blink candidates are only detected when the relevant eye landmarks are present. If the visibility column is missing or visibility is 0, the candidate is ignored or rejected. | `backend/app/analysis/blinks.py` | 2026-07-09 |
| Local minimum rule | Current raw opening must be <= previous and next raw opening | A candidate must be a local dip, not just any low value. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_RECOVERY_MIN_PERCENT` | 28% opening | Non-deep candidates must show recovery to at least this level, or another calculated recovery target, before and after the dip. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| Recovery window | 0.32 s normally; up to 1.20 s for recovered partial dips | Non-deep candidates need evidence that the eye was more open shortly before and after the dip. Meaningful partial dips can use the longer window so gradual close-and-recover shapes are detected. | `backend/app/analysis/blinks.py` | 2026-07-21 |
| Recovery target formula | `min(baseline - 2, max(28, seed_opening + max(5, seed_dip * 0.5)))` | Sets how open the eye must get before/after a non-deep blink candidate. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| Event expansion threshold formula | `min(max(40, partial_seed_threshold), seed_opening + max(5, seed_dip * 0.55))` | Expands blink start/end around the valley while the smoothed opening remains low enough. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_EXPAND_MAX_PERCENT` | 40% opening | Lower bound used in the event expansion threshold. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_EDGE_PAD_SEC` | 0.04 s | Adds a small time pad when expanding event edges. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_EDGE_MAX_PERCENT` | 55% opening | Used as a maximum opening threshold when refining blink event edges. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| `AUTO_SPLIT_RECOVERY_PERCENT` | 50% opening | If one low-opening region contains two local valleys, the first event is split before the second valley only when the eye reopens to at least 50% between them. This helps detect close double blinks. | `backend/app/analysis/blinks.py` | 2026-07-16 |
| `AUTO_SPLIT_MIN_GAP_SEC` | 0.08 s | The two local valley centers must be at least 80 ms apart before the detector can split one low-opening region into two blink events. | `backend/app/analysis/blinks.py` | 2026-07-16 |
| `AUTO_MIN_DURATION_SEC` | 0.03 s | Candidates shorter than 30 ms are rejected and logged instead of saved as blink events. | `backend/app/analysis/blinks.py` | 2026-07-09 |
| Same-frame rejection | Start frame must not equal end frame | If a candidate begins and ends on the same frame, it is rejected and logged. | `backend/app/analysis/blinks.py` | 2026-07-09 |
| `AUTO_MAX_DURATION_SEC` | 0.32 s | Candidates longer than 320 ms are rejected by auto-detection. Also defines recovery/search windows. | `backend/app/analysis/blinks.py` | 2026-07-21 |
| `AUTO_PARTIAL_MAX_DURATION_SEC` | 1.20 s | Recovered partial-dip candidates can last up to 1.2 s when they have a meaningful shallow drop and recovery back toward local baseline. This does not apply to tiny/non-significant dips. | `backend/app/analysis/blinks.py` | 2026-07-21 |
| Low-confidence event flag | Mean confidence `< 0.45` | Saved blink events with low average tracking confidence receive `quality_flag = low_confidence`. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| Low-confidence explanation | Visible in Manual review | Analysis explains that low-confidence blink flags come from average landmark tracking confidence below 0.45, often due to dim lighting, blur, face angle, or eyes partly out of frame. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Possible gaze/downward-look flag | Review flag only | Auto-detected events are still saved as blink candidates, but receive `quality_flag = possible_gaze_or_downward_look` when eyelid movement is slow or recovery is incomplete. This is meant to help review gaze-like drops without hiding them. | `backend/app/analysis/blinks.py`; `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Gaze flag closing velocity threshold | `< 0.20 %/ms` | A candidate is considered slow-closing for the gaze/downward-look quality flag when peak closure divided by closing time is below 0.20 percent closure per millisecond. | `backend/app/analysis/blinks.py` | 2026-07-24 |
| Gaze flag opening velocity threshold | `< 0.20 %/ms` | A candidate is considered slow-opening for the gaze/downward-look quality flag when peak closure divided by opening time is below 0.20 percent closure per millisecond. | `backend/app/analysis/blinks.py` | 2026-07-24 |
| Gaze flag minimum duration | `>= 0.35 s` | Slow movement triggers the gaze/downward-look flag only when the saved event lasts at least 350 ms. | `backend/app/analysis/blinks.py` | 2026-07-24 |
| Gaze flag incomplete recovery gap | `max(8%, peak_closure * 0.35)` | A candidate is flagged when final opening does not recover near the local open-eye reference by this amount. | `backend/app/analysis/blinks.py` | 2026-07-24 |
| Bilateral merge rule | Left/right events that overlap in time are merged as bilateral | If left and right blink detections overlap, the app saves one bilateral event. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |
| Bilateral closure calculation | Average left/right opening | For bilateral events, peak closure and display color use the average of left and right opening percent rather than the lower eye alone, so one deeper/noisier eye does not force the entire event into Complete. | `backend/app/analysis/blinks.py`; `src/app/pages/AnalysisPage.tsx` | 2026-07-21 |
| Bilateral merge boundary rule | Use the already-detected left/right event boundaries | The final left/right merge does not re-expand event edges, so close double blinks are less likely to be blurred back together. | `backend/app/analysis/blinks.py` | 2026-07-16 |
| Final event overlap cleanup | Later merged events are trimmed so they start after the previous saved event ends | Prevents close double blinks from producing overlapping saved events when left and right eye timing differs slightly. | `backend/app/analysis/blinks.py` | 2026-07-16 |
| `AUTO_MERGE_GAP_SEC` | 0.12 s | Defined in code but not currently used by the merge logic. | `backend/app/analysis/blinks.py` | Audited 2026-07-09 |

Rejected blink candidates are written to the session `audit_log.json` with action:

```text
blink_candidates_rejected
```

## Tracking And Eyelid Measurement

These values affect how eyelid opening and tracking confidence are calculated before blink analysis.

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| Face count | 1 face | The app tracks one face at a time. | `backend/app/tracking/landmarks.py`; `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| MediaPipe face detection confidence | 0.5 | Backend video processing requires MediaPipe face detection confidence of at least 0.5. | `backend/app/tracking/landmarks.py` | Audited 2026-07-09 |
| MediaPipe face presence confidence | 0.5 | Backend video processing requires MediaPipe face presence confidence of at least 0.5. | `backend/app/tracking/landmarks.py` | Audited 2026-07-09 |
| MediaPipe tracking confidence | 0.5 | Backend video processing requires MediaPipe tracking confidence of at least 0.5. | `backend/app/tracking/landmarks.py` | Audited 2026-07-09 |
| Backend confidence eye-width scale | `eye_width * 0.45` | Normalizes eyelid opening into a confidence estimate for processed video. | `backend/app/tracking/metrics.py` | Audited 2026-07-09 |
| Renderer confidence eye-width scale | `eye_width * 0.42` | Normalizes eyelid opening into a confidence estimate for live camera tracking. | `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| Closed-touching opening threshold | `< 20% opening` | A frame is marked as closed/touching when opening is below 20%. Backend also requires confidence at least 0.4. | `backend/app/tracking/metrics.py`; `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| Backend closed-touching confidence threshold | `>= 0.4` | Backend video processing only marks closed/touching when tracking confidence is at least 0.4. | `backend/app/tracking/metrics.py` | Audited 2026-07-09 |
| Backend low-confidence tracking threshold | `< 0.45` | Backend processed frames are marked `low_confidence` when either eye confidence is below 0.45. | `backend/app/tracking/metrics.py` | Audited 2026-07-09 |
| Renderer low-confidence tracking threshold | `< 0.35` | Live camera frames are marked `low_confidence` when either eye confidence is below 0.35. | `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| Missing landmark visibility fallback | 0.85 support | If MediaPipe does not provide visibility, backend landmark support defaults to 0.85. | `backend/app/tracking/landmarks.py` | Audited 2026-07-09 |
| Zero landmark support fallback | 0.85 support | If support is exactly 0.0, backend resets support to 0.85. | `backend/app/tracking/landmarks.py` | Audited 2026-07-09 |
| Live audio tracking alert persistence | 0.8 s | The app plays a short alert tone only after a live tracking issue persists for at least 800 ms, avoiding beeps from one-frame glitches. | `src/app/utils/trackingAudioAlert.ts` | 2026-07-28 |
| Live audio tracking alert cooldown | 3.5 s | After one alert tone, the app waits at least 3.5 seconds before playing another alert for the same ongoing issue. | `src/app/utils/trackingAudioAlert.ts` | 2026-07-28 |
| Live out-of-frame warning | Face landmark bounds within 3% of frame edge | Baseline calibration and live camera recording warn when face landmarks are close to the camera-frame edge. | `src/app/utils/liveTracking.ts` | 2026-07-28 |
| Live too-far warning | Face width `< 22%` or face height `< 26%` of frame | Baseline calibration and live camera recording warn when the face appears too small for reliable landmark tracking. | `src/app/utils/liveTracking.ts` | 2026-07-28 |
| Live head-movement warning | Face center movement `> 4.5%` of frame and `> 0.5 frame-widths/sec` | Baseline calibration and live camera recording warn when frame-to-frame head movement is large enough to destabilize landmarks. | `src/app/utils/liveTracking.ts` | 2026-07-28 |

## Gaze Rules

Gaze is recorded in framewise data but is not currently used to decide whether something is a blink.

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| Horizontal gaze left threshold | `< 0.42` | Horizontal iris ratio below 0.42 is labeled left. | `backend/app/tracking/metrics.py`; `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| Horizontal gaze right threshold | `> 0.58` | Horizontal iris ratio above 0.58 is labeled right. | `backend/app/tracking/metrics.py`; `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| Vertical gaze up threshold | `< 0.4` | Vertical iris ratio below 0.4 is labeled up. | `backend/app/tracking/metrics.py`; `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| Vertical gaze down threshold | `> 0.6` | Vertical iris ratio above 0.6 is labeled down. | `backend/app/tracking/metrics.py`; `src/app/utils/liveTracking.ts` | Audited 2026-07-09 |
| Blink detection gaze dependency | None | Gaze direction is not used in blink detection. | `backend/app/analysis/blinks.py` | 2026-07-09 |

## Session Workflow

| Area | Current behavior | Source | Last changed |
|---|---|---|---|
| Pre-Session tab | Contains subject demographics, expanded eye-health history, clickable today's symptom ratings, general health today, prior environment exposure, recording environment, notes, and emotion check. The 0-5 symptom scale is shown as 0 = no signs of symptoms and 5 = extremely severe. | `src/app/pages/PreSessionPage.tsx`; `src/app/utils/navigation.ts` | 2026-07-24 |
| Session tab | Contains session name/date, recording source, camera/video selection, baseline calibration, output folder, raw video setting, capture mode, and Create Session. | `src/app/pages/SessionPage.tsx` | 2026-07-20 |
| Post-Session tab | Contains clickable ocular symptom ratings and a Post-Session Type choice. Baseline / Kaleidoscope mode shows kaleidoscope-video comfort questions; Reading Session mode shows reading comfort, vision, reading experience, and device/environment ratings. Saves answers into the active session metadata under `post_session`. The 0-5 symptom scale is shown as 0 = no signs of symptoms and 5 = extremely severe. | `src/app/pages/PostSessionPage.tsx`; `backend/app/io/session_store.py` | 2026-07-24 |
| Pre-Session clear behavior | After Create Session succeeds, Pre-Session fields are cleared for the next subject while recording setup fields remain available for the active recording workflow. | `src/app/pages/SessionPage.tsx` | 2026-07-24 |
| Post-Session clear behavior | After Save Post-Session succeeds, the post-session form clears automatically. | `src/app/pages/PostSessionPage.tsx` | 2026-07-24 |
| Blink task labels | Optional free-text task label per blink | Manual Review shows a writable task field for each blink. Values are saved in session metadata as `blink_task_labels`, while the original blink CSV schema is preserved. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Completed recording navigation | After a live recording is stopped, Recording shows Go to Post-Session and Go to Analysis buttons. | `src/app/pages/AcquirePage.tsx` | 2026-07-24 |
| One recording per session guard | Start Recording is blocked if the current session already has frame rows or an `acquisition_stopped_at` value. This prevents a second recording from being appended into the same session trace. | `src/app/pages/AcquirePage.tsx` | 2026-07-24 |

## Session Baseline Calibration

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| `CALIBRATION_DURATION_SEC` | 10 s | Baseline calibration records 10 seconds of the subject blinking naturally. | `src/app/pages/SessionPage.tsx` | Audited 2026-07-09 |
| Baseline lighting reminder | Bright, even frontal lighting | The Session screen reminds the user to keep eyes clearly in frame with bright frontal lighting because poor lighting can make blink classification harder. | `src/app/pages/SessionPage.tsx` | 2026-07-24 |
| Calibration blink rate formula | `baseline_blink_count / 10 * 60` | Converts baseline blink count into blinks per minute. | `src/app/pages/SessionPage.tsx` | Audited 2026-07-09 |
| Calibration reference values | `left_reference_max_px`, `right_reference_max_px` | These subject-specific opening references seed later recording/tracking. | `src/app/pages/SessionPage.tsx`; `src/app/pages/AcquirePage.tsx` | Audited 2026-07-09 |
| Inference canvas max width | 480 px | Live/session tracking downscales inference input to a max width of 480 px. | `src/app/pages/SessionPage.tsx`; `src/app/pages/AcquirePage.tsx` | Audited 2026-07-09 |

## Recording And Processing

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| `DEFAULT_TRACE_WINDOW_SEC` | 10 s | Live recording trace shows a 10-second window. | `src/app/pages/AcquirePage.tsx` | Audited 2026-07-09 |
| `UI_UPDATE_INTERVAL_MS` | 120 ms | Minimum interval between UI metric updates during recording/preview. | `src/app/pages/AcquirePage.tsx` | Audited 2026-07-09 |
| `PERSIST_FLUSH_INTERVAL_MS` | 350 ms | Frame rows are flushed to storage roughly every 350 ms. | `src/app/pages/AcquirePage.tsx` | Audited 2026-07-09 |
| `MIN_ACCEPTABLE_RECORDING_FPS` | 25 FPS | If estimated live recording FPS drops below 25 after the first 2 seconds of recording, BlinkTracker saves a low-FPS data-quality warning in session metadata and `audit_log.json`. | `src/app/pages/AcquirePage.tsx` | 2026-07-24 |
| `FPS_WARNING_GRACE_SEC` | 2 s | The first 2 seconds of live recording are ignored for low-FPS warnings so startup settling does not create an immediate false warning. | `src/app/pages/AcquirePage.tsx` | 2026-07-24 |
| Recording MIME preference order | MP4/H.264, MP4, VP8 WebM, VP9 WebM, WebM | Preferred raw-video recording formats for live camera sessions. MP4 is attempted first; WebM is used automatically when MP4 is not supported by Electron/Chromium. | `src/app/pages/AcquirePage.tsx` | 2026-07-20 |
| Video processing FPS fallback | 30 FPS | If OpenCV reports no FPS for a video during processing, backend assumes 30 FPS. | `backend/app/capture/video_processor.py` | Audited 2026-07-09 |
| Camera index scan limit | 0 through 4 | Backend camera discovery probes five camera indices. | `backend/app/capture/camera.py` | Audited 2026-07-09 |
| Default camera modes shown | 640x480@30, 1280x720@30, 1920x1080@60 | These are advertised/default mode labels, not guaranteed hardware capabilities. | `backend/app/capture/camera.py` | Audited 2026-07-09 |
| Camera source label | Built-in laptop camera, USB / external camera, Virtual camera, Default camera, or Unknown camera source | Camera dropdown labels classify the source from the camera name exposed by Windows/browser APIs. Camera labels do not include the full FPS/resolution mode list or device-code suffixes such as `(13d3:56ff)`; modes stay in the separate Capture Mode picker. | `src/app/hooks/useCameraDiscovery.ts`; `src/app/pages/SessionPage.tsx` | 2026-07-20 |
| Live camera startup fallback | Selected camera first, then system default camera | Baseline calibration and Recording preview first request the selected browser camera ID. If that exact request fails, BlinkTracker retries with the default available camera so live capture can still start. | `src/app/pages/SessionPage.tsx`; `src/app/pages/AcquirePage.tsx` | 2026-07-21 |
| Baseline re-record behavior | Replace previous baseline | Pressing Record 10-Second Baseline again clears the previous baseline rows/summary and records a new baseline. Live camera playback is resumed instead of staying paused from the prior baseline. | `src/app/pages/SessionPage.tsx` | 2026-07-21 |
| Camera list source | Browser camera list first, Python/OpenCV fallback only if browser cameras are unavailable | BlinkTracker uses the browser/Electron camera list for live camera choices so the same device IDs are used for baseline and Recording preview. It avoids repeated startup mode probing because opening the camera many times can interfere with some Windows camera drivers. | `src/app/hooks/useCameraDiscovery.ts` | 2026-07-21 |
| Capture mode presets | 640x480@30, 1280x720@30, 1920x1080@60 | These are optional requested modes. BlinkTracker no longer probes every mode on startup; the browser/camera may negotiate a different actual mode during recording. | `src/app/hooks/useCameraDiscovery.ts`; `src/app/pages/AcquirePage.tsx` | 2026-07-21 |
| Capture Mode picker | Auto with detected actual resolution/FPS after the camera opens, or one preset resolution/FPS mode | Session setup lets the user request a specific camera mode. Auto does not request a specific width, height, or FPS; after the camera opens, BlinkTracker reads the stream settings and shows the actual Auto resolution/FPS in the dropdown. Preset modes are passed as ideal browser camera constraints, and the camera may negotiate a different actual mode if conditions change. | `src/app/pages/SessionPage.tsx`; `src/app/pages/AcquirePage.tsx` | 2026-07-21 |

## Database

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| Auto-detect on database open | Run only when no active blink rows exist | Opening a session from Database loads the session and, if `blink_events.csv` has no active blink rows but frame data exists, runs blink auto-detection before opening Analysis. Existing detections/manual edits are preserved. | `src/app/pages/DatabasePage.tsx` | 2026-07-21 |
| Database auto-refresh after session creation | Refresh when the latest session changes | The Database screen refreshes from the selected root folder when a new session is created, so users do not need to press Refresh manually. | `src/app/pages/DatabasePage.tsx` | 2026-07-24 |
| Empty Analysis action | Go to Database | When no Analysis session is loaded, the primary action takes the user to Database instead of opening a file-folder picker. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |

## Analysis Review UI

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| `PLAYBACK_RATES` | 0.25x, 0.5x, 1x, 2x | Reference video playback-speed buttons in Analysis. | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Blink highlight colors | Complete = green; Partial = pink | Analysis graph blink regions and peak markers use the saved blink classification label from the backend. Unknown/below-threshold labels fall back to gray. Legacy Near-Complete rows from older sessions are displayed as Complete/green. | `src/app/pages/AnalysisPage.tsx` | 2026-07-25 |
| Velocity graph | `%/ms` opening change | The Analysis Velocity tab plots eyelid-opening velocity from the loaded `framewise_measurements.csv` as opening percent change per millisecond. Negative values indicate closing; positive values indicate opening. | `src/app/pages/AnalysisPage.tsx` | 2026-07-26 |
| Blink velocity summary | Total blink time, closing time, and opening time per blink | For each saved blink interval, the app reports total event duration plus closing and opening durations in milliseconds. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Default playback rate | 1x | Reference video starts at normal speed. | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Manual blink draft duration | 0.24 s | New manual blink button starts with a 0.24-second event around the current time. | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Blink edge hit width | 14 px | How close the cursor must be to a blink edge before dragging the edge is enabled. | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Nearest blink click distance | 0.35 s | Clicking within 0.35 seconds of a blink center can select that blink. | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Analysis plot left/right margin | 44 px left, 18 px right | Used to map mouse position to trace time. | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| First reference-video seek | 0.05 s | The reference video nudges to 0.05 s after loading to avoid staying on a blank first frame. | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Default graph drag behavior | Zoom | Dragging over the Analysis graph zooms into the selected graph region by default. | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Graph click behavior | Move red playhead | A simple click on the Analysis graph moves the red video-sync/playhead bar to that time. | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Click vs drag threshold | 4 px movement | A mouse action with 4 px or less movement is treated as a click; more movement is left for graph zooming. | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Red playhead drag hit area | 18 px | Pressing near the red playhead line lets the user drag the playhead directly on the trace graph. | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Manual blink graph mode | Requires `Add Blink From Trace` | The graph only creates a manual blink range after the user explicitly turns on Add Blink From Trace. | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Before / After tab | Appears when post-session data exists and compares matching pre-session and post-session 0-5 ocular symptom ratings. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Session Summary tab | Descriptive review notes only | The Analysis Session Summary tab turns saved blink metrics into plain-English notes about blink pattern, classification mix, timing, inter-blink intervals, review flags, recording quality, and task labels. It does not make diagnoses or medical recommendations. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Clock-style time display | Current time, recording elapsed time, and session duration are shown as minutes:seconds instead of only seconds. | `src/app/pages/AcquirePage.tsx`; `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Auto-detect confirmation | Removed | Pressing Auto-Detect Blinks immediately regenerates detections for the loaded session without a browser confirmation pop-up. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Analysis tab-switch cleanup | Reset graph add/hover/drag state when leaving Review | Switching to Velocity or Before / After clears temporary graph interaction state so Review interactions do not carry into other tabs. | `src/app/pages/AnalysisPage.tsx` | 2026-07-24 |
| Blink confirmation review | Popup over Analysis trace with trace crop, video clip, drag editing, Confirm / Not a Blink, and prompted review labels | Start Review opens the first active blink. Selecting a specific blink row opens that blink. The popup shows a cropped trace and a reference-video clip that starts 1 second before blink start and stops 1 second after the closing peak, falling back to blink end if no peak time is available. Confirm asks the reviewer to choose Complete or Partial before saving. Not a Blink asks the reviewer to choose Flutter, Downward Gaze, or Other with typed notes before saving. Confirmed candidates stay active, rejected candidates are marked deleted, choices save to `blink_events.csv`, and the reviewer advances to the next active blink. Human-review flags are stored in `quality_flag` as `human_confirmed`, `human_rejected`, `rejected_flutter`, `rejected_downward_gaze`, or `rejected_other`. | `src/app/pages/AnalysisPage.tsx`; `backend/app/analysis/blinks.py` | 2026-07-29 |
| Review popup timing edits | Drag blink edges or add a blink by dragging | The blink review popup disables trace zooming and lets the reviewer drag the white left/right blink edges to adjust duration. Add Blink mode lets the reviewer drag across the crop to create a new blink candidate. Split at Current Time remains available for candidates that actually contain two blinks. | `src/app/pages/AnalysisPage.tsx` | 2026-07-29 |
| Database blink loading | Preserve any saved blink rows | Opening a session from Database only runs auto-detect when no blink rows exist yet. If saved blink rows exist, including rows marked Not a Blink/deleted, the app loads the saved review state instead of overwriting it. | `src/app/pages/DatabasePage.tsx` | 2026-07-26 |

## Compare Sessions

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| Compare session slots | Session A and Session B | The Compare tab loads two saved sessions from the session database folder. If a selected session has frame rows but no saved blink rows at all, auto-detect runs before comparison. Saved deleted/rejected rows are preserved. | `src/app/pages/CompareSessionsPage.tsx` | 2026-07-26 |
| Difference summary | Session B minus Session A | Metric changes are calculated by subtracting Session A values from Session B values. The table omits Total blinks, Complete, Partial, and Unclassified rows, and adds plain-English descriptions such as increased/decreased blink rate, longer/shorter intervals, less/more regular intervals, faster/slower velocity, and longer/shorter blink duration. | `src/app/pages/CompareSessionsPage.tsx` | 2026-07-25 |
| Classification comparison | Complete, Partial, Unclassified | Each loaded session counts active blink rows by saved classification. Legacy Near-Complete rows from older sessions are counted with Complete. Unclassified includes any active blink row that is not Complete, legacy Near-Complete, or Partial. | `src/app/pages/CompareSessionsPage.tsx` | 2026-07-25 |
| Compare blink rate | `active blink count / session duration in minutes` | Shows average blink frequency for each compared session. | `src/app/pages/CompareSessionsPage.tsx` | 2026-07-24 |
| Compare interval metrics | Start-time differences between consecutive active blinks | Shows average inter-blink interval, maximum inter-blink interval, and regularity score for each compared session. | `src/app/pages/CompareSessionsPage.tsx` | 2026-07-24 |
| Compare average closing/opening velocity | `peak_closure_percent / closing_or_opening_duration_ms`, shown as `%/ms` | Shows average eyelid closure/opening speed in percent closure per millisecond across active blink rows with available timing and closure data. | `src/app/pages/CompareSessionsPage.tsx` | 2026-07-26 |

## Analysis Metrics Formulas

| Metric | Current formula | Source | Last changed |
|---|---|---|---|
| Recording blink rate | `active blink count / recording duration in minutes` | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Average closing time | Mean of `closing_duration_sec * 1000` across active blink rows | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Average opening time | Mean of `opening_duration_sec * 1000` across active blink rows | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Average blink duration | Mean of `duration_sec * 1000` across active blink rows | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Inter-blink interval | Difference between sorted blink start times | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Max inter-blink interval pair | The two ordinal blink numbers surrounding the longest interval | `src/app/pages/AnalysisPage.tsx` | 2026-07-09 |
| Interval regularity | Standard deviation of intervals divided by average interval, shown as percent | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Interval trend | Linear trend of inter-blink interval over session time, shown in seconds per minute | `src/app/pages/AnalysisPage.tsx` | Audited 2026-07-09 |
| Data FPS | `(data frame count - 1) / timestamp span` from `framewise_measurements.csv` | `src/app/pages/AnalysisPage.tsx` | 2026-07-20 |
| Data frames | Number of loaded rows in `framewise_measurements.csv` | `src/app/pages/AnalysisPage.tsx` | 2026-07-20 |
| Video FPS | FPS reported by OpenCV when probing the Analysis reference video file; values above 300 FPS are treated as unavailable. If metadata FPS is invalid but decoded duration is available, FPS is estimated from decoded frame count and decoded duration. | `backend/app/capture/video_reader.py`; `src/app/pages/AnalysisPage.tsx` | 2026-07-20 |
| Video frames | Frame count reported by OpenCV when probing the Analysis reference video file; if metadata count is invalid, the app decodes the video and counts frames directly. Non-positive or absurd counts are shown as `NA`. | `backend/app/capture/video_reader.py`; `src/app/pages/AnalysisPage.tsx` | 2026-07-20 |

## Database Screen Rules

| Parameter name | Current value | What it controls | Source | Last changed |
|---|---:|---|---|---|
| Blink count | Active rows in `blink_events.csv` where `is_deleted != 1` | Database blink count ignores deleted blink rows. | `backend/app/io/session_store.py` | 2026-07-09 |
| Session duration | `max(timestamp_sec) - min(timestamp_sec)` | Database duration is calculated from framewise timestamps. | `backend/app/io/session_store.py` | 2026-07-09 |
| Session search fields | Subject ID and Date | Database screen filters sessions by subject ID or date text. | `src/app/pages/DatabasePage.tsx` | 2026-07-09 |
| Database session notes | Saved in `database_notes` metadata | Database shows a Notes column with an inline textbox for each session. Notes auto-save back to that session without replacing original session setup notes. | `backend/app/io/session_store.py`; `src/app/pages/DatabasePage.tsx` | 2026-07-28 |
| Living session index files | `session_index.csv` and `session_index.xlsx` in the selected session root folder | The Database scan writes a spreadsheet-style CSV and a formatted Excel workbook containing subject ID, date, session name, folder path, duration, blink count, source type, notes, created time, and frame count. The `.xlsx` version stores wider column widths for easier reading. Updating session metadata, including Database notes, refreshes both files. | `backend/app/io/session_store.py`; `src/app/pages/DatabasePage.tsx` | 2026-07-28 |

## Current Rule Summary

1. Blink detection uses eyelid-opening percent traces, not gaze direction.
2. A candidate must have visible eye landmarks, be a local dip, and pass drop/recovery/duration checks.
3. Same-frame candidates and candidates shorter than 30 ms are rejected and logged, not saved.
4. Complete vs Partial classification is based only on peak closure amount.
5. Duration is still measured for review metrics, but it does not classify blink type.
