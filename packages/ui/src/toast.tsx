import type { ReactNode } from 'react';

export function Toast(props: { readonly children: ReactNode; readonly assertive?: boolean }) {
  return (
    <div className="lm-toast" role={props.assertive === true ? 'alert' : 'status'}>
      {props.children}
    </div>
  );
}
