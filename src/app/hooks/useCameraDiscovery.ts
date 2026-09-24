import { useEffect } from 'react';
import { useAppStore } from '@app/state/useAppStore';
import type { CameraInfo } from '@ipc/schemas';

const DEFAULT_CAMERA_MODES: CameraInfo['modes'] = [
  { width: 640, height: 480, fps: 30 },
  { width: 1280, height: 720, fps: 30 },
  { width: 1920, height: 1080, fps: 60 }
];

export const useCameraDiscovery = (): (() => Promise<void>) => {
  const setCameras = useAppStore((state) => state.setCameras);
  const setCameraPermissionState = useAppStore((state) => state.setCameraPermissionState);
  const setIsLoadingCameras = useAppStore((state) => state.setIsLoadingCameras);
  const setErrorMessage = useAppStore((state) => state.setErrorMessage);
  const setSessionFormValue = useAppStore((state) => state.setSessionFormValue);

  const requestCameraPermission = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraPermissionState('unsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermissionState('granted');
    } catch (error) {
      setCameraPermissionState('denied');
      throw error;
    }
  };

  const enumerateBrowserVideoDevices = async (): Promise<MediaDeviceInfo[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput');
  };

  const describeCameraSource = (label: string, index: number): string => {
    const normalized = label.toLowerCase();

    if (/(obs|virtual|snap camera|manycam|xsplit|ndi)/.test(normalized)) {
      return 'Virtual camera';
    }

    if (/(built.?in|integrated|internal|facetime|front|laptop)/.test(normalized)) {
      return 'Built-in laptop camera';
    }

    if (/(usb|external|logitech|elgato|capture|webcam|sony|brio|c920|hd camera)/.test(normalized)) {
      return 'USB / external camera';
    }

    return index === 0 ? 'Default camera' : 'Unknown camera source';
  };

  const cleanCameraLabel = (label: string): string =>
    label
      .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const buildCameraLabel = (camera: Pick<CameraInfo, 'label'>, index: number, matchedDevice?: MediaDeviceInfo): string => {
    const browserLabel = matchedDevice?.label.trim();
    const baseLabel = cleanCameraLabel(browserLabel || camera.label);
    const source = describeCameraSource(baseLabel, index);

    return `${source} ${index + 1} - ${baseLabel}`;
  };

  const browserCameraSources = (browserDevices: MediaDeviceInfo[]): CameraInfo[] =>
    browserDevices.map((device, index) => {
      const fallbackLabel = device.label || `Camera ${index + 1}`;
      return {
        deviceId: device.deviceId || `browser-camera-${index}`,
        label: buildCameraLabel({ label: fallbackLabel }, index, device),
        index,
        available: true,
        browserDeviceId: device.deviceId,
        modes: DEFAULT_CAMERA_MODES
      };
    });

  const mergeCameraSources = (backendCameras: CameraInfo[], browserDevices: MediaDeviceInfo[]): CameraInfo[] => {
    const browserByLabel = new Map(
      browserDevices
        .filter((device) => device.label)
        .map((device) => [device.label.toLowerCase(), device])
    );

    const unusedBrowserDevices = [...browserDevices];

    return backendCameras.map((camera, index) => {
      const matchedByLabel = browserByLabel.get(camera.label.toLowerCase());
      let matchedDevice = matchedByLabel;

      if (!matchedDevice) {
        matchedDevice = unusedBrowserDevices[index];
      }

      if (matchedDevice) {
        const deviceIndex = unusedBrowserDevices.findIndex((device) => device.deviceId === matchedDevice?.deviceId);
        if (deviceIndex >= 0) {
          unusedBrowserDevices.splice(deviceIndex, 1);
        }
      }

      return {
        ...camera,
        label: buildCameraLabel(camera, index, matchedDevice),
        browserDeviceId: matchedDevice?.deviceId
      };
    });
  };

  const load = async (): Promise<void> => {
    if (!window.electronAPI) {
      setErrorMessage('Electron preload API unavailable. Run inside the desktop shell to enumerate cameras.');
      return;
    }

    setIsLoadingCameras(true);
    setErrorMessage(null);

    try {
      await requestCameraPermission();
      const browserDevices = await enumerateBrowserVideoDevices();
      const discoveredCameras =
        browserDevices.length > 0
          ? browserCameraSources(browserDevices)
          : mergeCameraSources(await window.electronAPI.listCameras(), browserDevices);

      setCameras(discoveredCameras);

      const firstAvailable = discoveredCameras.find((camera) => camera.available || camera.browserDeviceId);
      if (firstAvailable) {
        setSessionFormValue('cameraDeviceId', firstAvailable.deviceId);
        setSessionFormValue('cameraMode', '');
      } else if (discoveredCameras[0]) {
        setSessionFormValue('cameraDeviceId', discoveredCameras[0].deviceId);
        setSessionFormValue('cameraMode', '');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to enumerate cameras.');
    } finally {
      setIsLoadingCameras(false);
    }
  };

  useEffect(() => {
    void load();

  }, [setCameraPermissionState, setCameras, setErrorMessage, setIsLoadingCameras, setSessionFormValue]);

  return load;
};
