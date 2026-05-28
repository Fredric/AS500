/**
 * Lightweight markdown renderer for AI chat messages.
 * Handles the patterns the LLM actually produces: headers, bold, italic,
 * inline code, code blocks, bullet lists, numbered lists, and horizontal rules.
 * Styled to match the green-screen terminal aesthetic.
 */

interface Props {
  content: string;
  streaming?: boolean;
}

type Block =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'hr' }
  | { type: 'code'; lang: string; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; text: string }
  | { type: 'blank' };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      i++;
      continue;
    }

    // Headings
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);
    if (h3) { blocks.push({ type: 'h3', text: h3[1] }); i++; continue; }
    if (h2) { blocks.push({ type: 'h2', text: h2[1] }); i++; continue; }
    if (h1) { blocks.push({ type: 'h1', text: h1[1] }); i++; continue; }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Unordered list — collect consecutive items
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      blocks.push({ type: 'blank' });
      i++;
      continue;
    }

    // Paragraph (or continuation)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^[-*+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      blocks.push({ type: 'p', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

/** Render inline markdown: **bold**, *italic*, `code`, [link](url) */
function InlineText({ text }: { text: string }) {
  // Split on inline patterns
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] !== undefined) parts.push(<strong key={m.index} className="md-bold">{m[2]}</strong>);
    else if (m[3] !== undefined) parts.push(<em key={m.index} className="md-em">{m[3]}</em>);
    else if (m[4] !== undefined) parts.push(<code key={m.index} className="md-code-inline">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <>{parts}</>;
}

export default function MarkdownMessage({ content, streaming }: Props) {
  const blocks = parseBlocks(content);

  return (
    <span className="md-root">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'blank':
            return <div key={i} className="md-blank" />;
          case 'hr':
            return <hr key={i} className="md-hr" />;
          case 'h1':
            return <div key={i} className="md-h1"><InlineText text={block.text} /></div>;
          case 'h2':
            return <div key={i} className="md-h2"><InlineText text={block.text} /></div>;
          case 'h3':
            return <div key={i} className="md-h3"><InlineText text={block.text} /></div>;
          case 'code':
            return (
              <pre key={i} className="md-code-block">
                {block.lang && <div className="md-code-lang">{block.lang}</div>}
                <code>{block.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={i} className="md-ul">
                {block.items.map((item, j) => (
                  <li key={j} className="md-li"><InlineText text={item} /></li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="md-ol">
                {block.items.map((item, j) => (
                  <li key={j} className="md-li"><InlineText text={item} /></li>
                ))}
              </ol>
            );
          case 'p':
            return (
              <p key={i} className="md-p">
                <InlineText text={block.text} />
                {streaming && i === blocks.length - 1 && (
                  <span className="ai-chat-cursor">&#x258C;</span>
                )}
              </p>
            );
          default:
            return null;
        }
      })}
      {streaming && blocks[blocks.length - 1]?.type !== 'p' && (
        <span className="ai-chat-cursor">&#x258C;</span>
      )}
    </span>
  );
}
