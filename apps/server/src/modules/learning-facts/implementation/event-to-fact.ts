import type { DataKey, EventType, LearningEventEnvelope } from '@learning-more/contracts';

import type { LearningFact, LearningFactType } from '../interface.js';
import { createLearningFact } from './fact.js';

type Mapping = Readonly<{
  factType: LearningFactType;
  dataKeys: readonly DataKey[];
}>;

const mappings: Partial<Record<EventType, Mapping>> = {
  LessonSessionStarted: {
    factType: 'LessonStartedFact',
    dataKeys: ['lesson.started_at', 'lesson.session_id', 'lesson.lifecycle_status'],
  },
  LessonSessionPaused: {
    factType: 'LessonPausedFact',
    dataKeys: ['lesson.paused_at', 'lesson.session_id', 'lesson.lifecycle_status'],
  },
  LessonAbandoned: {
    factType: 'LessonAbandonedFact',
    dataKeys: ['lesson.abandoned_at', 'lesson.evidence_checkpoint', 'lesson.lifecycle_status'],
  },
  LessonRestored: {
    factType: 'LessonRestoredFact',
    dataKeys: ['lesson.restored_at', 'lesson.session_id', 'lesson.lifecycle_status'],
  },
  LessonSessionCompleted: {
    factType: 'LessonCompletedFact',
    dataKeys: [
      'lesson.completed_at',
      'lesson.session_id',
      'lesson.lifecycle_status',
      'completion.actual_seconds',
      'completion.lesson_id',
      'completion.local_date',
    ],
  },
  CourseCreated: {
    factType: 'CourseCreatedFact',
    dataKeys: ['course.created_at', 'course.id', 'course.mode', 'course.status', 'course.title'],
  },
  CourseClosed: {
    factType: 'CourseClosedFact',
    dataKeys: ['course.closed_at', 'course.id', 'course.status'],
  },
  ReviewFinalized: {
    factType: 'ReviewFinalizedFact',
    dataKeys: [
      'review.generated_at',
      'review.generation_status',
      'review.id',
      'review.source_snapshot_hash',
      'review.type',
    ],
  },
  CourseReviewFinalized: {
    factType: 'CourseReviewFinalizedFact',
    dataKeys: ['course_review.id', 'course_review.source_snapshot_hash'],
  },
  SchedulePlanned: {
    factType: 'ScheduleConfirmedFact',
    dataKeys: [
      'schedule.assignment_id',
      'schedule.lesson_id',
      'schedule.planned_local_date',
      'schedule.source_type',
      'schedule.status',
    ],
  },
  InteractionPrompted: {
    factType: 'InteractionPromptedFact',
    dataKeys: ['interaction.id', 'interaction.prompted_at', 'conversation.interaction_id'],
  },
  InteractionResponded: {
    factType: 'InteractionRespondedFact',
    dataKeys: ['interaction.id', 'interaction.responded_at', 'conversation.interaction_id'],
  },
  InteractionSkipped: {
    factType: 'InteractionSkippedFact',
    dataKeys: ['interaction.id', 'interaction.skipped_at', 'conversation.interaction_id'],
  },
};

export function eventToFacts(event: LearningEventEnvelope): readonly LearningFact[] {
  const mapping = mappings[event.type];
  if (mapping === undefined) return [];
  return [createLearningFact({ event, ...mapping })];
}
