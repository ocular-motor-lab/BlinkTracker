import type { AppTab } from '@ipc/schemas';

type PlaceholderTab = Exclude<
  AppTab,
  'preSession' | 'session' | 'acquire' | 'postSession' | 'database' | 'analysis' | 'compare' | 'settings'
>;

const COPY: Record<PlaceholderTab, { title: string; detail: string }> = {
  export: {
    title: 'Export panel placeholder',
    detail: 'Final CSV and metadata export actions will appear here once processing outputs exist.'
  }
};

export const PlaceholderPage = ({ tab }: { tab: PlaceholderTab }): JSX.Element => {
  const copy = COPY[tab];
  return (
    <section className="placeholder-card">
      <h3>{copy.title}</h3>
      <p>{copy.detail}</p>
    </section>
  );
};
