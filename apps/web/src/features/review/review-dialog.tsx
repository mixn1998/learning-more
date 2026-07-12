import Markdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export function ReviewDialog(props: { readonly markdown: string; readonly open: boolean }) {
  if (!props.open) return null;
  return (
    <div role="dialog" aria-modal="true" className="dialog">
      <header>
        <h2>课时 Review</h2>
      </header>
      <div className="review-body">
        <Markdown rehypePlugins={[rehypeSanitize]}>{props.markdown}</Markdown>
      </div>
      <footer>
        <a href="#lesson-record">查看课节记录</a>
        <a href="/">返回课程大纲</a>
      </footer>
    </div>
  );
}
