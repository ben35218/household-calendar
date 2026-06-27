// Tiny, dependency-free Markdown renderer for chat messages.
// Intentionally minimal: input is HTML-escaped first, then a small set of
// inline + block rules are applied, so the result is safe to use with v-html.
// Supports: **bold**, *italic*/_italic_, `code`, [links](http…), and
// unordered (-, *) / ordered (1.) lists. Everything else renders as text.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(s) {
  let out = escapeHtml(s);
  // inline code first so its contents aren't touched by other rules
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // links: [text](http(s)://…) — href is restricted to http/https by the regex
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, text, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  const html = [];
  let list = null; // 'ul' | 'ol' | null

  const closeList = () => {
    if (list) { html.push(`</${list}>`); list = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);

    if (ul) {
      if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; }
      html.push(`<li>${inline(ul[1])}</li>`);
    } else if (ol) {
      if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; }
      html.push(`<li>${inline(ol[1])}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('');
}
