import { LessonRecordView } from '../features/history/lesson-record-view.js';
import { LessonNavigationWorkspace } from '../features/learning/lesson-navigation-workspace.js';
import { LessonSessionWorkspace } from '../features/learning/lesson-session-workspace.js';
import { ReviewDialog } from '../features/review/review-dialog.js';
import { AppShellView } from '../layouts/app-shell.js';
import type { RuntimeUiState } from '../state/version-guard.js';

const readyRuntime = {
  kind: 'loaded',
  readiness: {
    status: 'ready',
    instanceId: 'visual-instance',
    buildId: 'development',
    protocolVersion: '1',
    storeStatus: 'ready',
    projectionStatus: 'ready',
    providerStatus: 'ready',
  },
  version: { kind: 'compatible', writesAllowed: true },
} satisfies RuntimeUiState;

export function LessonNavigationFixture(props: {
  readonly fixtureId: 'lesson-not-started' | 'lesson-abandoned';
}) {
  const abandoned = props.fixtureId === 'lesson-abandoned';
  return (
    <AppShellView providerLabel="Codex" refresh={() => undefined} state={readyRuntime}>
      <LessonNavigationWorkspace
        courseTitle="从反馈到核心循环"
        moduleLabel="模块一 · 体验断点"
        outlineVersionLabel="大纲 v1"
        points={
          abandoned
            ? [
                {
                  marker: '✓',
                  title: '已学习：掌握感不是简单变难',
                  description: '已区分操作负担、判断复杂度与玩家可感知进步。',
                },
                {
                  marker: '✓',
                  title: '已学习：难度必须与反馈连接',
                  description: '已能说明没有可解释反馈的失败只会产生挫败。',
                },
                {
                  marker: '→',
                  title: '待完成：推进节奏与证据',
                  description: '还需通过玩家行为验证挑战是否带来新的判断和掌握感。',
                },
              ]
            : [
                {
                  marker: '01',
                  title: '反馈的三个层级',
                  description: '区分状态反馈、能力反馈和目标反馈，不把有动画误认为有反馈。',
                },
                {
                  marker: '02',
                  title: '玩家如何读懂系统变化',
                  description: '判断反馈是否说明发生了什么、为什么发生以及下一步能做什么。',
                },
                {
                  marker: '03',
                  title: '反馈如何连接下一步行动',
                  description: '让即时响应进入目标推进，而不是停留在装饰。',
                },
              ]
        }
        state={abandoned ? 'abandoned' : 'not_started'}
        title={abandoned ? '难度与掌握感如何推进' : '反馈不是奖励动画'}
        onBackHome={() => undefined}
        onBackToOutline={() => undefined}
        onPrimary={() => undefined}
        onViewRecord={() => undefined}
      />
    </AppShellView>
  );
}

export function LessonSessionFixture() {
  return (
    <LessonSessionWorkspace
      abandoned={false}
      assistantPending={false}
      opening={false}
      openingError={false}
      canComplete
      canStop
      courseTitle="从反馈到核心循环"
      elapsedSeconds={18 * 60 + 42}
      generating
      input=""
      messages={[
        {
          id: 'a1',
          role: 'assistant',
          content: '回想你的平台跳跃原型：玩家在第几分钟开始觉得重复？你当时看到了什么行为证据？',
        },
        {
          id: 'u1',
          role: 'user',
          content: '大概第三分钟。玩家还在继续跳，但已经不再尝试收集边缘金币，动作变得很机械。',
        },
        {
          id: 'a2',
          role: 'assistant',
          content:
            '这说明问题不只是内容数量少，而是玩家已经不需要重新判断。我们可以把体验断点拆成三个维度：行动是否变化、反馈是否带来新信息、目标是否继续推进。你觉得原型先在哪一层失效？',
        },
        {
          id: 'u2',
          role: 'user',
          content: '应该是反馈没有新信息。金币只是加分，没有改变玩家接下来怎么跳。',
        },
        {
          id: 'a3',
          role: 'assistant',
          content: (
            <>
              <h2>反馈的第一条判断</h2>
              <p>反馈不是系统“回应了”，而是回应是否改变玩家对当前状态、能力或目标的理解。</p>
              <div className="review-callout">
                <b>现在继续检验：</b>
                如果把金币改成临时提高跳跃高度，玩家的下一步路线判断会怎样变化？
              </div>
            </>
          ),
        },
      ]}
      moduleLabel="模块一"
      outlineVersionLabel="大纲 v1"
      path={[
        { title: '反馈层级', detail: '正在建立判断', state: 'active' },
        { title: '新信息', detail: '识别可用反馈', state: 'pending' },
        { title: '行动选择', detail: '检验下一步变化', state: 'pending' },
        { title: '核心循环', detail: '连接连续动机', state: 'pending' },
      ]}
      paused={false}
      editingDraft=""
      stopped={false}
      title="反馈不是奖励动画"
      writable
      onAbandon={() => undefined}
      onBackToOutline={() => undefined}
      onComplete={() => undefined}
      onCancelEdit={() => undefined}
      onEditDraft={() => undefined}
      onEditMessage={() => undefined}
      onInput={() => undefined}
      onPause={() => undefined}
      onRestore={() => undefined}
      onRetryOpening={() => undefined}
      onRetryMessage={() => undefined}
      onSkipOpening={() => undefined}
      onResume={() => undefined}
      onSend={() => undefined}
      onSubmitEdit={() => undefined}
      onStop={() => undefined}
      onTransfer={() => undefined}
    />
  );
}

