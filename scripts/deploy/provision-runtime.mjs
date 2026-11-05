import { constants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { postgresTlsOptions } from '../../server/node-postgres-tls.js';
import { auditDatabase, DatabaseGateError, loadManifest, validateTarget, verifyDatabaseClientTls } from './database.mjs';
import { verifyRuntimeDatabase } from './release-preflight.mjs';

const projectRef = 'lfsdgxcpdyghidzkzzvn';
const backupDirectory = '/var/backups/milobingo-staging';
const runtimeRole = 'milo_staging_runtime';
const outputName = 'runtime-output.json';
const fail = (code, message) => { throw new DatabaseGateError(code, message); };
const stable = value => JSON.stringify(value);
const digestShape = value => value && /^[a-f0-9]{64}$/.test(value.digest || '');

// Generated passwords are ASCII base64url, so SASLprep leaves them unchanged.
// PostgreSQL accepts a SCRAM verifier in PASSWORD without logging plaintext.
export function scramVerifier(password) {
  if (typeof password !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(password)) fail('runtime_password_format', 'Runtimewachtwoord heeft een ongeldig intern formaat.');
  const salt = randomBytes(16), iterations = 16384;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const stored = createHash('sha256').update(clientKey).digest('base64');
  const server = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${stored}:${server}`;
}

export function deriveRuntimeUrl(source, password) {
  const url = new URL(source);
  url.username = url.hostname.endsWith('.pooler.supabase.com') ? `${runtimeRole}.${projectRef}` : runtimeRole;
  url.password = password;
  for (const key of [...url.searchParams.keys()]) if (/^ssl/i.test(key) || key.toLowerCase() === 'uselibpqcompat') url.searchParams.delete(key);
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

async function privateFile(parent, name, maxBytes) {
  const file = await open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size < 1 || info.size > maxBytes) fail('backup_file_unsafe', 'Backup en herstelbewijs moeten normale private bestanden van de runner zijn.');
    return file;
  } catch (error) { await file.close(); throw error; }
}

export async function validateRestoreProof(parent, backupId, releaseSha, now = Date.now()) {
  if (!new RegExp(`^milo-${projectRef}-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`).test(backupId || '') || !/^[a-f0-9]{40}$/.test(releaseSha || '')) fail('backup_identity', 'Geef de exacte backupidentiteit en broncommit op.');
  const proofFile = await privateFile(parent, `${backupId}.proof.json`, 65536);
  let proof;
  try { proof = JSON.parse(await proofFile.readFile('utf8')); }
  catch { fail('backup_proof_invalid', 'Het private herstelbewijs is niet geldig.'); }
  finally { await proofFile.close(); }
  const verifiedAt = Date.parse(proof.verifiedAt), age = now - verifiedAt;
  if (proof.format !== 1 || proof.projectRef !== projectRef || proof.releaseSha !== releaseSha || proof.backupId !== backupId || proof.restoreVerified !== true || !/^[a-f0-9]{64}$/.test(proof.encryptedSha256 || '') || !Number.isSafeInteger(proof.postgresMajor) || !Number.isFinite(age) || age < 0 || age > 3600000 || !digestShape(proof.sourceProof) || !digestShape(proof.sourceSecurity) || stable(proof.sourceProof) !== stable(proof.restoredProof) || stable(proof.sourceSecurity) !== stable(proof.restoredSecurity)) fail('backup_proof_invalid', 'Het herstelbewijs moet recent, overeenkomend en aan dit stagingproject en deze release gebonden zijn.');
  const dump = await privateFile(parent, `${backupId}.dump.aesgcm`, Number.MAX_SAFE_INTEGER);
  try {
    const hash = createHash('sha256');
    for await (const chunk of dump.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== proof.encryptedSha256) fail('backup_hash_mismatch', 'Het versleutelde backupbestand wijkt af van het herstelbewijs.');
  } finally { await dump.close(); }
  return proof;
}

function sourcePoolFactory(connectionString, { caBase64 } = {}) {
  const pool = new Pool({ ...postgresTlsOptions(connectionString, { caBase64 }), max: 2, connectionTimeoutMillis: 10000, statement_timeout: 60000 });
  pool.on('error', () => {});
  return pool;
}

export async function provisionRuntime({ env = process.env, backupId, directory = backupDirectory, poolFactory = sourcePoolFactory, runtimePoolFactory = options => new Pool(options), fetcher = fetch } = {}) {
  const target = validateTarget(env, projectRef), manifest = await loadManifest();
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let output, pool, client, locked = false, committed = false, commitAttempted = false;
  try {
    const info = await parent.stat();
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700 || await realpath(directory) !== resolve(directory)) fail('backup_directory_unsafe', 'De backupdirectory moet een private echte runnerdirectory zijn.');
    const proof = await validateRestoreProof(parent, backupId, env.RELEASE_SHA);
    // Reserve before touching the database: never overwrite an existing handoff.
    output = await open(`/proc/self/fd/${parent.fd}/${outputName}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await output.chmod(0o600);
    const before = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, poolFactory, fetcher });
    if (!before.ok || before.applicationTables.length !== 18 || !before.managed || !before.historyReadable || before.pending.length) fail('runtime_schema_unready', 'De beheerde stagingdatabase moet volledig gemigreerd en gecontroleerd zijn.');
    pool = poolFactory(env.DATABASE_URL, { verifiedTls: true, caBase64: env.SUPABASE_DB_CA_BASE64 });
    client = await pool.connect(); verifyDatabaseClientTls(client, target.database.hostname);
    await client.query("SELECT pg_advisory_lock(hashtextextended('milo-controlled-schema-bootstrap',0))"); locked = true;
    const fresh = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, poolFactory, fetcher });
    if (!fresh.ok || fresh.applicationTables.length !== 18 || !fresh.managed || !fresh.historyReadable || fresh.pending.length || Math.floor(fresh.connection.version / 10000) !== proof.postgresMajor) fail('runtime_locked_audit', 'De gecontroleerde database of PostgreSQL-versie veranderde vóór runtimeprovisioning.');
    await validateRestoreProof(parent, backupId, env.RELEASE_SHA);
    const history = (await client.query('SELECT backup_id,release_sha,project_ref FROM milo_deploy.migrations ORDER BY filename')).rows;
    if (!history.length || history.some(row => row.backup_id !== backupId || row.release_sha !== env.RELEASE_SHA || row.project_ref !== projectRef)) fail('runtime_backup_history', 'De migratiehistorie verwijst niet naar dit herstelbewijs en deze release.');
    if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [runtimeRole])).rows.length) fail('runtime_role_exists', 'De vaste runtime-login bestaat al. Er wordt geen account of wachtwoord overschreven.');
    const password = randomBytes(32).toString('base64url'), verifier = scramVerifier(password);
    const runtimeUrl = deriveRuntimeUrl(env.DATABASE_URL, password);
    const outputInfo = await output.stat();
    if (!outputInfo.isFile() || outputInfo.nlink !== 1 || outputInfo.uid !== process.getuid() || (outputInfo.mode & 0o777) !== 0o600) fail('runtime_output_unsafe', 'De gereserveerde runtimeoverdracht is niet meer veilig.');
    // Preserve recovery material before COMMIT can make the login durable.
    // This private file is not permission to publish: the workflow and a fresh
    // independent runtime check must succeed before changing the app secret.
    await output.writeFile(stable({ DATABASE_URL: runtimeUrl }) + '\n', 'utf8'); await output.sync(); await parent.sync();
    await client.query('BEGIN');
    try {
      await client.query(`CREATE ROLE ${runtimeRole} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`);
      await client.query(`GRANT milo_backend TO ${runtimeRole} WITH INHERIT TRUE, SET FALSE`);
      const privileges = (await client.query("SELECT has_schema_privilege($1,'public','CREATE') AS schema_create,has_table_privilege($1,'public.app_user_roles','INSERT,UPDATE,DELETE') AS role_write", [runtimeRole])).rows[0];
      if (privileges.schema_create || privileges.role_write) fail('runtime_excess_privileges', 'De runtime-login erft ongewenste schema- of roltoekenningsrechten.');
      commitAttempted = true; await client.query('COMMIT'); committed = true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    const verifiedRuntimeFactory = options => {
      const runtimePool = runtimePoolFactory(options), connect = runtimePool.connect.bind(runtimePool);
      runtimePool.connect = async () => { const runtimeClient = await connect(); try { verifyDatabaseClientTls(runtimeClient, target.database.hostname); return runtimeClient; } catch (error) { runtimeClient.release(); throw error; } };
      return runtimePool;
    };
    await verifyRuntimeDatabase(runtimeUrl, { poolFactory: verifiedRuntimeFactory, caBase64: env.SUPABASE_DB_CA_BASE64, tableNames: [...manifest.tables.keys()] });
    return { ok: true, role: runtimeRole, projectRef, releaseSha: env.RELEASE_SHA, backupId, runtimeVerified: true, handoff: outputName, credentialsPrinted: false };
  } catch (error) {
    if (committed || commitAttempted) fail('partial_runtime_provision', 'De runtime-login kan zijn aangemaakt, maar commitbevestiging of nacontrole faalde. De private runtimeoverdracht blijft behouden. Stop deployment; publiceer de URL pas na onafhankelijke controle, zonder automatische wachtwoordreset.');
    throw error;
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended('milo-controlled-schema-bootstrap',0))");
    } finally {
      client?.release(); await pool?.end(); await output?.close();
      if (output && !committed && !commitAttempted) await unlink(`/proc/self/fd/${parent.fd}/${outputName}`).catch(() => {});
      await parent.close();
    }
  }
}

