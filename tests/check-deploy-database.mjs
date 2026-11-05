import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as createTlsServer, connect as connectTls } from 'node:tls';
import { Socket } from 'node:net';
import { Pool } from 'pg';
import { validateTarget, validateApplyPrerequisites, loadManifest, encryptBackup, decryptBackup, auditDatabase, applyDatabase, backupAndRestore, assertBackupCapacity, verifyDatabaseClientTls } from '../scripts/deploy/database.mjs';

const projectRef = 'lfsdgxcpdyghidzkzzvn';
const sha = value => createHash('sha256').update(value).digest('hex');
const directHost = `db.${projectRef}.supabase.co`, poolerHost = 'aws-0-eu-central-1.pooler.supabase.com';
async function tlsFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'milo-tls-transport-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = join(directory, 'test-only.key'), certPath = join(directory, 'test-only.crt');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=milo-local-test-only', '-addext', `subjectAltName=DNS:${directHost},DNS:${poolerHost}`, '-addext', 'basicConstraints=critical,CA:TRUE']);
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  const sockets = [], server = createTlsServer({ key, cert }, socket => { sockets.push(socket); socket.on('error', () => {}); });
  server.on('tlsClientError', () => {});
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(done => server.close(done)); });
  async function connect(verify = true) {
    const socket = connectTls({ host: '127.0.0.1', port: server.address().port, servername: directHost, ...(verify ? { ca: cert } : {}), rejectUnauthorized: verify });
    sockets.push(socket); socket.on('error', () => {});
    await new Promise((done, reject) => { socket.once('secureConnect', done); socket.once('error', reject); });
    return socket;
  }
  return { socket: await connect(), connect };
}
function fixturePool(options, failures) {
  const pool = new Pool(options), disconnects = [];
  pool.on('connect', client => { disconnects.push(new Promise(done => client.once('end', done))); });
  // Capture only safe error codes. Unexpected idle errors still fail the test;
  // pg error objects include Client internals and must never reach testlogs.
  pool.on('error', error => failures.push(/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'unknown_pool_error'));
  const finish = pool.end.bind(pool); let finishing;
  pool.end = () => finishing ??= (async () => {
    let timer;
    try {
      await Promise.race([
        (async () => { await finish(); await Promise.all(disconnects); })(),
        new Promise((done, reject) => { timer = setTimeout(() => reject(new Error('A fixture pool did not release every PostgreSQL connection.')), 5000); }),
      ]);
    } finally { clearTimeout(timer); }
  })();
  return pool;
}
async function dropFixtureDatabase(admin, name) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await admin.query(`DROP DATABASE "${name}"`); return; }
    catch (error) {
      if (error.code !== '55006') throw error;
      if (attempt === 39) assert.fail('A fixture database still has live connections after bounded cleanup (55006).');
      await new Promise(done => setTimeout(done, 50));
    }
  }
}
const configuration = overrides => ({
  DATABASE_URL: `postgresql://migration:test-only-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  SUPABASE_URL: `https://${projectRef}.supabase.co`, SUPABASE_SECRET_KEY: 'sb_secret_test_fixture_only', SUPABASE_STORAGE_BUCKET: 'milo-staging',
  RELEASE_SHA: 'a'.repeat(40), BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32), RESTORE_TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/milo_restore_test_contract',
  DATABASE_BACKUP_DIRECTORY: '/tmp/milo-private-backups-contract', ...overrides,
});

test('database preflight binds API and TLS database to the explicitly confirmed project', () => {
  assert.equal(validateTarget(configuration(), projectRef).bucket, 'milo-staging');
  for (const env of [
    configuration({ SUPABASE_URL: 'https://unrelated-project.supabase.co' }),
    configuration({ DATABASE_URL: 'postgresql://test:secret@db.other.supabase.co/postgres' }),
    configuration({ DATABASE_URL: `postgresql://postgres.wrong:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` }),
    configuration({ DATABASE_URL: `postgresql://test:secret@db.${projectRef}.supabase.co:6543/postgres` }),
    configuration({ DATABASE_URL: `postgresql://test:secret@db.${projectRef}.supabase.co/postgres?sslmode=no-verify` }),
    configuration({ DATABASE_URL: `postgresql://test:secret@db.${projectRef}.supabase.co/postgres?host=another.example` }),
    configuration({ SUPABASE_STORAGE_BUCKET: '../another' }),
  ]) assert.throws(() => validateTarget(env, projectRef));
  assert.throws(() => validateTarget(configuration(), undefined), error => error.code === 'expected_project_required');
  assert.ok(validateTarget(configuration({ DATABASE_URL: `postgresql://postgres.${projectRef}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` }), projectRef));
});

