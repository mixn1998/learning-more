export type HistorySection = 'statistics' | 'calendar' | 'portrait';

const sections: readonly Readonly<{ id: HistorySection; label: string }>[] = [
  { id: 'statistics', label: '历史统计' },
  { id: 'calendar', label: '学习日历' },
  { id: 'portrait', label: '学习画像' },
];

export function HistorySectionTabs(props: {
  readonly active: HistorySection;
  readonly onChange: (section: HistorySection) => void;
}) {
  return (
    <nav role="tablist" aria-label="历史功能">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          role="tab"
          aria-selected={props.active === section.id}
          onClick={() => props.onChange(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
