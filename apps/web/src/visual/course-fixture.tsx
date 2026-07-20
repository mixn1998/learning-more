import { useState } from 'react';

import { Dialog } from '@learning-more/ui';

import { FormalCourseView } from '../features/course/formal-course-view.js';
import { BrandIdentity } from '../components/brand/brand-identity.js';
import { OutlineRevisionWorkspace } from '../features/course/outline-revision-workspace.js';
import { CourseReviewView } from '../features/review/course-review-view.js';
import { AppShellView } from '../layouts/app-shell.js';
import type { RuntimeUiState } from '../state/version-guard.js';
import {
  COURSE_FIXTURE_ACTIVE,
  COURSE_FIXTURE_ACTIVE_STATES,
  COURSE_FIXTURE_CLOSED,
  COURSE_FIXTURE_CLOSED_STATES,
  COURSE_FIXTURE_DIRECTORY,
  COURSE_FIXTURE_OUTLINE,
  COURSE_FIXTURE_REVIEW_DOCUMENT,
  COURSE_FIXTURE_REVISION_CANDIDATE,
  COURSE_FIXTURE_REVISION_MESSAGES,
} from './course-fixture-data.js';

import './course-fixture.css';

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

export type CourseFixtureId =
  | 'course-active'
  | 'course-revision'
  | 'course-closed'
  | 'course-lifecycle-confirm'
  | 'course-review';

export function isCourseFixtureId(value: string): value is CourseFixtureId {
  return [
    'course-active',
    'course-revision',
    'course-closed',
    'course-lifecycle-confirm',
    'course-review',
  ].includes(value);
}

function DeleteCoursePreview() {
  const [dialogOpen, setDialogOpen] = useState(true);
  const [deleted, setDeleted] = useState(false);

  return (
    <div className="course-delete-preview-fixture">
      <header className="lm-topbar">
        <div className="lm-brand">
          <BrandIdentity subtitle="正式课程学习档案" />
        </div>
      </header>
      <main className="delete-preview-page">
        {deleted ? (
          <section aria-live="polite" className="lm-card delete-preview-hero" role="status">
            <div>
              <div className="lm-kicker">课程管理</div>
              <h1>课程已永久删除</h1>
              <p>相关课程档案与学习记录已从当前视图移除。</p>
            </div>
          </section>
        ) : (
          <div aria-hidden={dialogOpen} className="delete-course-preview">
            <section className="lm-card delete-preview-hero">
              <div>
                <div className="lm-kicker">STANDARD · 正式课程</div>
                <h1>{COURSE_FIXTURE_ACTIVE.title}</h1>
                <p>艺术与设计 · 游戏设计、核心循环 · 大纲 v1</p>
              </div>
              <div className="delete-preview-actions">
                <span className="lm-btn">返回主页</span>
                <span className="lm-btn">切换课程</span>
                <span className="lm-btn">修改大纲</span>
              </div>
            </section>
            <div className="delete-preview-grid">
              <section className="lm-card delete-preview-panel">
                <h2>课程单元</h2>
                <div className="delete-preview-lines">
                  <div />
                  <div />
                  <div />
                </div>
              </section>
              <aside className="lm-card delete-preview-panel">
                <h2>课程进度</h2>
              </aside>
            </div>
          </div>
        )}
        {dialogOpen ? (
          <div className="delete-preview-shade">
            <Dialog
              chrome="custom"
              className="delete-preview-dialog"
              initialFocusId="delete-preview-title"
              labelledBy="delete-preview-title"
              onClose={() => setDialogOpen(false)}
              open={dialogOpen}
            >
              <header>
                <div className="lm-kicker">课程管理</div>
                <h1 className="lm-dialog-initial-focus" id="delete-preview-title" tabIndex={-1}>
                  永久删除课程？
                </h1>
              </header>
              <div className="delete-preview-body">
                <p>
                  将永久删除 <strong>《{COURSE_FIXTURE_ACTIVE.title}》</strong>{' '}
                  的课程档案、课节学习记录、Review 与课程排期。
                </p>
                <p className="delete-preview-note">
                  此操作不可恢复。历史统计与学习画像会从底层事实中扣除此课程，并基于剩余记录重新计算。
                </p>
              </div>
              <footer>
                <button className="lm-btn" onClick={() => setDialogOpen(false)} type="button">
                  取消
                </button>
                <button
                  className="lm-btn danger"
                  onClick={() => {
                    setDeleted(true);
                    setDialogOpen(false);
                  }}
                  type="button"
                >
                  永久删除
                </button>
              </footer>
            </Dialog>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export function CourseFixture(props: { readonly fixtureId: CourseFixtureId }) {
  if (props.fixtureId === 'course-lifecycle-confirm') return <DeleteCoursePreview />;

  let content;
  let brandSubtitle = '正式课程学习档案';
  let headerBeforeStatus;
  let headerStatus: { tone: 'success' | 'readonly'; text: string } = {
    tone: 'success',
    text: '● 课程进行中',
  };

  if (props.fixtureId === 'course-revision') {
    brandSubtitle = '大纲调整会话 · 原课程模式不可更改';
    headerBeforeStatus = <span className="lm-mode-badge">● 标准模式</span>;
    headerStatus = { tone: 'success', text: '● 调整会话已保存' };
    content = (
      <OutlineRevisionWorkspace
        candidate={COURSE_FIXTURE_REVISION_CANDIDATE}
        course={COURSE_FIXTURE_ACTIVE}
        currentOutline={COURSE_FIXTURE_OUTLINE}
        initialMessages={COURSE_FIXTURE_REVISION_MESSAGES}
        onBack={() => undefined}
        onCancelGeneration={async () => undefined}
        onGenerate={async () => undefined}
        onPublish={async () => undefined}
        onSend={async () => undefined}
        phase="candidate-ready"
      />
    );
  } else if (props.fixtureId === 'course-review') {
    brandSubtitle = '课程主题总 Review';
    headerStatus = { tone: 'readonly', text: '● 永久只读' };
    content = (
      <CourseReviewView
        course={COURSE_FIXTURE_CLOSED}
        currentOutline={COURSE_FIXTURE_OUTLINE}
        document={COURSE_FIXTURE_REVIEW_DOCUMENT}
        markdown="# 主题总结"
        onNavigate={() => undefined}
      />
    );
  } else {
    const closed = props.fixtureId === 'course-closed';
    headerStatus = closed
      ? { tone: 'success', text: '● 课程已关闭' }
      : { tone: 'success', text: '● 课程进行中' };
    content = (
      <FormalCourseView
        availableCourses={COURSE_FIXTURE_DIRECTORY}
        course={closed ? COURSE_FIXTURE_CLOSED : COURSE_FIXTURE_ACTIVE}
        currentOutline={COURSE_FIXTURE_OUTLINE}
        lessonStates={closed ? COURSE_FIXTURE_CLOSED_STATES : COURSE_FIXTURE_ACTIVE_STATES}
        onCloseCourse={() => undefined}
        onDeleteCourse={async () => undefined}
        onModifyOutline={() => undefined}
        onNavigate={() => undefined}
        onOpenReview={() => undefined}
        onSelectVersion={async () => COURSE_FIXTURE_OUTLINE}
      />
    );
  }

  return (
    <AppShellView
      brandSubtitle={brandSubtitle}
      headerBeforeStatus={headerBeforeStatus}
      headerStatus={headerStatus}
      providerLabel="Codex"
      refresh={() => undefined}
      state={readyRuntime}
    >
      {content}
    </AppShellView>
  );
}
