import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly busy?: boolean;
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly variant?: Exclude<ButtonVariant, 'ghost'>;
}

function buttonClasses(variant: ButtonVariant, className?: string) {
  const variantClass = variant === 'secondary' || variant === 'ghost' ? undefined : variant;
  return ['lm-button', 'lm-btn', variantClass, className].filter(Boolean).join(' ');
}

export function Button({
  variant = 'secondary',
  busy = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={busy}
      className={buttonClasses(variant, className)}
      data-variant={variant}
      disabled={disabled === true || busy}
    >
      {children}
    </button>
  );
}

export function ButtonLink({ variant = 'secondary', className, ...props }: ButtonLinkProps) {
  return <a {...props} className={buttonClasses(variant, className)} data-variant={variant} />;
}
