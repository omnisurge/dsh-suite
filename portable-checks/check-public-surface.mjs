import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('public root exposes build and portable checks', async () => {
  const pkg = await readJson(join(root, 'package.json'));
  assert.equal(pkg.scripts.build, 'pnpm --filter @omnisurge/dsh-ui build && node scripts/build/build-suite.mjs');
  assert.equal(pkg.scripts['test:portable'], 'node portable-checks/run.mjs');
});

test('suite package keeps runtime metadata', async () => {
  const pkg = await readJson(join(root, 'packages/suite/package.json'));
  assert.equal(pkg.name, '@omnisurge/dsh-suite');
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(typeof pkg.engines?.dsh, 'string');
  assert.ok(Array.isArray(pkg.omnisurge?.platforms?.verified));
  assert.ok(Array.isArray(pkg.omnisurge?.platforms?.unverified));
});

test('build emitted suite entrypoints', async () => {
  for (const file of ['lib/index.js', 'lib/client.js', 'components.json', 'cordis.patch.yml']) {
    await stat(join(root, 'packages/suite', file));
  }
  const client = await readFile(join(root, 'packages/suite/lib/client.js'), 'utf8');
  assert.ok(client.length > 10000, 'client bundle must be non-trivial');
});
