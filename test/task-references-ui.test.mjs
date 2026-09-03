import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, app, style] = await Promise.all([
  readFile(new URL('public/index.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/style.css', root), 'utf8'),
]);

test('the composer and task-card menu expose all task reference scopes', () => {
  assert.match(html, /id="task-references"[^>]*hidden/);
  assert.match(html, /Right-click another task to attach its conversation\./);
  assert.match(html, /id="task-reference-list"[^>]*aria-live="polite"/);
  assert.match(html, /id="task-reference-menu"[^>]*role="menu"[^>]*hidden/);
  for (const scope of ['prompts', 'responses', 'both']) {
    assert.match(html, new RegExp(`data-task-reference-scope="${scope}"`));
  }
  assert.match(html, />My messages</);
  assert.match(html, />AI responses</);
  assert.match(html, />Both</);
});

test('right click and the keyboard context-menu gesture open the task reference menu', () => {
  assert.match(app, /card\.addEventListener\('contextmenu'/);
  assert.match(app, /event\.preventDefault\(\);[\s\S]{0,180}openTaskReferenceMenu/);
  assert.match(app, /textSelectionGuard\.isActive\(\)[\s\S]{0,100}event\.target\.closest\('a, input, select, textarea'\)/);
  assert.match(app, /event\.key === 'ContextMenu'/);
  assert.match(app, /event\.shiftKey && event\.key === 'F10'/);
  assert.match(app, /role="menuitem"/);
  assert.match(app, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(app, /event\.key === 'Escape'/);
});

test('attaching reads canonical task history and keeps references inside the active project', () => {
  assert.match(app, /const detail = await api\(`\/api\/tasks\/\$\{taskId\}`\)/);
  assert.match(app, /createTaskReference\(detail, scope\)/);
  assert.match(app, /sameProjectPath\(detail\.task\?\.repo_path, state\.activeProjectPath\)/);
  assert.match(app, /state\.taskReferences = \[\.\.\.state\.taskReferences, reference\]/);
  assert.match(app, /updateTaskReferenceScope\(reference, event\.target\.value\)/);
  assert.match(app, /data-remove-task-reference/);
});

test('submission includes frozen task context in every workflow and clears it only after acceptance', () => {
  assert.match(app, /const submissionTaskReferences = quickSkill \? \[\] : state\.taskReferences/);
  assert.match(
    app,
    /const submittedPrompt = taskReferencePrompt\([\s\S]{0,120}quickSkill\?\.prompt \|\| formData\.get\('prompt'\),[\s\S]{0,80}submissionTaskReferences/,
  );
  assert.equal((app.match(/prompt: submittedPrompt/g) || []).length, 4);
  const accepted = app.indexOf("if (!createdTask) {");
  const cleared = app.indexOf('state.taskReferences = [];', accepted);
  assert.ok(accepted >= 0 && cleared > accepted);
  assert.match(app.slice(cleared, cleared + 420), /renderTaskReferences\(\)/);
  assert.match(app, /taskReferences = state\.taskReferences/);
  assert.match(app, /taskReferencePromptIssue\(prompt, taskReferences\)/);
});

test('task reference tickets and context menu support compact and dark layouts', () => {
  assert.match(style, /\.task-reference-ticket[\s\S]*border-right: 1px dashed/);
  assert.match(style, /\.task-reference-menu[\s\S]*position: fixed[\s\S]*z-index: 420/);
  assert.match(style, /html\[data-theme="dark"\] \.task-references/);
  assert.match(style, /html\[data-theme="dark"\] \.task-reference-menu/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*\.task-reference-item/);
});
