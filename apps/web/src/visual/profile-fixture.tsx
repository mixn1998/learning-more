import {
  PortraitWorkspace,
  type PortraitWorkspaceInsight,
} from '../features/profile/portrait-workspace.js';
import { AppShellView } from '../layouts/app-shell.js';
import type { RuntimeUiState } from '../state/version-guard.js';

const readyRuntime: RuntimeUiState = {
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
};

const insights: readonly PortraitWorkspaceInsight[] = [
  {
    claimId: 'constraint-reasoning',
    markdown: [
      '### 你会先寻找系统必须维持的性质，再判断操作代价',
      '',
      '在数据结构课程中，你能够从连续存储推出随机访问优势，也能从指针连接推出链表的寻址成本。这种推理方式随后被你迁移到游戏反馈：不是先判断反馈“好不好看”，而是先检查它是否改变玩家下一步决策。',
      '',
      '- 倾向从约束和机制出发，而不是孤立记忆结论；',
      '- 能把同一种判断方法迁移到不同学科场景；',
      '- 在证据不足时会主动要求更具体的例子。',
    ].join('\n'),
    evidence: [
      {
        title: '数组与链表',
        summary: '从存储约束解释访问、插入和删除代价。',
        sourceGroup: 'outcome',
      },
      {
        title: '游戏反馈',
        summary: '从玩家后续行为判断反馈是否提供了新信息。',
        sourceGroup: 'behavior',
      },
      {
        title: '适用边界',
        summary: '遇到不熟悉领域时，仍需要先建立基本概念边界。',
        sourceGroup: 'boundary',
        boundary: true,
      },
    ],
    synthesis: '两门课程中重复出现了“从结构或行为证据推出结论”的稳定路径，且能够跨主题迁移。',
  },
  {
    claimId: 'counter-evidence',
    markdown: [
      '### 你能修正直觉，但开放问题中仍容易过早收敛',
      '',
      '当具体行为证据出现时，你愿意放弃“内容太少所以重复”这样的初始解释，转向检查反馈是否改变下一次行动。相较之下，在证据尚不完整的开放问题中，你有时会较快接受第一个能自洽的答案。',
      '',
      '- 看见反例后能快速更新原有解释；',
      '- 对具体行为证据的敏感度正在提高；',
      '- 形成结论前可再主动寻找一个替代解释。',
    ].join('\n'),
    evidence: [
      { title: '初始解释', summary: '把玩家停下归因于素材数量不足。', sourceGroup: 'reflection' },
      {
        title: '证据修正',
        summary: '发现玩家仍在操作，但不再改变路线判断。',
        sourceGroup: 'behavior',
      },
      {
        title: '反向证据',
        summary: '在缺少行为记录的问题中，结论更新速度会明显下降。',
        sourceGroup: 'boundary',
        boundary: true,
      },
    ],
    synthesis: '你具备依据证据改写判断的能力；下一步重点不是更快得出结论，而是扩大候选解释。',
  },
  {
    claimId: 'concrete-context',
    markdown: [
      '### 你在对话中更容易通过具体场景暴露真实理解',
      '',
      '面对抽象定义时，你的回答往往较短；一旦问题被放入原型、玩家行为或具体数据结构中，你会主动补充条件、提出例外，并清楚区分“相关”与“正在解释当前问题”。',
      '',
      '- 案例化问题比自我报告更能呈现你的掌握程度；',
      '- 愿意指出题目中缺少的条件；',
      '- 在具体任务中更常产生可验证的判断。',
    ].join('\n'),
    evidence: [
      {
        title: '抽象提问',
        summary: '回答集中在定义复述，较少主动展开边界。',
        sourceGroup: 'behavior',
      },
      {
        title: '案例提问',
        summary: '能够根据玩家行为拆分行动、反馈和目标推进。',
        sourceGroup: 'behavior',
      },
      {
        title: '限制',
        summary: '样本主要来自近期两门课程，尚不代表所有学习情境。',
        sourceGroup: 'boundary',
        boundary: true,
      },
    ],
    synthesis: '具体场景稳定地提高了回答中的条件意识和证据密度，但这一判断仍需更多课程验证。',
  },
];

export function PortraitFixture() {
  return (
    <AppShellView
      brandSubtitle="学习画像"
      headerBeforeStatus={<span className="lm-pill">● 接口 · Codex</span>}
      providerLabel="Codex"
      refresh={() => undefined}
      state={readyRuntime}
    >
      <PortraitWorkspace
        insights={insights}
        onRefresh={() => undefined}
        onSectionChange={() => undefined}
        summary="最近的学习中，你很少停留在结论记忆，而是持续追问“这个结构必须维持什么”以及“用户的下一次行动是否真的改变”。当新的证据与原判断冲突时，你通常能够修正解释；开放问题中的反证搜索仍有进一步加强空间。"
        title="你擅长从结构约束建立判断，也愿意用行为证据修正最初直觉"
        updatedLabel="7月12日"
      />
    </AppShellView>
  );
}
