import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, userInfo } from 'node:os';
import { Pool } from 'pg';
import { postgresTlsOptions } from '../../server/node-postgres-tls.js';
import { auditDatabase, DatabaseGateError, loadManifest, validateTarget, verifyDatabaseClientTls } from '../../scripts/deploy/database.mjs';
import { verifyRuntimeDatabase } from '../../scripts/deploy/release-preflight.mjs';

import { scramVerifier } from '../../scripts/deploy/provision-runtime.mjs';

export const projectRef = 'msupvdycmtbycaonqgan';
export const backupDirectory = '/var/backups/milobingo-production';
export const environmentFile = '/root/milo-production-bootstrap/database-environment.json';
export const runtimeRole = 'milobingo_production_runtime';
const outputName = 'runtime-output.json';
const fail = (code, message) => { throw new DatabaseGateError(code, message); };
const stable = value => JSON.stringify(value);
const digestShape = value => value && /^[a-f0-9]{64}$/.test(value.digest || '');

// This is a one-time, root-owned production bootstrap. The runner, build and
// app accounts receive neither this entrypoint nor the administrative input.
// Shared schema/TLS/SCRAM primitives remain authoritative; staging identity
// checks and the staging provisioning command are never invoked.
export function validateProductionEnvironment(env) {
  const keys = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_DB_CA_BASE64', 'SUPABASE_STORAGE_BUCKET', 'RELEASE_SHA'];
  if (!env || Object.keys(env).length !== keys.length || keys.some(key => typeof env[key] !== 'string' || !env[key] || /[\u0000\r\n]/.test(env[key])) || Object.keys(env).some(key => !keys.includes(key))) fail('production_environment', 'De private productie-invoer moet uitsluitend de zes beoordeelde databasevelden bevatten.');
  const target = validateTarget(env, projectRef);
  if (env.SUPABASE_STORAGE_BUCKET !== 'milo-private' || !/^[a-f0-9]{40}$/.test(env.RELEASE_SHA) || target.database.pathname !== '/postgres' || target.database.searchParams.getAll('sslmode').length !== 1 || target.database.searchParams.get('sslmode') !== 'verify-full') fail('production_environment', 'De productie-invoer moet het vaste project, de private bucket, postgres, de exacte release en verify-full gebruiken.');
  // Decode and validate the independently acquired public CA before connecting.
  postgresTlsOptions(env.DATABASE_URL, { caBase64: env.SUPABASE_DB_CA_BASE64 });
  return target;
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
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size < 1 || info.size > maxBytes) fail('backup_file_unsafe', 'Backup en herstelbewijs moeten normale private bestanden van de bootstrapbeheerder zijn.');
    return file;
  } catch (error) { await file.close(); throw error; }
}

export async function validateRestoreProof(parent, backupId, releaseSha, now = Date.now()) {
  if (!new RegExp(`^milo-${projectRef}-[0-9]{8}T[0-9]{9}Z-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`).test(backupId || '') || !/^[a-f0-9]{40}$/.test(releaseSha || '')) fail('backup_identity', 'Geef de exacte backupidentiteit en broncommit op.');
  const proofFile = await privateFile(parent, `${backupId}.proof.json`, 65536);
  let proof;
  try { proof = JSON.parse(await proofFile.readFile('utf8')); }
  catch { fail('backup_proof_invalid', 'Het private herstelbewijs is niet geldig.'); }
  finally { await proofFile.close(); }
  const verifiedAt = Date.parse(proof.verifiedAt), age = now - verifiedAt;
  const extensionMetadata = proof.extensionMetadata;
  if (proof.format !== 1 || proof.projectRef !== projectRef || proof.releaseSha !== releaseSha || proof.backupId !== backupId || proof.restoreVerified !== true || !/^[a-f0-9]{64}$/.test(proof.encryptedSha256 || '') || !Number.isSafeInteger(proof.postgresMajor) || !Number.isFinite(age) || age < 0 || age > 3600000 || !digestShape(proof.sourceProof) || !digestShape(proof.sourceSecurity) || stable(proof.sourceProof) !== stable(proof.restoredProof) || stable(proof.sourceSecurity) !== stable(proof.restoredSecurity) || extensionMetadata?.format !== 1 || extensionMetadata.filename !== `${backupId}.extensions.json.aesgcm` || !/^[a-f0-9]{64}$/.test(extensionMetadata.encryptedSha256 || '') || !/^[a-f0-9]{64}$/.test(extensionMetadata.metadataSha256 || '') || !Number.isSafeInteger(extensionMetadata.relations) || extensionMetadata.relations < 0 || !Number.isSafeInteger(extensionMetadata.extensions) || extensionMetadata.extensions < 0 || !Number.isSafeInteger(extensionMetadata.eventTriggers) || extensionMetadata.eventTriggers < 0 || !Number.isSafeInteger(extensionMetadata.schemas) || extensionMetadata.schemas < 0 || !Number.isSafeInteger(extensionMetadata.schemaGrants) || extensionMetadata.schemaGrants < 0) fail('backup_proof_invalid', 'Het herstelbewijs moet recent, overeenkomend en aan dit productieproject en deze release gebonden zijn.');
  const dump = await privateFile(parent, `${backupId}.dump.aesgcm`, Number.MAX_SAFE_INTEGER);
  try {
    const hash = createHash('sha256');
    for await (const chunk of dump.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== proof.encryptedSha256) fail('backup_hash_mismatch', 'Het versleutelde backupbestand wijkt af van het herstelbewijs.');
  } finally { await dump.close(); }
  const sidecar = await privateFile(parent, extensionMetadata.filename, 4194340);
  try {
    const hash = createHash('sha256');
    for await (const chunk of sidecar.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== extensionMetadata.encryptedSha256) fail('extension_metadata_hash', 'De private versleutelde extensiemetadata wijkt af van het herstelbewijs.');
  } finally { await sidecar.close(); }
  return proof;
}

