import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('the console renders Claude and Codex sub-agent runs as their own signal', () => {
  assert.match(app, /subAgentEntryDetails,/);
  assert.match(app, /const details = subAgentEntryDetails\(entry\);/);
  assert.match(app, /return subAgentPresentation\(entry, item, common\);/);
  assert.match(app, /kind: 'agent',/);
  assert.match(app, /title: 'Sub-agent',/);
  assert.match(app, /SUB_AGENT_STATUS_LABELS = \{\s*running: 'Running',\s*backgrounded: 'In background',\s*finished: 'Finished',/);
  assert.match(app, /if \(p\.kind === 'agent'\) \{/);
  assert.match(app, /class="term-signal-inline term-agent-name">\$\{escapeHtml\(p\.name\)\}/);
  assert.match(app, /data-agent-state="\$\{escapeHtml\(p\.agentState\)\}"/);
});

test('every sub-agent value the model controls is escaped before it reaches the DOM', () => {
  const branch = app.match(/if \(p\.kind === 'agent'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(branch, 'the sub-agent render branch is present');
  for (const field of ['p.name', 'p.status', 'p.agentType', 'p.agentState', 'p.duration', 'p.note']) {
    assert.match(branch, new RegExp(`escapeHtml\\(${field.replace('.', '\\.')}\\)`), `${field} is escaped`);
  }
  // The agent briefing goes through the shared output helper, which escapes its own content.
  assert.match(app, /eventOutputMarkup\(prompt, \{ label: 'brief' \}\)/);
});

test('the console counts live sub-agents next to its other signal counts', () => {
  assert.match(app, /eventStreamStats\(grouped, \{ turnEnded: task\.status !== 'running' \}\)/);
  assert.match(app, /stats\.agents \?[^\n]*has-agents[^\n]*\$\{stats\.agents\}[^\n]*sub-agents/);
  assert.match(style, /\.event-metrics \.has-agents b,\s*\.event-metrics \.has-agents small \{ color: var\(--term-cyan\); \}/);
});

test('the sub-agent signal keeps a calm hierarchy and respects reduced motion', () => {
  assert.match(style, /\.event-kind-agent \.term-glyph \{ color: var\(--term-cyan\); \}/);
  assert.match(style, /\.term-agent-name \{ color: var\(--term-fg\); font-weight: 600; \}/);
  const dot = style.match(/\.term-agent-live \{[^}]*\}/)?.[0] || '';
  assert.ok(dot, 'the live dot rule is present');
  assert.doesNotMatch(dot, /animation/, 'motion is opt-in, never part of the base rule');
  assert.match(
    style,
    /@media \(prefers-reduced-motion: no-preference\) \{\s*\.term-agent-live \{ animation: term-agent-pulse/,
  );
  // No new live region: sub-agent state reuses the existing terminal announcements.
  assert.doesNotMatch(app, /term-agent[^\n]*aria-live/);
});

test('the copy log carries the sub-agent name, outcome, and brief', () => {
  const branch = app.match(/if \(isSubAgentEntry\(entry\)\) \{[\s\S]*?\} else if \(item\?\.type === 'commandExecution'\) \{/g) || [];
  const copyBranch = branch.find((chunk) => chunk.includes('agentFinishedEvent'));
  assert.ok(copyBranch, 'the copy log handles sub-agent entries');
  assert.match(copyBranch, /presentation\.name/);
  assert.match(copyBranch, /summary/);
  assert.match(copyBranch, /details\?\.prompt \|\| item\?\.arguments\?\.prompt/);
});
