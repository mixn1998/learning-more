import './lesson-navigation-workspace.css';

export type LessonNavigationPoint = Readonly<{
  marker: string;
  title: string;
  /** Legacy fixture/input compatibility; navigation intentionally does not render descriptions. */
  description?: string;
}>;

export function LessonNavigationWorkspace(props: {
  readonly state: 'not_started' | 'abandoned';
  readonly title: string;
  readonly courseTitle: string;
  readonly moduleLabel?: string;
  readonly outlineVersionLabel?: string;
  readonly points: readonly LessonNavigationPoint[];
  readonly primaryLabel?: string;
  readonly onPrimary: () => void;
  readonly onBackToOutline: () => void;
  readonly onBackHome?: () => void;
  readonly onViewRecord?: () => void;
  readonly statusMessage?: string;
}) {
  const abandoned = props.state === 'abandoned';
  return (
    <div className={`lesson-navigation-workspace lesson-navigation-workspace--${props.state}`}>
      <header className="lm-topbar lesson-navigation-topbar">
        <div className="lm-brand">
          <strong>Learning MORE</strong>
          <span>{abandoned ? '正式课程 · 恢复学习' : '正式课程 · 课节导航'}</span>
        </div>
        <div className="lm-topbar-tools">
          <div className="lm-global-runtime">
            <a className="lm-runtime-button ok" href="/runtime?tab=ai">
              <span aria-hidden="true" className="lm-runtime-dot" />
              <span>
                <b>AI 接口 · Codex</b>
                <small>连接正常</small>
              </span>
            </a>
            <a className="lm-runtime-button ok" href="/runtime?tab=service">
              <span aria-hidden="true" className="lm-runtime-dot" />
              <span>
                <b>本地服务 · 准备就绪</b>
                <small>实例与版本已核验</small>
              </span>
            </a>
          </div>
        </div>
      </header>
      <main className="nav-stage">
        <section className="lm-card nav-modal">
          <header className="nav-head">
            {abandoned ? (
              <div className="nav-return-actions">
                <button className="lm-btn" onClick={props.onBackToOutline} type="button">
                  返回课程大纲
                </button>
                <button className="lm-btn" onClick={props.onBackHome} type="button">
                  返回主页
                </button>
              </div>
            ) : null}
            <div className="lm-mode-badge">● 标准模式</div>
            {abandoned ? <div className="lm-kicker nav-state-kicker">已放弃 · 恢复导航</div> : null}
            <h1>{props.title}</h1>
            {abandoned ? (
              <p>恢复后解除原始学习会话冻结，继续使用同一会话，不创建续学会话。</p>
            ) : null}
          </header>
          <div className="nav-body">
            {abandoned ? null : (
              <div className="nav-context">
                <span className="lm-pill">{props.courseTitle}</span>
                <span className="lm-pill">{props.moduleLabel ?? '正式课程课节'}</span>
              </div>
            )}
            <div className="nav-points">
              {props.points.map((point, index) => (
                <div className="nav-point" key={`${point.marker}:${point.title}:${index}`}>
                  <b>{point.marker}</b>
                  <strong>{point.title}</strong>
                </div>
              ))}
            </div>
            {abandoned ? (
              <div className="nav-inherit">
                {props.statusMessage ??
                  '当前阶段 Review 与原始对话保持只读；恢复后解除冻结并切换为“学习中”。'}
              </div>
            ) : null}
          </div>
          <footer className="nav-foot">
            {abandoned ? (
              <span>
                本课来自{props.outlineVersionLabel ?? '当前大纲'}，当前课程仍为
                {props.outlineVersionLabel?.replace(/^大纲\s*/u, '') ?? '当前版本'}。
              </span>
            ) : null}
            <div className="lm-actions">
              {abandoned ? null : (
                <>
                  <button className="lm-btn" onClick={props.onBackHome} type="button">
                    返回主页
                  </button>
                  <button className="lm-btn" onClick={props.onBackToOutline} type="button">
                    返回课程大纲
                  </button>
                </>
              )}
              {abandoned ? (
                <button className="lm-btn" onClick={props.onViewRecord} type="button">
                  查看记录
                </button>
              ) : null}
              <button className="lm-btn primary" onClick={props.onPrimary} type="button">
                {props.primaryLabel ?? (abandoned ? '恢复学习' : '开始学习')}
              </button>
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}
