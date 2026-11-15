import test from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { privateJson, validateRootDirectories } from '../infra/production/bootstrap-database.mjs';

const bootstrapRoot = '/root/milo-production-bootstrap';
const privatePaths = ['/root', bootstrapRoot];
const backupPaths = [...privatePaths, '/var', '/var/backups', '/var/backups/milobingo-production'];
const directory = (path, overrides = {}) => ({
  uid: 0, mode: path === '/var' || path === '/var/backups' ? 0o755 : 0o700,
  isDirectory: () => true, isSymbolicLink: () => false, ...overrides,
});

test('production database guards keep audit private and validate every backup ancestor before backup/apply', async () => {
  for (const operation of ['audit', 'backup', 'apply']) {
    const inspected = [];
    await validateRootDirectories(operation, async path => { inspected.push(path); return directory(path); });
    assert.deepEqual(inspected, operation === 'audit' ? privatePaths : backupPaths);
  }
  await assert.rejects(validateRootDirectories('other-operation', () => assert.fail('unknown operation must fail before filesystem access')));
});

test('production database guards refuse symlinks, foreign ownership, writable parents and non-private root/backup paths', async () => {
  const unsafe = [{ uid: 1000 }, { isDirectory: () => false }, { isSymbolicLink: () => true }, { mode: 0o777 }, { mode: 0o720 }];
  for (const target of backupPaths) {
    for (const changed of unsafe) await assert.rejects(validateRootDirectories('apply', async path => directory(path, path === target ? changed : {})), /Unsafe private directory/);
  }
  for (const target of [...privatePaths, '/var/backups/milobingo-production']) {
    for (const mode of [0o750, 0o755, 0o600]) await assert.rejects(validateRootDirectories('backup', async path => directory(path, path === target ? { mode } : {})), /Unsafe private directory/);
  }
});

function fileFixture(body = JSON.stringify({ BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32) }), overrides = {}) {
  let opened = 0, closed = 0, reads = 0;
  const openFile = async (path, flags) => {
    opened++;
    assert.equal(path, bootstrapRoot + '/backup-key.json');
    assert.equal(flags, constants.O_RDONLY | constants.O_NOFOLLOW);
    return {
      async stat() { return { uid: 0, nlink: 1, mode: 0o600, size: Buffer.byteLength(body), isFile: () => true, ...overrides }; },
      async readFile(encoding) { reads++; assert.equal(encoding, 'utf8'); return body; },
      async close() { closed++; },
    };
  };
  return { openFile, counts: () => ({ opened, closed, reads }) };
}

test('production private input opens only fixed filenames without following symlinks and closes the handle', async () => {
  const fixture = fileFixture();
  assert.deepEqual(await privateJson('backup-key.json', ['BACKUP_ENCRYPTION_KEY'], fixture.openFile), { BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32) });
  assert.deepEqual(fixture.counts(), { opened: 1, closed: 1, reads: 1 });
  for (const [name, keys] of [['../outside', ['BACKUP_ENCRYPTION_KEY']], ['backup-key.json', ['DATABASE_URL']], ['unknown.json', []]]) {
    await assert.rejects(privateJson(name, keys, () => assert.fail('unapproved target must not open a file')), /Unexpected private input/);
  }
  await assert.rejects(privateJson('scratch-connection.json', ['RESTORE_TEST_DATABASE_URL'], async (_path, flags) => {
    assert.ok(flags & constants.O_NOFOLLOW); throw Object.assign(new Error('test-only symlink refused'), { code: 'ELOOP' });
  }), { code: 'ELOOP' });
});

test('production private input rejects foreign owner, extra links, broad permissions and oversized files before reading', async () => {
  for (const changed of [{ uid: 1000 }, { nlink: 2 }, { mode: 0o644 }, { mode: 0o640 }, { isFile: () => false }, { size: 16385 }]) {
    const fixture = fileFixture(undefined, changed);
    await assert.rejects(privateJson('backup-key.json', ['BACKUP_ENCRYPTION_KEY'], fixture.openFile), /Unsafe private input/);
    assert.deepEqual(fixture.counts(), { opened: 1, closed: 1, reads: 0 });
  }
});

test('production private JSON rejects malformed content, additional fields and missing values without exposing credentials', async () => {
  const marker = 'private-test-value-must-not-leak';
  for (const body of [marker, '{}', 'null', '[]', JSON.stringify({ BACKUP_ENCRYPTION_KEY: '' }), JSON.stringify({ BACKUP_ENCRYPTION_KEY: marker, EXTRA_SECRET: marker })]) {
    const fixture = fileFixture(body);
    await assert.rejects(privateJson('backup-key.json', ['BACKUP_ENCRYPTION_KEY'], fixture.openFile), error => {
      assert.ok(!error.message.includes(marker)); return true;
    });
    assert.equal(fixture.counts().closed, 1);
  }
});

test('production bootstrap CLI rejects a foreign operation before accessing protected inputs and sanitizes failure output', async () => {
  const marker = 'private-test-value-must-not-leak';
  await assert.rejects(promisify(execFile)(process.execPath, ['infra/production/bootstrap-database.mjs', 'forbidden-operation'], {
    cwd: new URL('../', import.meta.url), env: { PATH: process.env.PATH, DATABASE_URL: marker, SUPABASE_SECRET_KEY: marker },
  }), error => {
    const output = (error.stdout || '') + (error.stderr || '');
    assert.ok(!output.includes(marker)); assert.match(output, /production_database_bootstrap_failed/); return true;
  });
});
