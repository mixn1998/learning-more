import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={['lm-card', className].filter(Boolean).join(' ')} />;
}
