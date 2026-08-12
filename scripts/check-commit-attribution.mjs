#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSISTANT_IDENTITY = /\b(?:claude|anthropic|codex|openai)\b/i;
const ASSISTANT_CREDIT_TRAILER = new RegExp(
  '^\\s*(?:co-authored-by|signed-off-by|authored-by|assisted-by|generated-by)\\s*:'
    + '[^\\r\\n]*\\b(?:claude|anthropic|codex|openai)\\b',
  'im',
);
const ASSISTANT_SESSION_TRAILER = /^\s*(?:claude|codex)-session\s*:/im;
const LOG_FORMAT = '%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00%x1e';

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function attributionViolations({
  message = '',
  author = '',
  committer = '',
} = {}) {
  const violations = [];
  if (ASSISTANT_IDENTITY.test(String(author))) {
    violations.push('the author identity names an AI assistant or provider');
  }
  if (ASSISTANT_IDENTITY.test(String(committer))) {
    violations.push('the committer identity names an AI assistant or provider');
  }
  if (ASSISTANT_CREDIT_TRAILER.test(String(message))) {
    violations.push('the commit message contains an AI assistant credit trailer');
  }
  if (ASSISTANT_SESSION_TRAILER.test(String(message))) {
    violations.push('the commit message contains an AI assistant session trailer');
  }
  return violations;
}

export function parseHistoryLog(output) {
  return String(output || '')
    .split('\x1e')
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [
        hash = '',
        authorName = '',
        authorEmail = '',
        committerName = '',
        committerEmail = '',
        ...messageParts
      ] = record.split('\x00');
      return {
        hash,
        author: `${authorName} <${authorEmail}>`,
        committer: `${committerName} <${committerEmail}>`,
        message: messageParts.join('\x00'),
      };
    });
}

export function inspectHistory(output) {
  return parseHistoryLog(output).flatMap((commit) => (
    attributionViolations(commit).map((reason) => ({ hash: commit.hash, reason }))
  ));
}

export function scanHistory(revisions = ['HEAD'], cwd = process.cwd()) {
  const output = git(['log', `--format=${LOG_FORMAT}`, ...revisions], cwd);
  return inspectHistory(output);
}

function currentIdentity(variable, cwd) {
  return git(['var', variable], cwd).trim();
}

function pendingCommitViolations(messageFile, cwd) {
  return attributionViolations({
    message: readFileSync(messageFile, 'utf8'),
    author: currentIdentity('GIT_AUTHOR_IDENT', cwd),
    committer: currentIdentity('GIT_COMMITTER_IDENT', cwd),
  }).map((reason) => ({ hash: 'pending commit', reason }));
}

function printFailure(violations) {
  console.error('Commit attribution check failed:');
  for (const { hash, reason } of violations) {
    console.error(`- ${hash.slice(0, 12)}: ${reason}`);
  }
  console.error('Use the maintainer Git identity and remove all AI credit and session trailers.');
}

function main(argv) {
  let violations;
  if (argv[0] === '--message-file') {
    if (!argv[1]) throw new Error('--message-file requires a path.');
    violations = pendingCommitViolations(resolve(argv[1]), process.cwd());
  } else if (argv[0] === '--all') {
    violations = scanHistory(['--all']);
  } else {
    violations = scanHistory(argv.length > 0 ? argv : ['HEAD']);
  }

  if (violations.length > 0) {
    printFailure(violations);
    process.exitCode = 1;
    return;
  }
  console.log('Commit attribution is clean.');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Commit attribution check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