test('audit verifies the actual TLS peer for direct and pooled connections independently of the backend hop', async t => {
  const { socket, connect } = await tlsFixture(t), manifest = await loadManifest();
  assert.deepEqual(verifyDatabaseClientTls({ connection: { stream: socket } }, directHost), { tls: true, tlsAuthorized: true });
  assert.throws(() => verifyDatabaseClientTls({ connection: { stream: socket } }, 'different.example'), error => error.code === 'database_tls_unconfirmed');
  const unauthorized = await connect(false);
  assert.equal(unauthorized.encrypted, true); assert.equal(unauthorized.authorized, false);
  for (const stream of [unauthorized, new Socket(), { encrypted: true, authorized: true }]) {
    assert.throws(() => verifyDatabaseClientTls({ connection: { stream } }, directHost), error => error.code === 'database_tls_unconfirmed');
  }
  for (const [hostname, user, backendTls] of [[directHost, 'migration', true], [poolerHost, `migration.${projectRef}`, false]]) {
    const queries = [], env = configuration({ DATABASE_URL: `postgresql://${user}:test-only@${hostname}:5432/postgres?sslmode=verify-full` });
    let closed = false;
    const poolFactory = () => ({ async end() { closed = true; }, async connect() { return { connection: { stream: socket }, release() {}, async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM pg_roles r WHERE r.rolname=current_user')) return { rows: [{ user: 'migration', database: 'postgres', version: 170011, superuser: false, createrole: true, bypassrls: true, schema_create: true, backendTls, databaseSizeBytes: '123456' }] };
      if (sql.includes('FROM pg_extension')) return { rows: [{ extname: 'plpgsql', extversion: '1.0' }] };
      return { rows: [] };
    } }; } });
    const fetcher = async () => Response.json({ id: 'milo-staging', name: 'milo-staging', public: false });
    const audit = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, poolFactory, fetcher });
    assert.equal(audit.connection.tls, true); assert.equal(audit.connection.tlsAuthorized, true); assert.equal(audit.connection.backendTls, backendTls);
    assert.deepEqual(audit.connection.extensions, [{ extname: 'plpgsql', extversion: '1.0' }]); assert.equal(audit.connection.databaseSizeBytes, '123456');
    assert.equal(closed, true); assert.equal(queries[0], 'BEGIN READ ONLY'); assert.equal(queries.at(-1), 'COMMIT');
    assert.ok(audit.blockers.every(reason => reason.startsWith('migration_pending:')));
  }
  let queried = false, closed = false;
  const poolFactory = () => ({ async end() { closed = true; }, async connect() { return { connection: { stream: unauthorized }, release() {}, async query() { queried = true; } }; } });
  await assert.rejects(auditDatabase({ env: configuration(), expectedProjectRef: projectRef, manifest, poolFactory }), error => error.code === 'database_tls_unconfirmed');
  assert.equal(queried, false); assert.equal(closed, true);
});

test('apply fails before any connection when backup, scratch restore or reviewed manifest is missing', async () => {
  const never = () => assert.fail('an incomplete apply must not open a database connection');
  for (const overrides of [
    { BACKUP_ENCRYPTION_KEY: '' }, { RESTORE_TEST_DATABASE_URL: '' },
    { RESTORE_TEST_DATABASE_URL: 'postgresql://x:y@production.example/milo_restore_test_x' },
    { RESTORE_TEST_DATABASE_URL: 'postgresql://x:y@127.0.0.1/production' },
    { RESTORE_TEST_DATABASE_URL: 'postgresql://x:y@127.0.0.1/milo_restore_test_x?host=remote.example' },
    { DATABASE_BACKUP_DIRECTORY: process.cwd() }, { DATABASE_BACKUP_DIRECTORY: 'relative' }, { RELEASE_SHA: 'short' },
  ]) await assert.rejects(applyDatabase({ env: configuration(overrides), expectedProjectRef: projectRef, poolFactory: never }));
  const manifest = await loadManifest();
  assert.equal(manifest.tables.size, 18);
  assert.equal(manifest.migrations.length, 1);
  assert.equal(manifest.migrations[0].checksum, sha(await readFile(new URL('../supabase/migrations/20261104115830_milo_friends_server_schema.sql', import.meta.url))));
  await assert.rejects(applyDatabase({ env: configuration(), expectedProjectRef: projectRef, manifest, poolFactory: never, reviewedManifestSha256: '0'.repeat(64) }), error => error.code === 'manifest_review_required');
  assert.ok(validateApplyPrerequisites(configuration()));
});

