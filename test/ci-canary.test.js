import assert from 'node:assert/strict';
import test from 'node:test';

test('synthetic fork runs on a GitHub-hosted runner', () => {
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
});
