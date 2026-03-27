import { useEffect } from 'react';
import { useAppStore } from '@app/state/useAppStore';
import type { CameraInfo } from '@ipc/schemas';

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
      const [cameras, browserDevices] = await Promise.all([
        window.electronAPI.listCameras(),
        enumerateBrowserVideoDevices()
      ]);
      const mergedCameras = mergeCameraSources(cameras, browserDevices);
      setCameras(mergedCameras);

      const firstAvailable = mergedCameras.find((camera) => camera.available || camera.browserDeviceId);
      if (firstAvailable) {
        setSessionFormValue('cameraDeviceId', firstAvailable.deviceId);
      } else if (mergedCameras[0]) {
        setSessionFormValue('cameraDeviceId', mergedCameras[0].deviceId);
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
