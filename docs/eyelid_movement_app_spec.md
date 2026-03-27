# Eyelid Movement Recording Application — Product & Technical Specification

## 1. Purpose

Build a cross-platform desktop application for recording and analyzing eyelid motion over time from either:

1. a live camera feed (preferably the highest frame rate supported by the selected camera), or
2. a prerecorded video file.

The system is intended for high-detail, high-precision measurement of eyelid dynamics in both eyes, with a focus on:

- eyelid opening over time,
- blink detection,
- lid closure events,
- whether upper and lower eyelids appear to touch,
- export of time series and blink summary metrics for downstream analysis.

This document is written as an implementation-ready specification for Codex / engineering use.

---

## 2. Product Goals

### 2.1 Primary goals

- Record bilateral eyelid movement from video in near real time.
- Estimate eyelid opening continuously for left and right eyes.
- Track relevant eyelid landmarks per frame.
- Export per-frame measurements with timestamps to CSV.
- Detect blinks automatically.
- Provide a manual editing workflow so users can add, delete, split, merge, or adjust blink intervals.
- Export a blink-event summary table with one row per blink.
- Support both webcam capture and offline video processing.

### 2.2 Secondary goals

- Estimate eyelid opening both:
  - in image units (pixels),
  - as percentage of estimated maximum opening.
- Provide fast playback and data visualization.
- Provide a live online trace of eyelid opening during acquisition.
- Preserve reproducibility through explicit metadata and configuration export.

### 2.3 Non-goals for v1

- Full clinical diagnosis.
- Millimeter estimation and calibration workflows.
- Cloud backend or multi-user synchronization.
- Mobile phone native app in v1 unless the chosen stack makes packaging easy.
- Highly customized 3D face modeling.
- Medical-grade certification.

---

## 3. Target Users

- Vision scientists
- Ophthalmology / optometry researchers
- Clinicians doing observational or exploratory eyelid analysis
- Research assistants annotating blink events

---

## 4. Platform Scope

### 4.1 Required platforms

Cross-platform desktop application supporting:

- macOS
- Windows
- Linux

### 4.2 Preferred packaging

Single installable desktop app with local processing.

### 4.3 Recommended implementation stack

Because the application is video-heavy, needs responsive UI, and should run locally across platforms:

**Recommended stack:**
- **Frontend/Desktop shell:** Electron + React + TypeScript
- **Backend / processing:** Python service invoked locally
- **Computer vision:** Python + OpenCV + MediaPipe and/or custom landmark model
- **Data handling:** pandas / NumPy
- **Plotting:** Plotly.js in UI
- **Packaging:** Electron Builder; bundled Python runtime or managed environment

### 4.4 Alternative acceptable stack

- Tauri + React + TypeScript + Rust shell + Python worker

### 4.5 Why this split

- UI iteration is easier in React.
- Python has the best mature ecosystem for video analysis, CV models, and CSV-based scientific workflows.
- Codex can generate both the desktop shell and the analysis service cleanly.

---

## 5. High-Level User Workflow

### 5.1 Recording workflow

1. User launches app.
2. User chooses:
   - **Live Camera**, or
   - **Video File**.
3. User selects camera and desired capture mode if live.
4. App shows preview.
5. User optionally defines calibration and subject/session metadata.
6. User starts recording or processing.
7. App tracks eyelid features frame by frame.
8. App stores raw per-frame metrics.
9. User stops recording / processing completes.
10. App opens analysis view.
11. User reviews traces and blink calls.
12. User edits blinks if needed.
13. User exports outputs.

### 5.2 Analysis workflow

1. User loads an existing session.
2. App reads video, metadata, framewise CSV, and blink event file if present.
3. User views synchronized video + traces.
4. User adjusts thresholds or runs blink detection.
5. User manually edits blink intervals.
6. User saves revised blink annotations.
7. App updates CSV and blink summary export.

---

## 6. Functional Requirements

## 6.1 Data input modes

### 6.1.1 Live camera mode
The application shall:
- enumerate available cameras,
- display supported resolutions and frame rates when available,
- allow the user to select a device,
- default to the highest available frame rate for the chosen mode,
- allow manual override of resolution and fps if supported,
- show a live preview,
- record timestamps as accurately as possible,
- optionally save the raw video alongside extracted measurements.

### 6.1.2 Video file mode
The application shall:
- accept common video formats, at minimum: `.mp4`, `.mov`, `.avi`, `.mkv`,
- decode the original frame rate and timestamps when available,
- process frame-by-frame,
- preserve source timing metadata as much as possible,
- allow re-analysis of previously processed sessions.

---

## 6.2 Eyelid tracking and measurements

