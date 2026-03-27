import type { AppTab } from '@ipc/schemas';

export const NAV_ITEMS: Array<{ id: AppTab; label: string; description: string }> = [
  { id: 'session', label: 'Session', description: 'Configure source and output paths.' },
  { id: 'acquire', label: 'Acquire', description: 'Preview capture and run processing.' },
  { id: 'analysis', label: 'Analysis', description: 'Review traces and blink intervals.' },
  { id: 'export', label: 'Export', description: 'Write CSV and metadata outputs.' },
  { id: 'settings', label: 'Settings', description: 'Tune defaults and thresholds.' }
];

