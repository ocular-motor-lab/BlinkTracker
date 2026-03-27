import type { SessionFormValues } from '@ipc/schemas';

export const validateSessionForm = (values: SessionFormValues): string[] => {
  const errors: string[] = [];

  if (!values.sessionName.trim()) {
    errors.push('Session name is required.');
  }

  if (!values.outputFolder.trim()) {
    errors.push('Output folder is required.');
  }

  if (values.sourceType === 'camera' && !values.cameraDeviceId.trim()) {
    errors.push('Select a camera before creating a session.');
  }

  if (values.sourceType === 'video_file' && !values.videoFilePath.trim()) {
    errors.push('Select a video file before creating a session.');
  }

  return errors;
};

