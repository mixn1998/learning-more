import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

function classes(...values: readonly (string | undefined)[]) {
  return values.filter(Boolean).join(' ');
}

export function Page({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <main {...props} className={classes('lm-page', className)} />;
}

export function Stack({
  className,
  gap,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly gap?: string }) {
  const custom = gap === undefined ? style : ({ ...style, '--lm-stack-gap': gap } as CSSProperties);
  return <div {...props} className={classes('lm-stack', className)} style={custom} />;
}

export function Inline({
  className,
  gap,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly gap?: string }) {
  const custom =
    gap === undefined ? style : ({ ...style, '--lm-inline-gap': gap } as CSSProperties);
  return <div {...props} className={classes('lm-inline', className)} style={custom} />;
}

export function Grid({
  className,
  columns,
  gap,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly columns?: number; readonly gap?: string }) {
  const custom = {
    ...style,
    ...(columns === undefined ? {} : { '--lm-grid-columns': String(columns) }),
    ...(gap === undefined ? {} : { '--lm-grid-gap': gap }),
  } as CSSProperties;
  return <div {...props} className={classes('lm-grid', className)} style={custom} />;
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={classes('lm-panel', className)} />;
}

export function SectionHeader(props: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly level?: 1 | 2 | 3;
}) {
  const level = props.level ?? 2;
  const Heading = `h${level}` as const;
  return (
    <header className="lm-section-header">
      <div>
        <Heading>{props.title}</Heading>
        {props.description === undefined ? null : <p>{props.description}</p>}
      </div>
      {props.actions}
    </header>
  );
}
