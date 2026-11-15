import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { backupAndRestore, encryptBackup, readExtensionMetadata, relationGrantInventory,
  restoreRelationGrants, validateApplyPrerequisites } from '../scripts/deploy/database.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const grant = extra => ({ schema: 'public', name: 'fixture', kind: 'r', grantor: 'original_grantor',
  grantee: 'fixture_reader', privilege_type: 'INSERT', is_grantable: false, ...extra });
const metadata = extra => ({ format: 1, projectRef: 'a'.repeat(20), releaseSha: 'a'.repeat(40), backupId: 'fixture-backup',
  owners: [], extensions: [], eventTriggers: [], schemaPermissions: { schemas: [], grants: [] }, ...extra });
async function encryptedFixture(t, value, summary = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'milo-relation-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'metadata.aesgcm'), key = randomBytes(32).toString('hex');
  const body = JSON.stringify(value);
  await encryptBackup(Readable.from(body), path, key);
  const encrypted = await readFile(path);
  const expected = { projectRef: value.projectRef, releaseSha: value.releaseSha, backupId: value.backupId,
    relations: 0, extensions: 0, eventTriggers: 0, schemas: 0, schemaGrants: 0,
    encryptedSha256: hash(encrypted), metadataSha256: hash(body), ...summary };
  return { path, key, encrypted, expected };
}

test('relation ACL provenance survives authenticated encrypted sidecar persistence; legacy v1 remains readable', async t => {
  const value = metadata({ relationGrants: [grant()] });
  const saved = await encryptedFixture(t, value, { relationGrants: 1 });
  assert.equal(saved.encrypted.includes(Buffer.from('original_grantor')), false);
  assert.deepEqual(await readExtensionMetadata(saved.path, saved.key, saved.expected), value);
  await assert.rejects(readExtensionMetadata(saved.path, saved.key, { ...saved.expected, relationGrants: 2 }), error => error.code === 'extension_metadata_invalid');
  const legacy = await encryptedFixture(t, metadata());
  assert.deepEqual(await readExtensionMetadata(legacy.path, legacy.key, legacy.expected), metadata());
  assert.deepEqual(await restoreRelationGrants({ query() { assert.fail('legacy metadata must not mutate or query ACLs'); } }, metadata()), { changed: 0, legacyMetadata: true });
});

test('encrypted ACL metadata rejects duplicate grants, injected privileges, extra fields and invalid PUBLIC grant options', async t => {
  for (const rows of [[grant(), grant()], [grant({ privilege_type: 'INSERT; SELECT 1' })], [grant({ extra: true })],
    [grant({ schema: 'pg_catalog' })], [grant({ kind: 'S', privilege_type: 'DELETE' })],
    [grant({ grantee: 'PUBLIC', is_grantable: true })]]) {
    const saved = await encryptedFixture(t, metadata({ relationGrants: rows }), { relationGrants: rows.length });
    await assert.rejects(readExtensionMetadata(saved.path, saved.key, saved.expected), error => error.code === 'extension_metadata_invalid');
  }
});

test('relation grant restoration rejects non-loopback, overridden and mismatched scratch targets before DDL', async () => {
  const commands = [], client = { async query(sql) { commands.push(sql); return { rows: [{ database: 'milo_restore_test_fixture' }] }; } };
  for (const url of [undefined, new URL('postgresql://x:y@remote.example/milo_restore_test_fixture'),
    new URL('postgresql://x:y@127.0.0.1/production'), new URL('postgresql://x:y@127.0.0.1/milo_restore_test_other'),
    new URL('postgresql://x:y@127.0.0.1/milo_restore_test_fixture?host=remote.example')]) {
    await assert.rejects(restoreRelationGrants(client, metadata({ relationGrants: [grant()] }), url), error => error.code === 'relation_restore_target');
  }
  assert.ok(commands.every(sql => sql.startsWith('SELECT current_database()')));
});

