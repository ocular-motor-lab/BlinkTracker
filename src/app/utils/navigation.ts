import type { AppTab } from '@ipc/schemas';

export const NAV_ITEMS: Array<{ id: AppTab; label: string; description: string }> = [
  { id: 'database', label: 'Database', description: 'Find past sessions.' },
  { id: 'preSession', label: 'Pre-Session', description: 'Enter subject and check-in information.' },
  { id: 'session', label: 'Session', description: 'Set up recording here.' },
  { id: 'acquire', label: 'Recording', description: 'Preview recording and click start.' },
  { id: 'postSession', label: 'Post-Session', description: 'Record after-session feedback.' },
  { id: 'analysis', label: 'Analysis', description: 'Review traces and blink data.' },
  { id: 'compare', label: 'Compare', description: 'Compare two sessions.' },
  { id: 'export', label: 'Export', description: 'Write CSV and metadata outputs.' },
  { id: 'settings', label: 'Settings', description: 'Tune defaults and thresholds.' }
];
