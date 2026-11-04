import type { ReactNode } from "react";

// Tiny, safe Markdown subset. Builds React elements only (no innerHTML) and renders
// links as plain text, so pasted content can never inject markup or navigate the webview.

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let fence: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++}>
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (fence) {
        blocks.push(<pre key={key++}>{fence.join("\n")}</pre>);
        fence = null;
      } else {
        flushList();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const Tag = `h${h[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Tag key={key++}>{inline(h[2])}</Tag>);
    } else if (line.trim()) {
      blocks.push(<p key={key++}>{inline(line)}</p>);
    }
  }
  if (fence) blocks.push(<pre key={key++}>{fence.join("\n")}</pre>);
  flushList();
  return <div className="md">{blocks}</div>;
}
