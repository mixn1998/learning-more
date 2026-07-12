export function CourseClosurePanel(props: {
  readonly abandonedLessonIds: readonly string[];
  readonly onConfirm: () => void;
}) {
  return (
    <section className="authoring-panel">
      <h2>关闭课程</h2>
      {props.abandonedLessonIds.length > 0 ? (
        <>
          <p>以下课节已放弃，需要明确确认：</p>
          <ul>
            {props.abandonedLessonIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </>
      ) : null}
      <button type="button" onClick={props.onConfirm}>
        确认关闭课程
      </button>
    </section>
  );
}
