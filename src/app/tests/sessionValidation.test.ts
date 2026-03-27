import { describe, expect, it } from 'vitest';
import { validateSessionForm } from '@app/utils/validation';

describe('validateSessionForm', () => {
  it('requires a camera for live mode', () => {
    const errors = validateSessionForm({
      sessionName: 'demo',
      subjectId: '',
      notes: '',
      sourceType: 'camera',
      cameraDeviceId: '',
      videoFilePath: '',
      outputFolder: '/tmp/session-output',
      saveRawVideo: true,
      preferHighResolution: false
    });

    expect(errors).toContain('Select a camera before creating a session.');
  });

  it('accepts a valid video file session', () => {
    const errors = validateSessionForm({
      sessionName: 'demo',
      subjectId: '',
      notes: '',
      sourceType: 'video_file',
      cameraDeviceId: '',
      videoFilePath: '/tmp/demo.mp4',
      outputFolder: '/tmp/session-output',
      saveRawVideo: false,
      preferHighResolution: false
    });

    expect(errors).toHaveLength(0);
  });
});
