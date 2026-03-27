interface StatusBannerProps {
  tone: 'error' | 'success' | 'info';
  message: string;
}

export const StatusBanner = ({ tone, message }: StatusBannerProps): JSX.Element => {
  return <div className={`status-banner ${tone}`}>{message}</div>;
};

