import { tabId, tabPanelId, Tabs, type TabOption } from '@learning-more/ui';

export type HistorySection = 'statistics' | 'calendar' | 'portrait';

const sections: readonly Readonly<{ id: HistorySection; label: string }>[] = [
  { id: 'statistics', label: '历史统计' },
  { id: 'calendar', label: '学习日历' },
  { id: 'portrait', label: '学习画像' },
];

const historyTabsIdPrefix = 'history-primary';

export function historySectionPanelAttributes(section: HistorySection) {
  return {
    'aria-labelledby': tabId(historyTabsIdPrefix, section),
    id: tabPanelId(historyTabsIdPrefix, section),
    role: 'tabpanel' as const,
    tabIndex: 0,
  };
}

export function HistorySectionTabs(props: {
  readonly active: HistorySection;
  readonly onChange: (section: HistorySection) => void;
  readonly className?: string;
  readonly tabClassName?: (section: HistorySection, active: boolean) => string;
}) {
  return (
    <Tabs
      active={props.active}
      activeAriaCurrent="page"
      as="nav"
      idPrefix={historyTabsIdPrefix}
      label="历史功能"
      options={sections}
      onChange={props.onChange}
      renderInactivePanels
      {...(props.className === undefined ? {} : { className: props.className })}
      {...(props.tabClassName === undefined
        ? {}
        : {
            tabClassName: (option: TabOption<HistorySection>, active: boolean) =>
              props.tabClassName?.(option.id, active) ?? '',
          })}
    />
  );
}