test('encrypted backups roundtrip binary data, hide plaintext, reject tampering and use private file permissions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'milo-backup-crypto-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, 'proof.dump.aesgcm');
  const content = Buffer.concat([Buffer.from('PRIVATE-FAMILY-DATA-DO-NOT-LOG'), randomBytes(1024 * 1024)]);
  const key = randomBytes(32).toString('hex');
  await encryptBackup(Readable.from(content), destination, key);
  const encrypted = await readFile(destination);
  assert.equal(encrypted.includes(Buffer.from('PRIVATE-FAMILY-DATA-DO-NOT-LOG')), false);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  const chunks = [];
  await decryptBackup(destination, new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } }), key);
  assert.deepEqual(Buffer.concat(chunks), content);
  const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1;
  await writeFile(destination, tampered);
  await assert.rejects(decryptBackup(destination, new Writable({ write(chunk, encoding, callback) { callback(); } }), key));
  await writeFile(destination, encrypted);
  await assert.rejects(decryptBackup(destination, new Writable({ write(chunk, encoding, callback) { callback(); } }), randomBytes(32).toString('hex')));
  await assert.rejects(encryptBackup(Readable.from('replacement'), destination, key), error => error.code === 'EEXIST');
});

test('CLI failures do not echo malformed secret values', async () => {
  const sentinel = 'must-never-appear-in-output-123456';
  const run = promisify(execFile);
  await assert.rejects(run(process.execPath, ['scripts/deploy/database.mjs', `--expected-project-ref=${projectRef}`], { cwd: new URL('../', import.meta.url), env: { ...process.env, SUPABASE_URL: sentinel, DATABASE_URL: sentinel } }), error => {
    assert.equal((error.stdout + error.stderr).includes(sentinel), false);
    assert.match(error.stderr, /target_configuration/); return true;
  });
});

test('backup capacity uses measured available filesystem bytes and database size', async () => {
  await assert.rejects(assertBackupCapacity('/unused', '1048576', async () => ({ bavail: 10n, bsize: 4096n })), error => error.code === 'backup_capacity');
  const capacity = await assertBackupCapacity('/unused', '1048576', async () => ({ bavail: 1024n * 1024n, bsize: 4096n }));
  assert.equal(capacity.backupRequiredBytes, String(2n * 1048576n + 512n * 1024n * 1024n));
  assert.equal(capacity.backupAvailableBytes, '4294967296');
});

