import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, writeFile, open, rm, chmod, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, connect, rootCertificates } from 'node:tls';
import { Pool } from 'pg';
import { Readable } from 'node:stream';
import { deriveRuntimeUrl, validateRestoreProof, provisionProductionRuntime as provisionRuntime, assertMigrationProofHistory, validateProductionEnvironment, publishHandoff, loadProductionEnvironment } from '../infra/production/provision-runtime.mjs';
import { scramVerifier } from '../scripts/deploy/provision-runtime.mjs';
import { applyDatabase, loadManifest, encryptBackup } from '../scripts/deploy/database.mjs';

const ref = 'msupvdycmtbycaonqgan', releaseSha = 'a'.repeat(40), role = 'milobingo_production_runtime';
const now = Date.now(), trustedPem = rootCertificates.find(pem => { const cert = new X509Certificate(pem); return cert.ca && Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) > now; });
assert.ok(trustedPem);
const caBase64 = Buffer.from(trustedPem).toString('base64');
const backupId = `milo-${ref}-20261105T160000000Z-${randomUUID()}`;
const configuration = () => ({ DATABASE_URL: `postgresql://migration:test-only@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`, SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SECRET_KEY: 'sb_secret_test_only', SUPABASE_STORAGE_BUCKET: 'milo-private', RELEASE_SHA: releaseSha, SUPABASE_DB_CA_BASE64: caBase64 });

test('runtime proof binds the newest exact migration while preserving known earlier backup/release identities',async()=>{
 const manifest=await loadManifest(),history=manifest.migrations.map((migration,index)=>({filename:migration.filename,checksum:migration.checksum,project_ref:ref,backup_id:index?'current-proof':'earlier-proof',release_sha:index?releaseSha:'b'.repeat(40)}));
 const before=structuredClone(history);assertMigrationProofHistory(history,manifest,'current-proof',releaseSha);assert.deepEqual(history,before);
 for(const altered of [history.slice(1),[...history,{...history[0],filename:'unknown_migration.sql'}],history.map((r,i)=>i?{...r,backup_id:'wrong-proof'}:r),history.map((r,i)=>i?{...r,release_sha:'c'.repeat(40)}:r),history.map((r,i)=>i?r:{...r,checksum:'0'.repeat(64)}),history.map((r,i)=>i?r:{...r,project_ref:'wrong-project'})])assert.throws(()=>assertMigrationProofHistory(altered,manifest,'current-proof',releaseSha),error=>error.code==='runtime_backup_history');
});
async function proofFixture(t, major = 17) {
  const directory = await mkdtemp(join(tmpdir(), 'milo-runtime-proof-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const bytes = Buffer.from('encrypted-backup-fixture-only');
  const metadata = JSON.stringify({ format: 1, projectRef: ref, releaseSha, backupId, extensions: [], owners: [], eventTriggers: [], schemaPermissions: { schemas: [], grants: [] } });
  const sidecarPath = join(directory, `${backupId}.extensions.json.aesgcm`);
  await encryptBackup(Readable.from(metadata), sidecarPath, 'ab'.repeat(32));
  const extensionMetadata = { format: 1, filename: `${backupId}.extensions.json.aesgcm`, encryptedSha256: createHash('sha256').update(await readFile(sidecarPath)).digest('hex'), metadataSha256: createHash('sha256').update(metadata).digest('hex'), relations: 0, extensions: 0, eventTriggers: 0, schemas: 0, schemaGrants: 0 };
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
      return { connection: { stream: socket }, release: () => client.release(), async query(sql, values) { statements.push(sql); if (sql.startsWith('CREATE ROLE')) { const handoff = JSON.parse(await readFile(join(fixture.directory, 'runtime-output.json'), 'utf8')); assert.equal(new URL(handoff.DATABASE_URL).username, role, 'complete recoverable credential must exist before role transaction'); } return client.query(sql, values); } };
    } };
  };
  const buckets = new Map(), fetcher = async (request, options = {}) => {
    if (options.method === 'POST') { const value = JSON.parse(options.body); buckets.set(value.id, value); return Response.json(value); }
    const bucket = buckets.get(request.split('/').at(-1)); return bucket ? Response.json(bucket) : new Response('{}', { status: 404 });
  };
  const env = configuration(), manifest = await loadManifest();
  await applyDatabase({ env: { ...env, BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32), RESTORE_TEST_DATABASE_URL: 'postgresql://fixture:test-only@127.0.0.1/milo_restore_test_runtime', DATABASE_BACKUP_DIRECTORY: '/tmp/runtime-proof-contract' }, expectedProjectRef: ref, reviewedManifestSha256: manifest.digest, manifest, poolFactory, fetcher, backupProvider: async () => fixture.proof });
  // An additive upgrade preserves the first migration's original proof and
  // release. Only the newest exact migration belongs to this restore proof.
  const historicalBackup=backupId.replace('20261105T160000000Z','20261104T160000000Z'),historicalRelease='b'.repeat(40),firstMigration=manifest.migrations[0].filename;
  await source.query('UPDATE milo_deploy.migrations SET backup_id=$1,release_sha=$2 WHERE filename=$3',[historicalBackup,historicalRelease,firstMigration]);
  const originalHistory=(await source.query('SELECT * FROM milo_deploy.migrations WHERE filename=$1',[firstMigration])).rows[0];
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
  assert.deepEqual((await source.query('SELECT * FROM milo_deploy.migrations WHERE filename=$1',[firstMigration])).rows[0],originalHistory,'runtime provisioning never rewrites the earlier migration proof');
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
  await assert.rejects(provisionRuntime({ env, backupId, directory: fixture.directory, poolFactory: () => assert.fail('existing output must fail before database access'), fetcher }), error => error.code === 'runtime_output_exists');
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

