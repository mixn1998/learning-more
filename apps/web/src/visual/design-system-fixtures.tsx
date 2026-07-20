import type { CSSProperties, ReactNode } from 'react';

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Grid,
  ModeBadge,
  ModeIcon,
  Page,
} from '@learning-more/ui';

import { COURSE_MODE_REGISTRY, type CourseModeDefinition } from '../course-mode-registry.js';
import { BrandIdentity } from '../components/brand/brand-identity.js';
import { RuntimeStatusCards } from '../layouts/app-shell.js';

import './design-system-fixtures.css';

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

function SampleHeader(props: { readonly subtitle: string }) {
  return (
    <header className="lm-topbar">
      <div className="lm-brand">
        <BrandIdentity subtitle={props.subtitle} />
      </div>
      <div aria-label="运行状态" className="lm-topbar-tools">
        <RuntimeStatusCards providerLabel="Codex" providerReady status="ready" />
        <ButtonLink href="/">返回索引</ButtonLink>
      </div>
    </header>
  );
}

function StatusSample(props: {
  readonly tone: 'success' | 'warning' | 'danger' | 'readonly';
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={`status lm-status-${props.tone}`}>
      <b>{props.title}</b>
      <p>{props.children}</p>
    </div>
  );
}

function modeVariables(mode: CourseModeDefinition): CustomProperties {
  return {
    '--accent': mode.accent,
    '--accent-dark': mode.accentDark,
    '--tint': mode.tint,
  };
}

function VisualFixtureRoot(props: { readonly children: ReactNode }) {
  return <div className="visual-design-system">{props.children}</div>;
}

export function UiComponentsFixture() {
  return (
    <VisualFixtureRoot>
      <SampleHeader subtitle="共享组件与状态语义" />
      <Page className="visual-ui-components">
        <Card className="demo">
          <div className="lm-kicker">Identity</div>
          <h1>模式色不等于状态色</h1>
          <div className="compare">
            <div className="sample" style={modeVariables(COURSE_MODE_REGISTRY[8]!)}>
              <ModeBadge>¶ 阅读研讨</ModeBadge>
              <p>表示课程来源与体验身份。</p>
            </div>
            <div className="sample">
              <Badge tone="success">● 已完成</Badge>
              <p>表示生命周期状态，始终使用全局成功色。</p>
            </div>
          </div>
        </Card>
        <Card className="demo">
          <h2>全局状态</h2>
          <Grid className="status-grid" columns={2}>
            <StatusSample tone="success" title="已完成">
              最终 Review 已成功写入。
            </StatusSample>
            <StatusSample tone="warning" title="生成中">
              等待 AI 输出或后台事务。
            </StatusSample>
            <StatusSample tone="danger" title="生成失败">
              保留已有事实并提供安全重试。
            </StatusSample>
            <StatusSample tone="readonly" title="永久只读">
              最终 Review 与关闭课程档案不可修改。
            </StatusSample>
          </Grid>
        </Card>
        <Card className="demo">
          <h2>共享操作</h2>
          <div className="row">
            <Button type="button">次要操作</Button>
            <Button type="button" variant="primary">
              主操作
            </Button>
            <Button type="button" variant="danger">
              危险操作
            </Button>
            <Badge>中性标签</Badge>
            <Badge tone="readonly">只读归档</Badge>
          </div>
        </Card>
      </Page>
    </VisualFixtureRoot>
  );
}

function CourseModeToken(props: { readonly mode: CourseModeDefinition }) {
  const { mode } = props;
  return (
    <Card className="token" data-course-mode={mode.id} style={modeVariables(mode)}>
      <div className="token-head">
        <ModeIcon>{mode.icon}</ModeIcon>
        <div>
          <h2>{mode.label}</h2>
          <p>
            {mode.id} · {mode.subtitle}
          </p>
        </div>
      </div>
      <div className="swatches" aria-label={`${mode.label}色板`}>
        <div className="swatch" style={{ background: mode.accent }} />
        <div className="swatch" style={{ background: mode.tint }} />
        <div className="swatch" style={{ background: '#fffdf9', borderColor: mode.accent }} />
      </div>
    </Card>
  );
}

export function CourseModesFixture() {
  return (
    <VisualFixtureRoot>
      <SampleHeader subtitle="九模式视觉身份注册表" />
      <Page className="visual-course-modes">
        <div className="lm-section-title">
          <div>
            <div className="lm-kicker">Design system</div>
            <h1>九模式视觉身份</h1>
            <p>模式只表达课程来源身份；状态色继续表达成功、警告、错误和只读。</p>
          </div>
        </div>
        <Grid className="tokens">
          {COURSE_MODE_REGISTRY.map((mode) => (
            <CourseModeToken key={mode.id} mode={mode} />
          ))}
        </Grid>
        <Card className="levels">
          <h2>渐进式身份强度</h2>
          <div className="level-grid">
            <div className="level">
              <strong>创建 · 强</strong>
              <p>整卡、图标、输入区和用户气泡使用模式色。</p>
            </div>
            <div className="level">
              <strong>学习 · 中弱</strong>
              <p>仅顶部标识、用户气泡和局部进度使用模式色。</p>
            </div>
            <div className="level">
              <strong>Review · 弱</strong>
              <p>只保留模式徽标、细强调线和章节锚点。</p>
            </div>
          </div>
        </Card>
      </Page>
    </VisualFixtureRoot>
  );
}
