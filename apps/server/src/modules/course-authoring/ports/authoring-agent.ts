import type { CourseMode } from '../model/commands.js';
import type { OutlineMessage } from '../model/outline-message.js';
import type { LessonKnowledgeStructure } from '@learning-more/contracts';

export type FrozenLessonOutlineContext = Readonly<{
  lessonId: string;
  semanticKey: string;
  title: string;
  objective: string;
  coreKnowledgePoints: readonly string[];
  knowledgeStructure: LessonKnowledgeStructure;
  progress: 'in_progress' | 'abandoned' | 'completed';
}>;

export type AuthoringContext = Readonly<{
  outlineSessionId: string;
  phase: 'assessment' | 'candidate-alignment';
  topic: string;
  courseMode: CourseMode;
  completedAssessmentRounds: number;
  messages: readonly OutlineMessage[];
  materials: readonly Readonly<{
    sourceRef: string;
    title: string;
    excerpt: string;
  }>[];
  pastVersionContext?: Readonly<{
    dialogueDigest: string;
    frozenLessons: readonly FrozenLessonOutlineContext[];
  }>;
  candidate?: Readonly<{
    candidateVersionId: string;
    createdAt?: string | undefined;
    markdown: string;
    outlineNodes?: readonly Readonly<{
      ref: string;
      kind: 'course' | 'module' | 'lesson' | 'course-section';
      title: string;
      excerpt: string;
      parentRef?: string | undefined;
    }>[];
  }>;
  pendingAlignment?: Readonly<{
    action: 'regenerate' | 'patch';
    targetModuleIds: readonly string[];
  }>;
}>;

export interface AuthoringAgent {
  respond(context: AuthoringContext): Promise<string>;
}
