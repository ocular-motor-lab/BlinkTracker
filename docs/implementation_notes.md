# Implementation Notes

## Known Issues

### Analysis video/data synchronization may be offset

Status: pending investigation

Observed behavior:
- In the Analysis tab, the recorded review video may not line up exactly with the framewise trace and scrubber time.
- The current sync path assumes the saved media timeline and framewise timestamps are aligned closely enough for MVP review, but that assumption may be wrong for some sessions.

Likely contributing factors:
- `MediaRecorder` chunk timing is not guaranteed to match the acquisition loop timing exactly.
- The framewise CSV timestamps are currently derived from the live acquisition clock rather than a media-file-grounded timeline.
- Playback startup and first-frame seeking in the Analysis tab may introduce a visible offset.

Follow-up work:
- Measure the offset between recorded media timestamps and framewise timestamps on a short validation recording.
- Decide whether Analysis should sync to media time, acquisition time, or a stored alignment offset.
- Add an explicit alignment model if needed instead of assuming zero offset.

### Blink editing interaction still feels harder than it should

Status: pending usability pass

Observed behavior:
- The current blink editor is workable, but selecting, resizing, and curating blink intervals in the Analysis tab still takes more effort than ideal.
- Users can click a shaded blink to select it and drag its edges, but the workflow still feels a bit fiddly for repeated review/edit cycles.

Likely contributing factors:
- Plotly shape editing is functional but not yet as direct or polished as a purpose-built interval editor.
- The list below the trace is now simpler, but it still behaves more like an inspector than a full editing surface.
- Blink creation, resizing, deletion, and confirmation are not yet unified into one especially obvious interaction model.

Follow-up work:
- Improve discoverability and affordances for selecting and resizing blinks directly in the trace.
- Consider adding dedicated handles, clearer selected-state styling, or keyboard shortcuts for nudge/resize actions.
- Reduce the number of clicks needed for common review tasks like extending onset/offset or correcting a missed blink.
- Fix the remaining cursor-feedback bug in the trace editor so hover near a blink edge reliably changes the cursor and makes the upcoming drag action obvious before the user clicks.
- Make edge resizing tolerant to clicks slightly outside the shaded blink interval, while keeping zoom as the default interaction elsewhere on the trace.

## Open Product / Architecture Questions

### Future gaze-tracking support: same app or separate app?

Status: undecided

Question:
- If gaze tracking is added later, should it live inside this app as a second analysis mode, or become a separate application?

Current leaning:
- One shared app with separate `blink` and `gaze` modes probably makes the most sense if the shell, acquisition flow, analysis patterns, and export workflow remain substantially shared.

Reasons to keep one app:
- Session setup, source selection, preview, recording, trace review, and export infrastructure are already shared.
- Both use cases fit under a broader local oculomotor analysis tool.

Reasons to split later:
- Gaze tracking may require substantially different workflows such as calibration, world-reference modeling, head pose tooling, and different review interfaces.
- If the product becomes too complex or the user groups diverge, two apps may be easier to maintain conceptually.

### Long-term platform direction: keep Python, move to pure TypeScript desktop, or move to web?

Status: undecided

Question:
- Should the long-term version remain Electron + Python, simplify to Electron + TypeScript only, or eventually become a browser-hosted web app?

Current leaning:
- Keep the current local-first Electron app for now.

Why this remains open:
- Live tracking ended up working better in the JavaScript/TypeScript path than in Python.
- Much of the current application logic is now frontend-side.
- Python still handles useful local processing and file-oriented analysis tasks, but it also complicates packaging.

Options to revisit later:
- Keep the current hybrid architecture if local analysis and file workflows remain the priority.
- Move to a pure TypeScript Electron app if packaging simplicity becomes more important than Python-based offline processing.
- Consider a hosted web app only if easier access/sharing becomes a higher priority than the desktop-first local workflow.
