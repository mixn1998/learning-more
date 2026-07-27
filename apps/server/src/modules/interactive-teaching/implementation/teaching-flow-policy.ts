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
        ? ['当前阶段是课前热身，目标是连接学习目标与已有经验并了解学习起点。']
        : [
            '结合学习者对课前热身的回应，进入账本标记的第一个知识点。',
            `从“${activePoint?.text ?? '第一个知识点'}”开始教学。`,
          ]
      : phase === 'knowledge_point'
        ? [
            `当前从知识点“${activePoint?.text ?? '账本标记的当前知识点'}”继续教学。`,
            '本回复可以继续或完成当前节点；完成后可以把下一主链节点置为 learning，为下一轮准备，但不要在同一可见回复中展开下一节点。最后一个主链节点完成后可以把下一阶段置为 comprehensive_application，但综合应用在下一轮展开。',
          ]
        : phase === 'comprehensive_application'
          ? [
              '全部知识点教学已经完成或由学习者明确跳过。当前进行一次跨知识点的综合应用。',
              '若尚未提出综合应用，只提出一个能够连接本课核心关系并具有迁移价值的任务；这是一项非强制应用邀请，学习者可以回答或明确跳过。',
              '若学习者回答，根据其真实表现自主组织回应、深化或纠偏；综合应用回应完成或被明确跳过后进入讨论答疑。此时不要输出最终课程总结。',
            ]
          : phase === 'discussion'
            ? [
                '综合应用已经回应完成或被学习者明确跳过；当前处于讨论答疑阶段，等待学习者确认是否还有本课疑问或其他讲解需求。',
                '如果学习者提出疑问，继续答疑并保持 lessonPhase=discussion、closureInquiry=awaiting_confirmation；在学习者确认无需继续前，不要输出最终课程总结。',
                '用户可以连续追问任意轮次。只有学习者本轮明确表示没有疑问、不需要继续讲解或可以结束时，才输出最终课程总结，并在同一轮把状态设为 ready_to_close、confirmed_no_questions、delivered。',
              ]
            : phase === 'summary'
              ? [
                  '学习者已经明确表示没有其他疑问。当前只输出本课最终总结，概括核心知识、关系和本次学习形成的关键理解。',
                  '总结完成后进入结束本课，不再开启新的教学阶段或互动。',
                ]
              : [
                  '本课教学流程已经完成。回应当前诉求，并提示学习者可点击“结束本课”生成最终 Review。',
                ];
  const supplementalLines =
    phase === 'comprehensive_application'
      ? ['综合应用应连接本课核心知识关系并体现迁移；不要虚构用户表现或声称用户已经掌握。']
      : [];
  return `【当前教学阶段】\n${[...lines, ...supplementalLines].join('\n')}`;
}
