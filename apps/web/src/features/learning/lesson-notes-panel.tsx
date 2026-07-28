import { useEffect, useState } from 'react';

import type { LearningNoteView } from '@learning-more/contracts';

import {
  learningNotesClient,
  type LearningNotesClient,
} from '../../client/learning-notes-client.js';

const draftKey = (courseId: string, lessonId: string) =>
  `learning-more:note-draft:${courseId}:${lessonId}`;

function noteTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function LessonNotesPanel(props: {
  readonly courseId: string;
  readonly lessonId: string;
  readonly lessonTitle: string;
  readonly client?: LearningNotesClient;
}) {
  const api = props.client ?? learningNotesClient;
  const storageKey = draftKey(props.courseId, props.lessonId);
  const titleStorageKey = `${storageKey}:title`;
  const [notes, setNotes] = useState<LearningNoteView[]>([]);
  const [draft, setDraft] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [titleDraft, setTitleDraft] = useState(
    () => localStorage.getItem(titleStorageKey) ?? props.lessonTitle,
  );
  const [editingId, setEditingId] = useState<string>();
  const [editingTitleDraft, setEditingTitleDraft] = useState('');
  const [editingDraft, setEditingDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setError(undefined);
    void api
      .list({ courseId: props.courseId, lessonId: props.lessonId })
      .then((entries) => {
        if (active) setNotes(entries);
      })
      .catch(() => {
        if (active) setError('笔记暂时无法载入，请稍后重试。');
      });
    return () => {
      active = false;
    };
  }, [api, props.courseId, props.lessonId]);

  useEffect(() => {
    localStorage.setItem(storageKey, draft);
  }, [draft, storageKey]);

  useEffect(() => {
    if (titleDraft === props.lessonTitle) localStorage.removeItem(titleStorageKey);
    else localStorage.setItem(titleStorageKey, titleDraft);
  }, [props.lessonTitle, titleDraft, titleStorageKey]);

  const save = async () => {
    const markdown = draft.trim();
    const title = titleDraft.trim() || props.lessonTitle;
    if (markdown === '' || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const note = await api.create({
        courseId: props.courseId,
        lessonId: props.lessonId,
        title,
        markdown,
      });
      setNotes((current) => [note, ...current]);
      setTitleDraft(props.lessonTitle);
      setDraft('');
      localStorage.removeItem(storageKey);
      localStorage.removeItem(titleStorageKey);
    } catch {
      setError('保存失败，草稿已保留。');
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (note: LearningNoteView) => {
    const markdown = editingDraft.trim();
    const title = editingTitleDraft.trim();
    if (title === '' || markdown === '' || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await api.update(note, { title, markdown });
      setNotes((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(undefined);
      setEditingTitleDraft('');
      setEditingDraft('');
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
      if (editingId === note.id) setEditingId(undefined);
    } catch {
      setError('删除失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lm-card lesson-notes-panel">
      <div className="lesson-notes-head">
        <h3>本课笔记</h3>
        <a href="/notes">全部笔记</a>
      </div>
      <div className="lesson-note-compose">
        <input
          aria-label="笔记标题"
          maxLength={200}
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
        />
        <textarea
          aria-label="记录本课笔记"
          placeholder="记下此刻的重要理解……"
          rows={4}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
          }}
        />
        <div className="lesson-note-compose-actions">
          <small>Ctrl+Enter 保存</small>
          <button
            className="lm-btn primary"
            disabled={busy || draft.trim() === ''}
            type="button"
            onClick={() => void save()}
          >
            保存
          </button>
        </div>
      </div>
      {error === undefined ? null : (
        <p className="lesson-note-error" role="alert">
          {error}
        </p>
      )}
      <div aria-label="本课已保存笔记" className="lesson-note-list">
        {notes.length === 0 ? (
          <p className="lesson-note-empty">保存后，本课的笔记会连续显示在这里。</p>
        ) : (
          notes.map((note) => (
            <article className="lesson-note-item" key={note.id}>
              {editingId === note.id ? (
                <>
                  <input
                    aria-label="编辑笔记标题"
                    maxLength={200}
                    value={editingTitleDraft}
                    onChange={(event) => setEditingTitleDraft(event.target.value)}
                  />
                  <textarea
                    aria-label="编辑笔记"
                    rows={4}
                    value={editingDraft}
                    onChange={(event) => setEditingDraft(event.target.value)}
                  />
                  <div className="lesson-note-item-actions">
                    <button
                      className="lm-btn"
                      type="button"
                      onClick={() => {
                        setEditingId(undefined);
                        setEditingTitleDraft('');
                      }}
                    >
                      取消
                    </button>
                    <button
                      className="lm-btn primary"
                      disabled={
                        busy || editingTitleDraft.trim() === '' || editingDraft.trim() === ''
                      }
                      type="button"
                      onClick={() => void submitEdit(note)}
                    >
                      保存修改
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="lesson-note-item-head">
                    <strong>{note.title}</strong>
                    <time dateTime={note.createdAt}>{noteTime(note.createdAt)}</time>
                  </div>
                  <p>{note.markdown}</p>
                  <div className="lesson-note-item-actions">
                    <button
                      className="lesson-note-text-button"
                      type="button"
                      onClick={() => {
                        setEditingId(note.id);
                        setEditingTitleDraft(note.title);
                        setEditingDraft(note.markdown);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className="lesson-note-text-button danger"
                      type="button"
                      onClick={() => void remove(note)}
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
