export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightSearch(text: string, query: string) {
  const escaped = escapeHtml(text);
  const trimmed = query.trim();
  if (!trimmed) {
    return escaped;
  }
  return escaped.replace(new RegExp(escapeRegExp(trimmed), "gi"), (match) => {
    return `<mark class="rounded bg-yellow-200 px-0.5 text-slate-900">${match}</mark>`;
  });
}

export function countMatches(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return 0;
  }
  const matches = text.match(new RegExp(escapeRegExp(trimmed), "gi"));
  return matches?.length ?? 0;
}
