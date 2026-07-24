import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  ClaudeExecutionRunner,
  consumeClaudeStreamMessage,
} from '../src/claude-execution-runner.mjs';

test('Claude stream events pair tool use with its result', () => {
  const context = { cwd: '/tmp/repo', tools: new Map(), finalResponse: '', sessionId: 'one', error: null };
  const started = consumeClaudeStreamMessage({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'tool-one', name: 'Bash', input: { command: 'npm test' } }],
    },
  }, context);
  const completed = consumeClaudeStreamMessage({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'tool-one', content: 'Tests passed' }],
    },
  }, context);

  assert.equal(started[0].event.type, 'item/started');
  assert.equal(started[0].event.item.command, 'npm test');
  assert.equal(completed[0].event.type, 'item/completed');
  assert.equal(completed[0].event.item.aggregatedOutput, 'Tests passed');
  assert.equal(completed[0].event.item.exitCode, 0);
});

function controlledClaudeProcess(sessionId) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killedWith = null;
  child.kill = (signal) => {
    child.killedWith = signal;
    queueMicrotask(() => child.emit('close', null, signal));
    return true;
  };
  child.complete = (result = `Completed ${sessionId}`) => {
    child.stdout.end(`${JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result,
      session_id: sessionId,
    })}\n`);
    child.emit('close', 0, null);
  };
  return child;
}

test('Claude execution runs different terminal sessions concurrently and cancels only the requested task', async () => {
  const children = new Map();
  const runner = new ClaudeExecutionRunner({
    spawnProcess: (command, args) => {
      const resumeIndex = args.indexOf('--resume');
      const sessionId = args[resumeIndex + 1];
      const child = controlledClaudeProcess(sessionId);
      children.set(sessionId, child);
      return child;
    },
    sessions: { readConnectedSession: async () => ({ rawStatus: 'idle' }) },
  });
  const callbacks = { onEvent: () => {}, onStderr: () => {} };
  const first = runner.run({
    id: 101,
    thread_id: 'claude-one',
    repo_path: '/tmp/repo',
    prompt: 'First',
    provider: 'claude',
    attachments: [],
  }, callbacks);
  const second = runner.run({
    id: 102,
    thread_id: 'claude-two',
    repo_path: '/tmp/repo',
    prompt: 'Second',
    provider: 'claude',
    attachments: [],
  }, callbacks);

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...children.keys()].sort(), ['claude-one', 'claude-two']);
  assert.equal(runner.cancel(101), true);
  await assert.rejects(first, (error) => error.cancelled === true);
  assert.equal(children.get('claude-one').killedWith, 'SIGTERM');
  assert.equal(children.get('claude-two').killedWith, null);

  children.get('claude-two').complete();
  assert.equal((await second).sessionId, 'claude-two');
});

test('Claude starts independent processes for an arbitrary project set', async () => {
  const children = new Map();
  const invocations = [];
  const runner = new ClaudeExecutionRunner({
    spawnProcess: (command, args, options) => {
      const resumeIndex = args.indexOf('--resume');
      const sessionId = args[resumeIndex + 1];
      const child = controlledClaudeProcess(sessionId);
      children.set(sessionId, child);
      invocations.push({ sessionId, cwd: options.cwd });
      return child;
    },
    sessions: { readConnectedSession: async () => ({ rawStatus: 'idle' }) },
  });
  const callbacks = { onEvent: () => {}, onStderr: () => {} };
  const projects = Array.from({ length: 12 }, (_, index) => `/repo/project-${index + 1}`);
  const executions = projects.map((repoPath, index) => runner.run({
    id: 110 + index,
    thread_id: `claude-${index + 1}`,
    repo_path: repoPath,
    prompt: `Work in ${repoPath}`,
    provider: 'claude',
    attachments: [],
  }, callbacks));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(invocations, projects.map((cwd, index) => ({
    sessionId: `claude-${index + 1}`,
    cwd,
  })));
  for (const child of children.values()) child.complete();
  assert.deepEqual(
    (await Promise.all(executions)).map((outcome) => outcome.sessionId),
    projects.map((_, index) => `claude-${index + 1}`),
  );
});

test('Claude execution rejects overlapping work on the same terminal session', async () => {
  let child;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      child = controlledClaudeProcess('claude-shared');
      return child;
    },
    sessions: { readConnectedSession: async () => ({ rawStatus: 'idle' }) },
  });
  const callbacks = { onEvent: () => {}, onStderr: () => {} };
  const first = runner.run({
    id: 201,
    thread_id: 'claude-shared',
    repo_path: '/tmp/repo',
    prompt: 'First',
    provider: 'claude',
    attachments: [],
  }, callbacks);

  await assert.rejects(() => runner.run({
    id: 202,
    thread_id: 'claude-shared',
    repo_path: '/tmp/repo',
    prompt: 'Second',
    provider: 'claude',
    attachments: [],
  }, callbacks), /session already has an active Relay task/i);

  await new Promise((resolve) => setImmediate(resolve));
  child.complete();
  await first;
});

