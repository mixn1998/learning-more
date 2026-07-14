import type { CourseMode } from '@learning-more/contracts';
import type { CandidateGenerationFailureCode } from '@learning-more/contracts';

import { courseModeDefinition } from '../../course-mode-registry.js';
import { parseCandidateMarkdown } from './candidate-markdown.js';
import { candidateGenerationFailurePresentation } from './candidate-generation-failure.js';
import type { OutlineWorkspaceData } from './outline-workspace-view.js';

type MaterialSummary = Readonly<{
  originalFileName: string;
  sections: readonly string[];
  warnings: readonly string[];
}>;

const phaseStatus: Readonly<Record<string, string>> = {
  assessing: '正在评估课程需求',
  ready: '基础评估已完成 · 可以生成候选大纲，也可以继续对话',
  generating: 'AI 正在生成候选大纲',
  'candidate-ready': '候选大纲已生成 · 可以继续对话调整',
  'version-conflict': '服务端已有新版本 · 当前输入仍保留',
  confirming: '正在创建正式课程',
  confirmed: '正式课程已创建',
};

export function createAuthoringWorkspaceData(input: {
  readonly phase: string;
  readonly topic: string;
  readonly courseMode: CourseMode;
  readonly assessment: string;
  readonly completedAssessmentRounds: number;
  readonly generationFailureCode?: CandidateGenerationFailureCode;
  readonly messages: readonly Readonly<{
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'submitting' | 'complete' | 'failed';
  }>[];
  readonly candidateMarkdown: string;
  readonly materials: readonly MaterialSummary[];
}): OutlineWorkspaceData {
  const mode = courseModeDefinition(input.courseMode);
  const parsed = parseCandidateMarkdown(input.candidateMarkdown);
  const status =
    input.phase === 'generation-failed'
      ? candidateGenerationFailurePresentation(input.generationFailureCode).status
      : (phaseStatus[input.phase] ?? '课程创建会话已保存');
  const material = input.materials.at(0);

  return {
    mode: input.courseMode,
    topic: input.topic,
    status,
    messages: input.messages,
    completedAssessmentRounds: input.completedAssessmentRounds,
    outline: parsed?.title ?? `${input.topic || '待命名课程'} · 候选大纲`,
    summary: parsed?.summary ?? '完成至少三轮基础评估后，将根据真实对话与材料生成候选课程结构。',
    discipline: parsed?.discipline ?? mode.label,
    tags: parsed?.tags.length === 0 || parsed === undefined ? [mode.shortLabel] : parsed.tags,
    modules: parsed?.modules ?? [
      {
        title: '等待生成',
        lessons: [{ title: status, points: [] }],
      },
    ],
    ...(material === undefined
      ? {}
      : {
          material: {
            name: material.originalFileName,
            status: '解析成功',
            detail: `${material.sections.length} 个章节${
              material.warnings.length === 0 ? '' : ` · ${material.warnings.length} 条提示`
            }`,
          },
        }),
  };
}
