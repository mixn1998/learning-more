import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export function AiContent(props: { readonly markdown: string; readonly className?: string }) {
  const className = ['lm-ai-content', props.className].filter(Boolean).join(' ');
  return (
    <div className={className} data-ai-content="true">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{props.markdown}</ReactMarkdown>
    </div>
  );
}
