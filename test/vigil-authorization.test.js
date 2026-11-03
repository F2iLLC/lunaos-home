import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/vigil.yml', import.meta.url), 'utf8');
const script = workflow.match(/          script: \|\n((?:            .*\n|\n)+)/)[1]
  .split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const authorize = new AsyncFunction('context', 'github', 'core', script);
const condition = workflow.match(/    if: >-\n([\s\S]*?)    outputs:/)[1].trim();
const repository = 'example/home';

function contextFor(eventName, association = 'MEMBER') {
  return {
    eventName,
    repo: { owner: 'example', repo: 'home' },
    payload: {
      comment: { author_association: association, body: '/vigil review' },
      issue: { number: 42, pull_request: {} },
      pull_request: { number: 42, head: { repo: { full_name: repository } } },
    },
  };
}

function admitted(context, skip = 'false') {
  return runInNewContext(condition, {
    vars: { VIGIL_SKIP: skip },
    github: { event_name: context.eventName, event: context.payload, repository },
    contains: (values, value) => values.includes(value),
    fromJSON: JSON.parse,
  });
}

async function check(context, { head = repository, base = repository, state = 'open', error } = {}) {
  const outputs = {};
  const calls = [];
  const github = { rest: { pulls: { get: async args => {
    calls.push(args);
    if (error) throw error;
    return { data: { state, base: { repo: { full_name: base } }, head: { repo: head && { full_name: head } } } };
  } } } };
  const core = { setOutput: (name, value) => { outputs[name] = value; } };
  let failure;
  try { await authorize(context, github, core); } catch (err) { failure = err; }
  return { outputs, calls, failure };
}

test('Vigil admits same-repository PRs and trusted comment commands after API verification', async () => {
  for (const event of ['pull_request', 'issue_comment', 'pull_request_review_comment']) {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      const context = contextFor(event, association);
      assert.equal(admitted(context), true);
      const result = await check(context);
      assert.equal(result.outputs.allowed, 'true');
      assert.deepEqual(result.calls, [{ owner: 'example', repo: 'home', pull_number: 42 }]);
      assert.equal(admitted(context, 'true'), false);
    }
  }
});

test('Vigil rejects untrusted comments before any API call', async () => {
  for (const event of ['issue_comment', 'pull_request_review_comment']) {
    for (const association of ['NONE', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', '', null]) {
      const context = contextFor(event, association);
      assert.equal(admitted(context), false);
      const result = await check(context);
      assert.equal(result.outputs.allowed, 'false');
      assert.deepEqual(result.calls, []);
    }
  }
});

test('Vigil rejects fork heads, deleted heads, wrong bases, and closed PRs for every event', async () => {
  for (const event of ['pull_request', 'issue_comment', 'pull_request_review_comment']) {
    for (const response of [{ head: 'outsider/home' }, { head: null }, { base: 'other/home' }, { state: 'closed' }]) {
      const result = await check(contextFor(event), response);
      assert.equal(result.outputs.allowed, 'false');
    }
  }
  const fork = contextFor('pull_request');
  fork.payload.pull_request.head.repo.full_name = 'outsider/home';
  assert.equal(admitted(fork), false);
});

test('Vigil fails closed on ordinary issues, unsupported events, missing numbers and API errors', async () => {
  const issue = contextFor('issue_comment');
  delete issue.payload.issue.pull_request;
  const malformed = contextFor('pull_request_review_comment');
  delete malformed.payload.pull_request.number;
  for (const context of [issue, malformed, contextFor('push')]) {
    const result = await check(context);
    assert.equal(result.outputs.allowed, 'false');
    assert.deepEqual(result.calls, []);
  }
  const error = new Error('API unavailable');
  const result = await check(contextFor('issue_comment'), { error });
  assert.equal(result.outputs.allowed, 'false');
  assert.equal(result.failure, error);
});

test('Vigil privileges and forwarded secrets remain behind successful authorization', () => {
  const [prefix, privileged] = workflow.split('\n  vigil:\n');
  assert.doesNotMatch(prefix, /^\s*(?:(?:id-token|issues|pull-requests): write|secrets:)/m);
  assert.doesNotMatch(prefix, /uses: actions\/checkout/);
  assert.match(prefix, /permissions:\n      pull-requests: read/);
  assert.match(privileged, /needs: authorize\n    if: needs\.authorize\.outputs\.allowed == 'true' && vars\.VIGIL_SKIP != 'true'/);
  assert.doesNotMatch(workflow, /secrets: inherit/);
  assert.deepEqual([...workflow.matchAll(/secrets\.(\w+)/g)].map(match => match[1]), ['GEMINI_API_KEY', 'VIGIL_REVIEW_TOKEN']);
});
