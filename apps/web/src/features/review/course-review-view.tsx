import { useState } from 'react';

import type {
  CourseArchiveView,
  CourseFinalReviewDocument,
  CourseOutlineVersionView,
  ReviewTextBlock,
} from '@learning-more/contracts';
import { AiContent, AiSurface, Button } from '@learning-more/ui';

import { courseModeDefinition } from '../../course-mode-registry.js';
import { useCourseModeTheme } from '../../use-course-mode-theme.js';

import './course-review-view.css';

export type CourseReviewDocument = Readonly<{
  knowledge: readonly Readonly<{ title: string; detail: string }>[];
  strengths: Readonly<{ title: string; detail: string }>;
  development: Readonly<{ title: string; detail: string }>;
  boundary: Readonly<{ title: string; detail: string }>;
  extensions: readonly Readonly<{ title: string; detail: string }>[];
}>;

type CourseReviewProjection = Readonly<{
  title?: string;
  lead?: string;
  knowledge: readonly ReviewTextBlock[];
  strengths: readonly ReviewTextBlock[];
  development: readonly ReviewTextBlock[];
  boundaries: readonly ReviewTextBlock[];
  extensions: readonly ReviewTextBlock[];
  additionalSections: readonly ReviewTextBlock[];
}>;

function section(markdown: string, heading: string): string {
  const match = markdown.match(
    new RegExp(`(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'),
  );
  return match?.[1]?.trim() ?? '';
}

function reviewDocument(markdown: string): CourseReviewDocument {
  const knowledge = section(markdown, '核心知识线索');
  const performance = section(markdown, '总体学习表现');
  const extensions = section(markdown, '推荐扩展课程');
  return {
    knowledge: [
      {
        title: '课程核心知识已经汇总',
        detail: knowledge || '核心知识线索来自确认版大纲与已归档课时 Review。',
      },
    ],
    strengths: {
      title: '稳定优势',
      detail: performance || '学习表现仅依据课程内可追溯的真实互动与 Review。',
    },
    development: {
      title: '需要继续发展',
      detail: '继续在新的问题情境中验证已经形成的判断。',
    },
    boundary: {
      title: '可继续探索的知识边界',
      detail: '沿当前主题向相邻问题扩展，并保留可验证的学习证据。',
    },
    extensions: [
      {
        title: '基于当前主题创建扩展课程',
        detail: extensions || '把下一阶段问题作为独立课程继续深化。',
      },
    ],
  };
}

function projection(
  document: CourseFinalReviewDocument | CourseReviewDocument | undefined,
  markdown: string,
): CourseReviewProjection {
  if ((document as CourseFinalReviewDocument | undefined)?.kind === 'course-final') {
    const structured = document as CourseFinalReviewDocument;
    return {
      title: structured.title,
      ...(structured.lead === undefined ? {} : { lead: structured.lead }),
      knowledge: structured.knowledgeThreads,
      strengths: structured.strengths,
      development: structured.development,
      boundaries: structured.boundaries,
      extensions: structured.extensions,
      additionalSections: structured.additionalSections ?? [],
    };
  }
  const legacy = (document ?? reviewDocument(markdown)) as CourseReviewDocument;
  return {
    knowledge: legacy.knowledge.map((item) => ({ title: item.title, markdown: item.detail })),
    strengths: [{ title: legacy.strengths.title, markdown: legacy.strengths.detail }],
    development: [{ title: legacy.development.title, markdown: legacy.development.detail }],
    boundaries: [{ title: legacy.boundary.title, markdown: legacy.boundary.detail }],
    extensions: legacy.extensions.map((item) => ({
      title: item.title,
      markdown: item.detail,
    })),
    additionalSections: [],
  };
}

const toc = [
  ['knowledge', '核心知识线索'],
  ['performance', '总体学习表现'],
  ['boundaries', '可继续探索'],
  ['extensions', '推荐扩展课程'],
] as const;

export function CourseReviewView(props: {
  readonly course: CourseArchiveView;
  readonly currentOutline?: CourseOutlineVersionView | undefined;
  readonly markdown: string;
  readonly document?: CourseFinalReviewDocument | CourseReviewDocument | undefined;
  readonly onNavigate: (path: string) => void;
}) {
  const [active, setActive] = useState<(typeof toc)[number][0]>('knowledge');
  const document = projection(props.document, props.markdown);
  const lessonCount = props.course.lessons?.length ?? props.course.lessonIds.length;
  const mode = courseModeDefinition(props.course.courseMode);
  useCourseModeTheme(props.course.courseMode);

  return (
    <main className="lm-page course-review-page" data-course-mode={props.course.courseMode}>
      <section className="lm-card course-review-hero">
        <div>
          <div className="lm-chips">
            <span className="lm-pill success">课程已关闭</span>
            <span className="lm-mode-badge">● {mode.label}</span>
          </div>
          <div className="lm-kicker course-review-hero__kicker">COURSE REVIEW</div>
          <h1>{document.title ?? props.course.title}</h1>
          {document.lead === undefined ? (
            <p>基于确认版大纲与 {lessonCount} 个可用课时 Review 汇总生成。</p>
          ) : (
            <AiContent markdown={document.lead} />
          )}
        </div>
        <div className="lm-actions">
          <Button type="button" onClick={() => props.onNavigate('/')}>
            返回主页
          </Button>
          <Button
            type="button"
            onClick={() => props.onNavigate(`/courses/${props.course.courseId}`)}
          >
            返回课程大纲
          </Button>
        </div>
      </section>

      <div className="course-review-layout">
        <aside aria-label="主题总结导航" className="lm-card course-review-toc">
          <b>主题总结</b>
          <span>{lessonCount} 个课节已完成</span>
          {toc.map(([id, label]) => (
            <a
              key={id}
              className={active === id ? 'active' : undefined}
              href={`#${id}`}
              onClick={() => setActive(id)}
            >
              {label}
            </a>
          ))}
        </aside>

        <AiSurface className="lm-card course-review-content">
          <section className="course-review-section" id="knowledge">
            <h2 className="course-review-section__title">主题核心知识线索</h2>
            <div className="course-review-knowledge-list">
              {document.knowledge.map((item) => (
                <article key={item.title} className="course-review-knowledge-item">
                  <b>{item.title}</b>
                  <AiContent markdown={item.markdown} />
                </article>
              ))}
            </div>
          </section>
          <section className="course-review-section" id="performance">
            <h2 className="course-review-section__title">总体学习表现</h2>
            <div className="course-review-performance-grid">
              {[...document.strengths, ...document.development].map((item) => (
                <article key={item.title} className="course-review-performance-card">
                  <b>{item.title}</b>
                  <AiContent markdown={item.markdown} />
                </article>
              ))}
            </div>
          </section>
          <section className="course-review-section" id="boundaries">
            <h2 className="course-review-section__title">可继续探索的知识边界</h2>
            {document.boundaries.map((item) => (
              <article className="course-review-boundary" key={item.title}>
                <b>{item.title}</b>
                <AiContent markdown={item.markdown} />
              </article>
            ))}
          </section>
          <section className="course-review-section" id="extensions">
            <h2 className="course-review-section__title">推荐扩展课程</h2>
            <div className="course-review-extension-grid">
              {document.extensions.map((item) => (
                <article key={item.title}>
                  <b>{item.title}</b>
                  <AiContent markdown={item.markdown} />
                </article>
              ))}
            </div>
          </section>
          {document.additionalSections.map((item) => (
            <section className="course-review-section" key={item.title}>
              <h2 className="course-review-section__title">{item.title}</h2>
              <AiContent markdown={item.markdown} />
            </section>
          ))}
        </AiSurface>
      </div>
    </main>
  );
}