The application shall compute, for each frame and for each eye when visible:

### 6.2.1 Landmark outputs
- upper eyelid landmark coordinates
- lower eyelid landmark coordinates
- medial canthus landmark if available
- lateral canthus landmark if available
- pupil center and/or iris center if available
- optional contour points along upper and lower lid margins

At minimum, the system must estimate enough points to robustly compute aperture and closure.

### 6.2.2 Derived framewise measurements
For left eye and right eye separately:
- eyelid opening in pixels
- eyelid opening as percent of maximum opening
- eyelid closed / touching estimate (binary or probabilistic)
- confidence score for tracking quality
- eye visibility / occlusion flag
- blink state flag

Optional but recommended:
- velocity of lid opening/closing
- acceleration
- asymmetry metrics between left and right eye
- contour overlap metric or minimum lid-lid distance

### 6.2.3 Definition of eyelid opening
For v1, define eyelid opening as:

> The vertical distance, in image pixels, between the upper and lower eyelid margins measured at a standardized horizontal position for each eye.

Recommended standardized positions:
- through pupil center when pupil is detected, otherwise
- midpoint between medial and lateral canthi, otherwise
- best-fit lid aperture midpoint based on tracked eyelid contours.

### 6.2.4 Definition of lid touching / closed
The application shall output a `closed_touching` state per eye.

Recommended default logic:
- compute minimum upper-lid to lower-lid distance near the central lid aperture,
- if distance is below a configurable threshold in pixels or below a normalized threshold relative to eye width, label as closed/touching,
- expose both raw distance and binary classification.

Because visual “touching” is model- and image-quality-dependent, the system must also save confidence values.

### 6.2.5 Percent of maximum opening
The application shall estimate percent max opening per eye:

`opening_percent = 100 * opening_px / reference_max_opening_px`

Where `reference_max_opening_px` is determined by one of:
1. manual calibration by user,
2. maximum robust value observed within selected baseline interval,
3. percentile-based estimate (recommended default: 95th or 99th percentile of valid opening values).

This reference choice must be recorded in metadata.

### 6.2.6 Millimeter estimate
Millimeter estimation is out of scope for v1.

The application shall not require calibration workflows in MVP.

Future versions may add optional calibration and mm conversion, but all current exports and UI should be designed so that this can be added later without breaking the framewise schema.

---

## 6.3 Timing requirements

The application shall store, for every frame:
- frame index
- timestamp in seconds from session start
- absolute timestamp if available
- nominal source fps
- actual inter-frame interval when measurable

For live acquisition, the system should prioritize real timestamp capture over assuming constant frame period.

---

## 6.4 Blink detection

### 6.4.1 Automatic blink detection
The application shall automatically detect blink events based on eyelid opening trajectories and/or closed-touching state.

Recommended default logic:
- smooth opening trace lightly,
- detect downward threshold crossing and recovery,
- require minimum closure depth and minimum duration,
- optionally combine with velocity criteria,
- support per-eye and bilateral blink definitions.

### 6.4.2 Editable blink objects
A blink annotation shall have at minimum:
- unique blink ID
- eye side (`left`, `right`, `bilateral`, `unknown`)
- start frame / start time
- peak closure frame / time
- end frame / end time
- auto-detected yes/no
- manually edited yes/no
- validity / deleted flag
- reviewer notes optional

Framewise blink labeling shall include:
- `blink_yes_no`
- `left_blink`
- `right_blink`
- `bilateral_blink`

### 6.4.3 Manual editing tools
The analysis UI shall allow the user to:
- add a new blink interval,
- adjust blink start,
- adjust blink peak,
- adjust blink end,
- delete a blink,
- restore a deleted blink,
- split one blink into two,
- merge adjacent blinks,
- mark blink as unilateral left/right or bilateral,
- rerun detection after threshold changes.

The analysis UI shall not include manual ROI placement or manual landmark correction tools in v1.

---

## 6.4.4 Live online trace during acquisition

During live camera acquisition, the application shall display a continuously updating plot of eyelid opening over time.

### Requirements
- show separate traces for left and right eye opening,
- update in near real time while tracking,
- display at least the most recent rolling time window (recommended default: last 10–20 seconds),
- optionally auto-scroll as new data arrives,
- visually indicate periods of low tracking confidence,
- remain responsive while acquisition continues.

### Recommended controls
- pause/resume plot scrolling,
- adjust visible time window,
- toggle raw vs smoothed trace,
- toggle left/right channels.

This live trace is for monitoring and not a replacement for the post hoc Analysis tab.

## 6.5 Visualization and analysis UI

The application shall include an **Analysis** tab with synchronized video and timeseries plots.