const reviewContent = (
  <>
    <h2>第一讲总结：玩家为什么会停下来</h2>
    <h3>知识图谱</h3>
    <pre>{`体验断点
├── 行动变化：玩家是否仍需做新的判断
├── 反馈信息：系统是否提供新的可用信息
└── 目标推进：当前行为是否继续改变下一步追求

重复感不是内容数量问题
└── 关键判断：反馈是否改变玩家的下一次行动`}</pre>
    <h3>核心思想</h3>
    <p>
      玩家停下来往往不是因为“看过了相同画面”，而是因为系统不再要求新的判断。分析体验断点时，应从玩家行为证据出发，检查行动、反馈与目标是否仍在推进。
    </p>
    <h3>学习表现评价</h3>
    <h4>你做得很好的地方</h4>
    <div className="review-callout">
      <p>
        你能从“玩家不再收集边缘金币”这一具体行为，推导出金币反馈没有改变下一次路线判断，而不是停留在“内容太少”的宽泛结论。
      </p>
    </div>
    <h4>有一处需要留意</h4>
    <p>
      你最初把重复感理解为素材数量不足。这个判断并非完全错误，但它没有解释玩家为什么仍在操作却停止探索。
    </p>
    <h4>接下来的判断</h4>
    <div className="review-callout">
      <p>
        你已经具备继续学习反馈层级的基础。下一步可以区分状态反馈、能力反馈和目标反馈，并继续用“是否改变下一次行动”检验它们。
      </p>
    </div>
  </>
);

export function LessonReviewFixture() {
  return (
    <ReviewDialog
      content={reviewContent}
      courseTitle="从反馈到核心循环：游戏设计能力进阶"
      generatedAt="2026/07/12 10:42"
      markdown=""
      open
      title="玩家为什么会停下来"
      onBackToOutline={() => undefined}
      onViewRecord={() => undefined}
    />
  );
}

export function LessonRecordFixture() {
  return (
    <LessonRecordView
      actualSeconds={24 * 60}
      completedAt="2026/07/12"
      courseTitle="从反馈到核心循环"
      finalReviewMarkdown=""
      original={{
        sessionId: 'original',
        label: '原始学习对话',
        meta: '2026/07/12 · 24 分钟',
        messages: [
          {
            id: 'original-assistant-1',
            role: 'assistant',
            markdown:
              '回想你提到的平台跳跃原型：玩家在第几分钟开始觉得重复？你当时看到了什么行为证据？',
          },
          {
            id: 'original-user-1',
            role: 'user',
            markdown:
              '大概第三分钟。玩家还在继续跳，但已经不再尝试收集边缘位置的金币，动作变得很机械。',
          },
          {
            id: 'original-assistant-2',
            role: 'assistant',
            markdown:
              '这说明问题不只是“内容数量少”，而是玩家已经不需要重新判断。我们可以把体验断点拆成三个维度：行动是否变化、反馈是否带来新信息、目标是否继续推进。',
          },
          {
            id: 'original-user-2',
            role: 'user',
            markdown: '应该是反馈没有新信息。金币只是加分，没有改变玩家接下来怎么跳。',
          },
          {
            id: 'original-assistant-3',
            role: 'assistant',
            markdown: '很好。你已经从“重复感”推进到了可设计的问题：反馈有没有改变下一次行动。',
          },
        ],
      }}
      reviewContent={reviewContent}
      supplementary={[
        {
          sessionId: 'supplement',
          label: '补充学习 01',
          meta: '2026/07/15 · 金币路线',
          messages: [
            {
              id: 'supplement-user-1',
              role: 'user',
              markdown: '如果边缘金币临时提高跳跃高度，它是不是能改变路线判断？',
            },
            {
              id: 'supplement-assistant-1',
              role: 'assistant',
              markdown:
                '关键不在奖励更强，而在玩家是否会因此重新比较路线；路线选择变化才是更直接的证据。',
            },
          ],
        },
      ]}
      title="玩家为什么会停下来"
      onBackHome={() => undefined}
      onBackToOutline={() => undefined}
    />
  );
}