test('Claude execution resumes a live session through the subscription CLI', async () => {
  let invocation;
  let input = '';
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on('data', (chunk) => { input += chunk.toString(); });
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Implemented the task.' }] },
      })}\n`);
      child.stdout.end(`${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Implemented the task.',
        session_id: 'claude-session',
      })}\n`);
      child.emit('close', 0, null);
    });
    return child;
  };
  const runner = new ClaudeExecutionRunner({
    spawnProcess,
    sessions: { readConnectedSession: async () => ({ rawStatus: 'idle' }) },
  });
  const events = [];
  const result = await runner.run({
    thread_id: 'claude-session',
    thread_name: 'Checkout work',
    repo_path: '/tmp/repo',
    prompt: 'Fix checkout.',
    provider: 'claude',
    model: 'opus',
    effort: 'max',
    attachments: [{ name: 'bug.png', path: '/tmp/images/bug.png' }],
  }, {
    onEvent: (event) => events.push(event),
    onStderr: () => {},
  });

  assert.equal(invocation.command, 'claude');
  assert.equal(invocation.options.cwd, '/tmp/repo');
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--resume'), invocation.args.indexOf('--resume') + 2),
    ['--resume', 'claude-session'],
  );
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--permission-mode'), invocation.args.indexOf('--permission-mode') + 2),
    ['--permission-mode', 'auto'],
  );
  assert.equal(invocation.args.includes('--no-session-persistence'), false);
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--add-dir'), invocation.args.indexOf('--add-dir') + 2),
    ['--add-dir', '/tmp/images'],
  );
  assert.match(input, /Fix checkout/);
  assert.match(input, /bug\.png/);
  assert.equal(result.finalResponse, 'Implemented the task.');
  assert.equal(events.some((event) => event.event.type === 'claude/started'), true);
  assert.equal(events.some((event) => event.event.type === 'claude/completed'), true);
});

test('Claude execution initializes an uninitialized live terminal with the exact same session ID', async () => {
  const sessionId = '78f8d562-b6d5-4dec-ba0f-d9be2ac6b670';
  const invocations = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    const invocation = { command, args, options, input: '' };
    child.stdin.on('data', (chunk) => { invocation.input += chunk.toString(); });
    const invocationIndex = invocations.push(invocation) - 1;
    queueMicrotask(() => {
      if (invocationIndex === 0) {
        child.stderr.end(`No conversation found with session ID: ${sessionId}\n`);
        child.emit('close', 1, null);
        return;
      }
      child.stdout.end(`${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Initialized and completed.',
        session_id: sessionId,
      })}\n`);
      child.emit('close', 0, null);
    });
    return child;
  };
  const runner = new ClaudeExecutionRunner({
    spawnProcess,
    sessions: {
      readConnectedSession: async () => ({
        id: sessionId,
        source: 'Claude interactive',
        cwd: '/tmp/repo',
        rawStatus: 'idle',
      }),
    },
  });
  const events = [];
  const stderr = [];
  const result = await runner.run({
    thread_id: sessionId,
    thread_name: 'relay-c3',
    repo_path: '/tmp/repo',
    prompt: 'hi',
    provider: 'claude',
    model: 'opus',
    effort: 'low',
    attachments: [],
  }, {
    onEvent: (event) => events.push(event),
    onStderr: (line) => stderr.push(line),
  });

  assert.equal(result.finalResponse, 'Initialized and completed.');
  assert.equal(result.sessionId, sessionId);
  assert.equal(invocations.length, 2);
  assert.deepEqual(
    invocations[0].args.slice(invocations[0].args.indexOf('--resume'), invocations[0].args.indexOf('--resume') + 2),
    ['--resume', sessionId],
  );
  assert.deepEqual(
    invocations[1].args.slice(invocations[1].args.indexOf('--session-id'), invocations[1].args.indexOf('--session-id') + 2),
    ['--session-id', sessionId],
  );
  assert.equal(invocations[1].args.includes('--resume'), false);
  assert.equal(invocations[0].input, 'hi');
  assert.equal(invocations[1].input, 'hi');
  assert.doesNotMatch(stderr.join('\n'), /No conversation found/);
  assert.equal(events.some((event) => event.event.type === 'claude/session-initializing'), true);
  assert.deepEqual(
    events.filter((event) => event.event.type === 'claude/started').map((event) => event.event.sessionMode),
    ['resume', 'fresh'],
  );
  assert.equal(events.some((event) => event.event.type === 'claude/completed'), true);
});

test('Claude execution resumes when the transcript appears during first-turn initialization', async () => {
  const sessionId = '12010d32-44c2-40cf-9204-ce3cf1ee6a48';
  const invocations = [];
  const runner = new ClaudeExecutionRunner({
    spawnProcess: (command, args, options) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      const invocationIndex = invocations.push({ command, args, options }) - 1;
      queueMicrotask(() => {
        if (invocationIndex === 0) {
          child.stderr.end(`No conversation found with session ID: ${sessionId}\n`);
          child.emit('close', 1, null);
          return;
        }
        if (invocationIndex === 1) {
          child.stderr.end(`Error: Session ID ${sessionId} is already in use.\n`);
          child.emit('close', 1, null);
          return;
        }
        child.stdout.end(`${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Resumed after the transcript race.',
          session_id: sessionId,
        })}\n`);
        child.emit('close', 0, null);
      });
      return child;
    },
    sessions: {
      readConnectedSession: async () => ({
        id: sessionId,
        source: 'Claude interactive',
        cwd: '/tmp/repo',
        rawStatus: 'idle',
      }),
    },
  });
  const events = [];
  const stderr = [];

  const result = await runner.run({
    thread_id: sessionId,
    thread_name: 'Racing terminal',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, {
    onEvent: (event) => events.push(event),
    onStderr: (line) => stderr.push(line),
  });

  assert.equal(result.finalResponse, 'Resumed after the transcript race.');
  assert.equal(invocations.length, 3);
  assert.deepEqual(
    invocations.map((invocation) => (
      invocation.args.includes('--session-id') ? '--session-id' : '--resume'
    )),
    ['--resume', '--session-id', '--resume'],
  );
  assert.doesNotMatch(stderr.join('\n'), /No conversation found|already in use/);
  assert.equal(events.filter((event) => event.event.type === 'claude/session-initializing').length, 2);
  assert.equal(events.some((event) => event.event.type === 'claude/completed'), true);
});

test('Claude execution does not initialize when the missing-conversation error names another session', async () => {
  const sessionId = 'a8f59acb-f395-49eb-83a7-efba9d23c381';
  const otherSessionId = '2635e38e-0c2d-4e9e-8fe6-717c8cc80c44';
  let invocations = 0;
  const stderr = [];
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      invocations += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stderr.end(`No conversation found with session ID: ${otherSessionId}\n`);
        child.emit('close', 1, null);
      });
      return child;
    },
    sessions: {
      readConnectedSession: async () => ({
        id: sessionId,
        source: 'Claude interactive',
        cwd: '/tmp/repo',
        rawStatus: 'idle',
      }),
    },
  });

  await assert.rejects(() => runner.run({
    thread_id: sessionId,
    thread_name: 'Selected terminal',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, { onEvent: () => {}, onStderr: (line) => stderr.push(line) }), (error) => {
    assert.match(error.message, new RegExp(otherSessionId));
    assert.equal(error.retryable, false);
    return true;
  });

  assert.equal(invocations, 1);
  assert.match(stderr.join('\n'), new RegExp(otherSessionId));
});

test('Claude execution fails closed if first-turn output reports a different session ID', async () => {
  const sessionId = '4034bc61-e199-4d51-b397-3773ac071569';
  const otherSessionId = 'c67cbe3c-65a5-42b4-8a19-26983e3c47a3';
  let invocations = 0;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      invocations += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      const invocationIndex = invocations;
      queueMicrotask(() => {
        if (invocationIndex === 1) {
          child.stderr.end(`No conversation found with session ID: ${sessionId}\n`);
          child.emit('close', 1, null);
          return;
        }
        child.stdout.end(`${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Completed in the wrong session.',
          session_id: otherSessionId,
        })}\n`);
        child.emit('close', 0, null);
      });
      return child;
    },
    sessions: {
      readConnectedSession: async () => ({
        id: sessionId,
        source: 'Claude interactive',
        cwd: '/tmp/repo',
        rawStatus: 'idle',
      }),
    },
  });
  const events = [];

  await assert.rejects(() => runner.run({
    thread_id: sessionId,
    thread_name: 'Selected terminal',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, { onEvent: (event) => events.push(event), onStderr: () => {} }), /did not confirm the selected session ID/i);

  assert.equal(invocations, 2);
  assert.equal(events.some((event) => event.event.type === 'claude/completed'), false);
});

test('Claude execution does not initialize a terminal that disappears after the resume probe', async () => {
  const sessionId = 'fresh-but-closed';
  let sessionReads = 0;
  let invocations = 0;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      invocations += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stderr.end(`No conversation found with session ID: ${sessionId}\n`);
        child.emit('close', 1, null);
      });
      return child;
    },
    sessions: {
      readConnectedSession: async () => {
        sessionReads += 1;
        return sessionReads === 1
          ? { id: sessionId, source: 'Claude interactive', cwd: '/tmp/repo', rawStatus: 'idle' }
          : null;
      },
    },
  });
  const stderr = [];

  await assert.rejects(() => runner.run({
    thread_id: sessionId,
    thread_name: 'Closed terminal',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, { onEvent: () => {}, onStderr: (line) => stderr.push(line) }), /no longer open/i);

  assert.equal(invocations, 1);
  assert.doesNotMatch(stderr.join('\n'), /No conversation found/);
});

test('Claude execution does not initialize a fresh session from another workspace', async () => {
  const sessionId = 'wrong-workspace';
  let sessionReads = 0;
  let invocations = 0;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      invocations += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stderr.end(`No conversation found with session ID: ${sessionId}\n`);
        child.emit('close', 1, null);
      });
      return child;
    },
    sessions: {
      readConnectedSession: async () => {
        sessionReads += 1;
        return {
          id: sessionId,
          source: 'Claude interactive',
          cwd: sessionReads === 1 ? '/tmp/repo' : '/tmp/another-repo',
          rawStatus: 'idle',
        };
      },
    },
  });

  await assert.rejects(() => runner.run({
    thread_id: sessionId,
    thread_name: 'Moved terminal',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, { onEvent: () => {}, onStderr: () => {} }), /different workspace/i);

  assert.equal(invocations, 1);
});

test('Claude execution does not initialize a background process after the interactive terminal disappears', async () => {
  const sessionId = 'background-only-session';
  let sessionReads = 0;
  let invocations = 0;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      invocations += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stderr.end(`No conversation found with session ID: ${sessionId}\n`);
        child.emit('close', 1, null);
      });
      return child;
    },
    sessions: {
      readConnectedSession: async () => {
        sessionReads += 1;
        return {
          id: sessionId,
          source: sessionReads === 1 ? 'Claude interactive' : 'Claude background',
          cwd: '/tmp/repo',
          rawStatus: 'idle',
        };
      },
    },
  });

  await assert.rejects(() => runner.run({
    thread_id: sessionId,
    thread_name: 'Background process',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, { onEvent: () => {}, onStderr: () => {} }), /no longer the live interactive terminal/i);

  assert.equal(invocations, 1);
});

test('Claude execution honors cancellation between the resume probe and fresh initialization', async () => {
  const sessionId = 'cancelled-fresh-session';
  let sessionReads = 0;
  let invocations = 0;
  let runner;
  runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      invocations += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stderr.end(`No conversation found with session ID: ${sessionId}\n`);
        child.emit('close', 1, null);
      });
      return child;
    },
    sessions: {
      readConnectedSession: async () => {
        sessionReads += 1;
        if (sessionReads === 2) runner.cancel();
        return { id: sessionId, source: 'Claude interactive', cwd: '/tmp/repo', rawStatus: 'idle' };
      },
    },
  });

  await assert.rejects(() => runner.run({
    thread_id: sessionId,
    thread_name: 'Cancelled terminal',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, { onEvent: () => {}, onStderr: () => {} }), (error) => error.cancelled === true);

  assert.equal(invocations, 1);
});

test('Claude execution rejects a session that disappeared before dispatch', async () => {
  let spawned = false;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      spawned = true;
      throw new Error('should not spawn');
    },
    sessions: { readConnectedSession: async () => null },
  });

  await assert.rejects(() => runner.run({
    thread_id: 'closed-session',
    thread_name: 'Closed terminal',
    repo_path: '/tmp/repo',
    prompt: 'Work',
    provider: 'claude',
    attachments: [],
  }, { onEvent: () => {}, onStderr: () => {} }), /no longer open/i);
  assert.equal(spawned, false);
});

test('an immediate follow-up rejects a newly busy Claude session without waiting or spawning', async () => {
  let spawned = false;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => {
      spawned = true;
      throw new Error('should not spawn');
    },
    sessions: { readConnectedSession: async () => ({ rawStatus: 'busy' }) },
  });

  await assert.rejects(() => runner.run({
    thread_id: 'busy-session',
    thread_name: 'Busy terminal',
    repo_path: '/tmp/repo',
    prompt: 'Start this follow-up now.',
    provider: 'claude',
    attachments: [],
    sessionFollowUp: true,
  }, { onEvent: () => {}, onStderr: () => {} }), /became busy.*not queued/i);
  assert.equal(spawned, false);
});