### 6.5.1 Required views
- video player with frame stepping
- left eye opening trace
- right eye opening trace
- optional closed/touching state trace
- blink interval overlays
- landmark overlay on video

### 6.5.2 Interaction requirements
- clicking on a plot moves the video to that time
- stepping video updates cursor on plots
- selecting a blink highlights corresponding interval
- zoom and pan in time plots
- show tooltips with frame/time/value
- allow turning channels on/off

### 6.5.3 Editing interactions
Recommended interactions:
- drag blink boundary handles on plot
- context menu for add/delete blink
- keyboard shortcuts for frame stepping and annotation

---

## 6.6 Export requirements

### 6.6.1 Framewise CSV export
The application shall export a CSV with one row per frame.

Required columns:
- `session_id`
- `source_type` (`camera` or `video_file`)
- `source_name`
- `frame_index`
- `timestamp_sec`
- `timestamp_iso` if available
- `nominal_fps`
- `dt_sec`
- `left_opening_px`
- `right_opening_px`
- `left_opening_percent`
- `right_opening_percent`
- `left_closed_touching`
- `right_closed_touching`
- `left_closed_touching_confidence`
- `right_closed_touching_confidence`
- `left_tracking_confidence`
- `right_tracking_confidence`
- `left_visible`
- `right_visible`
- `blink_yes_no`
- `left_blink`
- `right_blink`
- `bilateral_blink`

Recommended additional columns:
- lid landmark coordinates
- contour coordinates or serialized JSON reference
- per-eye blink labels (`left_blink`, `right_blink`, `bilateral_blink`)
- velocities
- raw thresholds used

#### Landmark column naming convention
All landmark coordinates shall be included directly in the main framewise CSV for v1.

Use explicit coordinate columns, e.g.:
- `left_upper_lid_x_1`, `left_upper_lid_y_1`
- `left_lower_lid_x_1`, `left_lower_lid_y_1`
- `right_upper_lid_x_1`, `right_upper_lid_y_1`
- `right_lower_lid_x_1`, `right_lower_lid_y_1`
- canthus and auxiliary landmarks with similarly explicit naming

The schema should remain consistent across sessions, even if some landmarks are missing in particular frames; missing values should be stored as empty or `NaN`.

### 6.6.2 Blink summary file
The application shall export a second file with one row per blink.

Required columns:
- `session_id`
- `blink_id`
- `eye_side`
- `start_frame`
- `start_time_sec`
- `peak_frame`
- `peak_time_sec`
- `end_frame`
- `end_time_sec`
- `duration_sec`
- `closing_duration_sec`
- `opening_duration_sec`
- `peak_closure_percent`
- `min_opening_px`
- `min_opening_percent`
- `is_auto_detected`
- `is_manually_edited`
- `is_deleted`
- `quality_flag`
- `notes`

Recommended additional blink metrics:
- max closing velocity
- max opening velocity
- interblink interval
- area under closure curve
- symmetry index between eyes

### 6.6.3 Metadata export
The application shall export session metadata in JSON or YAML.

Fields should include:
- app version
- processing pipeline version
- model version
- operating system
- camera name / file name
- resolution
- source fps
- actual processing fps
- calibration method
- threshold values
- session start time
- subject/session notes

---

## 6.7 Save behavior

The system shall support:
- save project/session bundle,
- reopen and continue editing,
- export CSVs without losing edit history.

### 6.7.1 Session folder structure
Recommended default session folder:

```text
session_name/
  raw_video.mp4
  framewise_measurements.csv
  blink_events.csv
  session_metadata.json
  audit_log.json
  derived/
  thumbnails/
```

### 6.7.2 Updating blink column in framewise CSV
When blink editing changes are saved, the framewise CSV shall be rewritten or incrementally updated so that `blink_yes_no` reflects the current accepted annotation state.

Recommended behavior:
- keep original autogenerated blink columns,
- save final reviewed column separately, e.g. `blink_yes_no_final`.

This avoids destructive overwrite.

---

## 7. Accuracy and Performance Requirements

## 7.1 Performance requirements

### 7.1.1 Live mode
Target:
- preview latency under 150 ms on a modern laptop when possible,
- processing fast enough for at least 30 fps in real time on common hardware,
- attempt maximum camera fps if feasible.

### 7.1.2 Offline mode
- process at or faster than real time for standard HD video on typical recent hardware when possible,
- permit batch reprocessing with progress reporting.

## 7.2 Precision requirements

The system should:
- preserve sub-frame timing only if available from source,
- preserve per-frame measurement precision to at least 3 decimals in pixel-derived columns,
- support subpixel landmark estimation if model supports it.

## 7.3 Robustness requirements