async function main() {
  const env = process.env;
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--backup-id=')) fail('runtime_arguments', 'Gebruik uitsluitend --backup-id=<identiteit-uit-het-herstelbewijs>.');
  if (hostname() !== 'dg-nxttrack-01' || userInfo().username !== 'run-mil-stg' || process.getuid() !== 1001 || env.GITHUB_REPOSITORY !== 'milobingo/platform' || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.RUNNER_NAME !== 'dg-nxttrack-01-nxttrack-staging' || env.GITHUB_WORKSPACE !== '/home/run-mil-stg/_work/platform/platform') fail('runtime_identity', 'Runtimeprovisioning vereist de bevestigde stagingrunner en main-workflow.');
  const head = execFileSync('/usr/bin/git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();
  if (head !== env.RELEASE_SHA) fail('runtime_checkout', 'De checkout hoort niet bij de expliciet gecontroleerde release.');
  for (let path = dirname(backupDirectory);; path = dirname(path)) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022)) fail('runtime_parent_directory', 'De bovenliggende backupdirectories moeten uitsluitend door root beheerd worden.');
    if (path === '/') break;
  }
  console.log(stable(await provisionRuntime({ env, backupId: process.argv[2].slice('--backup-id='.length) })));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(stable({ ok: false, code: error instanceof DatabaseGateError ? error.code : 'runtime_provision_failed', message: error instanceof DatabaseGateError ? error.message : 'Runtimeprovisioning mislukt; geen verbindingswaarden of driverdetails gelogd.' }));
  process.exitCode = 1;
});