const testDatabase = process.env.MILO_TEST_DATABASE_URL;
test('real PostgreSQL preflight refuses unmanaged data, atomically bootstraps, tracks checksums and detects rights/schema drift', { skip: !testDatabase, timeout: 30_000 }, async t => {
  const { socket: verifiedSocket } = await tlsFixture(t);
  const adminUrl = new URL(testDatabase);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)); assert.match(adminUrl.pathname, /test/i);
  const failures = [], admin = fixturePool({ connectionString: testDatabase }, failures);
  const databases = [], fixturePools = [], factoryPools = [];
  t.after(async () => {
    const unclosedFactories = factoryPools.filter(pool => !pool.ending).length;
    try {
      await Promise.all([...fixturePools, ...factoryPools].map(pool => pool.end()));
      for (const name of databases) await dropFixtureDatabase(admin, name);
      assert.equal(unclosedFactories, 0, 'every deployment-created pool must be closed by its operation');
    } finally { await admin.end(); }
    assert.deepEqual(failures, [], 'no unexpected idle PostgreSQL errors');
  });
  async function fixture() {
    const name = `milo_deploy_source_test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`); databases.push(name);
    const url = new URL(adminUrl); url.pathname = `/${name}`;
    const pool = fixturePool({ connectionString: url.toString() }, failures);
    fixturePools.push(pool);
    // Production inspects pg's actual TLS stream. This injected pool uses an
    // independently verified local TLS stream for the plaintext PG fixture.
    const seenTls = [];
    const poolFactory = (connectionString, options) => {
      seenTls.push(options);
      const real = fixturePool({ connectionString: url.toString() }, failures); factoryPools.push(real);
      return { end: () => real.end(), async connect() {
        const client = await real.connect();
        return { connection: { stream: verifiedSocket }, release: () => client.release(), query: (sql, values) => client.query(sql, values) };
      } };
    };
    const buckets = new Map(), requests = [];
    const fetcher = async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET' });
      assert.equal(options.headers.apikey, 'sb_secret_test_fixture_only');
      if (options.method === 'POST') { const data = JSON.parse(options.body); buckets.set(data.id, data); return Response.json(data); }
      const name = url.split('/').at(-1);
      return buckets.has(name) ? Response.json(buckets.get(name)) : new Response('{}', { status: 404 });
    };
    return { pool, poolFactory, buckets, requests, fetcher, seenTls };
  }
  const manifest = await loadManifest(), env = configuration({ SUPABASE_DB_CA_BASE64: 'fixture-public-ca-plumbing-only' });
  const unmanaged = await fixture();
  await unmanaged.pool.query('CREATE TABLE public.bingo_games (id text PRIMARY KEY)');
  const unmanagedAudit = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, ...unmanaged });
  assert.ok(unmanagedAudit.blockers.includes('unmanaged_application_tables'));
  await assert.rejects(applyDatabase({ env, expectedProjectRef: projectRef, manifest, reviewedManifestSha256: manifest.digest, ...unmanaged, backupProvider: () => assert.fail('unmanaged application data must never migrate') }), error => error.code === 'apply_preflight_blocked');
  assert.equal((await unmanaged.pool.query('SELECT count(*)::int AS count FROM public.bingo_games')).rows[0].count, 0);
  assert.ok(unmanaged.requests.every(request => request.method === 'GET'));

  const fresh = await fixture();
  await fresh.pool.query("CREATE TABLE public.preexisting_context (id text PRIMARY KEY, value text NOT NULL); INSERT INTO public.preexisting_context VALUES ('preserve','original-context'); CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])");
  const initial = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, ...fresh });
  assert.equal(initial.ok, false); assert.equal(initial.applicationTables.length, 0); assert.equal(initial.pending.length, 1);
  assert.ok(fresh.requests.every(request => request.method === 'GET'));
  assert.ok(fresh.seenTls.every(options => options.verifiedTls === true && options.caBase64 === env.SUPABASE_DB_CA_BASE64), 'verified source pools receive the configured public CA');
  let backups = 0;
  const backupProvider = async ({ sourceClient }) => {
    backups++; assert.equal((await sourceClient.query('SELECT value FROM public.preexisting_context')).rows[0].value, 'original-context');
    return { restoreVerified: true, projectRef, releaseSha: env.RELEASE_SHA, backupId: `test-proof-${backups}`, encryptedSha256: 'b'.repeat(64) };
  };
  await assert.rejects(applyDatabase({ env, expectedProjectRef: projectRef, manifest, reviewedManifestSha256: manifest.digest, ...fresh, backupProvider: async () => ({ restoreVerified: false }) }), error => error.code === 'backup_proof_invalid');
  assert.equal((await fresh.pool.query("SELECT to_regclass('public.bingo_games') AS table")).rows[0].table, null);

  const poisoned = { ...manifest, migrations: manifest.migrations.map(row => ({ ...row, sql: row.sql + '\nALTER TABLE public.bingo_games DISABLE ROW LEVEL SECURITY;' })) };
  poisoned.migrations[0].checksum = sha(poisoned.migrations[0].sql);
  poisoned.digest = sha(JSON.stringify(poisoned.migrations.map(({ filename, checksum }) => ({ filename, checksum }))));
  await assert.rejects(applyDatabase({ env, expectedProjectRef: projectRef, manifest: poisoned, reviewedManifestSha256: poisoned.digest, ...fresh, backupProvider }), error => error.code === 'migration_postcondition');
  assert.equal((await fresh.pool.query("SELECT to_regclass('public.bingo_games') AS table,to_regclass('milo_deploy.migrations') AS history")).rows[0].table, null);
  assert.equal((await fresh.pool.query('SELECT value FROM public.preexisting_context')).rows[0].value, 'original-context');

  const applied = await applyDatabase({ env, expectedProjectRef: projectRef, manifest, reviewedManifestSha256: manifest.digest, ...fresh, backupProvider });
  assert.equal(applied.ok, true); assert.equal(applied.changed, true); assert.equal(applied.applicationTables.length, 18);
  assert.equal(applied.pending.length, 0); assert.equal(applied.backup.restoreVerified, true);
  assert.equal(fresh.buckets.get('milo-staging').public, false, 'the authoritative bucket is created separately from the immutable migration');
  assert.equal((await fresh.pool.query("SELECT count(*)::int AS count FROM storage.buckets WHERE id='milo-private'")).rows[0].count, 1, 'the original migration is unchanged');
  assert.equal((await fresh.pool.query('SELECT checksum FROM milo_deploy.migrations')).rows[0].checksum, manifest.migrations[0].checksum);
  const again = await applyDatabase({ env, expectedProjectRef: projectRef, manifest, reviewedManifestSha256: manifest.digest, ...fresh, backupProvider });
  assert.equal(again.changed, false); assert.equal(backups, 2, 'an already verified deployment does not mutate or back up again');

  await fresh.pool.query('GRANT SELECT ON public.bingo_families TO PUBLIC');
  const leakedGrant = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, ...fresh });
  assert.ok(leakedGrant.blockers.includes('browser_grant:bingo_families')); assert.ok(leakedGrant.blockers.includes('recorded_schema_drift'));
  await fresh.pool.query('REVOKE SELECT ON public.bingo_families FROM PUBLIC');
  await fresh.pool.query('ALTER TABLE public.bingo_games ADD COLUMN accidental text');
  const altered = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, ...fresh });
  assert.ok(altered.blockers.includes('column_contract:bingo_games')); assert.ok(altered.blockers.includes('recorded_schema_drift'));
  await fresh.pool.query('ALTER TABLE public.bingo_games DROP COLUMN accidental');
  await fresh.pool.query("UPDATE milo_deploy.migrations SET checksum=repeat('0',64)");
  const changedHistory = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, ...fresh });
  assert.ok(changedHistory.blockers.some(problem => problem.startsWith('migration_checksum:')));
});

