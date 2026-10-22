import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { newExternalEvidencePath } from '../scripts/test-fixtures/attended-output.mjs';

const checkout = fileURLToPath(new URL('..', import.meta.url));
test('attended evidence rejects checkout descendants and existing outputs', t => {
  const outside = mkdtempSync(path.join(tmpdir(), 'luna-attended-output-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const output = path.join(outside, 'new-evidence');
  assert.equal(newExternalEvidencePath(output, checkout), path.resolve(output));
  assert.throws(() => newExternalEvidencePath(path.join(checkout, 'new-evidence'), checkout), /outside the checkout/);
  assert.throws(() => newExternalEvidencePath(path.join(checkout, 'scripts', '..', 'new-evidence'), checkout), /outside the checkout/);
  mkdirSync(output);
  assert.throws(() => newExternalEvidencePath(output, checkout), /new output directory/);
  const linkedCheckout = path.join(outside, 'linked-checkout');
  symlinkSync(checkout, linkedCheckout, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => newExternalEvidencePath(path.join(linkedCheckout, 'new-evidence'), checkout), /outside the checkout/);
});
