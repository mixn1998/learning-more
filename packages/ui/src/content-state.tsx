import type { ReactNode } from 'react';

export function ContentState(props: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly role?: 'status' | 'alert';
}) {
  return (
    <section className="lm-content-state" role={props.role ?? 'status'}>
      <strong>{props.title}</strong>
      {props.description === undefined ? null : <p>{props.description}</p>}
      {props.action}
    </section>
  );
}
