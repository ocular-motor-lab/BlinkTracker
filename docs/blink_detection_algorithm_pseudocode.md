# Blink Detection Algorithm Pseudocode

Last updated: 2026-07-28

This document describes the current blink auto-detection logic used by BlinkTracker during Analysis.

The detector looks for a blink-like dip in eyelid opening percentage:

1. The eye is open enough locally.
2. The eyelid-opening trace drops downward.
3. The trace reaches a local minimum.
4. The trace recovers upward.
5. The dip lasts long enough to be physically plausible.
6. Eye landmarks remain visible during the detected event.

The app detects left-eye and right-eye candidates separately first, then merges overlapping left/right detections into one bilateral blink.

Important: the 10-second baseline calibration is not currently used to decide blink start or blink end. The detector uses the recorded session's frame-by-frame eyelid opening trace and a rolling local baseline.

## Input Data

The detector reads `framewise_measurements.csv`.

Important columns include:

- `timestamp_sec`
- `frame_index`
- `left_opening_percent`
- `right_opening_percent`
- `left_opening_px`
- `right_opening_px`
- `left_tracking_confidence`
- `right_tracking_confidence`
- `left_visible`
- `right_visible`

## Main Detection Flow

```text
For each session:

1. Load framewise_measurements.csv.

2. For each eye separately:
   - Run left-eye detection using left_opening_percent and left_visible.
   - Run right-eye detection using right_opening_percent and right_visible.

3. Smooth each eyelid-opening trace:
   smoothed_opening = 3-frame centered median

4. Calculate local opening baseline:
   local_baseline = 31-frame centered rolling 85th percentile

   Plain English:
   The app estimates what "locally open" looks like around each frame
   by looking at nearby frames and using the more-open values.

5. Calculate dip amount:
   dip = local_baseline - smoothed_opening
   raw_dip = local_baseline - raw_opening

6. Find blink candidates for each eye.

7. Merge overlapping left/right blink events into bilateral events.

8. Reject impossible or too-short events.

9. Save accepted events to blink_events.csv.

10. Update blink columns in framewise_measurements.csv.
```

## Candidate Peak Detection

The detector scans each frame and asks whether that frame could be the lowest point of a blink.

```text
For each frame i, excluding the first and last frame:

1. Skip if the eye landmarks are not visible at frame i.

2. Read:
   raw_opening = opening_percent[i]
   smoothed_opening = smoothed_opening[i]
   local_baseline = local_baseline[i]

3. Skip if any required value is missing.

4. Calculate:
   seed_opening = min(raw_opening, smoothed_opening)
   seed_dip = max(raw_dip, smoothed_dip)

5. Define possible candidate types:

   deep_valley:
     seed_opening <= 8%

   relative_valley:
     seed_opening <= seed_threshold
     AND seed_dip >= 20 percentage points
     AND local_baseline >= 30%

   any_drop:
     seed_opening <= 80%
     AND seed_dip >= 15 percentage points

6. Continue only if at least one candidate type is true:
   - deep_valley
   - relative_valley
   - any_drop

7. Require a local minimum:
   raw_opening[i] <= raw_opening[i - 1]
   AND
   raw_opening[i] <= raw_opening[i + 1]

8. Require neighboring landmark visibility:
   visible[i - 1] == 1
   visible[i] == 1
   visible[i + 1] == 1
```

In plain English, the app does not treat every lower value as a blink. It first looks for a local valley in the eyelid-opening trace.

## Recovery Check

For non-deep candidates, the app requires evidence that the eye was more open before and after the dip.

```text
If the candidate is not a deep valley:

1. Calculate recovery target:

   recovery_target =
     min(
       local_baseline - 2,
       max(28, seed_opening + max(5, seed_dip * 0.5))
     )

2. Look backward from the candidate within the allowed time window.

3. Look forward from the candidate within the allowed time window.

4. Accept the candidate only if:
   - before the dip, the eye reached at least recovery_target
   - after the dip, the eye reached at least recovery_target
```

This is why a partial blink is treated as a blink-like shape rather than just a low value. It needs a drop and recovery.

## Beginning And End Detection

The app first finds the peak frame, which is the bottom of the dip. Then it expands outward from that peak to determine the event boundaries.

```text
Given candidate peak frame i:

1. Choose maximum allowed candidate duration:

   If this is a recovered partial-like dip:
     max_candidate_duration = 1.20 seconds
   Else:
     max_candidate_duration = 0.32 seconds

2. Calculate event expansion threshold:

   event_expand_threshold =
     min(
       max(40, partial_seed_threshold),
       seed_opening + max(5, seed_dip * 0.55)
     )

   partial_seed_threshold is currently:
     100 - partial_min_closure_percent
     100 - 20 = 80

3. Start at the peak frame.

4. Expand backward frame by frame while:
   - the previous frame is within max_candidate_duration of the peak
   - the previous smoothed opening is not missing
   - the previous smoothed opening <= event_expand_threshold

5. Stop expanding backward when:
   - the signal rises above event_expand_threshold
   - data is missing
   - the time window would become too long

6. The first frame kept becomes the preliminary blink start.

7. Expand forward frame by frame while:
   - the next frame is within max_candidate_duration of the peak
   - the next smoothed opening is not missing
   - the next smoothed opening <= event_expand_threshold

8. Stop expanding forward using the same stopping rules.

9. The last frame kept becomes the preliminary blink end.

10. If the start and peak are the same frame:
    include one frame before the peak.

11. If the end and peak are the same frame:
    include one frame after the peak.
```

