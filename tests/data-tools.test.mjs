import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editors = readFileSync(new URL('../src/admin-preview/CatalogueEditors.jsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/admin-preview/entry.jsx', import.meta.url), 'utf8');
const start = editors.indexOf('export function DataToolsOverview');
assert.ok(start >= 0, 'DataToolsOverview missing');
const dataTools = editors.slice(start);

test('data tools salvage is export-only and uses the protected CMS projection', () => {
  assert.match(dataTools, /Download CMS backup/);
  assert.match(dataTools, /qclub-projected-cms-backup/);
  assert.match(dataTools, /content:content/);
  assert.doesNotMatch(dataTools, /fetch\s*\(/);
  assert.doesNotMatch(dataTools, /RESTORE CONTENT/);
  assert.doesNotMatch(dataTools, /backupRestore|csvImport|storage migrate/i);
  assert.match(entry, /content=\{saved\?\.content \|\| \{\}\}/);
});

test('data tools UI explicitly keeps destructive staging-era actions unavailable', () => {
  assert.match(dataTools, /Restore and import are intentionally unavailable/);
  assert.match(dataTools, /duplicate sources of truth/);
});