The tracker should tolerate:
- moderate head motion,
- moderate illumination changes,
- partial occlusion from lashes or glasses when possible,
- brief tracking loss without crashing.

When confidence is low, the system must mark outputs as low confidence instead of silently fabricating stable values.

---

## 8. Recommended Computer Vision Pipeline

## 8.1 Overall pipeline

1. Acquire frame.
2. Detect face / eye region.
3. Detect eye landmarks and eyelid contours.
4. Compute per-eye opening and closure metrics.
5. Estimate quality/confidence.
6. Save framewise data.
7. Run online or offline blink detection.
8. Render overlay + traces.

## 8.2 Landmark strategy

### v1 recommended approach
Use a hybrid pipeline:
- face and coarse eye region detection using MediaPipe Face Mesh or equivalent,
- refine eyelid margins locally within eye ROI using edge-based or learned refinement,
- estimate upper/lower lid positions at central aperture.

Rationale:
- MediaPipe alone may be convenient but not always precise enough for high-detail lid dynamics.
- A local refinement stage improves aperture measurement precision.

### v2 option
Custom trained landmark model for eyelid margin segmentation or contour regression.

## 8.3 Tracking confidence
Confidence should combine:
- detector confidence,
- contour fit residual,
- temporal consistency,
- ROI visibility.

## 8.4 Smoothing
Allow configurable smoothing for visualization and blink detection, but always preserve raw framewise measurements as separate columns.

Recommended columns:
- `left_opening_px_raw`
- `left_opening_px_smooth`
- etc.

---

## 9. User Interface Specification

## 9.1 Main navigation
Tabs or sections:
- **Home / Session Setup**
- **Acquire / Process**
- **Analysis**
- **Export**
- **Settings**

## 9.2 Home / Session Setup
Fields:
- session name
- subject ID optional
- notes
- source type
- camera select or file picker
- output folder
- save raw video toggle
- calibration setup button

## 9.3 Acquire / Process view
Display:
- live or video preview
- current frame rate
- current resolution
- recording state
- dropped frames indicator
- elapsed time
- current tracking confidence
- live rolling trace of left and right eye opening

Controls:
- start
- stop
- pause if video file mode
- choose camera mode
- overlay on/off
- live trace window duration selector
- raw/smoothed trace toggle

## 9.4 Analysis view
Panels:
- video pane
- plot pane
- blink table pane
- controls pane

Controls:
- play/pause
- step frame forward/back
- jump to next/previous blink
- zoom selection
- detect blinks
- edit thresholds
- add/edit/delete blink
- save annotations

## 9.5 Export view
Options:
- export framewise CSV
- export blink CSV
- export metadata JSON
- export plots as PNG/SVG
- export reviewed session bundle

## 9.6 Settings
- model selection
- default thresholds
- smoothing parameters
- plotting preferences
- output precision
- hardware acceleration options

---

## 10. Data Model

## 10.1 Core entities

### Session
Represents one acquisition or one imported video analysis.

Fields:
- `session_id`
- `name`
- `created_at`
- `source_type`
- `source_path`
- `camera_device_id`
- `fps_nominal`
- `resolution_width`
- `resolution_height`
- `notes`
- `calibration_id`
- `pipeline_version`

### FrameMeasurement
One row per frame.

Fields include:
- frame/timestamp info
- per-eye landmarks
- per-eye opening metrics
- per-eye state flags
- blink label fields

### BlinkEvent
One row per blink.

Fields include:
- interval boundaries
- summary metrics
- provenance flags

### Calibration
Fields:
- `calibration_id`
- `method`
- `mm_per_pixel`
- `reference_distance_mm`
- `reference_points`
- `confidence`

---

## 11. Suggested Internal File Formats

### 11.1 Storage recommendations
Use:
- CSV for interoperability and the main framewise export
- JSON for metadata

### 11.2 Landmarks storage recommendation
For v1, store all per-frame landmark coordinates directly in the main framewise CSV.

This is intentionally MATLAB-friendly and simplifies downstream use, even if the CSV becomes wide.

## 12. Blink Detection Algorithm Spec

## 12.1 Inputs
- left and right opening traces
- closed_touching states
- confidence masks

## 12.2 Default algorithm

1. Mask frames with invalid tracking.
2. Smooth valid opening trace slightly.
3. Normalize using max-opening reference.
4. Detect candidate closures where normalized opening falls below threshold.
5. Merge nearby candidates with gap below configurable threshold.
6. Compute onset, nadir, and offset using threshold crossings and local minima.
7. Reject events outside duration bounds.
8. Classify unilateral/bilateral overlap.

## 12.3 Configurable parameters
- closure threshold percent
- reopen threshold percent
- minimum blink duration
- maximum blink duration
- merge gap
- minimum closure depth
- minimum confidence

