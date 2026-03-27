import type { ElectronApi } from '@ipc/schemas';

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};

