import { useEffect, useId, useRef, useState } from 'react';

export type HistoryCompactSelectOption<T extends string> = Readonly<{
  value: T;
  label: string;
}>;

export function HistoryCompactSelect<T extends string>(props: {
  readonly active: boolean;
  readonly label: string;
  readonly onChange: (value: T) => void;
  readonly options: readonly HistoryCompactSelectOption<T>[];
  readonly value: T;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = props.options[selectedIndex];

  useEffect(() => {
    if (open) return;
    setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [open]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const selectOption = (index: number) => {
    const option = props.options[index];
    if (option === undefined) return;
    props.onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (offset: number) => {
    setActiveIndex((current) => (current + offset + props.options.length) % props.options.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (open) moveActive(1);
        else openMenu();
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (open) moveActive(-1);
        else openMenu();
        break;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(props.options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) selectOption(activeIndex);
        else openMenu();
        break;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="history-stat-select" data-active={props.active} data-open={open} ref={rootRef}>
      <button
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        aria-controls={`${id}-options`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={props.label}
        className="history-stat-select-trigger"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span>{props.label}</span>
        <strong>{selected?.label ?? props.value}</strong>
        <i aria-hidden="true" />
      </button>
      {open ? (
        <div
          aria-label={`${props.label}选项`}
          className="history-stat-select-menu"
          id={`${id}-options`}
          role="listbox"
        >
          {props.options.map((option, index) => (
            <button
              aria-selected={option.value === props.value}
              className={`history-stat-select-option${index === activeIndex ? ' highlighted' : ''}`}
              id={`${id}-option-${index}`}
              key={option.value}
              onClick={() => selectOption(index)}
              onPointerMove={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