## 12.4 Manual review priority
Manual edits always override auto-detected results in final exports.

---

## 13. Calibration Spec

Calibration is out of scope for v1.

The codebase should keep measurement and export layers modular so calibration can be added in a future release, but no calibration UI, storage, or mm conversion is required for MVP.

## 14. Error Handling

The application shall gracefully handle:
- unsupported video codec
- unavailable camera
- frame drops
- temporary tracking failure
- invalid output path
- export failure
- corrupted session files
- automatic eye detection failure

Requirements:
- show user-friendly error messages,
- log detailed diagnostic errors,
- never silently discard data,
- mark failed tracking frames explicitly with confidence and visibility flags,
- avoid manual rescue workflows in v1; failures should remain flagged as failed or low-confidence.

---

## 15. Logging and Auditability

The application shall maintain logs for:
- acquisition start/stop
- processing pipeline versions
- threshold changes
- blink edits
- exports
- errors and warnings

Recommended audit log fields:
- timestamp
- action
- user-entered note if applicable
- old value
- new value

---

## 16. Testing Requirements

## 16.1 Unit tests
Must cover:
- timestamp generation
- aperture calculation
- normalization to percent max
- mm conversion
- blink interval extraction
- manual edit persistence
- CSV export schema

## 16.2 Integration tests
Must cover:
- webcam session creation
- video file processing
- save and reopen session
- blink edit and re-export
- camera mode selection fallback

## 16.3 Performance tests
Must benchmark:
- live preview fps
- processing throughput
- memory usage for long sessions

## 16.4 Validation datasets
Engineering should include a small set of internal test videos with:
- normal blinking
- unilateral blinks / wink-like events if available
- partial closures
- tracking loss
- glasses / reflections

---

## 17. Security and Privacy

Because the app processes facial video:
- default to local-only processing,
- do not upload data unless explicitly implemented later,
- clearly show where files are saved,
- provide option to avoid saving raw video.

---

## 18. Accessibility and UX Notes

- large buttons for recording controls
- keyboard shortcuts for annotation
- dark mode support preferred
- colorblind-safe plot overlays
- clear indication of which eye is being edited

---

## 19. MVP Scope

## 19.1 Must-have for MVP
- cross-platform desktop app
- camera input and video file input
- per-frame timestamps
- left/right opening in pixels
- percent max opening
- live rolling trace of eye opening during online tracking
- CSV export
- auto blink detection
- manual blink editing
- blink summary export
- session save/load
- landmark overlay

## 19.2 Nice-to-have for MVP
- full landmark export
- confidence-based QC filters
- multiple detection models

## 19.3 Defer to later versions
- custom training pipeline
- cloud sync
- shared annotation workflows
- automatic report generation

---

## 20. Codex Execution Instructions

Use the following instructions as the engineering brief for Codex.

### 20.1 Objective
Build a production-quality MVP desktop application for local eyelid-movement acquisition and analysis on macOS, Windows, and Linux.

### 20.2 Implementation priorities
1. Reliability of per-frame timestamps and exports.
2. Stable left/right eyelid opening estimates in pixels.
3. Responsive live preview plus live rolling traces.
4. Accurate blink detection with strong manual blink editing tools.
5. Simple local-first packaging and session persistence.

### 20.3 Hard constraints
- Desktop app only.
- No cloud dependency for core operation.
- No calibration or mm estimation.
- No manual ROI fallback.
- No manual landmark editing.
- Use a single framewise CSV including all landmark columns.
- Include four framewise blink columns: `blink_yes_no`, `left_blink`, `right_blink`, `bilateral_blink`.
- Prioritize clarity and robustness over ambitious model complexity.

### 20.4 Recommended stack for Codex
- **Desktop shell / UI:** Electron + React + TypeScript + Vite
- **Charts:** Plotly.js
- **State management:** Zustand
- **IPC contract:** JSON over Electron IPC
- **Python backend:** Python 3.11+
- **CV / video:** OpenCV, NumPy, pandas
- **Landmarks:** MediaPipe Face Mesh or equivalent face/eye landmark model as the initial implementation
- **Testing:** Vitest for frontend; pytest for Python backend
- **Packaging:** Electron Builder

### 20.5 Delivery style for Codex
Codex should implement this in milestones, producing a runnable app early, then iterating. Do not start with over-engineered abstractions. First make acquisition, tracking, export, and review work end to end.

---

## 21. Codex Build Plan

### 21.1 Milestone 1 — App shell and session setup
Implement:
- Electron app with React UI
- Home screen with session form
- source selection: camera vs video file
- camera enumeration
- output folder selection
- session creation and save path initialization