test('production bootstrap rejects foreign projects, missing CA, non-verify-full, unknown inputs and bad release without exposing inputs', () => {
  assert.equal(validateProductionEnvironment(configuration()).projectRef, ref);
  const marker = 'private-value-must-never-leak';
  for (const changed of [
    { SUPABASE_URL: 'https://lfsdgxcpdyghidzkzzvn.supabase.co' },
    { DATABASE_URL: `postgresql://migration:${marker}@db.otherproject.supabase.co/postgres?sslmode=verify-full` },
    { DATABASE_URL: configuration().DATABASE_URL.replace('verify-full', 'require') },
    { DATABASE_URL: configuration().DATABASE_URL.replace('/postgres?', '/other?') },
    { SUPABASE_DB_CA_BASE64: '' }, { SUPABASE_DB_CA_BASE64: marker },
    { SUPABASE_STORAGE_BUCKET: 'milo-staging' }, { RELEASE_SHA: 'short' }, { EXTRA_SECRET: marker },
  ]) assert.throws(() => validateProductionEnvironment({ ...configuration(), ...changed }), error => { assert.ok(!error.message.includes(marker)); return true; });
});

test('runtime handoff publishes complete 0600 JSON once and never overwrites a file or symlink', async t => {
  const { directory } = await proofFixture(t), parent = await open(directory, 'r'); t.after(() => parent.close());
  const target = join(directory, 'runtime-output.json'), url = deriveRuntimeUrl(configuration().DATABASE_URL, 'x'.repeat(43));
  await publishHandoff(parent, url);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { DATABASE_URL: url });
  assert.equal((await stat(target)).mode & 0o777, 0o600); assert.equal((await stat(target)).nlink, 1);
  await assert.rejects(publishHandoff(parent, url + '-different'), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { DATABASE_URL: url });
  await rm(target); const victim = join(directory, 'victim.json'); await writeFile(victim, 'unchanged', { mode: 0o600 }); await symlink(victim, target);
  await assert.rejects(publishHandoff(parent, url), { code: 'EEXIST' }); assert.equal(await readFile(victim, 'utf8'), 'unchanged');
});

test('administrative bootstrap input must be a private ordinary owner-only file', async t => {
  const { directory } = await proofFixture(t), target = join(directory, 'database-environment.json');
  await writeFile(target, JSON.stringify(configuration()), { mode: 0o600 });
  assert.deepEqual(await loadProductionEnvironment(target), configuration());
  await chmod(target, 0o644); await assert.rejects(loadProductionEnvironment(target), error => error.code === 'backup_file_unsafe');
  await rm(target); const victim = join(directory, 'input.json'); await writeFile(victim, JSON.stringify(configuration()), { mode: 0o600 }); await symlink(victim, target);
  await assert.rejects(loadProductionEnvironment(target));
});
