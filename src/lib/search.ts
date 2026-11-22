// Shared search helpers: every word typed must match somewhere (any order), ignoring case, spaces and dashes in numbers.
const squash = (s: string) => s.toLowerCase().replace(/[\s\-_.()+/]/g, '');
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function buildHaystack(parts: Array<string | number | null | undefined>): { text: string; squashed: string } {
  const text = norm(parts.filter(p => p !== null && p !== undefined && p !== '').join(' | '));
  return { text, squashed: squash(text) };
}

export function matchesQuery(query: string, hay: { text: string; squashed: string }): boolean {
  const tokens = norm(query).split(' ').filter(Boolean);
  return tokens.every(t => hay.text.includes(t) || hay.squashed.includes(squash(t)));
}