Acceptance criteria:
- app launches on desktop
- user can create a session
- user can choose a camera or a video file
- user can start a processing session without crashes

### 21.2 Milestone 2 — Video preview and frame pipeline
Implement:
- live preview for webcam
- video playback preview for file input
- frame loop with timestamps
- backend pipeline that returns per-frame tracking payloads
- save raw video option for live mode

Acceptance criteria:
- preview updates continuously
- timestamps are recorded per frame
- pipeline can process a short session and write metadata JSON

### 21.3 Milestone 3 — Eyelid tracking and measurements
Implement:
- face detection and eye landmark extraction
- derive left and right eyelid opening in pixels
- derive percent-of-max opening using a session-level robust reference
- derive closed/touching state and tracking confidence
- include all configured landmark coordinates in framewise rows

Acceptance criteria:
- framewise CSV is written with stable schema
- openings and landmarks are populated on typical frontal videos
- failed frames are marked low-confidence instead of crashing

### 21.4 Milestone 4 — Live trace during acquisition
Implement:
- rolling online plot for left/right opening
- time window selector
- auto-scroll during acquisition
- raw/smoothed toggle

Acceptance criteria:
- live trace updates during webcam tracking
- UI remains responsive during recording
- plot and video stay reasonably synchronized

### 21.5 Milestone 5 — Analysis tab
Implement:
- load saved session
- synchronized video + traces
- blink overlays
- blink table
- frame stepping and click-to-seek

Acceptance criteria:
- clicking trace seeks video
- stepping video moves plot cursor
- blink intervals render correctly

### 21.6 Milestone 6 — Blink detection and editing
Implement:
- automatic blink detection
- editable blink intervals
- add/delete/split/merge/edit blink boundaries
- save reviewed blink labels back into framewise CSV and blink CSV

Acceptance criteria:
- user can revise blink intervals without editing landmarks
- framewise CSV contains all four blink columns
- blink summary CSV updates after edits

### 21.7 Milestone 7 — Packaging and QA
Implement:
- installers or distributable builds
- smoke tests
- sample session fixtures
- documentation for running locally

Acceptance criteria:
- app can be packaged
- core workflows run on at least one machine per OS target

---

## 22. Exact UI Specification

### 22.1 Global navigation
Use five tabs in the left sidebar or top nav:
- Session
- Acquire
- Analysis
- Export
- Settings

### 22.2 Session tab
Fields:
- Session Name (required)
- Subject ID (optional)
- Notes (optional multiline)
- Source Type: `Live Camera` or `Video File`
- Camera selector when live mode is chosen
- Video file picker when file mode is chosen
- Output folder picker
- Save raw video toggle for live mode

Buttons:
- Create Session
- Open Existing Session

Behavior:
- `Create Session` creates session folder and metadata stub
- cannot proceed without source and output folder

### 22.3 Acquire tab
Layout:
- left: video preview with landmark overlay toggle
- right upper: acquisition controls
- right lower: live rolling trace

Show:
- current fps
n- elapsed time
- resolution
- tracking status
- confidence summary
- dropped frame count if available

Controls:
- Start
- Stop
- Pause (video-file mode only)
- Overlay On/Off
- Trace Window: 5 s / 10 s / 20 s / 60 s
- Trace Mode: raw / smoothed / both

Behavior:
- when running live mode, trace auto-scrolls
- when stopped, session immediately becomes available in Analysis tab

### 22.4 Analysis tab
Layout:
- top left: video player
- top right: blink table
- bottom: synchronized multi-trace plot

Plot channels:
- left opening px
- right opening px
- left opening percent
- right opening percent
- optional closed/touching state overlay
- blink interval overlays

Controls:
- Play/Pause
- Step Back
- Step Forward
- Jump Prev Blink
- Jump Next Blink
- Detect Blinks
- Save Blink Edits
- Undo last blink edit

Context actions on plot:
- Add Blink Here
- Set Blink Start
- Set Blink Peak
- Set Blink End
- Delete Blink
- Split Blink
- Merge with Next

### 22.5 Export tab
Actions:
- Export Framewise CSV
- Export Blink CSV
- Export Metadata JSON
- Export All

Also show:
- output file paths
- last export timestamp

### 22.6 Settings tab
Fields:
- smoothing window
- blink closure threshold
- blink reopen threshold
- minimum blink duration
- maximum blink duration
- merge gap
- minimum tracking confidence
- max rolling trace duration default

---

## 23. Exact CSV Schema

### 23.1 Framewise CSV required columns
The framewise CSV must contain these base columns in this order:

```text
session_id
source_type
source_name
frame_index
timestamp_sec
timestamp_iso
nominal_fps
dt_sec
left_opening_px
right_opening_px
left_opening_percent
right_opening_percent
left_closed_touching
right_closed_touching
left_closed_touching_confidence
right_closed_touching_confidence
left_tracking_confidence
right_tracking_confidence
left_visible
right_visible
blink_yes_no
left_blink
right_blink
bilateral_blink
```

After these base columns, append landmark columns in a stable deterministic order.

### 23.2 Landmark column convention
Use explicit flat columns, not nested JSON.

Minimum recommended landmark set per eye:
- upper lid points: 5
- lower lid points: 5
- medial canthus: 1
- lateral canthus: 1
- center reference point: 1 if available

Example ordering:

```text
left_upper_lid_x_1
left_upper_lid_y_1
left_upper_lid_x_2
left_upper_lid_y_2
...
left_lower_lid_x_1
left_lower_lid_y_1
...
left_medial_canthus_x
left_medial_canthus_y
left_lateral_canthus_x
left_lateral_canthus_y
right_upper_lid_x_1
right_upper_lid_y_1
...
```

Rules:
- same columns for every session
- use empty or `NaN` for missing values
- never change column names based on detector availability within a session

### 23.3 Blink CSV required columns
Use this exact order:

```text
session_id
blink_id
eye_side
start_frame
start_time_sec
peak_frame
peak_time_sec
end_frame
end_time_sec
duration_sec
closing_duration_sec
opening_duration_sec
min_opening_px
min_opening_percent
peak_closure_percent
is_auto_detected
is_manually_edited
is_deleted
quality_flag
notes
```

### 23.4 Metadata JSON required keys
```json
{
  "session_id": "string",
  "app_version": "string",
  "pipeline_version": "string",
  "source_type": "camera|video_file",
  "source_name": "string",
  "resolution_width": 0,
  "resolution_height": 0,
  "nominal_fps": 0,
  "session_created_at": "ISO-8601 string",
  "save_raw_video": true,
  "tracking_model": "string",
  "opening_reference_method": "95th_percentile_valid_opening",
  "settings": {}
}
```

---

## 24. Backend Module Contracts

### 24.1 `capture/camera.py`
Responsibilities:
- enumerate cameras
- open selected camera
- request target resolution / fps when possible
- yield frames plus timestamps

Primary interface:
- `list_cameras() -> list[CameraInfo]`
- `open_camera(config: CameraConfig) -> CameraStream`

### 24.2 `capture/video_reader.py`
Responsibilities:
- read video files
- decode frame count/fps if available
- emit frames and timestamps

Primary interface:
- `open_video(path: str) -> VideoStream`

### 24.3 `tracking/landmarks.py`
Responsibilities:
- detect face
- extract eye-region landmarks
- return stable landmark structure for both eyes

Primary interface:
- `track_eyelids(frame: np.ndarray) -> TrackingResult`

### 24.4 `tracking/metrics.py`
Responsibilities:
- derive opening px
- derive percent opening
- derive closed/touching flags
- compute confidence and visibility flags

Primary interface:
- `compute_frame_metrics(tracking_result, state) -> FrameMetrics`

### 24.5 `analysis/blinks.py`
Responsibilities:
- detect blinks from framewise series
- convert intervals to blink objects
- recompute summary metrics after edits

Primary interface:
- `detect_blinks(frame_df: pd.DataFrame, config: BlinkConfig) -> pd.DataFrame`
- `recompute_blink_metrics(frame_df: pd.DataFrame, blink_df: pd.DataFrame) -> pd.DataFrame`

### 24.6 `io/session_store.py`
Responsibilities:
- create session folder
- write metadata
- append framewise rows safely
- write blink csv
- load existing session

Primary interface:
- `create_session(...) -> SessionPaths`
- `append_frame_row(row: dict) -> None`
- `save_framewise_csv(df) -> None`
- `save_blink_csv(df) -> None`
- `load_session(path) -> SessionData`

### 24.7 `ipc/schemas.ts` and `ipc/contracts.py`
Responsibilities:
- define typed IPC payloads between Electron and Python
- version all payloads
- validate payloads before processing

---

## 25. Processing Logic Requirements

### 25.1 Opening computation
Default opening per eye:
- estimate upper and lower lid positions at the eye centerline
- compute vertical distance in pixels
- if multiple contour points are available, use a robust central estimate rather than a single noisy point pair

### 25.2 Percent max opening
Default method:
- compute from valid frames only
- use 95th percentile of opening in the session as reference maximum
- clamp percentage to `[0, 100+]` but preserve raw px values unchanged

