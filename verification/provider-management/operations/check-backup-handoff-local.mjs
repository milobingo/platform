// Synthetic fixtures only. Importing the verifier never invokes its fixed-host CLI.
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { validateHandoff, latestPair, decryptAuthenticated } from './check-backup-handoff.mjs';

const cases = [];
const check = (name, run) => { run(); cases.push({ name, status: 'passed' }); };
const project = 'lfsdgxcpdyghidzkzzvn';
const first = `milo-${project}-20261110T120000000Z-11111111-2222-4333-8444-555555555555`;
const latest = `milo-${project}-20261111T120000000Z-11111111-2222-4333-8444-555555555555`;
const names = id => [`${id}.dump.aesgcm`, `${id}.extensions.json.aesgcm`];
const handoff = {
  MIGRATION_DATABASE_URL: `postgresql://postgres:synthetic@db.${project}.supabase.co:5432/postgres?sslmode=verify-full`,
  BACKUP_ENCRYPTION_KEY: '12'.repeat(32),
};
const key = validateHandoff(handoff);
check('own-project direct database with verify-full accepted', () => assert.equal(key.length, 32));
check('own-project pooler database with verify-full accepted', () => assert.equal(validateHandoff({ ...handoff, MIGRATION_DATABASE_URL: `postgresql://postgres.${project}:synthetic@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full` }).length, 32));
for (const [name, bad] of [
  ['short backup key rejected', { ...handoff, BACKUP_ENCRYPTION_KEY: '12'.repeat(31) }],
  ['extra handoff field rejected', { ...handoff, extra: 'synthetic' }],
  ['foreign database project rejected', { ...handoff, MIGRATION_DATABASE_URL: handoff.MIGRATION_DATABASE_URL.replace(project, 'foreignproject') }],
  ['weaker database TLS rejected', { ...handoff, MIGRATION_DATABASE_URL: handoff.MIGRATION_DATABASE_URL.replace('verify-full', 'require') }],
  ['duplicate TLS query rejected', { ...handoff, MIGRATION_DATABASE_URL: handoff.MIGRATION_DATABASE_URL + '&sslmode=verify-full' }],
  ['additional database query rejected', { ...handoff, MIGRATION_DATABASE_URL: handoff.MIGRATION_DATABASE_URL + '&application_name=unexpected' }],
]) check(name, () => assert.throws(() => validateHandoff(bad)));
check('latest matching pair selected independently of directory order', () => assert.equal(latestPair([...names(latest), ...names(first)]).id, latest));
check('newest orphan rejected instead of falling back', () => assert.throws(() => latestPair([...names(first), names(latest)[1]])));
check('invalid backup timestamp rejected', () => assert.throws(() => latestPair(names(first.replace('20261110', '20260230')))));
check('foreign project backup filenames rejected', () => assert.throws(() => latestPair(names(latest.replace(project, 'foreignproject')))));

const header = Buffer.concat([Buffer.from('MILOBAK1'), Buffer.alloc(12, 34)]);
const payload = Buffer.from('PGDMP synthetic-only fixture');
const cipher = createCipheriv('aes-256-gcm', key, header.subarray(8));
cipher.setAAD(header);
const envelope = Buffer.concat([header, cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
check('authenticated MILOBAK1 payload decrypted in memory', () => assert.deepEqual(decryptAuthenticated(envelope, key), payload));
check('wrong recovery key rejected', () => assert.throws(() => decryptAuthenticated(envelope, Buffer.alloc(32, 99))));
for (const [name, position] of [['magic', 0], ['AAD nonce', 8], ['ciphertext', 20], ['authentication tag', envelope.length - 1]]) {
  const corrupt = Buffer.from(envelope); corrupt[position] ^= 1;
  check(`modified ${name} rejected`, () => assert.throws(() => decryptAuthenticated(corrupt, key)));
  corrupt.fill(0);
}
check('truncated envelope rejected', () => assert.throws(() => decryptAuthenticated(Buffer.alloc(35), key)));
key.fill(0); payload.fill(0); envelope.fill(0);
assert.equal(cases.length, 19);
console.log(JSON.stringify({
  format: 1,
  scope: 'local synthetic fixtures only; fixed-host main function not invoked',
  status: 'passed',
  syntheticChecksPassed: cases.length,
  hostExecuted: false,
  databaseContacted: false,
  plaintextWritten: false,
  actualBackupKeyVerified: false,
  limits: 'No real backup was read; no filesystem ownership checks or database restore were exercised by this local harness.',
  cases,
}, null, 2));
