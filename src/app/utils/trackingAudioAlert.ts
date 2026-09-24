import type { FrameProbeResponse } from '@ipc/schemas';

type TrackingAlertReason = NonNullable<FrameProbeResponse['trackingAlertReason']>;

const ALERT_PERSIST_MS = 800;
const ALERT_COOLDOWN_MS = 3500;

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export const trackingAlertMessage = (reason: TrackingAlertReason): string => {
  switch (reason) {
    case 'no_face':
      return 'No face is currently detected. Bring the subject back into frame.';
    case 'low_confidence':
      return 'Tracking confidence is limited. Improve lighting or reposition the subject.';
    case 'out_of_frame':
      return 'The face is too close to the edge of the camera frame.';
    case 'too_far':
      return 'The subject appears too far from the camera for reliable landmarks.';
    case 'moving_too_much':
      return 'The subject is moving too much for stable landmark tracking.';
  }
};

export const createTrackingAudioAlertController = () => {
  let audioContext: AudioContext | null = null;
  let currentReason: TrackingAlertReason | null = null;
  let issueStartedAt = 0;
  let lastAlertAt = 0;

  const playTone = () => {
    const AudioCtor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioCtor) {
      return;
    }

    audioContext ??= new AudioCtor();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
  };

  return {
    reset: () => {
      currentReason = null;
      issueStartedAt = 0;
    },
    maybeAlert: (reason: TrackingAlertReason | undefined, active: boolean) => {
      if (!active || !reason) {
        currentReason = null;
        issueStartedAt = 0;
        return;
      }

      const now = performance.now();
      if (reason !== currentReason) {
        currentReason = reason;
        issueStartedAt = now;
        return;
      }

      if (now - issueStartedAt < ALERT_PERSIST_MS || now - lastAlertAt < ALERT_COOLDOWN_MS) {
        return;
      }

      lastAlertAt = now;
      playTone();
    }
  };
};
