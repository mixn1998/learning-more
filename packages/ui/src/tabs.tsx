import { useId, type KeyboardEvent, type ReactNode } from 'react';

export type TabOption<T extends string> = Readonly<{ id: T; label: ReactNode }>;

export function tabId(idPrefix: string, optionId: string): string {
  return `${idPrefix}-tab-${optionId}`;
}

export function tabPanelId(idPrefix: string, optionId: string): string {
  return `${idPrefix}-panel-${optionId}`;
}

export function Tabs<T extends string>(props: {
  readonly label: string;
  readonly active: T;
  readonly options: readonly TabOption<T>[];
  readonly onChange: (id: T) => void;
  readonly idPrefix?: string;
  readonly as?: 'div' | 'nav';
  readonly className?: string;
  readonly tabClassName?: string | ((option: TabOption<T>, active: boolean) => string);
  readonly activeAriaCurrent?: 'page';
  readonly children?: ReactNode;
  readonly renderInactivePanels?: boolean;
}) {
  const generatedId = useId().replaceAll(':', '');
  const idPrefix = props.idPrefix ?? `lm-tabs-${generatedId}`;
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? props.options.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + props.options.length) %
            props.options.length;
    const option = props.options[next];
    if (option === undefined) return;
    props.onChange(option.id);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]');
    buttons?.[next]?.focus();
  };
  const Component = props.as ?? 'div';
  return (
    <>
      <Component aria-label={props.label} className={props.className ?? 'lm-tabs'} role="tablist">
        {props.options.map((option, index) => {
          const active = option.id === props.active;
          const className =
            typeof props.tabClassName === 'function'
              ? props.tabClassName(option, active)
              : (props.tabClassName ?? 'lm-tab');
          return (
            <button
              aria-controls={tabPanelId(idPrefix, option.id)}
              aria-current={active ? props.activeAriaCurrent : undefined}
              aria-selected={active}
              className={className}
              id={tabId(idPrefix, option.id)}
              key={option.id}
              onClick={() => props.onChange(option.id)}
              onKeyDown={(event) => move(event, index)}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
        {props.children}
      </Component>
      {props.renderInactivePanels
        ? props.options
            .filter((option) => option.id !== props.active)
            .map((option) => (
              <div
                aria-labelledby={tabId(idPrefix, option.id)}
                hidden
                id={tabPanelId(idPrefix, option.id)}
                key={option.id}
                role="tabpanel"
              />
            ))
        : null}
    </>
  );
}
