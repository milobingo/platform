import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, open, rm, chmod, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, connect } from 'node:tls';
import { Pool } from 'pg';
import { Readable } from 'node:stream';
import { scramVerifier, deriveRuntimeUrl, validateRestoreProof, provisionRuntime } from '../scripts/deploy/provision-runtime.mjs';
import { applyDatabase, loadManifest, encryptBackup } from '../scripts/deploy/database.mjs';

const ref = 'lfsdgxcpdyghidzkzzvn', releaseSha = 'a'.repeat(40), role = 'milo_staging_runtime';
const backupId = `milo-${ref}-20261105T160000Z-${randomUUID()}`;
const configuration = () => ({ DATABASE_URL: `postgresql://migration:test-only@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`, SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SECRET_KEY: 'sb_secret_test_only', SUPABASE_STORAGE_BUCKET: 'milo-staging', RELEASE_SHA: releaseSha, BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32), RESTORE_TEST_DATABASE_URL: 'postgresql://fixture:test-only@127.0.0.1/milo_restore_test_runtime', DATABASE_BACKUP_DIRECTORY: '/tmp/runtime-proof-contract' });
async function proofFixture(t, major = 17) {
  const directory = await mkdtemp(join(tmpdir(), 'milo-runtime-proof-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const bytes = Buffer.from('encrypted-backup-fixture-only');
  const metadata = JSON.stringify({ format: 1, projectRef: ref, releaseSha, backupId, extensions: [], owners: [] });
  const sidecarPath = join(directory, `${backupId}.extensions.json.aesgcm`);
  await encryptBackup(Readable.from(metadata), sidecarPath, configuration().BACKUP_ENCRYPTION_KEY);
  const extensionMetadata = { format: 1, filename: `${backupId}.extensions.json.aesgcm`, encryptedSha256: createHash('sha256').update(await readFile(sidecarPath)).digest('hex'), metadataSha256: createHash('sha256').update(metadata).digest('hex'), relations: 0, extensions: 0 };
  const sourceProof = { tables: 2, digest: 'b'.repeat(64) }, sourceSecurity = { relations: 2, digest: 'c'.repeat(64) };
  const proof = { format: 1, projectRef: ref, releaseSha, backupId, postgresMajor: major, encryptedSha256: createHash('sha256').update(bytes).digest('hex'), extensionMetadata, sourceProof, restoredProof: sourceProof, sourceSecurity, restoredSecurity: sourceSecurity, restoreVerified: true, verifiedAt: new Date().toISOString() };
  const proofPath = join(directory, `${backupId}.proof.json`), dumpPath = join(directory, `${backupId}.dump.aesgcm`);
  await writeFile(proofPath, JSON.stringify(proof), { mode: 0o600 }); await writeFile(dumpPath, bytes, { mode: 0o600 });
  return { directory, proof, proofPath, dumpPath, sidecarPath };
}

test('derived runtime credentials preserve target, remove TLS overrides and use an ASCII SCRAM verifier', () => {
  const password = 'x'.repeat(43), verifier = scramVerifier(password);
  assert.match(verifier, /^SCRAM-SHA-256\$16384:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
  assert.equal(verifier.includes(password), false);
  const direct = new URL(deriveRuntimeUrl(configuration().DATABASE_URL, password));
  assert.equal(direct.username, role); assert.equal(direct.password, password); assert.equal(direct.search, '?sslmode=verify-full');
  const pooled = new URL(deriveRuntimeUrl(`postgresql://postgres.${ref}:old-only@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require&sslrootcert=ignored`, password));
  assert.equal(pooled.username, `${role}.${ref}`); assert.equal(pooled.search, '?sslmode=verify-full');
});

test('runtime provisioning rejects stale, mismatched, modified and unsafe backup proof before opening a database', async t => {
  const { directory, proof, proofPath, dumpPath, sidecarPath } = await proofFixture(t), parent = await open(directory, 'r');
  t.after(() => parent.close());
  assert.equal((await validateRestoreProof(parent, backupId, releaseSha)).backupId, backupId);
  const reject = overrides => writeFile(proofPath, JSON.stringify({ ...proof, ...overrides })).then(() => assert.rejects(provisionRuntime({ env: configuration(), backupId, directory, poolFactory: () => assert.fail('invalid proof opened a database') })));
  await reject({ verifiedAt: new Date(Date.now() - 3600001).toISOString() });
  await reject({ restoreVerified: false }); await reject({ releaseSha: 'd'.repeat(40) }); await reject({ projectRef: 'wrong' });
  await reject({ restoredSecurity: { relations: 2, digest: 'd'.repeat(64) } });
  await reject({ extensionMetadata: undefined });
  await writeFile(proofPath, JSON.stringify(proof));
  const sidecar = await readFile(sidecarPath); await writeFile(sidecarPath, 'changed-metadata');
  await assert.rejects(validateRestoreProof(parent, backupId, releaseSha), error => error.code === 'extension_metadata_hash');
  await rm(sidecarPath); await assert.rejects(validateRestoreProof(parent, backupId, releaseSha), error => error.code === 'ENOENT');
  await writeFile(sidecarPath, sidecar, { mode: 0o600 });
  await writeFile(proofPath, JSON.stringify(proof)); await writeFile(dumpPath, 'changed-encrypted-bytes');
  await assert.rejects(validateRestoreProof(parent, backupId, releaseSha), error => error.code === 'backup_hash_mismatch');
  await chmod(proofPath, 0o644);
  await assert.rejects(validateRestoreProof(parent, backupId, releaseSha), error => error.code === 'backup_file_unsafe');
  await rm(proofPath); await symlink(dumpPath, proofPath);
  await assert.rejects(validateRestoreProof(parent, backupId, releaseSha));
});

async function tlsFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'milo-runtime-tls-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const keyPath = join(directory, 'test.key'), certPath = join(directory, 'test.crt');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=milo-runtime-fixture', '-addext', `subjectAltName=DNS:db.${ref}.supabase.co`, '-addext', 'basicConstraints=critical,CA:TRUE']);
  const sockets = [], server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, socket => sockets.push(socket));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const socket = connect({ host: '127.0.0.1', port: server.address().port, servername: `db.${ref}.supabase.co`, ca: await readFile(certPath), rejectUnauthorized: true }); sockets.push(socket);
  await new Promise((done, reject) => { socket.once('secureConnect', done); socket.once('error', reject); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(done => server.close(done)); });
  return socket;
}

