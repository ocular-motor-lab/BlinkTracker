import { create } from 'zustand';
import type {
  AppTab,
  CameraInfo,
  CreateSessionRequest,
  CreateSessionResponse,
  LoadedSessionResponse,
  PostSessionFormValues,
  SessionFormValues
} from '@ipc/schemas';

const LAST_OUTPUT_FOLDER_KEY = 'blink-tracker:last-output-folder';
const APP_PREFERENCES_KEY = 'blink-tracker:preferences';

type SourceType = SessionFormValues['sourceType'];

export interface AppPreferences {
  defaultSourceType: SourceType;
  defaultSaveRawVideo: boolean;
  defaultPreferHighResolution: boolean;
}

const defaultPreferences: AppPreferences = {
  defaultSourceType: 'camera',
  defaultSaveRawVideo: true,
  defaultPreferHighResolution: false
};

const getStoredOutputFolder = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(LAST_OUTPUT_FOLDER_KEY) ?? '';
  } catch {
    return '';
  }
};

const getStoredPreferences = (): AppPreferences => {
  if (typeof window === 'undefined') {
    return defaultPreferences;
  }

  try {
    const raw = window.localStorage.getItem(APP_PREFERENCES_KEY);
    if (!raw) {
      return defaultPreferences;
    }
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    const preferences = {
      defaultSourceType:
        parsed.defaultSourceType === 'video_file' ? 'video_file' : defaultPreferences.defaultSourceType,
      defaultSaveRawVideo:
        typeof parsed.defaultSaveRawVideo === 'boolean'
          ? parsed.defaultSaveRawVideo
          : defaultPreferences.defaultSaveRawVideo,
      defaultPreferHighResolution:
        typeof parsed.defaultPreferHighResolution === 'boolean'
          ? parsed.defaultPreferHighResolution
          : defaultPreferences.defaultPreferHighResolution
    };

    try {
      window.localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore storage failures and keep the in-memory value.
    }

    return preferences;
  } catch {
    return defaultPreferences;
  }
};

const buildInitialSessionForm = (preferences: AppPreferences): SessionFormValues => ({
  sessionName: '',
  sessionDate: new Date().toISOString().slice(0, 10),
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
  sourceType: preferences.defaultSourceType,
  cameraDeviceId: '',
  cameraMode: '',
  videoFilePath: '',
  outputFolder: getStoredOutputFolder(),
  saveRawVideo: preferences.defaultSaveRawVideo,
  preferHighResolution: preferences.defaultPreferHighResolution
});

const initialPreferences = getStoredPreferences();
const initialSessionForm: SessionFormValues = buildInitialSessionForm(initialPreferences);

const defaultPostSessionForm: PostSessionFormValues = {
  postSessionContext: 'reading',
  postSymptomDryness: '',
  postSymptomTiredness: '',
  postSymptomBurningStinging: '',
  postSymptomBlurryVision: '',
  postSymptomLightSensitivity: '',
  symptomsDuringReading: '',
  symptomsDuringReadingTiming: '',
  readingEyeComfort: '',
  discomfortIncreased: '',
  urgeRubEyes: '',
  urgeLookAway: '',
  urgeBlinkMore: '',
  eyePressureHeaviness: '',
  visionClearThroughout: '',
  textHarderToFocus: '',
  textHarderToFocusTiming: '',
  headacheDuringAfter: '',
  concentrationEase: '',
  mentalFatigueEnd: '',
  physicalFatigueEnd: '',
  distractedDuringSession: '',
  distractionDetails: '',
  screenBrightnessComfort: '',
  roomLightingComfort: '',
  fontSizeComfort: '',
  viewingDistanceComfort: '',
  roomTemperatureComfort: '',
  baselineVideoComfort: '',
  baselineVideoEyeStrain: '',
  baselineVideoMotionDiscomfort: '',
  baselineVideoNotes: ''
};

