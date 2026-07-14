import { createHash } from 'node:crypto';

import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { AuthoringAgent, AuthoringContext } from '../ports/authoring-agent.js';

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const COURSE_MODE_ATTENTION: Readonly<Record<AuthoringContext['courseMode'], string>> = {
  standard: '学习者没有指定特殊互动偏好，以当前学习目标和问题为主。',
  brainstorm: '学习者偏好脑洞探索；有自然机会时可以发散联想，但应随时跟随新的学习诉求。',
  argument_clash: '学习者偏好观点交锋；有自然机会时可以检验论点，但不必把每轮都变成辩论。',
  case_study:
    '学习者偏好案例场景；案例有助于理解时优先使用，但系统解释、论证或决策讨论同样可以直接展开。',
  business_insight: '学习者偏好商业洞察；有自然机会时关注机制和现实影响，但不限制其他有效路径。',
  process_decomposition: '学习者偏好过程拆解；过程关系重要时可以逐层展开，但不强制固定步骤。',
  decision_analysis:
    '学习者偏好决策分析；涉及选择时可以比较依据与取舍，但不把所有内容都改写成决策题。',
  cross_explore: '学习者偏好跨域探索；有真实关联时可以连接其他领域，并保留回到当前目标的线索。',
  reading_seminar: '学习者偏好阅读研讨；材料适合时可以细读和讨论，但不限制直接讲解与追问。',
};

function materialBackground(context: AuthoringContext): string | undefined {
  if (context.materials.length === 0) return undefined;
  return context.materials
    .map((material) => `《${material.title}》\n${material.excerpt.trim()}`)
    .join('\n\n');
}

function priorConversation(context: AuthoringContext): string | undefined {
  const completeMessages = context.messages.filter((message) => message.status === 'complete');
  const latestUserIndex = completeMessages.findLastIndex((message) => message.role === 'user');
  const prior = completeMessages.slice(0, Math.max(0, latestUserIndex));
  if (prior.length === 0) return undefined;
  return prior
    .map(
      (message) =>
        `${message.role === 'user' ? '学习者' : '课程创建助手'}：${message.content.trim()}`,
    )
    .join('\n\n');
}

function currentUserMessage(context: AuthoringContext): string {
  return (
    context.messages.findLast((message) => message.role === 'user' && message.status === 'complete')
      ?.content ?? context.topic
  ).trim();
}

export function renderAuthoringConversationInput(context: AuthoringContext): string {
  const materials = materialBackground(context);
  const history = priorConversation(context);
  const candidate = context.candidate?.markdown.trim();
  return [
    'COURSE_AUTHORING_CONVERSATION_V1',
    '你是课程创建阶段的教学设计对话智能体。依据真实对话理解学习目标、已有经验、最想解决的问题与边界。',
    '自由选择此刻最有帮助的追问、复述、解释或建议；允许课程邻接探索。课程玩法只是关注重心，不是对话格式或内容边界。',
    context.phase === 'assessment'
      ? '基础评估完成前，应主动帮助用户澄清边界；不要替用户确认大纲。'
      : '候选大纲已经存在。回应用户的调整诉求，说明你理解的改变；不要宣称尚未完成的调整已经生效。',
    '下面是以学习者为中心整理的自然语言背景。它不是要逐项展示或逐项询问的表单。',
    '“当前诉求｜用户原话”是学习者本轮真实输入；其他部分只是已知背景，不要伪装成学习者刚刚说过的话。',
    '不要复述栏目名，不要输出内部状态，不要宣称评估或课程已经完成。只输出给学习者看的自然 Markdown。',
    '',
    `【已知学习背景】\n学习方向：${context.topic.trim()}\n互动关注：${COURSE_MODE_ATTENTION[context.courseMode]}`,
    history === undefined ? undefined : `【此前真实对话】\n${history}`,
    materials === undefined ? undefined : `【学习者提供的材料】\n${materials}`,
    candidate === undefined ? undefined : `【当前候选大纲】\n${candidate}`,
    `【当前诉求｜用户原话】\n${currentUserMessage(context)}`,
  ]
    .filter((section): section is string => section !== undefined)
    .join('\n\n');
}

export function createGenerationAuthoringAgent(options: {
  readonly execution: GenerationExecution;
  readonly providerId: string;
}): AuthoringAgent {
  return {
    async respond(context) {
      const input = renderAuthoringConversationInput(context);
      const task = await options.execution.submit({
        taskKey: `course-authoring-conversation:${context.outlineSessionId}:${hash(input)}`,
        inputSnapshotHash: hash(input),
        taskKind: 'course-authoring-conversation',
        taskGroup: 'interactive',
        ownerRef: context.outlineSessionId,
        providerId: options.providerId,
        priority: 110,
        prompt: input,
      });
      const completed = await options.execution.awaitTerminal(task.taskId);
      const markdown = completed.draftMarkdown?.trim() ?? '';
      if (completed.status !== 'completed' || markdown.length === 0) {
        throw Object.assign(new Error('authoring_agent_unavailable'), {
          code: 'ai_unavailable',
          taskId: task.taskId,
        });
      }
      return markdown;
    },
  };
}
