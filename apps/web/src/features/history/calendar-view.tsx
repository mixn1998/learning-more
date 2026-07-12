export function CalendarView(props: {
  readonly days: readonly Readonly<{
    localDate: string;
    actualSeconds: number;
    completedLessonIds: readonly string[];
  }>[];
  readonly selectedDate?: string;
  readonly onSelect: (date: string) => void;
}) {
  return (
    <section className="authoring-panel">
      <h2>学习日历</h2>
      <ul>
        {props.days.map((day) => (
          <li key={day.localDate}>
            <button
              type="button"
              aria-pressed={day.localDate === props.selectedDate}
              onClick={() => props.onSelect(day.localDate)}
            >
              {day.localDate} · {day.actualSeconds}s
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
