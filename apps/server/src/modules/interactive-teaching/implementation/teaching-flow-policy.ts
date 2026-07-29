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
            '当前阶段是课前热身。环节目标是建立本课所需的理解背景：结合可用的知识地图事实，自然帮助学习者理解本课在当前模块和整门课程中的位置及学习意义；若本课是模块或课程起点，可相应扩大到模块或学科层级。当具体事件、案例或议题承载本课分析时，先建立足以理解问题的共同情境，使学习者知道发生了什么、关键主体处于什么关系、当前为何必须作出判断，以及分析对象如何由此前过程形成。',
            '最后只提出一个能够连接本课目标与学习者已有经验的暖场问题，并等待学习者回应。',
            '本回复不展开任何知识点，也不推进知识点状态。',
          ]
        : [
            '结合学习者刚才的回应作出必要反馈，然后在同一回复中自然进入第一个知识点；无论回应是否正确、是否完整、表示不理解或希望跳过，都不再追加热身问题，也不要求学习者额外发送“继续”。',
            `开始讲解“${activePoint?.text ?? '第一个知识点'}”，并将教学阶段推进到 knowledge_point、将该知识点置为 learning。`,
          ]
      : phase === 'knowledge_point'
        ? [
            `当前从知识点“${activePoint?.text ?? '账本标记的当前知识点'}”继续教学。`,
            '本回复可以继续或完成当前节点；完成后可以把教学游标切换到相邻下一主链节点，但下一主链节点保持 pending，直到属于它的讲解真正开始。不要在同一可见回复中展开下一节点。最后一个主链节点完成后可以把下一阶段置为 comprehensive_application，但综合应用在下一轮展开。',
          ]
        : phase === 'comprehensive_application'
          ? [
              '全部知识点教学已经完成或由学习者明确跳过。当前进行一次跨知识点的综合应用。',
              '综合应用应在具有实质差异的新问题、新条件中保留本课方法可能适用的底层结构，使学习者自主识别问题、选择并调整方法，再依据新条件形成判断。仅更换场景、复述结论或重现课堂推理不构成迁移。',
              '若尚未提出综合应用，只提出一项非强制应用邀请；学习者可以回答或明确跳过。',
              '若学习者回答，根据其真实表现自主组织回应、深化或纠偏；综合应用回应完成或被明确跳过后进入讨论答疑。此时不要输出最终课程总结。',
            ]
          : phase === 'discussion'
            ? context.turnKind === 'continuation'
              ? [
                  '学习者在答疑阶段点击“继续讲解”，等同于明确确认没有其他疑问。',
                  '当前输出本课最终总结，并在同一轮把状态设为 ready_to_close、confirmed_no_questions、delivered；不要继续等待答疑回应或开启新的教学内容。',
                ]
              : [
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
      ? ['不要虚构用户表现或声称用户已经掌握。']
      : [];
  return `【当前教学阶段】\n${[...lines, ...supplementalLines].join('\n')}`;
}
