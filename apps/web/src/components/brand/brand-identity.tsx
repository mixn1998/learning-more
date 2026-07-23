export function BrandIdentity(props: { readonly subtitle?: string }) {
  return (
    <span className="lm-brand-identity">
      <span aria-hidden="true" className="lm-brand-mark">
        <img alt="" src="/brand/learning-more-mark.svg" />
      </span>
      <span className="lm-brand-copy">
        <strong>Learning MORE</strong>
        {props.subtitle === undefined ? null : <span>{props.subtitle}</span>}
      </span>
    </span>
  );
}
