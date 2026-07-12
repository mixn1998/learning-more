import { useState } from 'react';

import type { PlanFlowPreviewView } from '../../client/planning-client.js';

export function PlanFlowPanel(props: {
  readonly onPreview: (
    courseIds: readonly string[],
    lessonIds: readonly string[],
  ) => Promise<PlanFlowPreviewView>;
  readonly onConfirm: (flow: PlanFlowPreviewView) => Promise<void>;
}) {
  const [courseIds, setCourseIds] = useState('');
  const [lessonIds, setLessonIds] = useState('');
  const [preview, setPreview] = useState<PlanFlowPreviewView>();
  const [error, setError] = useState<string>();
  const values = (input: string) =>
    input
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  return (
    <section className="authoring-panel">
      <h2>计划流</h2>
      <label>
        计划课程 ID
        <input value={courseIds} onChange={(event) => setCourseIds(event.target.value)} />
      </label>
      <label>
        计划课节 ID
        <input value={lessonIds} onChange={(event) => setLessonIds(event.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => {
          setError(undefined);
          void props
            .onPreview(values(courseIds), values(lessonIds))
            .then(setPreview, () => setError('预览生成失败，输入约束已保留'));
        }}
      >
        生成计划预览
      </button>
      {preview === undefined ? null : (
        <div>
          <p>预览不会修改正式排期</p>
          {preview.conflicts.length > 0 ? (
            <p role="alert">冲突：{preview.conflicts.join(', ')}</p>
          ) : null}
          <ul>
            {preview.suggestions.map((item) => (
              <li key={`${item.lessonId}:${item.startAt}`}>
                {item.lessonId} · {item.startAt} · {item.explanation}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              void props.onConfirm(preview).catch(() => setError('排期版本已变化，请重新预览'))
            }
          >
            确认计划流
          </button>
        </div>
      )}
      {error === undefined ? null : <p role="alert">{error}</p>}
    </section>
  );
}
