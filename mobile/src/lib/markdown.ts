// Lightweight markdown flattener for assistant chat bubbles. The web renders
// full markdown (renderMarkdown), but RN has no DOM and we don't want to pull a
// heavy markdown renderer in for the first SSE port. This strips the common
// inline/block markers so replies read cleanly as plain text:
//   **bold** / *italic* / `code`  -> unwrapped
//   # headings                    -> plain line
//   - / * / 1. list bullets       -> "• "
//   [text](url)                   -> text
// Rich rendering (real bold, tappable links) is a deferred polish item.
export function flattenMarkdown(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => {
      let l = line;
      l = l.replace(/^#{1,6}\s+/, ''); // headings
      l = l.replace(/^\s*[-*+]\s+/, '• '); // unordered bullets
      l = l.replace(/^\s*(\d+)\.\s+/, '$1. '); // keep ordered numbering
      l = l.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1'); // links -> text
      l = l.replace(/(\*\*|__)(.*?)\1/g, '$2'); // bold
      l = l.replace(/(\*|_)(.*?)\1/g, '$2'); // italic
      l = l.replace(/`([^`]+)`/g, '$1'); // inline code
      return l;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
