import { escapeHtml } from './escape-html.js';

export function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function tableCells(line) {
  const source = String(line || '').trim();
  const cells = [];
  let cell = '';
  let inCode = false;
  let hasDivider = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && source[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (character === '`') {
      inCode = !inCode;
      cell += character;
    } else if (character === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
      hasDivider = true;
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());

  if (!hasDivider) return null;
  if (source.startsWith('|')) cells.shift();
  if (source.endsWith('|') && !source.endsWith('\\|')) cells.pop();
  return cells;
}

function tableAlignments(line) {
  const cells = tableCells(line);
  if (!cells?.length || cells.some(cell => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    return 'left';
  });
}

function renderTableCell(tag, value, alignment) {
  const className = alignment === 'left' ? '' : ` class="align-${alignment}"`;
  const scope = tag === 'th' ? ' scope="col"' : '';
  return `<${tag}${scope}${className}>${renderInlineMarkdown(value)}</${tag}>`;
}

export function renderMarkdown(value) {
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let list = null;
  let inCode = false;
  let codeLines = [];

  const closeList = () => {
    if (list) {
      output.push(`</${list}>`);
      list = null;
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (/^```/.test(line)) {
      closeList();
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const headerCells = tableCells(line);
    const alignments = tableAlignments(lines[lineIndex + 1]);
    if (headerCells?.length && alignments?.length === headerCells.length) {
      closeList();
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length) {
        const rowCells = tableCells(lines[lineIndex]);
        if (!rowCells) break;
        rows.push(Array.from({ length: headerCells.length }, (_, index) => rowCells[index] || ''));
        lineIndex += 1;
      }
      lineIndex -= 1;
      const head = headerCells.map((cell, index) => renderTableCell('th', cell, alignments[index])).join('');
      const body = rows.map(row => `<tr>${row.map((cell, index) => renderTableCell('td', cell, alignments[index])).join('')}</tr>`).join('');
      output.push(`<div class="markdown-table-scroll" role="region" aria-label="Scrollable table" tabindex="0"><table><thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table></div>`);
    } else if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      const nextList = unordered ? 'ul' : 'ol';
      if (list !== nextList) {
        closeList();
        list = nextList;
        output.push(`<${list}>`);
      }
      output.push(`<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`);
    } else if (/^>\s?/.test(line)) {
      closeList();
      output.push(`<blockquote>${renderInlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`);
    } else if (line.trim()) {
      closeList();
      output.push(`<p>${renderInlineMarkdown(line.trim())}</p>`);
    } else {
      closeList();
    }
  }

  closeList();
  if (inCode) {
    output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  return output.join('');
}

export function markdownPreviewText(value) {
  return String(value || '')
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/gm, '')
    .replace(/^\s*\||\|\s*$/gm, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/^(#{1,6}|>)\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
