import { createMockProvider, type MockProviderStep } from '../../ai-providers/mock-provider.js';
import type { AiProvider } from '../../ai-providers/provider.js';

function candidateMarkdown(version: number): string {
  return `\`\`\`learning-more-outline
{"protocol":"learning-more.candidate","schemaVersion":1,"outline":{"courseGoals":["理解并运用概率模型"],"disciplineTag":"数学","topicTags":["概率论"],"modules":[{"id":"module_probability","title":"概率基础","lessonIds":["probability-space","random-variable"]}],"lessons":[{"id":"probability-space","title":"概率空间","objective":"理解样本空间","coreKnowledgePoints":["样本空间"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]},{"id":"random-variable","title":"随机变量","objective":"用模型描述结果","coreKnowledgePoints":["随机变量"],"prerequisiteLessonIds":["probability-space"],"estimatedMinutes":45,"sourceRefs":["source_topic"]}]}}
\`\`\`
# 候选大纲 ${version}

1. Probability spaces
2. Random variables`;
}

function mockScript(
  attempt: number,
  failCandidate: boolean,
  prompt = '',
): readonly MockProviderStep[] {
  if (prompt.startsWith('COURSE_CANDIDATE_ALIGNMENT_PLAN_V1')) {
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2)) as {
      messages?: { role: 'user' | 'assistant'; content: string }[];
    };
    const request = [...(input.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user');
    const asksForGlobalChange = /重做|整版|全部|目标改为|受众改为/u.test(request?.content ?? '');
    return [
      {
        type: 'text',
        text: JSON.stringify({
          action: asksForGlobalChange ? 'regenerate' : 'patch',
          rationale: asksForGlobalChange
            ? '用户改变了全局课程方向。'
            : '用户请求可在保留整体结构时局部落实。',
          targetModuleIds: [],
        }),
      },
    ];
  }
  if (prompt.startsWith('COURSE_AUTHORING_CONVERSATION_V1')) {
    return [
      {
        type: 'text',
        text: '我已收到你的初始学习方向。为了把课程边界对齐得更准确，你目前有哪些相关经验，最希望通过这门课解决什么问题？',
      },
    ];
  }
  if (prompt.includes('【课程与待规划课节】') && prompt.includes('【可用时间与安排偏好】')) {
    const lessonRefs = [...prompt.matchAll(/（课节标识：([^；）]+)；课程标识：([^）]+)）/gu)].map(
      (match) => ({ lessonId: match[1]!, courseId: match[2]! }),
    );
    const start = /最早开始日期：([^\r\n]+)/u.exec(prompt)?.[1];
    const dailyMinutes = Number(/单日目标时长：([\d.]+) 分钟/u.exec(prompt)?.[1] ?? 45);
    const learningDays = new Set(/可学习日期：([^\r\n]+)/u.exec(prompt)?.[1]?.split('、') ?? []);
    const base = new Date(`${start ?? '2026-01-01'}T11:00:00.000Z`);
    let offsetDays = 0;
    return [
      {
        type: 'text',
        text: JSON.stringify({
          suggestions: lessonRefs.map(({ lessonId, courseId }, index) => {
            void index;
            let startAt = new Date(base.getTime() + offsetDays * 86_400_000);
            while (
              learningDays.size > 0 &&
              !learningDays.has(
                new Intl.DateTimeFormat('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  weekday: 'short',
                }).format(startAt),
              )
            ) {
              offsetDays += 1;
              startAt = new Date(base.getTime() + offsetDays * 86_400_000);
            }
            offsetDays += 1;
            return {
              courseId,
              lessonId,
              startAt: startAt.toISOString(),
              endAt: new Date(startAt.getTime() + dailyMinutes * 60 * 1_000).toISOString(),
              timezoneAtCreation: 'Asia/Shanghai',
              explanation: '根据给定时间窗口、课节依赖和已有日程形成的候选安排。',
            };
          }),
        }),
      },
    ];
  }
  if (
    prompt.includes('【周报范围】') &&
    (prompt.includes('【可用学习证据】') || prompt.includes('【已完成课节】'))
  ) {
    const refs = [...prompt.matchAll(/^来源标记：([^\r\n]+)$/gmu)].map((match) => match[1]!);
    const minutes = [...prompt.matchAll(/^实际学习时长：([\d.]+) 分钟$/gmu)].reduce(
      (total, match) => total + Number(match[1]),
      0,
    );
    const sourceComment = refs.length === 0 ? '' : ` <!-- sources:${refs.join(',')} -->`;
    return [
      {
        type: 'text',
        text: `# 上周学习成果概括\n\n${
          refs.length === 0
            ? '上周没有已完成课节。'
            : `上周完成 ${refs.length} 节可追溯的学习内容${minutes > 0 ? `，记录学习 ${minutes} 分钟` : ''}。${sourceComment}\n\n这些记录只描述已经完成的学习内容，不代表知识已经完全掌握。${sourceComment}`
        }`,
      },
    ];
  }
  if (prompt.startsWith('PROFILE_EVIDENCE_EXTRACTION_V1')) {
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2)) as {
      checkpoint?: {
        checkpointKind?: string;
        sources?: { sourceRef: string; role: string; observedAt: string }[];
      };
    };
    const reviewCheckpoint =
      input.checkpoint?.checkpointKind === 'stage_review_finalized' ||
      input.checkpoint?.checkpointKind === 'lesson_review_finalized';
    const eligibleSources = (input.checkpoint?.sources ?? []).filter((source) =>
      reviewCheckpoint
        ? source.role === 'review' || source.role === 'observer'
        : source.role === 'user',
    );
    const latest = eligibleSources.at(-1);
    const expiresAt = new Date(
      Date.parse(latest?.observedAt ?? '2026-07-14T00:00:00.000Z') + 90 * 86_400_000,
    ).toISOString();
    return [
      {
        type: 'text',
        text: JSON.stringify({
          candidates:
            latest === undefined
              ? []
              : [
                  {
                    candidateKind: 'thinking_behavior',
                    claimDimension: reviewCheckpoint
                      ? 'thinking_tendency.conditional_revision'
                      : 'thinking_tendency.contextual_relation_exploration',
                    label: reviewCheckpoint ? '依据条件变化修正判断' : '当前证据中的情境关系探索',
                    summary: reviewCheckpoint
                      ? '该学习会话中，学习者会比较条件变化，并据此修正当前判断。'
                      : '在当前受控检查点中，用户通过提出对象关系或条件变化推进学习问题。',
                    explicitness: 'ai_observed',
                    sourceRefs: reviewCheckpoint
                      ? eligibleSources.map((source) => source.sourceRef)
                      : [latest.sourceRef],
                    confidence: 0.68,
                    qualityFlags: ['direct'],
                    limitations: [
                      '只代表当前检查点中的可见学习行为，不构成固定人格或永久能力判断。',
                    ],
                    safetyStatus: 'usable',
                    polarity: 'supporting',
                    contradictionEvidenceIds: [],
                    expiryPolicy: { kind: 'window_bound', expiresAt },
                  },
                ],
        }),
      },
    ];
  }
  if (prompt.includes('增量归并到一个有界的跨会话语义核心')) {
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2)) as {
      currentModes?: { modeId: string; origin: 'observed_behavior' | 'explicit_preference' }[];
      newReviewObservations?: {
        observationId: string;
        origin: 'observed_behavior' | 'explicit_preference';
      }[];
    };
    return [
      {
        type: 'text',
        text: JSON.stringify({
          assignments: (input.newReviewObservations ?? []).map((observation) => {
            const current = (input.currentModes ?? []).find(
              (mode) => mode.origin === observation.origin,
            );
            return {
              sourceModeIds: current === undefined ? [] : [current.modeId],
              observationIds: [observation.observationId],
              mode: {
                origin: observation.origin,
                feature:
                  observation.origin === 'observed_behavior'
                    ? '倾向先核验前提、边界与条件变化再修正判断'
                    : '偏好使用对比和反例理解复杂概念',
                teachingImpact:
                  observation.origin === 'observed_behavior'
                    ? '沿统一问题主线加入对比、反推和条件变化，促使用户主动检验结论'
                    : '讲解复杂概念时优先提供对比和反例',
                applicabilityBoundary: '只适用于已经记录的学习情境，不代表固定人格或能力',
                priority: 5,
              },
            };
          }),
          ignoredObservationIds: [],
        }),
      },
    ];
  }
  if (prompt.includes('【分析边界】') && prompt.includes('【可用学习证据】')) {
    const semanticModes = prompt
      .split(/^### 稳定学习模式 \d+$/gmu)
      .slice(1)
      .flatMap((block) => {
        const modeId = /^模式编号：([^\r\n]+)$/mu.exec(block)?.[1];
        const evidenceIds = /^可引用证据编号：([^\r\n]+)$/mu.exec(block)?.[1]?.split('、');
        return modeId === undefined || evidenceIds === undefined ? [] : [{ modeId, evidenceIds }];
      });
    const claims = semanticModes
      .map((mode) => [mode.modeId, mode.evidenceIds] as const)
      .filter(([, evidenceIds]) => evidenceIds.length >= 2)
      .map(([modeId, evidenceIds], index) => ({
        claimId: `claim_${index + 1}`,
        semanticModeId: modeId,
        markdown:
          '### 你会先核验条件再修正判断\n\n核心结论：你会检查前提与边界。具体表现：在不同学习中根据条件变化调整结论。教学建议：继续使用对比和反推激活思考。适用边界：只代表已有学习记录。',
        evidenceIds,
        confidence: 0.65,
        limitations: ['这条观察只适用于当前已经记录的学习情境，不能说明固定人格或永久能力。'],
        counterEvidenceChecked: true,
      }));
    return [
      {
        type: 'text',
        text: JSON.stringify({
          title: claims.length === 0 ? '学习记录还不够' : '你在近期学习中重复出现的做法',
          summary:
            claims.length === 0
              ? '目前还没有足够的学习记录来形成可靠观察，继续学习后会再更新。'
              : '下面只描述你在近期不同学习记录中重复出现的具体做法，不把它解释成固定性格或能力。',
          claims,
        }),
      },
    ];
  }
  if (prompt.includes('【当前学习背景】') && prompt.includes('【可选课节】')) {
    const selectedBlock = prompt.split(/^### /gmu).slice(1)[0];
    const selected =
      selectedBlock === undefined
        ? undefined
        : {
            title: selectedBlock.split(/\r?\n/u)[0]?.trim(),
            semanticKey: /^课节标识：([^\r\n]+)$/mu.exec(selectedBlock)?.[1],
          };
    return [
      {
        type: 'text',
        text: JSON.stringify({
          semanticKey: selected?.semanticKey,
          rationale:
            selected === undefined
              ? '没有可推荐课节'
              : `当前先学习“${selected.title}”最有利于建立后续依赖。`,
        }),
      },
    ];
  }
  if (
    prompt.startsWith('只观察给定消息范围') ||
    prompt.startsWith('每轮只读取上次观察锚点与本轮新增消息')
  ) {
    const separator = prompt.lastIndexOf('\n\n');
    const input = JSON.parse(prompt.slice(separator + 2)) as {
      knowledgePointRefs?: string[];
      messages?: { messageId: string; role: 'user' | 'assistant' }[];
    };
    const knowledgePointRef = input.knowledgePointRefs?.[0];
    const assistant = input.messages?.find((message) => message.role === 'assistant');
    return [
      {
        type: 'text',
        text: JSON.stringify({
          scope: {
            alignment: knowledgePointRef === undefined ? 'unclear' : 'direct',
            relationRefs: knowledgePointRef === undefined ? [] : [knowledgePointRef],
            rationale: '本地模拟观察仅确认当前互动与本课的可追溯关系。',
          },
          entries:
            knowledgePointRef === undefined || assistant === undefined
              ? []
              : [
                  {
                    entryId: `entry_delivery_${assistant.messageId}`,
                    kind: 'teaching_delivery',
                    summary: '教学智能体回应了当前课节问题。',
                    knowledgePointRefs: [knowledgePointRef],
                    sourceRefs: [`message:${assistant.messageId}`],
                    resolvesEntryRefs: [],
                    qualityFlags: ['direct', 'complete'],
                  },
                ],
          interactions: [],
        }),
      },
    ];
  }
  if (
    prompt.includes('【机器控制协议｜不得展示给学习者】') &&
    prompt.includes('当前机器状态：') &&
    !prompt.includes('接口输出协议：只返回一个 JSON 对象')
  ) {
    const serializedState = /当前机器状态：(\{[^\r\n]+\})/u.exec(prompt)?.[1];
    const state = JSON.parse(serializedState ?? '{}') as {
      schemaVersion?: number;
      lessonPhase?: string;
      activeKnowledgePointRef?: string;
      knowledgePoints?: Array<{
        ref: string;
        title?: string;
        status: string;
        interactionStatus: string;
      }>;
      comprehensiveApplication?: string;
      closureInquiry?: string;
      summaryStatus?: string;
    };
    const currentUserTurn = prompt.includes('【当前诉求｜用户原话】');
    const activePoint =
      (state.knowledgePoints ?? []).find((point) => point.ref === state.activeKnowledgePointRef) ??
      (state.knowledgePoints ?? []).find((point) => point.status !== 'completed');
    const nextState = !currentUserTurn
      ? { schemaVersion: 2, lessonPhase: state.lessonPhase ?? 'warmup' }
      : state.lessonPhase === 'warmup'
        ? {
            schemaVersion: 2,
            lessonPhase: 'knowledge_point',
            ...(activePoint === undefined ? {} : { activeKnowledgePointRef: activePoint.ref }),
            ...(activePoint === undefined
              ? {}
              : {
                  knowledgePoints: [
                    {
                      ref: activePoint.ref,
                      status: 'learning',
                      interactionStatus: 'pending',
                    },
                  ],
                }),
          }
        : state.lessonPhase === 'knowledge_point'
          ? {
              schemaVersion: 2,
              lessonPhase: 'comprehensive_application',
              activeKnowledgePointRef: null,
              ...(activePoint === undefined
                ? {}
                : {
                    knowledgePoints: [
                      {
                        ref: activePoint.ref,
                        status: 'completed',
                        interactionStatus: 'completed',
                      },
                    ],
                  }),
              comprehensiveApplication: 'learning',
            }
          : state.lessonPhase === 'comprehensive_application'
            ? {
                schemaVersion: 2,
                lessonPhase: 'discussion',
                comprehensiveApplication: 'completed',
                closureInquiry: 'awaiting_confirmation',
              }
            : state.lessonPhase === 'discussion'
              ? {
                  schemaVersion: 2,
                  lessonPhase: 'ready_to_close',
                  closureInquiry: 'confirmed_no_questions',
                  summaryStatus: 'delivered',
                }
              : { schemaVersion: 2, lessonPhase: state.lessonPhase ?? 'ready_to_close' };
    return [
      {
        type: 'text',
        text: `<learning-more-reply>我们从你刚才的问题继续，先把条件变化与判断修正之间的关系讲清。你会先检查哪个条件发生了变化，为什么？</learning-more-reply><learning-more-control>${JSON.stringify(nextState)}</learning-more-control>`,
      },
    ];
  }
  if (
    prompt.startsWith('根据给定的局部思维行为证据') ||
    prompt.startsWith('输入 Episode 是课时或阶段 Review')
  ) {
    const separator = prompt.lastIndexOf('\n\n');
    const input = JSON.parse(prompt.slice(separator + 2)) as {
      episodes?: { episodeId: string }[];
    };
    const episodeIds = input.episodes?.map((episode) => episode.episodeId) ?? [];
    return [
      {
        type: 'text',
        text: JSON.stringify({
          dimensions:
            episodeIds.length === 0
              ? []
              : [
                  {
                    label: '当前证据中的关系推进',
                    description: '学习者通过说明对象之间的关系推进当前理解。',
                    inclusionSignals: ['表达中包含可说明的对象关系'],
                    exclusionSignals: ['只重复对象名称而没有关系'],
                    derivedFromEpisodeIds: episodeIds,
                  },
                ],
          classifications: episodeIds.map((episodeId) => ({
            episodeId,
            labels: [
              {
                label: '当前证据中的关系推进',
                rationale: '本地模拟分析仅用于验证开放维度数据链路。',
                confidence: 0.6,
              },
            ],
          })),
        }),
      },
    ];
  }
  if (prompt.includes('"kind":"lesson-final"')) {
    return [
      {
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 1,
          kind: 'lesson-final',
          title: '本课学习回看',
          knowledgeMap: { title: '知识图谱', markdown: '本课知识线索已依据冻结证据整理。' },
          methodologyInsight: '先把判断连接到可观察证据，再决定结论能否迁移到新情境。',
          coreInsight: '把本课中的关键判断连接到可观察的学习证据。',
          performance: [
            { title: '已经推进的部分', markdown: '学习者已完成本课要求的主要互动。' },
            { title: '下一步判断', markdown: '后续可继续检验理解能否迁移到新情境。' },
          ],
        }),
      },
    ];
  }
  if (prompt.includes('"kind":"lesson-stage"')) {
    return [
      {
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 1,
          kind: 'lesson-stage',
          title: '阶段学习回看',
          lead: '本课在形成可用证据后提前结束。',
          establishedUnderstanding: [
            { title: '已建立的理解', markdown: '已有互动证据支持当前阶段的部分理解。' },
          ],
          pendingValidation: [
            { title: '尚待验证', markdown: '其余教学闭环仍需在恢复学习后继续。' },
          ],
          knowledgeMap: { title: '当前知识线索', markdown: '阶段性知识关系已按现有证据整理。' },
          performance: [
            { title: '本次已经推进的部分', markdown: '学习者完成了当前阶段的有效互动。' },
          ],
          continuationNotice: '恢复学习将继续原课时，不会新建一节课。',
        }),
      },
    ];
  }
  if (prompt.startsWith('根据完整、冻结且可追溯的教学证据')) {
    return [
      {
        type: 'text',
        text: '# 学习 Review\n\n这份 Review 仅依据已冻结的教学证据，总结实际推进、仍待确认之处与有价值的教学支线。',
      },
    ];
  }
  if (prompt.includes('"kind":"course-final"')) {
    return [
      {
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 1,
          kind: 'course-final',
          title: '课程学习回看',
          lead: '本 Review 依据课程结构与已冻结的课时 Review 汇总生成。',
          knowledgeThreads: [
            { title: '主题核心知识线索', markdown: '各课时的关键判断已连接为课程级知识线索。' },
          ],
          strengths: [{ title: '稳定优势', markdown: '能够依据互动证据推进理解。' }],
          development: [{ title: '需要继续发展', markdown: '可继续检验理解在新情境中的迁移。' }],
          boundaries: [
            { title: '可继续探索的知识边界', markdown: '可从现有主题继续向相邻问题扩展。' },
          ],
          extensions: [
            { title: '推荐扩展方向', markdown: '选择与当前知识线索直接相连的补充课程。' },
          ],
        }),
      },
    ];
  }
  if (prompt.startsWith('根据冻结的课程结构、全部可用课时 Review')) {
    return [
      {
        type: 'text',
        text: '# 课程学习回看\n\n这份总 Review 仅依据课程结构与已冻结的课时 Review，区分已有证据、仍存缺口和可继续深化的方向。',
      },
    ];
  }
  if (failCandidate && prompt.startsWith('COURSE_OUTLINE_CANDIDATE_V4')) {
    return [
      { type: 'text', text: '# Partial candidate' },
      { type: 'fail', error: new Error('mock_provider_interrupted') },
    ];
  }
  return [{ type: 'text', text: candidateMarkdown(attempt) }];
}

export function createLocalMockProvider(options: Readonly<{ mockFailOnce: boolean }>): AiProvider {
  let failedConfiguredCandidate = false;
  return createMockProvider({
    id: 'mock',
    scriptFactory: (attempt, request) => {
      const failCandidate =
        options.mockFailOnce &&
        !failedConfiguredCandidate &&
        request.prompt.startsWith('COURSE_OUTLINE_CANDIDATE_V4');
      if (failCandidate) failedConfiguredCandidate = true;
      return mockScript(attempt, failCandidate, request.prompt);
    },
  });
}