const testUrl = process.env.MILO_TEST_DATABASE_URL;
test('real PostgreSQL accepts the generated SCRAM login, enforces backend-only rights and refuses account reuse', { skip: !testUrl, timeout: 30000 }, async t => {
  const url = new URL(testUrl); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)); assert.match(url.pathname, /test/);
  const socket = await tlsFixture(t), admin = new Pool({ connectionString: testUrl }), pools = [], pendingEnds = [], statements = [];
  const name = `milo_runtime_test_${randomUUID().replaceAll('-', '')}`;
  if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length) { await admin.end(); assert.fail('The dedicated fixture already contains the fixed bootstrap role.'); }
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const source = new Pool({ connectionString: url.toString() });
  const version = (await source.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
  const fixture = await proofFixture(t, Math.floor(version / 10000));
  t.after(async () => {
    await Promise.all(pools.map(pool => pool.end())); await Promise.all(pendingEnds); await source.end();
    try {
      for (let attempt = 0;; attempt++) {
        try { await admin.query(`DROP DATABASE "${name}"`); break; }
        catch (error) { if (error.code !== '55006' || attempt > 39) throw error; await new Promise(done => setTimeout(done, 50)); }
      }
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    } finally { await admin.end(); }
  });
  function trackedPool(options) {
    const pool = new Pool(options); pools.push(pool); pool.on('error', () => {});
    pool.on('connect', client => pendingEnds.push(new Promise(done => client.once('end', done))));
    const finish = pool.end.bind(pool); let ending;
    pool.end = () => ending ??= finish();
    return pool;
  }
  const poolFactory = () => {
    const pool = trackedPool({ connectionString: url.toString() });
    return { end: () => pool.end(), async connect() {
      const client = await pool.connect();
      return { connection: { stream: socket }, release: () => client.release(), async query(sql, values) { statements.push(sql); return client.query(sql, values); } };
    } };
  };
  const buckets = new Map(), fetcher = async (request, options = {}) => {
    if (options.method === 'POST') { const value = JSON.parse(options.body); buckets.set(value.id, value); return Response.json(value); }
    const bucket = buckets.get(request.split('/').at(-1)); return bucket ? Response.json(bucket) : new Response('{}', { status: 404 });
  };
  const env = configuration(), manifest = await loadManifest();
  await applyDatabase({ env, expectedProjectRef: ref, reviewedManifestSha256: manifest.digest, manifest, poolFactory, fetcher, backupProvider: async () => fixture.proof });
  const runtimePoolFactory = options => {
    const requested = new URL(options.connectionString), local = new URL(url);
    local.username = requested.username; local.password = requested.password;
    const pool = trackedPool({ connectionString: local.toString() }), connect = pool.connect.bind(pool);
    pool.connect = async () => { const client = await connect(); return { connection: { stream: socket }, query: client.query.bind(client), release: () => client.release() }; };
    return pool;
  };
  await source.query('GRANT CREATE ON SCHEMA public TO milo_backend');
  await assert.rejects(provisionRuntime({ env, backupId, directory: fixture.directory, poolFactory, runtimePoolFactory, fetcher }), error => error.code === 'runtime_excess_privileges');
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length, 0, 'unsafe inherited rights roll back role creation');
  await source.query('REVOKE CREATE ON SCHEMA public FROM milo_backend');
  const result = await provisionRuntime({ env, backupId, directory: fixture.directory, poolFactory, runtimePoolFactory, fetcher });
  assert.equal(result.ok, true); assert.equal(result.runtimeVerified, true); assert.equal(JSON.stringify(result).includes('DATABASE_URL'), false);
  const output = join(fixture.directory, 'runtime-output.json'), body = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(Object.keys(body), ['DATABASE_URL']); assert.equal((await stat(output)).mode & 0o777, 0o600);
  const derived = new URL(body.DATABASE_URL), localRuntime = new URL(url); localRuntime.username = derived.username; localRuntime.password = derived.password;
  assert.ok(!statements.some(sql => sql.includes(derived.password)), 'SQL never contains the plaintext generated password');
  const runtime = trackedPool({ connectionString: localRuntime.toString() });
  await runtime.query("INSERT INTO bingo_games VALUES ('fixture-game','owner',1,'{}',0)");
  await assert.rejects(runtime.query("INSERT INTO app_user_roles VALUES ('elevate','regie')"), error => error.code === '42501');
  await assert.rejects(runtime.query('CREATE TABLE public.illegal_runtime_ddl (id int)'), error => error.code === '42501');
  await assert.rejects(runtime.query('SELECT * FROM milo_deploy.migrations'), error => error.code === '42501');
  localRuntime.password = 'incorrect-test-password';
  const wrongPassword = trackedPool({ connectionString: localRuntime.toString() });
  await assert.rejects(wrongPassword.query('SELECT 1'), error => error.code === '28P01');
  await assert.rejects(provisionRuntime({ env, backupId, directory: fixture.directory, poolFactory: () => assert.fail('existing output must fail before database access'), fetcher }), error => error.code === 'EEXIST');
  await rm(output);
  await assert.rejects(provisionRuntime({ env, backupId, directory: fixture.directory, poolFactory, runtimePoolFactory, fetcher }), error => error.code === 'runtime_role_exists');
  assert.equal((await admin.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1', [role])).rows[0].rolcanlogin, true);
  await source.query(`REVOKE CONNECT ON DATABASE "${name}" FROM ${role}; DROP ROLE ${role}`);
  await assert.rejects(provisionRuntime({ env, backupId, directory: fixture.directory, poolFactory, runtimePoolFactory: () => { throw new Error('simulated post-commit connection outage'); }, fetcher }), error => error.code === 'partial_runtime_provision');
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length, 1, 'post-commit failure retains the account and never silently resets it');
  const retained = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(Object.keys(retained), ['DATABASE_URL']);
  assert.equal(new URL(retained.DATABASE_URL).username, role);
  assert.equal((await stat(output)).mode & 0o777, 0o600, 'post-commit failure preserves private recovery credentials without publishing them');
});

test('database-only workflows stay manual, use exact CI and keep source admin credentials out of app activation', async () => {
  for (const filename of ['staging-database-apply.yml', 'staging-runtime.yml']) {
    const source = await readFile(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8');
    assert.match(source, /workflow_dispatch:/); assert.match(source, /run: node scripts\/deploy\/release-preflight.mjs ci/);
    assert.match(source, /DATABASE_URL: \$\{\{ secrets.MIGRATION_DATABASE_URL \}\}/); assert.match(source, /group: milobingo-staging/);
    assert.doesNotMatch(source, /dg-site-deploy|secrets\.DATABASE_URL|pull_request:/);
  }
});
