import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

const focusable =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type DialogBaseProps = {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly className?: string;
  readonly initialFocusId?: string;
};

type StandardDialogProps = DialogBaseProps & {
  readonly chrome?: 'standard';
  readonly title: ReactNode;
  readonly footer?: ReactNode;
  readonly labelledBy?: string;
};

type CustomDialogProps = DialogBaseProps & {
  readonly chrome: 'custom';
  readonly labelledBy: string;
};

export function Dialog(props: StandardDialogProps | CustomDialogProps) {
  const generatedId = useId();
  const titleId = props.labelledBy ?? generatedId;
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!props.open) return undefined;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const requestedCandidate =
      props.initialFocusId === undefined
        ? undefined
        : document.getElementById(props.initialFocusId);
    const requested =
      requestedCandidate !== undefined &&
      requestedCandidate !== null &&
      dialogRef.current?.contains(requestedCandidate)
        ? requestedCandidate
        : undefined;
    const first =
      requested ?? dialogRef.current?.querySelector<HTMLElement>(focusable) ?? dialogRef.current;
    first?.focus();
    return () => previous?.focus();
  }, [props.open]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusable) ?? [])];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!props.open) return null;
  const surface = (
    <section
      aria-labelledby={titleId}
      aria-modal="true"
      className={
        props.chrome === 'custom'
          ? props.className
          : ['lm-dialog', props.className].filter(Boolean).join(' ')
      }
      onKeyDown={onKeyDown}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      {props.chrome === 'custom' ? (
        props.children
      ) : (
        <>
          <header className="lm-dialog__header">
            <h2 id={titleId}>{props.title}</h2>
          </header>
          <div className="lm-dialog__body">{props.children}</div>
          {props.footer === undefined ? null : (
            <footer className="lm-dialog__footer">{props.footer}</footer>
          )}
        </>
      )}
    </section>
  );
  if (props.chrome === 'custom') return surface;
  return (
    <div className="lm-dialog-backdrop" data-testid="dialog-backdrop">
      {surface}
    </div>
  );
}
