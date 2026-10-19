import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

function canonicalProspectivePath(value) {
  let ancestor = path.resolve(value);
  const missing = [];
  while (!existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    assert.notEqual(parent, ancestor, 'Output path has no existing ancestor');
    ancestor = parent;
  }
  return path.resolve(realpathSync.native(ancestor), ...missing);
}

export function newExternalEvidencePath(output, checkout) {
  assert.ok(output, 'Choose a new output directory outside the checkout');
  const resolved = path.resolve(output);
  assert.equal(existsSync(resolved), false, 'Choose a new output directory');
  const relative = path.relative(realpathSync.native(checkout), canonicalProspectivePath(resolved));
  assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'Choose an output directory outside the checkout');
  return resolved;
}