Plain-English definition:

```text
Blink beginning =
the first nearby frame before the valley where the smoothed opening is still below the event threshold.

Blink end =
the last nearby frame after the valley where the smoothed opening is still below the event threshold.
```

## Edge Refinement

After the preliminary start and end are found, the app slightly refines the event edges.

```text
1. Add a small time pad:
   padded_start = start_time - 0.04 seconds
   padded_end = end_time + 0.04 seconds

2. Inside that padded region, calculate:
   combined_opening = minimum of left and right opening percent

3. Keep frames where:
   combined_opening <= edge_threshold

4. edge_threshold =
   max(55, partial_seed_threshold)

   Because partial_seed_threshold is currently 80,
   this currently becomes 80%.

5. The final blink start becomes the first kept frame.

6. The final blink end becomes the last kept frame.
```

This can make the saved blink interval slightly wider than the exact lowest part of the dip.

## Candidate Rejection

A candidate is rejected and not saved as a real blink if:

```text
1. Any frame in the candidate segment has missing eye landmarks.

2. The start frame equals the end frame.
   This prevents impossible same-frame blinks.

3. The event duration is shorter than 0.03 seconds.

4. The event duration is longer than the allowed duration:
   - usually more than 0.32 seconds
   - more than 1.20 seconds for recovered partial-like dips
```

Rejected candidates are written to `audit_log.json` with the action:

```text
blink_candidates_rejected
```

## Double-Blink Splitting

The app tries to avoid merging two close blinks into one event.

```text
Inside a detected low-opening region:

1. Look for another local valley after the first peak.

2. The second valley must be at least 0.08 seconds later.

3. The eye must reopen to at least 50% between the two valleys.

4. If those rules pass:
   split the first blink before the second valley.
```

This helps detect cases where two blinks occur very close together.

## Left/Right Merge Logic

After detecting left-eye and right-eye events separately, the app merges events that overlap in time.

```text
1. Sort all left and right events by start time.

2. If a left-eye event and right-eye event overlap:
   merge them into one bilateral event.

3. The bilateral event uses:
   start_time = earliest start time from either eye
   end_time = latest end time from either eye

4. For bilateral closure calculation:
   use the average of left and right opening percent.

5. If final merged events overlap:
   trim later events so they start after the previous event ends.
```

## Blink Classification

Detection and classification are separate.

Detection answers:

```text
Is this dip a blink-like event?
```

Classification answers:

```text
How much did the eyelid close during that detected event?
```

For each accepted blink:

```text
1. Find the peak frame:
   the frame with the minimum opening percent inside the blink segment.

2. Calculate local open-eye reference:
   local_reference = 85th percentile of opening percent inside that blink segment

3. Calculate peak closure:

   peak_closure_percent =
     ((local_reference - minimum_opening_percent) / local_reference) * 100

4. Classify:

   If peak_closure_percent > 75:
     Complete

   If peak_closure_percent >= 20 and < 75:
     Partial

   If peak_closure_percent < 20 or cannot be calculated:
     below threshold / no label
```

Duration does not classify Complete vs Partial. Duration only helps decide whether a candidate is physically plausible enough to save as a blink.

## Quality Flags

The app can save review flags for blink candidates.

### Low Confidence

```text
If average tracking confidence inside the blink event < 0.45:
  add quality_flag = low_confidence
```

This usually means the landmarks may have been less reliable because of lighting, blur, face angle, or the eyes being partly out of frame.

### Possible Gaze Or Downward Look

This flag does not delete the blink. It marks the candidate for human review.

```text
Calculate:
  closing_velocity = peak_closure_percent / closing_time_ms
  opening_velocity = peak_closure_percent / opening_time_ms

Flag possible_gaze_or_downward_look if:

1. Event duration >= 0.35 seconds
   AND closing_velocity < 0.20 %/ms

OR

2. Event duration >= 0.35 seconds
   AND opening_velocity < 0.20 %/ms

OR

3. The final opening does not recover close enough to the local open-eye reference.
```

This helps reviewers notice slower, gaze-like dips that may not be true blinks.

## Summary

In simplest terms:

```text
The app detects blinks by finding local valleys in eyelid-opening percentage.

The beginning is found by walking backward from the valley until the trace rises above the event threshold.

The end is found by walking forward from the valley until the trace rises above the event threshold.

The candidate must have visible landmarks, enough drop, recovery evidence, and a realistic duration.

After detection, the app classifies the blink by peak closure amount:
  Complete: > 75%
  Partial: 20% to under 75%
```
