import type { CandidateGenerationFailureCode } from '@learning-more/contracts';

export type CandidateGenerationFailurePresentation = Readonly<{
  header: string;
  status: string;
  title: string;
  detail: string;
}>;

const presentations: Readonly<
  Record<CandidateGenerationFailureCode, CandidateGenerationFailurePresentation>
> = {
  candidate_invalid: {
    header: '● 大纲结构需重试',
    status: '内容已生成 · 结构校验未通过 · 草稿已保留',
    title: '候选内容已生成，但大纲结构校验未通过。',
    detail: '课程正文草稿已保留；重试会重新生成机器结构，不代表 AI 连接中断。',
  },
  generation_timeout: {
    header: '● 生成超时 · 可重试',
    status: '候选大纲生成超时 · 草稿已保留',
    title: '候选大纲生成超时。',
    detail: '已收到的内容不会覆盖已有草稿，可以直接重试。',
  },
  generation_interrupted: {
    header: '● 生成连接中断 · 可重试',
    status: '生成连接中断 · 已保留现有草稿',
    title: '生成连接中断。',
    detail: '已收到的草稿仍然保留；恢复连接后可以重试。',
  },
};

export function candidateGenerationFailurePresentation(
  code: CandidateGenerationFailureCode | undefined,
): CandidateGenerationFailurePresentation {
  return presentations[code ?? 'generation_interrupted'];
}

export function candidateGenerationFailureFromEvent(
  data: Readonly<Record<string, unknown>>,
): CandidateGenerationFailureCode {
  const problem = data.problem;
  if (typeof problem !== 'object' || problem === null) return 'generation_interrupted';
  const code = 'code' in problem ? problem.code : undefined;
  return code === 'candidate_invalid' || code === 'generation_timeout'
    ? code
    : 'generation_interrupted';
}
