import { useEffect, useMemo, useState } from 'react';

import type { LearningNoteView } from '@learning-more/contracts';

import {
  learningNotesClient,
  type LearningNotesClient,
} from '../../client/learning-notes-client.js';

import './notes-page.css';

type CourseGroup = Readonly<{
  id: string;
  title: string;
  notes: readonly LearningNoteView[];
  noteCount: number;
}>;

type DisciplineGroup = Readonly<{
  name: string;
  courses: readonly CourseGroup[];
  noteCount: number;
}>;

type NoteScope = Readonly<{
  key: string;
  label: string;
  path: readonly string[];
  discipline?: string;
  courseId?: string;
}>;

const selectedScopeStorageKey = 'learning-more:notes:selected-scope';
const expandedScopeStorageKey = 'learning-more:notes:expanded-scopes';
const allScope: NoteScope = { key: 'all', label: '全部笔记', path: ['全部笔记'] };

const encodeKeyPart = (value: string) => encodeURIComponent(value);
const disciplineKey = (discipline: string) => `discipline:${encodeKeyPart(discipline)}`;
const courseKey = (courseId: string) => `course:${encodeKeyPart(courseId)}`;

function storedExpandedScopes(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(expandedScopeStorageKey) ?? '[]') as unknown;
    return new Set(
      Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function noteMatchesScope(note: LearningNoteView, scope: NoteScope): boolean {
  if (scope.courseId !== undefined) return note.courseId === scope.courseId;
  if (scope.discipline !== undefined) return note.discipline === scope.discipline;
  return true;
}

export function NotesPage(props: { readonly client?: LearningNotesClient }) {
  const api = props.client ?? learningNotesClient;
  const [notes, setNotes] = useState<LearningNoteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [editingDraft, setEditingDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedScopeKey, setSelectedScopeKey] = useState(
    () => localStorage.getItem(selectedScopeStorageKey) ?? '',
  );
  const [expandedScopes, setExpandedScopes] = useState(storedExpandedScopes);

  useEffect(() => {
    let active = true;
    void api
      .list()
      .then((entries) => {
        if (active) setNotes(entries);
      })
      .catch(() => {
        if (active) setError('学习笔记暂时无法载入。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const navigation = useMemo(() => {
    const sortedNotes = [...notes].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
    const disciplineMaps = new Map<
      string,
      Map<string, { title: string; notes: LearningNoteView[] }>
    >();

    for (const note of sortedNotes) {
      const courses = disciplineMaps.get(note.discipline) ?? new Map();
      const course = courses.get(note.courseId) ?? {
        title: note.courseTitle,
        notes: [],
      };
      course.notes.push(note);
      courses.set(note.courseId, course);
      disciplineMaps.set(note.discipline, courses);
    }

    const disciplines: DisciplineGroup[] = [...disciplineMaps.entries()].map(
      ([discipline, courses]) => {
        const courseGroups: CourseGroup[] = [...courses.entries()].map(([courseId, course]) => ({
          id: courseId,
          title: course.title,
          notes: course.notes,
          noteCount: course.notes.length,
        }));
        return {
          name: discipline,
          courses: courseGroups,
          noteCount: courseGroups.reduce((total, course) => total + course.noteCount, 0),
        };
      },
    );

    const scopes = new Map<string, NoteScope>([[allScope.key, allScope]]);
    for (const discipline of disciplines) {
      const disciplineScope: NoteScope = {
        key: disciplineKey(discipline.name),
        label: discipline.name,
        path: [discipline.name],
        discipline: discipline.name,
      };
      scopes.set(disciplineScope.key, disciplineScope);
      for (const course of discipline.courses) {
        const currentCourseKey = courseKey(course.id);
        scopes.set(currentCourseKey, {
          key: currentCourseKey,
          label: course.title,
          path: [discipline.name, course.title],
          discipline: discipline.name,
          courseId: course.id,
        });
      }
    }

    return { disciplines, scopes, sortedNotes };
  }, [notes]);

  useEffect(() => {
    if (loading || notes.length === 0) return;
    if (navigation.scopes.has(selectedScopeKey)) return;
    const latest = navigation.sortedNotes[0];
    if (latest === undefined) return;
    const nextScope = courseKey(latest.courseId);
    setSelectedScopeKey(nextScope);
    setExpandedScopes((current) => {
      const next = new Set(current);
      next.add(disciplineKey(latest.discipline));
      return next;
    });
  }, [loading, navigation, notes.length, selectedScopeKey]);

  useEffect(() => {
    if (selectedScopeKey !== '') {
      localStorage.setItem(selectedScopeStorageKey, selectedScopeKey);
    }
  }, [selectedScopeKey]);

  useEffect(() => {
    localStorage.setItem(expandedScopeStorageKey, JSON.stringify([...expandedScopes]));
  }, [expandedScopes]);

  const selectedScope = navigation.scopes.get(selectedScopeKey) ?? allScope;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleNotes = useMemo(
    () =>
      navigation.sortedNotes.filter(
        (note) =>
          noteMatchesScope(note, selectedScope) &&
          (normalizedQuery === '' ||
            `${note.markdown} ${note.courseTitle} ${note.lessonTitle}`
              .toLocaleLowerCase()
              .includes(normalizedQuery)),
      ),
    [navigation.sortedNotes, normalizedQuery, selectedScope],
  );

  const toggleExpanded = (key: string) => {
    setExpandedScopes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectScope = (scope: NoteScope, parentKeys: readonly string[] = []) => {
    setSelectedScopeKey(scope.key);
    if (parentKeys.length > 0) {
      setExpandedScopes((current) => new Set([...current, ...parentKeys]));
    }
  };

  const saveEdit = async (note: LearningNoteView) => {
    if (busy || editingDraft.trim() === '') return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await api.update(note, editingDraft.trim());
      setNotes((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(undefined);
    } catch {
      setError('修改失败，原笔记未改变。');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (note: LearningNoteView) => {
    if (busy || !window.confirm('删除这条笔记？')) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.remove(note);
      setNotes((current) => current.filter((item) => item.id !== note.id));
    } catch {
      setError('删除失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="lm-page notes-page">
      <section className="lm-card notes-hero">
        <div>
          <div className="lm-kicker">Learning notes</div>
          <h1>学习笔记</h1>
          <p>沿着学科、课程与课时，重新找到课堂中形成的理解。</p>
        </div>
        <a className="lm-btn" href="/">
          返回首页
        </a>
      </section>
      {error === undefined ? null : (
        <p className="notes-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <section className="lm-card notes-empty">正在载入学习笔记……</section>
      ) : navigation.disciplines.length === 0 ? (
        <section className="lm-card notes-empty">
          <h2>还没有保存笔记</h2>
          <p>进入任意课节，即可在课堂右侧记录第一条学习笔记。</p>
        </section>
      ) : (
        <div className="lm-card notes-workspace">
          <aside className="notes-directory">
            <header>
              <div>
                <span>知识目录</span>
                <strong>{notes.length} 条</strong>
              </div>
            </header>
            <nav aria-label="学习笔记知识目录">
              <button
                className={`notes-directory-all${selectedScope.key === 'all' ? ' active' : ''}`}
                type="button"
                onClick={() => selectScope(allScope)}
              >
                <span>全部笔记</span>
                <small>{notes.length}</small>
              </button>
              <ul className="notes-tree">
                {navigation.disciplines.map((discipline) => {
                  const currentDisciplineKey = disciplineKey(discipline.name);
                  const disciplineExpanded = expandedScopes.has(currentDisciplineKey);
                  const disciplineScope = navigation.scopes.get(currentDisciplineKey)!;
                  return (
                    <li key={discipline.name}>
                      <div className="notes-tree-row notes-tree-discipline">
                        <button
                          aria-label={`${disciplineExpanded ? '收起' : '展开'}${discipline.name}`}
                          aria-expanded={disciplineExpanded}
                          className="notes-tree-toggle"
                          type="button"
                          onClick={() => toggleExpanded(currentDisciplineKey)}
                        >
                          <span aria-hidden="true">›</span>
                        </button>
                        <button
                          className={`notes-tree-label${
                            selectedScope.key === currentDisciplineKey ? ' active' : ''
                          }`}
                          type="button"
                          onClick={() => {
                            selectScope(disciplineScope, [currentDisciplineKey]);
                          }}
                        >
                          <span>{discipline.name}</span>
                          <small>{discipline.noteCount}</small>
                        </button>
                      </div>
                      {disciplineExpanded ? (
                        <ul>
                          {discipline.courses.map((course) => {
                            const currentCourseKey = courseKey(course.id);
                            const courseScope = navigation.scopes.get(currentCourseKey)!;
                            return (
                              <li key={course.id}>
                                <button
                                  className={`notes-tree-course-label${
                                    selectedScope.key === currentCourseKey ? ' active' : ''
                                  }`}
                                  type="button"
                                  onClick={() => selectScope(courseScope, [currentDisciplineKey])}
                                >
                                  <span>{course.title}</span>
                                  <small>{course.noteCount}</small>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          <section className="notes-content">
            <header className="notes-content-head">
              <div className="notes-content-context">
                <nav aria-label="当前笔记范围" className="notes-current-path">
                  {selectedScope.path.map((part, index) => (
                    <span key={`${part}:${index}`}>
                      {index === 0 ? null : <i aria-hidden="true">/</i>}
                      <b>{part}</b>
                    </span>
                  ))}
                </nav>
                <span>{visibleNotes.length} 条笔记</span>
              </div>
              <label className="notes-search">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="10.5" cy="10.5" r="5.75" />
                  <path d="m15 15 4.25 4.25" />
                </svg>
                <span className="sr-only">搜索当前目录笔记</span>
                <input
                  type="search"
                  placeholder="搜索当前目录中的笔记"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </header>

            {visibleNotes.length === 0 ? (
              <div className="lm-card notes-no-results">
                <strong>{normalizedQuery === '' ? '这里还没有笔记' : '没有找到匹配内容'}</strong>
                <p>
                  {normalizedQuery === ''
                    ? '可以从左侧切换到其他课程。'
                    : '换一个关键词，或从左侧扩大查看范围。'}
                </p>
              </div>
            ) : (
              <div className="notes-stream">
                {visibleNotes.map((note) => (
                  <article className="notes-item" key={note.id}>
                    <header>
                      <div className="notes-item-source">
                        <span>来源</span>
                        <strong>
                          {note.discipline} / {note.courseTitle} / {note.lessonTitle}
                        </strong>
                      </div>
                      <div className="notes-item-meta">
                        {editingId === note.id ? null : (
                          <div className="notes-item-actions">
                            <button
                              className="notes-item-action"
                              type="button"
                              onClick={() => {
                                setEditingId(note.id);
                                setEditingDraft(note.markdown);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="danger notes-item-action"
                              type="button"
                              onClick={() => void remove(note)}
                            >
                              删除
                            </button>
                          </div>
                        )}
                        <time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time>
                      </div>
                    </header>
                    {editingId === note.id ? (
                      <>
                        <textarea
                          aria-label="编辑学习笔记"
                          rows={6}
                          value={editingDraft}
                          onChange={(event) => setEditingDraft(event.target.value)}
                        />
                        <div className="lm-actions notes-edit-actions">
                          <button
                            className="lm-btn"
                            type="button"
                            onClick={() => setEditingId(undefined)}
                          >
                            取消
                          </button>
                          <button
                            className="lm-btn primary"
                            disabled={busy || editingDraft.trim() === ''}
                            type="button"
                            onClick={() => void saveEdit(note)}
                          >
                            保存修改
                          </button>
                        </div>
                      </>
                    ) : (
                      <p>{note.markdown}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