export async function publishHandoff(parent, runtimeUrl) {
  const base = `/proc/self/fd/${parent.fd}`;
  const temporary = `${base}/.runtime-output-${randomUUID()}.tmp`;
  let file, linked = false;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.chmod(0o600);
    await file.writeFile(stable({ DATABASE_URL: runtimeUrl }) + '\n', 'utf8');
    await file.sync(); await file.close(); file = undefined;
    await link(temporary, `${base}/${outputName}`); linked = true;
    await unlink(temporary); await parent.sync();
  } catch (error) {
    // No database transaction has started yet. Preserve an existing destination
    // owned by another attempt; remove only the file this attempt linked.
    if (linked) { await unlink(`${base}/${outputName}`).catch(() => {}); await parent.sync().catch(() => {}); }
    throw error;
  } finally { await file?.close(); await unlink(temporary).catch(() => {}); }
}

function sourcePoolFactory(connectionString, { caBase64 } = {}) {
  const pool = new Pool({ ...postgresTlsOptions(connectionString, { caBase64 }), max: 2, connectionTimeoutMillis: 10000, statement_timeout: 60000 });
  pool.on('error', () => {});
  return pool;
}

export function assertMigrationProofHistory(history,manifest,backupId,releaseSha){
  const expected=manifest.migrations,latest=history.at(-1);
  // Prior additive migrations retain their own release/backup provenance.
  // Every filename, checksum and project must still match the audited source;
  // only the latest exact migration must reference the current restore proof.
  if(!expected.length||history.length!==expected.length||history.some((row,index)=>row.filename!==expected[index].filename||row.checksum!==expected[index].checksum||row.project_ref!==projectRef||typeof row.backup_id!=='string'||!row.backup_id||!/^[a-f0-9]{40}$/.test(row.release_sha||''))||latest.backup_id!==backupId||latest.release_sha!==releaseSha)fail('runtime_backup_history','De volledige bekende migratiehistorie moet bij dit project horen; de nieuwste migratie moet naar dit herstelbewijs en deze release verwijzen.');
}

