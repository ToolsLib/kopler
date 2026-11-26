import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';

export function MarkdownBody({ body, onError }: { body: string; onError: (error: unknown) => void }) {
  const [expanded, setExpanded] = useState(false);
  const shortened = body.length > 4000 && !expanded;
  return <div className="item-body">
    <Markdown remarkPlugins={[remarkGfm]} urlTransform={url => url} components={{
      a: ({ href, children }) => /^https?:\/\//i.test(href ?? '')
        ? <a href={href} onClick={event => { event.preventDefault(); event.stopPropagation(); void api.openUrl(href!).catch(onError); }}>{children}</a>
        : <span title={href}>{children}</span>,
      img: ({ alt }) => <span className="markdown-image-label">{alt || 'Image reference'}</span>,
      input: ({ checked }) => <input type="checkbox" checked={checked} disabled aria-label={checked ? 'Completed Markdown task' : 'Markdown task'} />,
    }}>{shortened ? body.slice(0, 4000) + '\n\n…' : body}</Markdown>
    {body.length > 4000 && <button className="markdown-expand" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show more'}</button>}
  </div>;
}
