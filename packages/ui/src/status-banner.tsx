export type StatusBannerStatus = 'ready' | 'degraded' | 'rebuilding';

export interface StatusBannerProps {
  readonly status: StatusBannerStatus;
  readonly message?: string;
}

const defaultMessages: Readonly<Record<StatusBannerStatus, string>> = {
  ready: '运行正常',
  degraded: '数据需要修复',
  rebuilding: '数据正在重建',
};

export function StatusBanner({ status, message }: StatusBannerProps) {
  const isAlert = status === 'degraded';
  return (
    <div
      aria-live={isAlert ? 'assertive' : 'polite'}
      data-status={status}
      role={isAlert ? 'alert' : 'status'}
    >
      {message ?? defaultMessages[status]}
    </div>
  );
}
