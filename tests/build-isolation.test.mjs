import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isolatedBuildOutput } from '../scripts/isolated-build-output.mjs';

test('final output gate rejects stale preview assets after a valid production chunk', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qclub-build-test-'));
  const output = path.join(root, 'dist');
  const plugin = isolatedBuildOutput({ adminPreview: false, v2Preview: false });
  plugin.configResolved({ root, build: { outDir: 'dist' } });
  mkdirSync(output);
  const context = { error(message) { throw new Error(message); } };
  writeFileSync(path.join(output, 'current.js'), 'production');
  plugin.closeBundle.handler.call(context);
  writeFileSync(path.join(output, 'stale.js'), 'qclub.rehearsal.checkout.v1');
  assert.throws(() => plugin.closeBundle.handler.call(context), /Disabled preview code/);
});

test('production module gate rejects each preview while opted-in builds allow them', () => {
  const context = { error(message) { throw new Error(message); } };
  for (const name of ['admin-preview', 'checkout-preview', 'v2-preview']) {
    const bundle = { entry: { type: 'chunk', modules: { [`/app/src/${name}/entry.jsx`]: {} } } };
    assert.throws(() => isolatedBuildOutput({ adminPreview: false, v2Preview: false })
      .generateBundle.call(context, {}, bundle), /Disabled preview module/);
    isolatedBuildOutput({ adminPreview: true, v2Preview: true }).generateBundle.call(context, {}, bundle);
  }
});