interface AppState {
  activeTab: AppTab;
  cameras: CameraInfo[];
  preferences: AppPreferences;
  sessionForm: SessionFormValues;
  postSessionForm: PostSessionFormValues;
  lastCreatedSession: CreateSessionResponse | null;
  analysisSession: LoadedSessionResponse | null;
  cameraPermissionState: 'unknown' | 'granted' | 'denied' | 'unsupported';
  isLoadingCameras: boolean;
  isCreatingSession: boolean;
  errorMessage: string | null;
  successMessage: string | null;
  setActiveTab: (tab: AppTab) => void;
  setPreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
  resetSessionForm: () => void;
  resetPostSessionForm: () => void;
  clearRememberedOutputFolder: () => void;
  setSessionFormValue: <K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) => void;
  setPostSessionForm: (values: Partial<PostSessionFormValues>) => void;
  setPostSessionFormValue: <K extends keyof PostSessionFormValues>(key: K, value: PostSessionFormValues[K]) => void;
  setCameras: (cameras: CameraInfo[]) => void;
  setCameraPermissionState: (value: 'unknown' | 'granted' | 'denied' | 'unsupported') => void;
  setIsLoadingCameras: (value: boolean) => void;
  setIsCreatingSession: (value: boolean) => void;
  setLastCreatedSession: (session: CreateSessionResponse | null) => void;
  setAnalysisSession: (session: LoadedSessionResponse | null) => void;
  setErrorMessage: (value: string | null) => void;
  setSuccessMessage: (value: string | null) => void;
  toCreateSessionPayload: () => CreateSessionRequest;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeTab: 'preSession',
  cameras: [],
  preferences: initialPreferences,
  sessionForm: initialSessionForm,
  postSessionForm: defaultPostSessionForm,
  lastCreatedSession: null,
  analysisSession: null,
  cameraPermissionState: 'unknown',
  isLoadingCameras: false,
  isCreatingSession: false,
  errorMessage: null,
  successMessage: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setPreference: (key, value) =>
    set((state) => {
      const preferences = {
        ...state.preferences,
        [key]: value
      };
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(preferences));
        } catch {
          // Ignore storage failures and keep the in-memory value.
        }
      }

      const nextSessionForm = { ...state.sessionForm };
      if (key === 'defaultSourceType') {
        nextSessionForm.sourceType = value as SourceType;
      }
      if (key === 'defaultSaveRawVideo') {
        nextSessionForm.saveRawVideo = value as boolean;
      }
      if (key === 'defaultPreferHighResolution') {
        nextSessionForm.preferHighResolution = value as boolean;
      }

      return {
        preferences,
        sessionForm: nextSessionForm
      };
    }),
  resetSessionForm: () =>
    set((state) => ({
      sessionForm: buildInitialSessionForm(state.preferences)
    })),
  resetPostSessionForm: () => set({ postSessionForm: defaultPostSessionForm }),
  clearRememberedOutputFolder: () =>
    set((state) => {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(LAST_OUTPUT_FOLDER_KEY);
        } catch {
          // Ignore storage failures and keep the in-memory value.
        }
      }

      return {
        sessionForm: {
          ...state.sessionForm,
          outputFolder: ''
        }
      };
    }),
  setSessionFormValue: (key, value) =>
    set((state) => {
      if (key === 'outputFolder' && typeof value === 'string' && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(LAST_OUTPUT_FOLDER_KEY, value);
        } catch {
          // Ignore storage failures and keep the in-memory value.
        }
      }

      return {
        sessionForm: {
          ...state.sessionForm,
          [key]: value
        }
      };
    }),
  setPostSessionForm: (values) =>
    set((state) => ({
      postSessionForm: {
        ...state.postSessionForm,
        ...values
      }
    })),
  setPostSessionFormValue: (key, value) =>
    set((state) => ({
      postSessionForm: {
        ...state.postSessionForm,
        [key]: value
      }
    })),
  setCameras: (cameras) => set({ cameras }),
  setCameraPermissionState: (value) => set({ cameraPermissionState: value }),
  setIsLoadingCameras: (value) => set({ isLoadingCameras: value }),
  setIsCreatingSession: (value) => set({ isCreatingSession: value }),
  setLastCreatedSession: (session) => set({ lastCreatedSession: session }),
  setAnalysisSession: (session) => set({ analysisSession: session }),
  setErrorMessage: (value) => set({ errorMessage: value }),
  setSuccessMessage: (value) => set({ successMessage: value }),
  toCreateSessionPayload: () => {
    const { sessionForm, cameras } = get();
    const preferredCameraLabel =
      cameras.find((camera) => camera.deviceId === sessionForm.cameraDeviceId)?.label ?? '';

    return {
      ...sessionForm,
      preferredCameraLabel
    };
  }
}));
