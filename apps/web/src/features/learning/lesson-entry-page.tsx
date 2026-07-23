import { useEffect, useState } from 'react';

import { ContentState } from '@learning-more/ui';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { AbandonedLessonRecord } from './abandoned-lesson-record.js';
import { toKnowledgePointPresentation } from './knowledge-point-presentation.js';
import { LessonNavigationWorkspace } from './lesson-navigation-workspace.js';
import { SessionPage } from './session-page.js';

export function LessonEntryPage(props: {
  readonly lessonId: string;
  readonly client?: LearningClient;
  readonly onNavigate?: (path: string) => void;
}) {
  const api = props.client ?? learningClient;
  const [preview, setPreview] = useState<Awaited<ReturnType<LearningClient['getLessonPreview']>>>();
  const [lessonState, setLessonState] =
    useState<Awaited<ReturnType<LearningClient['getLessonState']>>>();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);
  const [courseTitle, setCourseTitle] = useState('当前课程');

  useEffect(() => {
    void Promise.all([
      api.getLessonPreview(props.lessonId),
      api.getLessonState(props.lessonId),
    ]).then(
      ([nextPreview, nextState]) => {
        setPreview(nextPreview);
        setLessonState(nextState);
        if (typeof api.getCourse === 'function') {
          void api.getCourse(nextPreview.courseId).then(
            (course) => setCourseTitle(course.title),
            () => setCourseTitle('当前课程'),
          );
        }
      },
      () => setError(true),
    );
  }, [api, props.lessonId]);

  useEffect(() => {
    if (preview?.teachingWeightStatus !== 'pending') return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = () => {
      timer = window.setTimeout(() => {
        void api.getLessonPreview(props.lessonId).then(
          (nextPreview) => {
            if (cancelled) return;
            setPreview(nextPreview);
            if (nextPreview.teachingWeightStatus === 'pending') refresh();
          },
          () => {
            if (!cancelled) refresh();
          },
        );
      }, 1_000);
    };
    refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, preview?.teachingWeightStatus, props.lessonId]);

  if (started && preview !== undefined) {
    return (
      <SessionPage
        client={api}
        autoOpen
        courseId={preview.courseId}
        courseTitle={courseTitle}
        knowledgePoints={preview.coreKnowledgePoints}
        lessonId={props.lessonId}
        moduleLabel="正式课程课节"
        outlineVersionLabel="大纲 v1"
        title={preview.title}
        {...(props.onNavigate === undefined ? {} : { onNavigate: props.onNavigate })}
      />
    );
  }
  if (error) return <ContentState title="课节暂时不可用" role="alert" />;
  if (preview === undefined || lessonState === undefined) {
    return <ContentState title="正在读取课节大纲…" />;
  }
  if (lessonState.progress === 'abandoned') {
    return (
      <AbandonedLessonRecord
        courseTitle={courseTitle}
        learnedPoints={[]}
        remainingPoints={preview.coreKnowledgePoints}
        title={preview.title}
        {...(lessonState.stageReviewMarkdown === undefined
          ? {}
          : { stageReviewMarkdown: lessonState.stageReviewMarkdown })}
        {...(lessonState.stageReviewStatus === undefined
          ? {}
          : { stageReviewStatus: lessonState.stageReviewStatus })}
        onBackHome={() => props.onNavigate?.('/')}
        onBackToOutline={() => props.onNavigate?.(`/courses/${preview.courseId}`)}
        onRestore={() => {
          void api.restore(props.lessonId, lessonState.resourceVersion).then((restored) => {
            setLessonState({
              lessonId: props.lessonId,
              progress: restored.progress,
              resourceVersion: restored.resourceVersion,
            });
            setStarted(restored.progress === 'in_progress');
          });
        }}
        onViewRecord={() =>
          props.onNavigate?.(`/courses/${preview.courseId}/lessons/${preview.lessonId}/record`)
        }
      />
    );
  }
  return (
    <LessonNavigationWorkspace
      courseTitle={courseTitle}
      moduleLabel="正式课程课节"
      points={preview.coreKnowledgePoints.map((point, index) => {
        const presentation = toKnowledgePointPresentation(point);
        return {
          marker: String(index + 1).padStart(2, '0'),
          title: presentation.title,
          ...(preview.knowledgePointWeights?.[index] === 'key' ? { emphasis: 'key' as const } : {}),
        };
      })}
      primaryLabel={
        lessonState.progress === 'completed'
          ? '查看课节记录'
          : lessonState.progress === 'in_progress'
            ? '继续学习'
            : '开始学习'
      }
      state="not_started"
      title={preview.title}
      onBackHome={() => props.onNavigate?.('/')}
      onBackToOutline={() => props.onNavigate?.(`/courses/${preview.courseId}`)}
      onPrimary={() => {
        if (lessonState.progress === 'completed') {
          props.onNavigate?.(`/courses/${preview.courseId}/lessons/${preview.lessonId}/record`);
          return;
        }
        setStarted(true);
      }}
    />
  );
}
