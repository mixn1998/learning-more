import Markdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export function MessageStream(props: { readonly assistantMarkdown: string }) {
  return (
    <section aria-live="polite" className="authoring-panel">
      {props.assistantMarkdown === '' ? (
        <p>开始提问后，回答会显示在这里。</p>
      ) : (
        <Markdown rehypePlugins={[rehypeSanitize]}>{props.assistantMarkdown}</Markdown>
      )}
    </section>
  );
}
