import type { ReactElement } from 'react';

export type AiSurfaceContent = ReactElement | readonly AiSurfaceContent[];

export function AiSurface(props: {
  readonly children: AiSurfaceContent;
  readonly className?: string;
}) {
  const className = ['lm-ai-surface', props.className].filter(Boolean).join(' ');
  return (
    <div className={className} data-ai-surface="true">
      {props.children}
    </div>
  );
}
