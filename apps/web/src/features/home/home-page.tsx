import { useMemo, useRef, useState } from 'react';

import type { CourseMode } from '@learning-more/contracts';

import {
  courseAuthoringClient,
  type CourseAuthoringClient,
} from '../../client/course-authoring-client.js';
import { getPageInstanceId } from '../../state/page-instance.js';
import { CourseModeSelector } from '../course-authoring/course-mode-selector.js';

export type HomeLessonCandidate = Readonly<{
  courseId: string;
  lessonId: string;
  progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
  sessionId?: string;
  recommended?: boolean;
}>;

export function selectContinueTarget(
  lessons: readonly HomeLessonCandidate[],
): HomeLessonCandidate | undefined {
  return (
    lessons.find((lesson) => lesson.progress === 'in_progress' && lesson.sessionId !== undefined) ??
    lessons.find((lesson) => lesson.progress === 'not_started' && lesson.recommended === true)
  );
}

export function HomePage(props: {
  readonly client?: CourseAuthoringClient;
  readonly onNavigate: (path: string) => void;
  readonly lessons?: readonly HomeLessonCandidate[];
  readonly draftSessions?: readonly Readonly<{ outlineSessionId: string; topic: string }>[];
  readonly courses?: readonly Readonly<{ courseId: string; title: string }>[];
  readonly notice?: string;
}) {
  const api = props.client ?? courseAuthoringClient;
  const pageInstanceId = useMemo(getPageInstanceId, []);
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<CourseMode>('standard');
  const [materialName, setMaterialName] = useState<string>();
  const inFlight = useRef(false);
  const continueTarget = selectContinueTarget(props.lessons ?? []);
  const drafts = props.draftSessions ?? [];
  const courses = props.courses ?? [];

  const create = async () => {
    if (inFlight.current || topic.trim() === '') return;
    inFlight.current = true;
    try {
      const session = await api.createOutlineSession({
        topic,
        courseMode: mode,
        pageInstanceId,
      });
      props.onNavigate(
        `/courses/new?outlineSessionId=${encodeURIComponent(session.outlineSessionId)}`,
      );
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <main className="home-page">
      <p className="eyebrow">本地优先学习系统</p>
      <h1>Learning MORE</h1>
      {props.notice === undefined ? null : <p role="status">{props.notice}</p>}
      {continueTarget === undefined ? null : (
        <button
          type="button"
          onClick={() =>
            props.onNavigate(
              `/courses/${continueTarget.courseId}/lessons/${continueTarget.lessonId}`,
            )
          }
        >
          继续学习
        </button>
      )}
      <section aria-label="创建课程">
        <CourseModeSelector
          value={mode}
          onChange={setMode}
          onMaterialSelected={(file) => setMaterialName(file.name)}
        />
        <label>
          学习主题
          <input value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>
        {materialName === undefined ? null : <p>已选择材料：{materialName}</p>}
        <button type="button" disabled={topic.trim() === ''} onClick={() => void create()}>
          开始创建
        </button>
      </section>
      <section aria-label="未确认大纲会话">
        <h2>未确认大纲</h2>
        {drafts.map((draft) => (
          <a
            key={draft.outlineSessionId}
            href={`/courses/new?outlineSessionId=${draft.outlineSessionId}`}
          >
            {draft.topic}
          </a>
        ))}
      </section>
      <section aria-label="正式课程">
        <h2>正式课程</h2>
        {courses.map((course) => (
          <a key={course.courseId} href={`/courses/${course.courseId}`}>
            {course.title}
          </a>
        ))}
      </section>
    </main>
  );
}
