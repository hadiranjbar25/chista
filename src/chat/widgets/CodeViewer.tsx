import { useState } from 'react';

export function CodeViewer({
  title,
  language,
  content,
}: {
  title: string;
  language: string;
  content: string;
}) {
  const [copied, setCopied] = useState('');
  return (
    <section className="response-widget code-viewer">
      <div className="action-row">
        <h3>{title}</h3>
        {language && <span className="pill">{language}</span>}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(content);
              setCopied('Copied');
            } catch {
              setCopied('Select the text to copy.');
            }
          }}
        >
          Copy
        </button>
        <span role="status">{copied}</span>
      </div>
      <pre>
        <code>{content}</code>
      </pre>
    </section>
  );
}
