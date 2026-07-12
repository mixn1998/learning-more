import { useState } from 'react';

import type { ScheduleItemView } from '../../client/planning-client.js';

export function ScheduleBoard(props: {
  readonly items: readonly ScheduleItemView[];
  readonly onCreate: (input: {
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    timezoneAtCreation: string;
  }) => Promise<void>;
}) {
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  return (
    <section className="authoring-panel">
      <h2>正式排期</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void props.onCreate({
            courseId,
            lessonId,
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString(),
            timezoneAtCreation: 'Asia/Shanghai',
          });
        }}
      >
        <label>
          课程 ID
          <input value={courseId} onChange={(event) => setCourseId(event.target.value)} />
        </label>
        <label>
          课节 ID
          <input value={lessonId} onChange={(event) => setLessonId(event.target.value)} />
        </label>
        <label>
          开始时间
          <input
            type="datetime-local"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
          />
        </label>
        <label>
          结束时间
          <input
            type="datetime-local"
            value={endAt}
            onChange={(event) => setEndAt(event.target.value)}
          />
        </label>
        <button type="submit">创建手工排期</button>
      </form>
      {props.items.length === 0 ? (
        <p>暂无正式排期</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>课节</th>
              <th>开始</th>
              <th>结束</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {props.items.map((item) => (
              <tr key={item.id}>
                <td>{item.lessonId}</td>
                <td>{item.startAt}</td>
                <td>{item.endAt}</td>
                <td>{item.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
