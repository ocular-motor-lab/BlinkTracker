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

const initialSessionForm: SessionFormValues = {
  sessionName: '',
  subjectId: '',
  notes: '',
  sourceType: 'camera',
  cameraDeviceId: '',
  videoFilePath: '',
  outputFolder: getStoredOutputFolder(),
  saveRawVideo: true,
  preferHighResolution: false
};

interface AppState {
  activeTab: AppTab;
  cameras: CameraInfo[];
  sessionForm: SessionFormValues;
  lastCreatedSession: CreateSessionResponse | null;
  analysisSession: LoadedSessionResponse | null;
  cameraPermissionState: 'unknown' | 'granted' | 'denied' | 'unsupported';
  isLoadingCameras: boolean;
  isCreatingSession: boolean;
  errorMessage: string | null;
  successMessage: string | null;
  setActiveTab: (tab: AppTab) => void;
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
  sessionForm: initialSessionForm,
  lastCreatedSession: null,
  analysisSession: null,
  cameraPermissionState: 'unknown',
  isLoadingCameras: false,
  isCreatingSession: false,
  errorMessage: null,
  successMessage: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
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