export async function provisionProductionRuntime({ env = process.env, backupId, directory = backupDirectory, poolFactory = sourcePoolFactory, runtimePoolFactory = options => new Pool(options), fetcher = fetch } = {}) {
  const target = validateProductionEnvironment(env), manifest = await loadManifest();
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let outputPublished = false, pool, client, locked = false, committed = false, commitAttempted = false;
  try {
    const info = await parent.stat();
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700 || await realpath(directory) !== resolve(directory)) fail('backup_directory_unsafe', 'De backupdirectory moet een private echte beheerdirectory zijn.');
    const proof = await validateRestoreProof(parent, backupId, env.RELEASE_SHA);
    // Refuse an existing handoff before opening any database. Publication below
    // additionally uses link(2), which cannot overwrite a concurrently added file.
    try { await lstat(`/proc/self/fd/${parent.fd}/${outputName}`); fail('runtime_output_exists', 'De private runtimeoverdracht bestaat al; controleer en herstel bewust, zonder overschrijven.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const before = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, poolFactory, fetcher });
    if (!before.ok || before.applicationTables.length !== 23 || !before.managed || !before.historyReadable || before.pending.length) fail('runtime_schema_unready', 'De beheerde productiedatabase moet volledig gemigreerd en gecontroleerd zijn.');
    pool = poolFactory(env.DATABASE_URL, { verifiedTls: true, caBase64: env.SUPABASE_DB_CA_BASE64 });
    client = await pool.connect(); verifyDatabaseClientTls(client, target.database.hostname);
    await client.query("SELECT pg_advisory_lock(hashtextextended('milo-controlled-schema-bootstrap',0))"); locked = true;
    const fresh = await auditDatabase({ env, expectedProjectRef: projectRef, manifest, poolFactory, fetcher });
    if (!fresh.ok || fresh.applicationTables.length !== 23 || !fresh.managed || !fresh.historyReadable || fresh.pending.length || Math.floor(fresh.connection.version / 10000) !== proof.postgresMajor) fail('runtime_locked_audit', 'De gecontroleerde database of PostgreSQL-versie veranderde vóór runtimeprovisioning.');
    await validateRestoreProof(parent, backupId, env.RELEASE_SHA);
    const history = (await client.query('SELECT filename,checksum,backup_id,release_sha,project_ref FROM milo_deploy.migrations ORDER BY filename')).rows;
    assertMigrationProofHistory(history,manifest,backupId,env.RELEASE_SHA);
    if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [runtimeRole])).rows.length) fail('runtime_role_exists', 'De vaste runtime-login bestaat al. Er wordt geen account of wachtwoord overschreven.');
    const password = randomBytes(32).toString('base64url'), verifier = scramVerifier(password);
    const runtimeUrl = deriveRuntimeUrl(env.DATABASE_URL, password);
    // Publish the complete credential in one no-replace filesystem operation,
    // then fsync both file and directory before a durable role can be created.
    await publishHandoff(parent, runtimeUrl); outputPublished = true;
    await client.query('BEGIN');
    try {
      await client.query(`CREATE ROLE ${runtimeRole} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`);
      await client.query(`GRANT milo_backend TO ${runtimeRole} WITH INHERIT TRUE, SET FALSE`);
      const database = (await client.query('SELECT current_database() AS database')).rows[0].database;
      await client.query(`GRANT CONNECT ON DATABASE "${database.replaceAll('"', '""')}" TO ${runtimeRole}`);
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
      client?.release(); await pool?.end();
      if (outputPublished && !committed && !commitAttempted) await unlink(`/proc/self/fd/${parent.fd}/${outputName}`).catch(() => {});
      await parent.close();
    }
  }
}

async function assertRootDirectoryChain(directory, privateLeaf = false) {
  for (let path = directory;; path = dirname(path)) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) || privateLeaf && path === directory && (info.mode & 0o777) !== 0o700) fail('production_parent_directory', 'De beheer- en backupdirectories moeten echte, uitsluitend door root beheerde directories zijn; de private mappen zijn 0700.');
    if (path === '/') break;
  }
}

export async function loadProductionEnvironment(filename = environmentFile) {
  const parent = await open(dirname(filename), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const input = await privateFile(parent, filename.slice(dirname(filename).length + 1), 131072);
    try { const value = JSON.parse(await input.readFile('utf8')); validateProductionEnvironment(value); return value; }
    finally { await input.close(); }
  } finally { await parent.close(); }
}

async function main() {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--backup-id=')) fail('runtime_arguments', 'Gebruik uitsluitend --backup-id=<identiteit-uit-het-herstelbewijs>.');
  if (hostname() !== 'dg-nxttrack-01' || userInfo().username !== 'root' || process.getuid() !== 0 || process.geteuid() !== 0) fail('runtime_identity', 'Productieruntimeprovisioning vereist de rootbeheerder op de vaste doelhost.');
  await assertRootDirectoryChain(dirname(environmentFile), true);
  await assertRootDirectoryChain(backupDirectory, true);
  const env = await loadProductionEnvironment();
  console.log(stable(await provisionProductionRuntime({ env, backupId: process.argv[2].slice('--backup-id='.length) })));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(stable({ ok: false, code: error instanceof DatabaseGateError ? error.code : 'production_runtime_provision_failed', message: error instanceof DatabaseGateError ? error.message : 'Productieruntimeprovisioning mislukt; geen verbindingswaarden of driverdetails gelogd.' }));
  process.exitCode = 1;
});
