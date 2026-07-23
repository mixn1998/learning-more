import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

export function Field(props: {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="lm-field">
      <span className="lm-field__label">{props.label}</span>
      {props.children}
      {props.hint === undefined ? null : <small>{props.hint}</small>}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={['lm-control', className].filter(Boolean).join(' ')} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={['lm-control', className].filter(Boolean).join(' ')} />;
}

export function LabelledTextInput(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string },
) {
  const id = useId();
  return (
    <label className="lm-field" htmlFor={id}>
      <span>{props.label}</span>
      <TextInput {...props} id={id} />
    </label>
  );
}
