import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

export function renderTeachingFlowPolicy(context: TeachingContextPackage): string {
  const state = context.teachingState;
  const phase = state.lessonPhase ?? 'warmup';
  const activePoint = context.lesson.coreKnowledgePoints.find(
    (point) => point.ref === state.activeKnowledgePointRef,
  );
  const lines =
    phase === 'warmup'
      ? context.turnKind === 'opening'
        ? [
            '当前阶段是课前热身。主动连接学习目标与已有经验，用一个容易回应的问题了解学习起点。',
            '本回合不展开整课，也不把热身问题写成整套知识检测。',
          ]
        : [
            '学习者正在回答课前热身。先自然回应其学习起点，然后进入账本标记的第一个知识点。',
            `本回合最多完成“${activePoint?.text ?? '第一个知识点'}”的讲解并提出一次理解检测，不要继续倾倒后续知识点。`,
          ]
      : phase === 'knowledge_point'
        ? [
            `当前只负责知识点：${activePoint?.text ?? '账本标记的当前知识点'}。`,
            '可以自由选择解释、案例、类比、反驳或讨论方式；讲解完成后自由采用情境应用、对比辨析、错误诊断、条件变化预测、迁移判断等综合提问方式对用户理解进行检测。',
            '提问时不默认给出提示、解题路径或答案框架；只有用户表现出困难或明确要求提示时，才提供适量支架。',
            '如果当前用户原话是在回答检测，就在本回合完成内部判断：通过且没有新疑问时，用简短小结自然引入下一个知识点，不要播报检测或通过状态；未通过时换一种方式继续，不机械重复同一个问题。',
            '如果当前用户原话提出相关疑问，先解决疑问并留在当前知识点；如果用户明确跳过，则尊重选择并进入下一节点。',
          ]
        : phase === 'comprehensive_check'
          ? [
              '全部知识点教学已经完成或由学习者明确跳过。当前进行跨知识点的综合检测。',
              '若尚未提出综合任务，只提出一个能够连接本课核心关系的任务；若用户正在回答，则完成判断与反馈。',
              '综合回答充分，或用户明确选择跳过时，不播报检测或通过状态；用一小段跨知识点小结自然过渡，然后询问“对本课是否还有疑惑或其他讲解需求”。此时不要输出最终课程总结。',
              '如果综合回答仍不充分，继续提供有针对性的支架，并以一个便于学习者继续表达本课理解的问题收束。',
            ]
          : phase === 'discussion'
            ? [
                '综合检测已经通过或被学习者明确跳过；当前处于讨论答疑阶段，等待学习者确认是否还有本课疑问或其他讲解需求。',
                '如果学习者提出疑问，完整回应并保持 lessonPhase=discussion、closureInquiry=awaiting_confirmation；在回复末尾再次自然询问是否还有其他疑惑或讲解需求，不要提前输出最终课程总结。',
                '用户可以连续追问任意轮次。只有学习者本轮明确表示没有疑问、不需要继续讲解或可以结束时，才输出结构完整、简洁连贯的最终课程总结，并在同一轮把状态设为 ready_to_close、confirmed_no_questions、delivered。',
              ]
            : phase === 'summary'
              ? [
                  '学习者已经明确表示没有其他疑问。当前只输出本课最终总结，概括核心知识、关系和本次学习形成的关键理解。',
                  '总结完成后告知学习者可以结束本课；不要再提出问题、布置任务或开启新的检测循环。',
                ]
              : [
                  '本课教学流程已经完成。简短回应当前诉求，并提示学习者可点击“结束本课”生成最终 Review。',
                ];
  return `【当前教学阶段】\n${lines.join('\n')}`;
}
