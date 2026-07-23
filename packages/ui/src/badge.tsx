import type { HTMLAttributes } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'readonly';

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { readonly tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={['lm-badge', 'lm-pill', tone === 'neutral' ? undefined : tone, className]
        .filter(Boolean)
        .join(' ')}
      data-tone={tone}
    />
  );
}

export function ModeBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={['lm-mode-badge', className].filter(Boolean).join(' ')}
      data-identity="course-mode"
    />
  );
}

export function ModeIcon({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      aria-hidden={props['aria-label'] === undefined ? true : undefined}
      className={['lm-mode-icon', className].filter(Boolean).join(' ')}
    />
  );
}
