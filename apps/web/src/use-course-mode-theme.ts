import { useEffect } from 'react';

import type { CourseMode } from '@learning-more/contracts';

import { courseModeDefinition } from './course-mode-registry.js';

const themeProperties = [
  '--accent',
  '--accent-dark',
  '--tint',
  '--lm-accent',
  '--lm-accent-dark',
  '--lm-tint',
] as const;

/** Applies one course-mode identity to both the approved sample tokens and UI package tokens. */
export function useCourseModeTheme(mode: CourseMode) {
  const definition = courseModeDefinition(mode);

  useEffect(() => {
    const root = document.documentElement;
    const values = [
      definition.accent,
      definition.accentDark,
      definition.tint,
      definition.accent,
      definition.accentDark,
      definition.tint,
    ] as const;
    const previous = themeProperties.map(
      (property) => [property, root.style.getPropertyValue(property)] as const,
    );
    const previousMode = root.dataset.courseMode;

    themeProperties.forEach((property, index) => root.style.setProperty(property, values[index]!));
    root.dataset.courseMode = mode;

    return () => {
      previous.forEach(([property, value]) => {
        if (value === '') root.style.removeProperty(property);
        else root.style.setProperty(property, value);
      });
      if (previousMode === undefined) delete root.dataset.courseMode;
      else root.dataset.courseMode = previousMode;
    };
  }, [definition, mode]);

  return definition;
}