test('real pg_dump backup is encrypted and restored with matching data checksums before receiving a proof', { skip: !testDatabase, timeout: 30_000 }, async t => {
  const adminUrl = new URL(testDatabase);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)); assert.match(adminUrl.pathname, /test/i);
  const container = process.env.MILO_TEST_POSTGRES_CONTAINER;
  const spawnTool = container ? (executable, args, options) => {
    const pg = Object.fromEntries(Object.entries(options.env).filter(([name, value]) => name.startsWith('PG') && value !== undefined));
    if (pg.PGHOST) { pg.PGHOST = '127.0.0.1'; pg.PGPORT = '5432'; }
    const dockerArgs = ['exec', '-i', ...Object.entries(pg).flatMap(([name, value]) => ['-e', `${name}=${value}`]), container, executable, ...args];
    return spawn('docker', dockerArgs, { ...options, env: { PATH: process.env.PATH } });
  } : spawn;
  const failures = [], admin = fixturePool({ connectionString: testDatabase }, failures);
  const version = (await admin.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
  if (!container) {
    try {
      for (const command of ['pg_dump', 'pg_restore']) {
        const { stdout } = await promisify(execFile)(command, ['--version']);
        if (Number(/PostgreSQL\)\s+(\d+)/.exec(stdout)?.[1]) !== Math.floor(version / 10000)) { await admin.end(); t.skip('matching PostgreSQL dump/restore tools are not installed'); return; }
      }
    } catch { await admin.end(); t.skip('PostgreSQL dump/restore tools are not installed'); return; }
  }
  const sourceName = `milo_backup_source_test_${randomUUID().replaceAll('-', '')}`, restoreName = `milo_restore_test_${randomUUID().replaceAll('-', '')}`;
  const ownerRole = `milo_backup_owner_${randomUUID().replaceAll('-', '')}`, readerRole = `milo_backup_reader_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'milo-actual-backup-'));
  await admin.query(`CREATE DATABASE "${sourceName}"`); await admin.query(`CREATE DATABASE "${restoreName}"`);
  const sourceUrl = new URL(adminUrl), restoreUrl = new URL(adminUrl); sourceUrl.pathname = `/${sourceName}`; restoreUrl.pathname = `/${restoreName}`;
  const sourcePool = fixturePool({ connectionString: sourceUrl.toString() }, failures), restoredPool = fixturePool({ connectionString: restoreUrl.toString() }, failures), restorePools = [];
  const poolFactory = connectionString => { const pool = fixturePool({ connectionString }, failures); restorePools.push(pool); return pool; };
  const sourceClient = await sourcePool.connect();
  t.after(async () => {
    const unclosedRestorePools = restorePools.filter(pool => !pool.ending).length;
    sourceClient.release(); await Promise.all([sourcePool, restoredPool, ...restorePools].map(pool => pool.end()));
    try { await dropFixtureDatabase(admin, sourceName); await dropFixtureDatabase(admin, restoreName); }
    finally { await admin.end(); }
    await rm(directory, { recursive: true, force: true });
    assert.equal(unclosedRestorePools, 0, 'backup operations must close their own scratch connections');
    assert.deepEqual(failures, [], 'no unexpected idle PostgreSQL errors');
  });
  await admin.query(`CREATE ROLE "${ownerRole}" NOLOGIN; CREATE ROLE "${readerRole}" NOLOGIN`);
  t.after(async () => {
    const cleanup = fixturePool({ connectionString: testDatabase }, failures);
    try { await cleanup.query(`DROP ROLE IF EXISTS "${ownerRole}"; DROP ROLE IF EXISTS "${readerRole}"`); } finally { await cleanup.end(); }
  });
  await sourceClient.query('CREATE TABLE public.backup_identity (id text PRIMARY KEY,revision bigint NOT NULL,document jsonb NOT NULL)');
  const payload = { family: 'private-fixture', cards: [7, 19, 42], code: randomUUID() };
  await sourceClient.query('INSERT INTO public.backup_identity VALUES ($1,$2,$3)', ['unchanged-book-id', 17, payload]);
  await sourceClient.query(`ALTER TABLE public.backup_identity OWNER TO "${ownerRole}"; GRANT SELECT ON public.backup_identity TO "${readerRole}"; ALTER TABLE public.backup_identity ENABLE ROW LEVEL SECURITY; CREATE POLICY backup_reader ON public.backup_identity FOR SELECT TO "${readerRole}" USING (true)`);
  const env = configuration({ DATABASE_URL: sourceUrl.toString(), RESTORE_TEST_DATABASE_URL: restoreUrl.toString(), DATABASE_BACKUP_DIRECTORY: directory });
  const prerequisites = validateApplyPrerequisites(env);
  const proof = await backupAndRestore({ env, target: { projectRef }, sourceClient, sourceVersion: version, prerequisites, spawnTool, poolFactory });
  assert.equal(proof.restoreVerified, true); assert.equal(proof.sourceProof.tables, 1);
  assert.deepEqual(proof.sourceProof, proof.restoredProof);
  assert.deepEqual(proof.sourceSecurity, proof.restoredSecurity);
  const restored = (await restoredPool.query('SELECT id,revision,document FROM public.backup_identity')).rows[0];
  assert.equal(restored.id, 'unchanged-book-id'); assert.equal(Number(restored.revision), 17); assert.deepEqual(restored.document, payload);
  assert.equal((await restoredPool.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.backup_identity'::regclass")).rows[0].owner, ownerRole);
  const grants = (await restoredPool.query("SELECT has_table_privilege($1,'public.backup_identity','SELECT') AS read,has_table_privilege($1,'public.backup_identity','UPDATE') AS write", [readerRole])).rows[0];
  assert.deepEqual(grants, { read: true, write: false });
  const files = await readdir(directory); assert.equal(files.length, 2);
  const encrypted = await readFile(join(directory, files.find(file => file.endsWith('.aesgcm'))));
  assert.equal(sha(encrypted), proof.encryptedSha256); assert.equal(encrypted.includes(Buffer.from('private-fixture')), false);
  await assert.rejects(backupAndRestore({ env, target: { projectRef }, sourceClient, sourceVersion: version, prerequisites, spawnTool, poolFactory }), error => error.code === 'restore_database_not_empty');
  assert.equal((await readdir(directory)).length, 2, 'a nonempty restore database blocks before writing a new backup');
});
