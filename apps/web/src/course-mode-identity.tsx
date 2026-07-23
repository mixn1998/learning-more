import type { ReactNode } from 'react';

import type { CourseMode } from '@learning-more/contracts';

import { courseModeDefinition } from './course-mode-registry.js';

export function CourseModeIdentity(props: {
  readonly mode: CourseMode;
  readonly context: 'authoring' | 'learning' | 'review' | 'history';
  readonly status?: 'success' | 'warning' | 'error' | 'abandoned' | 'readonly';
  readonly children?: ReactNode;
}) {
  const definition = courseModeDefinition(props.mode);
  return (
    <section
      data-course-mode={props.mode}
      data-course-context={props.context}
      {...(props.status === undefined ? {} : { 'data-semantic-status': props.status })}
      style={{ borderInlineStart: `4px solid ${definition.accent}` }}
    >
      <span>{definition.shortLabel}</span>
      {props.children}
    </section>
  );
}
