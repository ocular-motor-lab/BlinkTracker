import type { AppTab } from '@ipc/schemas';

const COPY: Record<Exclude<AppTab, 'session'>, { title: string; detail: string }> = {
  acquire: {
    title: 'Acquisition pipeline scaffolded',
    detail: 'Milestone 2 will attach live preview, timestamps, and backend frame processing here.'
  },
  analysis: {
    title: 'Analysis workspace reserved',
    detail: 'Milestones 5 and 6 will add synchronized video, traces, blink detection, and manual editing.'
  },
  export: {
    title: 'Export panel placeholder',
    detail: 'Final CSV and metadata export actions will appear here once processing outputs exist.'
  },
  settings: {
    title: 'Settings scaffold',
    detail: 'Thresholds, smoothing defaults, and trace preferences will be added in later milestones.'
  }
};

export const PlaceholderPage = ({ tab }: { tab: Exclude<AppTab, 'session'> }): JSX.Element => {
  const copy = COPY[tab];
  return (
    <section className="placeholder-card">
      <h3>{copy.title}</h3>
      <p>{copy.detail}</p>
    </section>
  );
};

