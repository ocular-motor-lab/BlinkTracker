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