test('extra, missing or changed effective privileges are refused rather than normalized away', async () => {
  for (const actual of [[grant({ is_grantable: true })], [], [grant(), grant({ privilege_type: 'DELETE' })]]) {
    const commands = [], client = { async query(sql) {
      commands.push(sql);
      if (sql.startsWith('SELECT current_database()')) return { rows: [{ database: 'milo_restore_test_fixture' }] };
      return { rows: sql.includes('aclexplode') ? actual : [] };
    } };
    await assert.rejects(restoreRelationGrants(client, metadata({ relationGrants: [grant()] }),
      new URL('postgresql://x:y@127.0.0.1/milo_restore_test_fixture')), error => error.code === 'relation_restore_permissions');
    assert.equal(commands.at(-1), 'ROLLBACK');
    assert.ok(!commands.some(sql => /^(GRANT|REVOKE|ALTER)/.test(sql)));
  }
});

const testDatabase = process.env.MILO_TEST_DATABASE_URL;
test('actual PostgreSQL restores a non-owner grantor, refuses drift and persists a complete verified encrypted backup',
  { skip: !testDatabase, timeout: 60000 }, async t => {
    const adminUrl = new URL(testDatabase);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname));
    assert.match(adminUrl.pathname, /test/i);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
    const sourceName = `milo_acl_source_test_${suffix}`, scratchName = `milo_restore_test_acl_${suffix}`, backupName = `milo_restore_test_backup_${suffix}`;
    const owner = `acl_owner_${suffix}`, grantor = `acl_grantor_${suffix}`, recipient = `acl_recipient_${suffix}`, noOption = `acl_nogrant_${suffix}`;
    const admin = new Pool({ connectionString: testDatabase }), pools = [], poolFailures = [];
    const directory = await mkdtemp(join(tmpdir(), 'milo-native-acl-backup-'));
    const databases = [], roles = [];
    let sourceClient, scratchClient;
    t.after(async () => {
      sourceClient?.release(); scratchClient?.release();
      await Promise.all(pools.map(async ({ pool, disconnects }) => {
        if (!pool.ending) await pool.end();
        // pg-pool can resolve end() before the sockets emit their final end.
        // Wait for those acknowledgements before removing a fixture database.
        let timer;
        try {
          await Promise.race([Promise.all(disconnects), new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('An ACL fixture PostgreSQL connection did not close.')), 5000);
          })]);
        } finally { clearTimeout(timer); }
      }));
      try {
        for (const name of databases.reverse()) await admin.query(`DROP DATABASE ${quote(name)}`);
        for (const name of roles.reverse()) await admin.query(`DROP ROLE ${quote(name)}`);
      } finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
      assert.deepEqual(poolFailures, [], 'no unexpected idle PostgreSQL errors');
    });
    for (const name of [sourceName, scratchName, backupName]) { await admin.query(`CREATE DATABASE ${quote(name)}`); databases.push(name); }
    for (const name of [owner, grantor, recipient, noOption]) { await admin.query(`CREATE ROLE ${quote(name)} NOLOGIN`); roles.push(name); }
    const connection = name => { const url = new URL(adminUrl); url.pathname = '/' + name; return url; };
    const pool = name => {
      const next = new Pool({ connectionString: connection(name).toString() }), disconnects = [];
      next.on('connect', client => disconnects.push(new Promise(resolve => client.once('end', resolve))));
      next.on('error', error => poolFailures.push(/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'unknown_pool_error'));
      pools.push({ pool: next, disconnects }); return next;
    };
    sourceClient = await pool(sourceName).connect(); scratchClient = await pool(scratchName).connect();
    for (const client of [sourceClient, scratchClient]) {
      await client.query(`CREATE TABLE public.fixture(id text PRIMARY KEY, document jsonb);
        INSERT INTO public.fixture VALUES ('synthetic-family','{"fixture":true}');
        ALTER TABLE public.fixture OWNER TO ${quote(owner)};
        GRANT INSERT,UPDATE ON public.fixture TO ${quote(grantor)} WITH GRANT OPTION`);
    }
    await sourceClient.query(`SET ROLE ${quote(grantor)}; GRANT INSERT,UPDATE ON public.fixture TO ${quote(recipient)}; RESET ROLE`);
    await scratchClient.query(`GRANT INSERT,UPDATE ON public.fixture TO ${quote(recipient)}`);
    const sourceGrants = await relationGrantInventory(sourceClient), scratchUrl = connection(scratchName);
    assert.notDeepEqual(await relationGrantInventory(scratchClient), sourceGrants);
    const restored = await restoreRelationGrants(scratchClient, { relationGrants: sourceGrants }, scratchUrl);
    assert.equal(restored.changed, 4);
    assert.deepEqual(await relationGrantInventory(scratchClient), sourceGrants);
    assert.deepEqual(await relationGrantInventory(sourceClient), sourceGrants, 'the source ACLs are never rewritten');
    assert.deepEqual((await scratchClient.query('SELECT rolcanlogin AS login,rolsuper AS superuser,rolcreaterole AS createrole FROM pg_roles WHERE rolname=$1', [grantor])).rows[0],
      { login: false, superuser: false, createrole: false }, 'grantor replay does not elevate any role');
    await scratchClient.query(`GRANT DELETE ON public.fixture TO ${quote(recipient)}`);
    const drift = await relationGrantInventory(scratchClient);
    await assert.rejects(restoreRelationGrants(scratchClient, { relationGrants: sourceGrants }, scratchUrl), error => error.code === 'relation_restore_permissions');
    assert.deepEqual(await relationGrantInventory(scratchClient), drift, 'extra permission is retained for investigation instead of hidden');
    await scratchClient.query(`REVOKE DELETE ON public.fixture FROM ${quote(recipient)}`);
    const unprivileged = sourceGrants.map(row => row.grantor === grantor && row.grantee === recipient ? { ...row, grantor: noOption } : row);
    await assert.rejects(restoreRelationGrants(scratchClient, { relationGrants: unprivileged }, scratchUrl), error => error.code === 'relation_restore_grantor');
    assert.deepEqual(await relationGrantInventory(scratchClient), sourceGrants, 'failed grantor authority check rolls back');
    await assert.rejects(restoreRelationGrants(sourceClient, { relationGrants: sourceGrants }, connection(sourceName)), error => error.code === 'relation_restore_target');
    const container = process.env.MILO_TEST_POSTGRES_CONTAINER;
    const spawnTool = container ? (executable, args, options) => {
      const pg = Object.fromEntries(Object.entries(options.env).filter(([name, value]) => name.startsWith('PG') && value !== undefined));
      if (pg.PGHOST) { pg.PGHOST = '127.0.0.1'; pg.PGPORT = '5432'; }
      return spawn('docker', ['exec', '-i', ...Object.entries(pg).flatMap(([name, value]) => ['-e', `${name}=${value}`]), container, executable, ...args],
        { ...options, env: { PATH: process.env.PATH } });
    } : spawn;
    const env = { DATABASE_URL: connection(sourceName).toString(), RESTORE_TEST_DATABASE_URL: connection(backupName).toString(),
      DATABASE_BACKUP_DIRECTORY: directory, RELEASE_SHA: 'a'.repeat(40), BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
    const proof = await backupAndRestore({ env, target: { projectRef: 'a'.repeat(20) }, sourceClient,
      sourceVersion: (await sourceClient.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version,
      prerequisites: validateApplyPrerequisites(env), spawnTool,
      poolFactory: connectionString => pool(decodeURIComponent(new URL(connectionString).pathname.slice(1))) });
    assert.equal(proof.restoreVerified, true);
    assert.deepEqual(proof.sourceProof, proof.restoredProof);
    assert.deepEqual(proof.sourceSecurity, proof.restoredSecurity, 'the unchanged full security comparison includes the original grantor');
    const saved = await readExtensionMetadata(join(directory, proof.extensionMetadata.filename), env.BACKUP_ENCRYPTION_KEY,
      { ...proof.extensionMetadata, projectRef: 'a'.repeat(20), releaseSha: env.RELEASE_SHA, backupId: proof.backupId });
    assert.deepEqual(saved.relationGrants, sourceGrants);
    assert.equal(proof.extensionMetadata.relationGrants, sourceGrants.length);
    const backupClient = await pool(backupName).connect();
    try { assert.deepEqual(await relationGrantInventory(backupClient), sourceGrants); }
    finally { backupClient.release(); }
  });
