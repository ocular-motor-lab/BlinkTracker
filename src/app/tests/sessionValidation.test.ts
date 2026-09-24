import { describe, expect, it } from 'vitest';
import type { SessionFormValues } from '@ipc/schemas';
import { validateSessionForm } from '@app/utils/validation';

const buildSessionForm = (overrides: Partial<SessionFormValues>): SessionFormValues => ({
  sessionName: 'demo',
  sessionDate: '2026-06-25',
  subjectId: '',
  subjectAge: '',
  subjectSex: '',
  subjectRaceEthnicity: '',
  notes: '',
  diagnosedDryEye: '',
  usesEyeDrops: '',
  eyeDropsDetails: '',
  eyeDropsLastTwoHours: '',
  wearsContactLenses: '',
  contactLensType: '',
  wornContactsToday: '',
  wearingContactLensesNow: '',
  wearsGlasses: '',
  wearingGlassesToday: '',
  recentEyeSurgery: '',
  eyeSurgeryDetails: '',
  eyeAllergies: '',
  eyeAllergyDetails: '',
  symptomDryness: '',
  symptomTiredness: '',
  symptomBurningStinging: '',
  symptomBlurryVision: '',
  symptomLightSensitivity: '',
  sleepHours: '',
  consumedCaffeine: '',
  caffeineTiming: '',
  consumedAlcohol24h: '',
  alertnessEyeMeds: '',
  feelingSick: '',
  stressLevel: '',
  energyLevel: '',
  screenReadingDurationToday: '',
  priorAirConditioningHeating: '',
  priorWindSun: '',
  dryEnvironmentToday: '',
  roomTemperature: '',
  deviceUsed: '',
  screenBrightness: '',
  viewingDistanceCm: '',
  currentEmotion: '',
  calibrationReminderAcknowledged: false,
  restingPalpebralAperture: '',
  calibrationFrameRows: [],
  calibrationSummary: null,
  sourceType: 'camera',
  cameraDeviceId: '',
  cameraMode: '',
  videoFilePath: '',
  outputFolder: '/tmp/session-output',
  saveRawVideo: true,
  preferHighResolution: false,
  ...overrides
});

describe('validateSessionForm', () => {
  it('requires a camera for live mode', () => {
    const errors = validateSessionForm(buildSessionForm({ sourceType: 'camera', cameraDeviceId: '' }));

    expect(errors).toContain('Select a camera before creating a session.');
  });

  it('accepts a valid video file session', () => {
    const errors = validateSessionForm(buildSessionForm({
      sourceType: 'video_file',
      videoFilePath: '/tmp/demo.mp4',
      saveRawVideo: false
    }));

    expect(errors).toHaveLength(0);
  });
});