### 25.3 Closed/touching logic
Default rule:
- closed/touching if opening percent is below configurable threshold and tracking confidence exceeds minimum threshold
- save both binary flag and confidence

### 25.4 Blink detection default algorithm
1. choose the relevant opening signal per eye
2. smooth lightly for detection only
3. detect closure threshold crossings
4. merge adjacent events separated by short gaps
5. locate nadir within each candidate blink
6. reject events outside duration range
7. combine overlapping unilateral events into bilateral blink labels where appropriate
8. fill all four framewise blink columns
9. generate one row per blink in blink CSV

### 25.5 Failure handling
If face/eye detection fails:
- do not invent landmarks
- write `NaN` landmark/opening values where needed
- set visibility to false
- set low confidence
- continue processing subsequent frames

If failure rate is high for a session, surface a warning in the UI.

---

## 26. State and Persistence Rules

### 26.1 Session folder layout
```text
session_name/
  framewise_measurements.csv
  blink_events.csv
  session_metadata.json
  audit_log.json
  raw_video.mp4        # optional in live mode
```

### 26.2 Save semantics
- session metadata saved at session creation
- framewise rows appended during acquisition or processing
- blink edits saved explicitly through `Save Blink Edits`
- export should not silently mutate source data beyond intentional reviewed blink columns

### 26.3 Audit log
Append audit entries for:
- session creation
- acquisition start/stop
- blink detection runs
- blink add/delete/edit operations
- exports
- processing failures and warnings

---

## 27. Testing and Acceptance Plan

### 27.1 Frontend tests
Test:
- session form validation
- IPC request dispatch
- trace rendering with mock data
- blink table editing interactions
- plot click-to-seek behavior

### 27.2 Backend tests
Test:
- timestamp monotonicity
- deterministic framewise schema generation
- opening computation for synthetic landmark inputs
- blink detection on synthetic traces
- blink CSV regeneration after manual edits
- failure handling on missing detections

### 27.3 End-to-end tests
Use small fixture videos to verify:
- session creation
- video-file processing
- framewise CSV export
- blink detection
- blink editing persistence
- reloading a saved session

### 27.4 Minimum acceptable validation set
Include at least:
- straightforward frontal blink video
- partial closure video
- unilateral blink or wink-like video if available
- clip with intermittent tracking loss

---

## 28. Coding Standards for Codex

Codex should follow these rules:
- Keep the code modular but practical.
- Prefer typed interfaces in TypeScript and dataclasses or Pydantic-style schemas in Python.
- Avoid premature abstraction.
- Put all schema names and CSV column names in shared constants.
- Keep detector-specific code isolated so the tracker can be replaced later.
- Separate raw measurements from smoothed values.
- Use structured logs.
- Fail loudly in logs, gently in the UI.

### 28.1 What not to build in v1
Do not add:
- calibration UI
- mm estimates
- manual ROI tools
- manual landmark editing
- cloud sync
- user accounts
- database server
- mobile app

---

## 29. Final Implementation Prompt for Codex

Use this as the direct build prompt:

> Build a cross-platform desktop MVP for recording and analyzing bilateral eyelid movements from either a webcam or a video file. Use Electron + React + TypeScript for the desktop UI and Python for local video processing. The app must run locally on macOS, Windows, and Linux. It must show live video preview, extract eyelid landmarks for both eyes, compute per-frame eyelid opening in pixels and percent-of-max opening, and display a live rolling trace during acquisition. It must write one framewise CSV with timestamps, openings, confidence flags, visibility flags, all landmark coordinates, and four blink columns: `blink_yes_no`, `left_blink`, `right_blink`, `bilateral_blink`. It must also write a blink summary CSV with one row per blink and a metadata JSON file. It must support automatic blink detection plus manual blink editing in an Analysis tab, but it must not support manual landmark editing, manual ROI fallback, calibration, or millimeter output. If detection fails, mark frames as low-confidence or invisible and continue. Prioritize a robust MVP with clear schema contracts, local-first operation, and responsive UI.

---

## 30. Finalized Product Decisions

The requester confirmed the following implementation decisions:

1. Use a single main framewise CSV that includes landmark coordinates.
2. Include four blink label columns in the framewise data:
   - `blink_yes_no`
   - `left_blink`
   - `right_blink`
   - `bilateral_blink`
3. Support manual blink editing only; do not support manual landmark editing in v1.
4. For v1 data assumptions, optimize for recordings with minimal head movement and no glasses or heavy makeup.
5. Do not include manual ROI fallback. If automatic detection fails, flag the data rather than rescue it manually.
6. Do not include calibration or mm conversion in v1.
7. Include a live rolling eye-opening trace during online tracking.

With these choices, the spec is now suitable as a concrete Codex handoff.

