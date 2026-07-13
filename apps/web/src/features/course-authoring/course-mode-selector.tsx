import type { CourseMode } from '@learning-more/contracts';

import { COURSE_MODE_REGISTRY } from '../../course-mode-registry.js';

export function CourseModeSelector(props: {
  readonly value: CourseMode;
  readonly onChange: (mode: CourseMode) => void;
  readonly onMaterialSelected?: (file: File) => void;
}) {
  return (
    <fieldset className="course-mode-grid">
      <legend>课程模式</legend>
      {COURSE_MODE_REGISTRY.map((mode) => (
        <label key={mode.id} data-course-mode={mode.id} style={{ borderColor: mode.accent }}>
          <input
            type="radio"
            name="course-mode"
            value={mode.id}
            checked={props.value === mode.id}
            onChange={() => props.onChange(mode.id)}
          />
          <strong>{mode.label}</strong>
          <span>{mode.prompt}</span>
        </label>
      ))}
      {props.value === 'reading_seminar' ? (
        <label>
          学习材料
          <input
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file !== undefined) props.onMaterialSelected?.(file);
            }}
          />
        </label>
      ) : null}
    </fieldset>
  );
}
