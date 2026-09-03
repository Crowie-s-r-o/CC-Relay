import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('task queue exposes attempt-aware CHANGELOG standups with dated follow-up questions', async () => {
  const [html, app, style, server] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
    readFile(new URL('src/server.mjs', root), 'utf8'),
  ]);
  const standupRoute = server.match(/if \(request\.method === 'POST' && pathname === '\/api\/standup\/generate'\) \{[\s\S]*?\n    \}\n\n    if \(request\.method === 'POST' && pathname === '\/api\/standup\/follow-up'\)/)?.[0] || '';
  const followUpRoute = server.match(/if \(request\.method === 'POST' && pathname === '\/api\/standup\/follow-up'\) \{[\s\S]*?\n    \}\n\n    if \(request\.method === 'GET' && pathname === '\/api\/diagnostics'\)/)?.[0] || '';

  assert.match(html, /id="standup-button"[^>]+aria-controls="standup-modal"/);
  assert.match(html, /<dialog id="standup-modal"[^>]+aria-labelledby="standup-title"/);
  assert.match(html, /id="standup-date" type="date"/);
  assert.match(html, /Start date/);
  assert.match(html, /id="standup-days"/);
  assert.match(html, /<option value="1">1 day<\/option>/);
  assert.match(html, /<option value="2">2 days<\/option>/);
  assert.match(html, /id="standup-custom-prompt"[^>]*maxlength="4000"/);
  assert.match(html, /Default custom prompt/);
  assert.match(html, /Added to every Standup generated for this Launchpad/);
  assert.match(html, /id="standup-custom-prompt-save"[^>]*>Save prompt/);
  assert.doesNotMatch(html, /id="standup-length"|All tasks|Short<\/option>|Standard<\/option>|Detailed<\/option>/);
  assert.match(html, /Added, Changed, Fixed, and Security/);
  assert.match(html, /id="standup-generator-provider"/);
  assert.match(html, /id="standup-generate"[^>]*>Generate changelog/);
  assert.match(html, /id="standup-copy"[^>]+disabled>Copy changelog/);
  assert.match(html, /id="standup-follow-up"[^>]+aria-labelledby="standup-follow-up-title"[^>]+hidden/);
  assert.match(html, /Dated Q&amp;A/);
  assert.match(html, /data-standup-question="What ran on each selected day\?"/);
  assert.match(html, /id="standup-follow-up-input"[^>]+maxlength="4000"/);
  assert.match(html, /id="standup-follow-up-send"[^>]*>Ask/);
  assert.match(html, /saved prompts and responses/);
  assert.match(html, /Task terminals are never used/);

  assert.match(app, /api\('\/api\/standup\/generate'/);
  assert.match(app, /api\('\/api\/standup\/follow-up'/);
  assert.match(app, /api\(`\/api\/projects\/\$\{project\.id\}\/standup-prompt`/);
  assert.match(app, /standupCustomPromptSupported\(\)[\s\S]*standupCustomPromptDirty\(\)[\s\S]*!await saveStandupCustomPrompt\(\)/);
  assert.match(app, /!state\.standupPromptEdited && !state\.standupPromptSaving/);
  assert.match(app, /projectStandupPrompt === true/);
  assert.match(app, /standup_custom_prompt/);
  assert.match(app, /state\.standupCustomPromptApplied = body\.customPromptApplied === true/);
  assert.match(app, /tasksForStandupDays\(projectTasks\(\), anchor, dayCount\)/);
  assert.doesNotMatch(app, /buildStandupSummary/);
  assert.match(app, /elements\.standupDate\.addEventListener\('change'/);
  assert.match(app, /elements\.standupDays\.addEventListener\('change'/);
  assert.match(app, /standupDateRange\(anchor, dayCount\)/);
  assert.match(app, /dateEnd: localDateInputValue\(finalDay\)/);
  assert.match(app, /maximum\.getDate\(\) - \(selectedStandupDays\(\) - 1\)/);
  assert.match(app, /elements\.standupDate\.max = value/);
  const openStandup = app.match(/function openStandup\(\) \{([\s\S]*?)\n\}\n\nfunction closeStandup/)?.[1] || '';
  assert.doesNotMatch(openStandup, /generateStandup/);
  assert.match(app, /state\.standupGenerating = true/);
  assert.match(app, /state\.standupFollowUpPending = true/);
  assert.match(app, /state\.standupExecutionCount = Number\(body\.executionCount/);
  assert.match(app, /conversation: standupFollowUpConversation\(\)/);
  assert.match(app, /execution starts, completion times, prompts, and responses/);
  assert.doesNotMatch(app, /standupLength|relay\.standupLength|length: state\.standup/);
  assert.match(app, /standupSections\(\{/);
  assert.match(app, /body\.added/);
  assert.match(app, /body\.changed/);
  assert.match(app, /body\.fixed/);
  assert.match(app, /body\.security/);
  assert.match(app, /'text\/html': new Blob\(\[clipboardHtml\]/);
  assert.match(app, /navigator\.clipboard\.writeText\(state\.standupClipboardText\)/);
  assert.match(app, /copied with chat formatting/);
  assert.match(app, /capabilities\?\.aiStandupGeneration === true/);
  assert.match(app, /capabilities\?\.aiStandupChangelog === true/);
  assert.match(app, /capabilities\?\.aiStandupStartDate === true/);
  assert.match(app, /capabilities\?\.aiStandupTwoDayRange === true/);
  assert.match(app, /capabilities\?\.aiStandupFollowUp === true/);
  assert.doesNotMatch(app, /aiStandupConfiguration|aiStandupAllTasks/);

  assert.match(standupRoute, /pathname === '\/api\/standup\/generate'/);
  assert.match(server, /database\.listTaskPrompts\(task\.id\)/);
  assert.match(server, /database\.listTaskResponses\(task\.id\)/);
  assert.match(server, /database\.taskAttemptsMap\(\)/);
  assert.match(server, /selectedForRange: execution\.outcome === 'complete'/);
  assert.match(server, /startedLocal: standupLocalTimestamp\(execution\.started_at\)/);
  assert.match(server, /timeZone: standupLocalTimeFormatter\.resolvedOptions\(\)\.timeZone/);
  assert.match(server, /execution_starts:/);
  assert.match(server, /startedAt: task\.started_at \|\| task\.created_at/);
  assert.doesNotMatch(standupRoute, /validateStandupLength|body\.length/);
  assert.match(server, /aiStandupGeneration: true/);
  assert.match(server, /aiStandupChangelog: true/);
  assert.match(server, /aiStandupStartDate: true/);
  assert.match(server, /aiStandupTwoDayRange: true/);
  assert.match(server, /aiStandupFollowUp: true/);
  assert.match(server, /projectStandupPrompt: true/);
  assert.match(server, /updateProjectStandupCustomPrompt/);
  assert.match(standupRoute, /customPrompt: source\.project\.standup_custom_prompt/);
  assert.match(standupRoute, /customPromptApplied: Boolean\(source\.project\.standup_custom_prompt\)/);
  assert.match(standupRoute, /dayCount: source\.window\.dayCount/);
  assert.match(standupRoute, /executionCount: source\.executionCount/);
  assert.match(followUpRoute, /buildStandupFollowUpPrompt\(source\.records/);
  assert.match(followUpRoute, /question: body\.question/);
  assert.match(followUpRoute, /conversation: body\.conversation/);
  assert.match(followUpRoute, /standupGenerator\.answer/);

  assert.match(style, /\.standup-modal/);
  assert.match(style, /\.standup-list li/);
  assert.match(style, /\.standup-item-marker/);
  assert.match(style, /\.standup-generator-route/);
  assert.match(style, /\.standup-custom-prompt-field/);
  assert.match(style, /\.standup-date-field :is\(input, select\)/);
  assert.match(style, /@media \(max-width: 620px\) \{[\s\S]*?\.standup-controls \{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(style, /html\[data-theme="dark"\] \.standup-custom-prompt-field textarea/);
  assert.match(style, /\.standup-result-group/);
  assert.match(style, /\.standup-loading-line/);
  assert.match(style, /\.standup-button:disabled/);
  assert.match(style, /\.standup-follow-up-turn/);
  assert.match(style, /\.standup-follow-up-form textarea/);
  assert.match(style, /html\[data-theme="dark"\] \.standup-follow-up/);
  assert.doesNotMatch(style, /\.standup-length-field/);
});
