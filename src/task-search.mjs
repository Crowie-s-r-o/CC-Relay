const SEARCH_TERM_LIMIT = 12;

function searchableCharacter(character) {
  return /[\p{L}\p{N}]/u.test(character);
}

function foldedText(value, { withMap = false } = {}) {
  const text = String(value ?? '');
  let folded = '';
  const map = [];
  let offset = 0;
  let pendingSpace = false;
  let pendingSpaceOffset = 0;

  for (const sourceCharacter of text) {
    const sourceOffset = offset;
    offset += sourceCharacter.length;
    const decomposed = sourceCharacter.normalize('NFKD');
    for (const character of decomposed) {
      if (/\p{M}/u.test(character)) continue;
      if (searchableCharacter(character)) {
        if (pendingSpace && folded) {
          folded += ' ';
          if (withMap) map.push(pendingSpaceOffset);
        }
        pendingSpace = false;
        const lowered = character.toLowerCase();
        folded += lowered;
        if (withMap) {
          for (let index = 0; index < lowered.length; index += 1) map.push(sourceOffset);
        }
      } else if (folded && !pendingSpace) {
        pendingSpace = true;
        pendingSpaceOffset = sourceOffset;
      }
    }
  }
  return withMap ? { text, folded, map } : folded;
}

export function normalizeTaskSearchText(value) {
  return foldedText(value);
}

export function parseTaskSearchQuery(value) {
  const query = String(value ?? '').trim().slice(0, 200);
  const terms = [];
  const seen = new Set();
  const matcher = /"([^"]+)"|([^\s"]+)/gu;
  for (const match of query.matchAll(matcher)) {
    const term = normalizeTaskSearchText(match[1] || match[2]);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= SEARCH_TERM_LIMIT) break;
  }
  return { query, folded: normalizeTaskSearchText(query), terms };
}

function occurrences(text, term) {
  let count = 0;
  let offset = 0;
  while (count < 4) {
    const index = text.indexOf(term, offset);
    if (index === -1) break;
    count += 1;
    offset = index + Math.max(1, term.length);
  }
  return count;
}

function sourceWeight(source) {
  if (source === 'name') return 70;
  if (source === 'command') return 48;
  return 34;
}

function sourceLabel(source, index) {
  if (source === 'name') return 'Task name';
  if (source === 'command') return index === 0 ? 'Original command' : `Command ${index + 1}`;
  return `Response ${index + 1}`;
}

function entryMatches(entry, terms) {
  const folded = normalizeTaskSearchText(entry.text);
  const matchingTerms = terms.filter((term) => folded.includes(term));
  return { ...entry, folded, matchingTerms };
}

function originalRange(mapped, foldedStart, foldedEnd) {
  if (!mapped.map.length || foldedStart < 0 || foldedEnd <= foldedStart) return null;
  const start = mapped.map[Math.min(foldedStart, mapped.map.length - 1)];
  const lastOffset = mapped.map[Math.min(foldedEnd - 1, mapped.map.length - 1)];
  const lastCharacter = String.fromCodePoint(mapped.text.codePointAt(lastOffset));
  return [start, lastOffset + lastCharacter.length];
}

function allOriginalRanges(text, terms) {
  const mapped = foldedText(text, { withMap: true });
  const ranges = [];
  for (const term of terms) {
    let offset = 0;
    while (ranges.length < 24) {
      const index = mapped.folded.indexOf(term, offset);
      if (index === -1) break;
      const range = originalRange(mapped, index, index + term.length);
      if (range) ranges.push(range);
      offset = index + Math.max(1, term.length);
    }
  }
  return ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
}

function mergedRanges(ranges) {
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

function safeSliceStart(text, index) {
  if (index > 0 && /[\uDC00-\uDFFF]/u.test(text[index])) return index - 1;
  return index;
}

function safeSliceEnd(text, index) {
  if (index < text.length && /[\uDC00-\uDFFF]/u.test(text[index])) return index + 1;
  return index;
}

function matchExcerpt(text, terms, maximumLength = 240) {
  const ranges = mergedRanges(allOriginalRanges(text, terms));
  const first = ranges[0] || [0, 0];
  let start = safeSliceStart(text, Math.max(0, first[0] - 72));
  let end = safeSliceEnd(text, Math.min(text.length, start + maximumLength));
  if (end - start < maximumLength && start > 0) {
    start = safeSliceStart(text, Math.max(0, end - maximumLength));
  }
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const excerpt = `${prefix}${text.slice(start, end)}${suffix}`;
  const highlights = ranges
    .filter(([rangeStart, rangeEnd]) => rangeEnd > start && rangeStart < end)
    .map(([rangeStart, rangeEnd]) => [
      Math.max(rangeStart, start) - start + prefix.length,
      Math.min(rangeEnd, end) - start + prefix.length,
    ]);
  return { excerpt, highlights };
}

function documentEntries(document) {
  return [
    ...(document.title ? [{ source: 'name', index: 0, text: document.title }] : []),
    ...(document.commands || []).map((text, index) => ({ source: 'command', index, text })),
    ...(document.responses || []).map((text, index) => ({ source: 'response', index, text })),
  ].filter((entry) => typeof entry.text === 'string' && entry.text.trim());
}

function rankedDocument(document, parsed) {
  const entries = documentEntries(document).map((entry) => entryMatches(entry, parsed.terms));
  const exactId = [`${document.taskId}`, `#${document.taskId}`].includes(parsed.query.toLowerCase());
  if (!exactId && parsed.terms.some((term) => !entries.some((entry) => entry.folded.includes(term)))) {
    return null;
  }

  let score = exactId ? 1_000 : 0;
  let best = entries[0];
  let bestEntryScore = -1;
  for (const entry of entries) {
    if (!entry.matchingTerms.length) continue;
    const weight = sourceWeight(entry.source);
    const entryOccurrences = entry.matchingTerms.reduce(
      (total, term) => total + occurrences(entry.folded, term),
      0,
    );
    let entryScore = (entry.matchingTerms.length * weight) + (entryOccurrences * 3);
    if (entry.matchingTerms.length === parsed.terms.length) entryScore += 90;
    if (parsed.folded && entry.folded.includes(parsed.folded)) entryScore += 55;
    if (parsed.folded && entry.folded === parsed.folded) entryScore += 110;
    score += entryScore;
    if (entryScore > bestEntryScore) {
      best = entry;
      bestEntryScore = entryScore;
    }
  }
  if (!best) return null;
  const snippetTerms = best.matchingTerms.length ? best.matchingTerms : parsed.terms;
  return {
    taskId: document.taskId,
    score,
    match: {
      source: best.source,
      label: sourceLabel(best.source, best.index),
      ...matchExcerpt(best.text, snippetTerms),
    },
  };
}

export function searchTaskDocuments(documents, query, { limit = 200 } = {}) {
  const parsed = parseTaskSearchQuery(query);
  if (!parsed.terms.length && !/^#?\d+$/u.test(parsed.query)) {
    return { query: parsed.query, total: 0, results: [] };
  }
  const matches = (documents || [])
    .map((document) => rankedDocument(document, parsed))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || right.taskId - left.taskId);
  return {
    query: parsed.query,
    total: matches.length,
    results: matches.slice(0, Math.max(1, Math.min(Number(limit) || 200, 200))),
  };
}
