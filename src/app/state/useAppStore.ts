import { create } from 'zustand';
import type {
  AppTab,
  CameraInfo,
  CreateSessionRequest,
  CreateSessionResponse,
  LoadedSessionResponse,
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
    return {
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
  } catch {
    return defaultPreferences;
  }
};

const buildInitialSessionForm = (preferences: AppPreferences): SessionFormValues => ({
  sessionName: '',
  subjectId: '',
  notes: '',
  sourceType: preferences.defaultSourceType,
  cameraDeviceId: '',
  videoFilePath: '',
  outputFolder: getStoredOutputFolder(),
  saveRawVideo: preferences.defaultSaveRawVideo,
  preferHighResolution: preferences.defaultPreferHighResolution
});

const initialPreferences = getStoredPreferences();
const initialSessionForm: SessionFormValues = buildInitialSessionForm(initialPreferences);

interface AppState {
  activeTab: AppTab;
  cameras: CameraInfo[];
  preferences: AppPreferences;
  sessionForm: SessionFormValues;
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
  clearRememberedOutputFolder: () => void;
  setSessionFormValue: <K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) => void;
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
  activeTab: 'session',
  cameras: [],
  preferences: initialPreferences,
  sessionForm: initialSessionForm,
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
