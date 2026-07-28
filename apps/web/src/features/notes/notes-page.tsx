import { useEffect, useMemo, useState } from 'react';

import type { LearningNoteView } from '@learning-more/contracts';

import {
  learningNotesClient,
  type LearningNotesClient,
} from '../../client/learning-notes-client.js';

import './notes-page.css';

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

export function NotesPage(props: { readonly client?: LearningNotesClient }) {
  const api = props.client ?? learningNotesClient;
  const [notes, setNotes] = useState<LearningNoteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [editingDraft, setEditingDraft] = useState('');
  const [busy, setBusy] = useState(false);

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

  const groups = useMemo(() => {
    const byDiscipline = new Map<string, Map<string, LearningNoteView[]>>();
    for (const note of notes) {
      const courses = byDiscipline.get(note.discipline) ?? new Map<string, LearningNoteView[]>();
      const courseNotes = courses.get(note.courseTitle) ?? [];
      courseNotes.push(note);
      courses.set(note.courseTitle, courseNotes);
      byDiscipline.set(note.discipline, courses);
    }
    return [...byDiscipline.entries()];
  }, [notes]);

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
          <p>课堂中的独立记录会按学科与课程自动整理。</p>
        </div>
        <a className="lm-btn" href="/">
          返回首页
        </a>
      </section>
      {error === undefined ? null : <p role="alert">{error}</p>}
      {loading ? (
        <section className="lm-card notes-empty">正在载入学习笔记……</section>
      ) : groups.length === 0 ? (
        <section className="lm-card notes-empty">
          <h2>还没有保存笔记</h2>
          <p>进入任意课节，即可在课堂右侧记录第一条学习笔记。</p>
        </section>
      ) : (
        groups.map(([discipline, courses]) => (
          <section className="notes-discipline" key={discipline}>
            <h2>{discipline}</h2>
            {[...courses.entries()].map(([courseTitle, courseNotes]) => (
              <section className="lm-card notes-course" key={courseTitle}>
                <h3>{courseTitle}</h3>
                <div className="notes-list">
                  {courseNotes.map((note) => (
                    <article className="notes-item" key={note.id}>
                      <header>
                        <strong>{note.lessonTitle}</strong>
                        <time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time>
                      </header>
                      {editingId === note.id ? (
                        <>
                          <textarea
                            aria-label="编辑学习笔记"
                            rows={5}
                            value={editingDraft}
                            onChange={(event) => setEditingDraft(event.target.value)}
                          />
                          <div className="lm-actions">
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
                        <>
                          <p>{note.markdown}</p>
                          <div className="notes-item-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(note.id);
                                setEditingDraft(note.markdown);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="danger"
                              type="button"
                              onClick={() => void remove(note)}
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </section>
        ))
      )}
    </main>
  );
}
