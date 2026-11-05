import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, statfs, writeFile, open, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform, Writable } from 'node:stream';
import { TLSSocket, checkServerIdentity } from 'node:tls';
import { Pool } from 'pg';
import { postgresTlsOptions } from '../../server/node-postgres-tls.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value);
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
const historySchema = 'milo_deploy';
const historyTable = `${historySchema}.migrations`;
const envelopeMagic = Buffer.from('MILOBAK1');
const minimumObjectLimit = 104857600;
const connectionAuthorityKeys = new Set(['host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname', 'service', 'servicefile']);

export class DatabaseGateError extends Error {
  constructor(code, message) { super(message); this.name = 'DatabaseGateError'; this.code = code; }
}
const fail = (code, message) => { throw new DatabaseGateError(code, message); };

export function validateTarget(env, expectedProjectRef) {
  if (!/^[a-z]{20}$/.test(expectedProjectRef || '')) fail('expected_project_required', 'Geef de bevestigde projectref met --expected-project-ref op.');
  let api, database;
  try { api = new URL(env.SUPABASE_URL); database = new URL(env.DATABASE_URL); }
  catch { fail('target_configuration', 'SUPABASE_URL en DATABASE_URL moeten geldige, afzonderlijk aangeleverde verbindingen zijn.'); }
  if (api.protocol !== 'https:' || api.hostname !== `${expectedProjectRef}.supabase.co` || api.port || api.username || api.password || api.pathname !== '/' || api.search || api.hash) fail('project_mismatch', 'SUPABASE_URL hoort niet bij de expliciet bevestigde projectref.');
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.username || !database.password || database.pathname === '/') fail('database_configuration', 'DATABASE_URL mist verplichte PostgreSQL-verbindingsvelden.');
  if ([...database.searchParams.keys()].some(key => connectionAuthorityKeys.has(key.toLowerCase()))) fail('database_authority_override', 'DATABASE_URL bevat een verboden query-override van de bevestigde verbindingsautoriteit.');
  const user = decodeURIComponent(database.username);
  const direct = database.hostname === `db.${expectedProjectRef}.supabase.co`;
  const pooler = database.hostname.endsWith('.pooler.supabase.com') && user.endsWith(`.${expectedProjectRef}`);
  if (!direct && !pooler) fail('database_project_mismatch', 'DATABASE_URL kan niet aan dezelfde Supabase-projectref worden gekoppeld.');
  if (database.port && database.port !== '5432') fail('database_pool_mode', 'Gebruik voor migraties een directe verbinding of sessiepooler op poort 5432.');
  if (['disable', 'allow', 'prefer', 'no-verify'].includes(database.searchParams.get('sslmode')) || database.searchParams.get('ssl') === 'false') fail('database_tls_required', 'De stagingdatabase vereist geverifieerde TLS.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(env.SUPABASE_STORAGE_BUCKET || '')) fail('bucket_required', 'SUPABASE_STORAGE_BUCKET moet de bevestigde privébucket noemen.');
  if (!env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) fail('storage_key_required', 'SUPABASE_SECRET_KEY moet een server-only secret key zijn.');
  return { projectRef: expectedProjectRef, apiOrigin: api.origin, database, bucket: env.SUPABASE_STORAGE_BUCKET };
}

export async function loadManifest(directory = join(root, 'supabase/migrations')) {
  const files = (await readdir(directory)).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) fail('migration_manifest_empty', 'Er zijn geen geldige PostgreSQL-migraties gevonden.');
  const migrations = await Promise.all(files.map(async filename => {
    const sql = await readFile(join(directory, filename), 'utf8');
    return { filename, checksum: hash(sql), sql };
  }));
  const tables = new Map(), indexes = [];
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(/CREATE TABLE\s+(?:public\.)?"?([a-z_]+)"?\s*\(([\s\S]*?)\n\);/g)) {
      const columns = [], primary = [];
      for (const line of match[2].split('\n')) {
        const column = /^\s*"?([a-z_]+)"?\s+(text|bigint)\b(.*)/i.exec(line);
        if (!column) continue;
        columns.push({ name: column[1], type: column[2].toLowerCase(), notNull: /NOT NULL|PRIMARY KEY/i.test(column[3]) });
        if (/PRIMARY KEY/i.test(column[3])) primary.push(column[1]);
      }
      const compound = /PRIMARY KEY\s*\(([^)]+)\)/i.exec(match[2]);
      if (compound) primary.push(...compound[1].split(',').map(name => name.trim().replaceAll('"', '')));
      tables.set(match[1], { columns, primary });
    }
    for (const match of migration.sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+"?([a-z_]+)"?\s+ON\s+(?:public\.)?"?([a-z_]+)"?\s*\(([^)]+)\)/g)) {
      indexes.push({ name: match[2], table: match[3], unique: Boolean(match[1]), columns: match[4].split(',').map(column => column.trim().replaceAll('"', '').replace(/\s+DESC$/i, '')) });
    }
  }
  if (tables.size !== 18) fail('migration_contract_changed', 'De migratie moet expliciet tegen het contract van 18 applicatietabellen worden beoordeeld.');
  return { migrations, tables, indexes, digest: hash(stable(migrations.map(({ filename, checksum }) => ({ filename, checksum })))) };
}

function defaultPoolFactory(connectionString, { verifiedTls = false, caBase64 } = {}) {
  const tls = postgresTlsOptions(connectionString, { caBase64, allowLoopback: !verifiedTls });
  const pool = new Pool({ ...tls, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
  pool.on('error', () => {}); // Query failures are handled without raw credential-bearing diagnostics.
  return pool;
}

export function verifyDatabaseClientTls(client, hostname) {
  const socket = client?.connection?.stream;
  // pg_stat_ssl describes the pooler's upstream PostgreSQL connection. The
  // transport carrying our credentials terminates at the pooler, so inspect
  // that actual client socket and independently match its peer hostname.
  if (!(socket instanceof TLSSocket) || socket.encrypted !== true || socket.authorized !== true || socket.authorizationError || socket.destroyed) {
    fail('database_tls_unconfirmed', 'De clientverbinding bevestigt geen geverifieerde TLS.');
  }
  const certificate = socket.getPeerCertificate();
  if (!certificate?.raw || checkServerIdentity(hostname, certificate)) fail('database_tls_unconfirmed', 'Het TLS-certificaat hoort niet bij de bevestigde databasehost.');
  return { tls: true, tlsAuthorized: true };
}

async function inventory(client, manifest) {
  const names = [...manifest.tables.keys()].sort();
  const tableRows = (await client.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind IN ('r','p') ORDER BY c.relname`, [names])).rows;
  const columns = (await client.query(`SELECT c.table_name AS table,c.column_name AS name,c.data_type AS type,c.is_nullable='NO' AS "notNull",c.column_default AS "default",c.ordinal_position AS position
    FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=ANY($1::text[]) ORDER BY c.table_name,c.ordinal_position`, [names])).rows;
  const indexes = (await client.query(`SELECT t.relname AS table,i.relname AS name,x.indisunique AS unique,x.indisprimary AS primary,
    ARRAY(SELECT pg_get_indexdef(x.indexrelid,k,true) FROM generate_series(1,x.indnkeyatts) k ORDER BY k) AS columns,pg_get_indexdef(x.indexrelid) AS definition
    FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,i.relname`, [names])).rows;
  const constraints = (await client.query(`SELECT c.relname AS table,x.conname AS name,x.contype AS type,pg_get_constraintdef(x.oid,true) AS definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,x.conname`, [names])).rows;
  const policies = (await client.query(`SELECT tablename AS table,policyname AS name,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname`, [names])).rows;
  const privileges = (await client.query(`SELECT c.relname AS table,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS role,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,role,a.privilege_type`, [names])).rows;
  const backend = (await client.query("SELECT rolname AS name,rolcanlogin AS login,rolsuper AS superuser,rolbypassrls AS bypassrls,rolcreatedb AS createdb,rolcreaterole AS createrole FROM pg_roles WHERE rolname='milo_backend'")).rows;
  return { tables: tableRows, columns, indexes, constraints, policies, privileges, backend };
}

function contractProblems(state, manifest) {
  const problems = [];
  for (const [name, expected] of manifest.tables) {
    const table = state.tables.find(row => row.name === name);
    if (!table) { problems.push(`table_missing:${name}`); continue; }
    if (!table.rls) problems.push(`rls_disabled:${name}`);
    const actual = state.columns.filter(column => column.table === name).map(({ name: columnName, type, notNull }) => ({ name: columnName, type, notNull }));
    if (stable(actual) !== stable(expected.columns)) problems.push(`column_contract:${name}`);
    const primary = state.indexes.find(index => index.table === name && index.primary);
    if (stable(primary?.columns) !== stable(expected.primary)) problems.push(`primary_key:${name}`);
    const policy = state.policies.find(row => row.table === name && row.name === (name === 'app_user_roles' ? 'milo_backend_read' : 'milo_backend_access'));
    if (!policy || stable(policy.roles) !== stable(['milo_backend']) || policy.cmd !== (name === 'app_user_roles' ? 'SELECT' : 'ALL') || policy.qual !== 'true' || name !== 'app_user_roles' && policy.with_check !== 'true') problems.push(`backend_policy:${name}`);
    if (state.policies.some(row => row.table === name && row.roles.some(role => ['anon', 'authenticated', 'public'].includes(role)))) problems.push(`browser_policy:${name}`);
    if (state.privileges.some(row => row.table === name && ['anon', 'authenticated', 'PUBLIC'].includes(row.role))) problems.push(`browser_grant:${name}`);
    const backendGrants = state.privileges.filter(row => row.table === name && row.role === 'milo_backend').map(row => row.privilege).sort();
    if (stable(backendGrants) !== stable(name === 'app_user_roles' ? ['SELECT'] : ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])) problems.push(`backend_grants:${name}`);
  }
  for (const expected of manifest.indexes) {
    const actual = state.indexes.find(index => index.name === expected.name && index.table === expected.table);
    if (!actual || actual.unique !== expected.unique || stable(actual.columns.map(column => column.replace(/\s+DESC$/i, ''))) !== stable(expected.columns)) problems.push(`index_contract:${expected.name}`);
  }
  const role = state.backend[0];
  if (!role || role.login || role.superuser || role.bypassrls || role.createdb || role.createrole) problems.push('backend_role_privileges');
  return problems.sort();
}

async function history(client) {
  const relation = (await client.query("SELECT c.oid AS table_oid,n.oid AS schema_oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='migrations' AND c.relkind='r'", [historySchema])).rows[0];
  if (!relation) return { managed: false, readable: true, rows: [] };
  const rights = (await client.query("SELECT has_schema_privilege(current_user,$1::oid,'USAGE') AND has_table_privilege(current_user,$2::oid,'SELECT') AS readable", [relation.schema_oid, relation.table_oid])).rows[0];
  if (!rights.readable) return { managed: true, readable: false, rows: [] };
  try {
    const rows = (await client.query(`SELECT filename,checksum,schema_digest,project_ref,release_sha FROM ${historyTable} ORDER BY filename`)).rows;
    return { managed: true, readable: true, rows };
  } catch { fail('history_invalid', 'De bestaande migratiehistorie heeft geen leesbaar, bekend contract.'); }
}

async function bucketStatus(target, env, fetcher) {
  const response = await fetcher(`${target.apiOrigin}/storage/v1/bucket/${encodeURIComponent(target.bucket)}`, { headers: { apikey: env.SUPABASE_SECRET_KEY }, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return { exists: false, ready: false, reasons: ['bucket_missing'] };
  if (!response.ok) fail('storage_audit_failed', `Storage-preflight is afgewezen met HTTP ${response.status}; er zijn geen sleutelwaarden gelogd.`);
  const value = await response.json();
  const reasons = [];
  if (value.id !== target.bucket || value.name !== target.bucket) reasons.push('bucket_identity');
  if (value.public !== false) reasons.push('bucket_public');
  if (value.allowed_mime_types !== null && value.allowed_mime_types !== undefined && !value.allowed_mime_types.includes('application/json') && !value.allowed_mime_types.includes('application/*') && !value.allowed_mime_types.includes('*/*')) reasons.push('bucket_json_disallowed');
  if (value.file_size_limit !== null && value.file_size_limit !== undefined && Number(value.file_size_limit) < minimumObjectLimit) reasons.push('bucket_size_limit');
  return { exists: true, ready: !reasons.length, reasons };
}

export async function auditDatabase({ env = process.env, expectedProjectRef, manifest, poolFactory = defaultPoolFactory, fetcher = fetch } = {}) {
  const target = validateTarget(env, expectedProjectRef);
  manifest ??= await loadManifest();
  const pool = poolFactory(env.DATABASE_URL, { verifiedTls: true, caBase64: env.SUPABASE_DB_CA_BASE64 });
  try {
    const client = await pool.connect();
    try {
      const transport = verifyDatabaseClientTls(client, target.database.hostname);
      await client.query('BEGIN READ ONLY');
      const connection = (await client.query(`SELECT current_user AS user,current_database() AS database,current_setting('server_version_num')::int AS version,
        r.rolsuper AS superuser,r.rolcreaterole AS createrole,r.rolbypassrls AS bypassrls,has_schema_privilege(current_user,'public','CREATE') AS schema_create,
        coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS "backendTls",pg_database_size(current_database())::text AS "databaseSizeBytes"
        FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
      Object.assign(connection, transport);
      connection.extensions = (await client.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
      const state = await inventory(client, manifest), applied = await history(client);
      await client.query('COMMIT');
      const expected = manifest.migrations.map(({ filename, checksum }) => ({ filename, checksum }));
      const historyProblems = [];
      for (const row of applied.rows) {
        const local = expected.find(item => item.filename === row.filename);
        if (!local) historyProblems.push(`unknown_migration:${row.filename}`);
        else if (local.checksum !== row.checksum) historyProblems.push(`migration_checksum:${row.filename}`);
        if (row.project_ref !== target.projectRef) historyProblems.push(`history_project:${row.filename}`);
      }
      const pending = applied.readable ? expected.filter(row => !applied.rows.some(item => item.filename === row.filename)).map(row => row.filename) : [];
      const schemaDigest = hash(stable(state));
      const problems = state.tables.length ? contractProblems(state, manifest) : [];
      if (state.tables.length && !applied.managed) problems.push('unmanaged_application_tables');
      if (!applied.readable) problems.push('history_not_readable');
      if (state.tables.length && applied.managed && applied.readable && !applied.rows.length) problems.push('empty_history_with_application_tables');
      if (applied.rows.length && applied.rows.at(-1).schema_digest !== schemaDigest) problems.push('recorded_schema_drift');
      if (applied.rows.length && !state.tables.length) problems.push('history_without_application_tables');
      const bucket = await bucketStatus(target, env, fetcher);
      const blockers = [...historyProblems, ...problems, ...pending.map(name => `migration_pending:${name}`), ...bucket.reasons].sort();
      return { ok: blockers.length === 0, mode: 'audit', projectRef: target.projectRef, bucket: target.bucket, connection,
        applicationTables: state.tables.map(row => ({ name: row.name, rls: row.rls })), managed: applied.managed, historyReadable: applied.readable,
        migrations: expected, appliedMigrations: applied.rows.map(({ filename, checksum }) => ({ filename, checksum })), pending,
        migrationManifestDigest: manifest.digest, schemaDigest, storage: bucket, blockers };
    } finally { client.release(); }
  } finally { await pool.end(); }
}

export function validateApplyPrerequisites(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.BACKUP_ENCRYPTION_KEY || '')) fail('backup_key_missing', 'BACKUP_ENCRYPTION_KEY ontbreekt of bevat geen afzonderlijke 64-tekens hexsecret. Zonder versleutelde backup is --apply geblokkeerd.');
  if (!/^[a-f0-9]{40}$/i.test(env.RELEASE_SHA || '')) fail('release_sha_missing', 'RELEASE_SHA moet de volledige groen gecontroleerde broncommit bevatten.');
  let restore;
  try { restore = new URL(env.RESTORE_TEST_DATABASE_URL); } catch { fail('restore_database_missing', 'RESTORE_TEST_DATABASE_URL moet een afzonderlijke lege lokale hersteltestdatabase aanwijzen.'); }
  if (!['postgres:', 'postgresql:'].includes(restore.protocol) || !loopback(restore.hostname) || !/^\/milo_restore_test_[a-z0-9_]+$/.test(restore.pathname) || !restore.username || !restore.password) fail('restore_database_unsafe', 'De hersteltest vereist loopback en een afzonderlijke database met naam milo_restore_test_*.');
  if ([...restore.searchParams.keys()].some(key => connectionAuthorityKeys.has(key.toLowerCase()))) fail('restore_database_authority_override', 'De lokale herstelverbinding mag geen query-overrides van host, gebruiker of database bevatten.');
  if (!env.DATABASE_BACKUP_DIRECTORY || !isAbsolute(env.DATABASE_BACKUP_DIRECTORY)) fail('backup_directory_missing', 'DATABASE_BACKUP_DIRECTORY moet de bevestigde absolute private backuplocatie buiten de release aanwijzen.');
  const directory = resolve(env.DATABASE_BACKUP_DIRECTORY);
  if (directory === root || directory.startsWith(`${root}/`)) fail('backup_directory_in_checkout', 'Bewaar databasebackups buiten de checkout en wegwerp-release.');
  return { restore, directory };
}

function pgEnvironment(connectionString, rootCertFile) {
  const url = new URL(connectionString);
  return { PATH: process.env.PATH, LANG: 'C.UTF-8', PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: loopback(url.hostname) ? 'disable' : 'verify-full', ...(!loopback(url.hostname) ? { PGSSLROOTCERT: rootCertFile || 'system' } : {}), PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'milo-controlled-backup' };
}
function startTool(executable, args, env, spawnTool = spawn) {
  const child = spawnTool(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  // Tool diagnostics may contain user data or credentials. Retain only a
  // bounded generic failure code; never forward stderr into Actions logs.
  child.stderr.resume();
  const done = new Promise((resolveDone, reject) => {
    child.once('error', () => reject(new DatabaseGateError('postgres_tool_missing', `${executable} kan niet worden gestart; installeer passende PostgreSQL-clienttools.`)));
    child.once('exit', code => code === 0 ? resolveDone() : reject(new DatabaseGateError('postgres_tool_failed', `${executable} is mislukt; de migratie wordt niet toegepast.`)));
  });
  // The pipeline and process completion are awaited together by the caller.
  done.catch(() => {});
  return { child, done };
}
async function toolMajor(executable, spawnTool) {
  const { child, done } = startTool(executable, ['--version'], { PATH: process.env.PATH, LANG: 'C.UTF-8' }, spawnTool);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); }); child.stdin.end(); await done;
  const match = /PostgreSQL\)\s+(\d+)/.exec(output);
  if (!match) fail('postgres_tool_version', 'De PostgreSQL-clienttoolversie kon niet worden vastgesteld.');
  return Number(match[1]);
}

// Authenticated encryption is streamed: no plaintext dump is written to disk.
export async function encryptBackup(input, destination, keyHex) {
  const nonce = randomBytes(12), header = Buffer.concat([envelopeMagic, nonce]);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), nonce); cipher.setAAD(header);
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  output.write(header);
  await pipeline(input, cipher, output, { end: false });
  output.end(cipher.getAuthTag()); await new Promise((done, reject) => { output.once('finish', done); output.once('error', reject); });
  const handle = await open(destination, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
export async function decryptBackup(source, output, keyHex) {
  const size = (await stat(source)).size;
  if (size < 36) fail('backup_format', 'Het versleutelde backupbestand is onvolledig.');
  const handle = await open(source, 'r'), header = Buffer.alloc(20), tag = Buffer.alloc(16);
  try { await handle.read(header, 0, 20, 0); await handle.read(tag, 0, 16, size - 16); } finally { await handle.close(); }
  if (!header.subarray(0, 8).equals(envelopeMagic)) fail('backup_format', 'Het backupbestand heeft een onbekende versie.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), header.subarray(8)); decipher.setAAD(header); decipher.setAuthTag(tag);
  await pipeline(createReadStream(source, { start: 20, end: size - 17 }), decipher, output);
}
async function fileDigest(path) {
  const digest = createHash('sha256');
  await pipeline(createReadStream(path), new Transform({ transform(chunk, encoding, callback) { digest.update(chunk); callback(); } }));
  return digest.digest('hex');
}
export async function assertBackupCapacity(directory, databaseBytes, readCapacity = statfs) {
  const capacity = await readCapacity(directory, { bigint: true });
  const available = BigInt(capacity.bavail) * BigInt(capacity.bsize), sourceBytes = BigInt(databaseBytes);
  const required = sourceBytes * 2n + 512n * 1024n * 1024n;
  if (sourceBytes <= 0n || available < required) fail('backup_capacity', 'De private backuplocatie heeft minder dan tweemaal de gemeten databaseomvang plus 512 MiB reserve.');
  return { sourceDatabaseBytes: sourceBytes.toString(), backupAvailableBytes: available.toString(), backupRequiredBytes: required.toString() };
}
async function dataProof(client) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const tables = (await client.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname")).rows;
  const result = [];
  for (const table of tables) {
    const values = (await client.query(`SELECT count(*)::text AS rows,
      coalesce(sum(('x'||substring(md5(to_jsonb(t)::text),1,16))::bit(64)::bigint::numeric),0)::text AS sum_a,
      coalesce(sum(('x'||substring(md5(to_jsonb(t)::text),17,16))::bit(64)::bigint::numeric),0)::text AS sum_b
      FROM ${quote(table.schema)}.${quote(table.name)} t`)).rows[0];
    result.push({ ...table, ...values });
  }
  return { tables: result.length, digest: hash(stable(result)) };
}
async function securityProof(client) {
  const relations = (await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','m','v','S','f') ORDER BY n.nspname,c.relname`)).rows;
  const grants = (await client.query(`SELECT n.nspname AS schema,c.relname AS name,pg_get_userbyid(a.grantor) AS grantor,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','m','v','S','f') ORDER BY n.nspname,c.relname,grantor,grantee,a.privilege_type`)).rows;
  const policies = (await client.query("SELECT schemaname,tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies ORDER BY schemaname,tablename,policyname")).rows;
  const schemas = (await client.query("SELECT nspname AS name,pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname")).rows;
  const schemaGrants = (await client.query(`SELECT n.nspname AS name,pg_get_userbyid(a.grantor) AS grantor,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY n.nspname,grantor,grantee,a.privilege_type`)).rows;
  const defaults = (await client.query(`SELECT pg_get_userbyid(d.defaclrole) AS owner,coalesce(n.nspname,'') AS schema,d.defaclobjtype AS kind,pg_get_userbyid(a.grantor) AS grantor,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a ORDER BY owner,schema,kind,grantor,grantee,a.privilege_type`)).rows;
  return { relations: relations.length, digest: hash(stable({ relations, grants, policies, schemas, schemaGrants, defaults })) };
}

async function extensionOwners(client) {
  return (await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner
    FROM pg_depend d JOIN pg_class c ON c.oid=d.objid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE d.classid='pg_class'::regclass AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND d.objsubid=0
    AND c.relkind IN ('r','p','m','v','S','f') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
    ORDER BY n.nspname,c.relname`)).rows;
}

async function extensionInventory(client) {
  return (await client.query('SELECT e.extname AS name,e.extversion AS version,n.nspname AS schema,pg_get_userbyid(e.extowner) AS owner FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname')).rows;
}

export async function readExtensionMetadata(path, key, expected) {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected.encryptedSha256 || '') || !/^[a-f0-9]{64}$/.test(expected.metadataSha256 || '') || await fileDigest(path) !== expected.encryptedSha256) fail('extension_metadata_hash', 'De versleutelde extensiemetadata wijkt af van het vastgelegde herstelbewijs.');
  const chunks = []; let bytes = 0;
  try {
    await decryptBackup(path, new Writable({ write(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > 4194304) { callback(new Error('metadata size')); return; }
      chunks.push(chunk); callback();
    } }), key);
    const body = Buffer.concat(chunks);
    if (hash(body) !== expected.metadataSha256) fail('extension_metadata_hash', 'De extensiemetadata heeft niet de vastgelegde inhoudshash.');
    const metadata = JSON.parse(body.toString('utf8'));
    const kinds = ['r', 'p', 'm', 'v', 'S', 'f'];
    const identifier = value => typeof value === 'string' && value && !value.includes('\0') && Buffer.byteLength(value) <= 63;
    if (metadata.format !== 1 || metadata.projectRef !== expected.projectRef || metadata.releaseSha !== expected.releaseSha || metadata.backupId !== expected.backupId || !Array.isArray(metadata.owners) || metadata.owners.length !== expected.relations || metadata.owners.some(row => !row || stable(Object.keys(row).sort()) !== stable(['kind', 'name', 'owner', 'schema']) || !kinds.includes(row.kind) || ['schema', 'name', 'owner'].some(key => !identifier(row[key]))) || !Array.isArray(metadata.extensions) || metadata.extensions.length !== expected.extensions || metadata.extensions.some(row => !row || stable(Object.keys(row).sort()) !== stable(['name', 'owner', 'schema', 'version']) || ['schema', 'name', 'owner'].some(key => !identifier(row[key])) || typeof row.version !== 'string' || !row.version || row.version.length > 512)) fail('extension_metadata_invalid', 'De extensiemetadata hoort niet bij dit herstelbewijs of heeft een onjuist contract.');
    if (new Set(metadata.owners.map(row => stable([row.schema, row.name]))).size !== metadata.owners.length) fail('extension_metadata_invalid', 'De extensiemetadata bevat dubbele relaties.');
    if (new Set(metadata.extensions.map(row => row.name)).size !== metadata.extensions.length) fail('extension_metadata_invalid', 'De extensiemetadata bevat dubbele extensies.');
    return metadata;
  } catch (error) {
    if (error instanceof DatabaseGateError) throw error;
    fail('extension_metadata_invalid', 'De versleutelde extensiemetadata kon niet geauthenticeerd en gevalideerd worden.');
  }
}

export async function restoreExtensionOwners(restoreClient, metadata) {
  const database = (await restoreClient.query('SELECT current_database() AS database')).rows[0].database;
  if (!/^milo_restore_test_[a-z0-9_]+$/.test(database)) fail('extension_restore_target', 'Extensie-eigenaarschap mag uitsluitend op de afzonderlijke hersteltestdatabase worden aangevuld.');
  const commands = { r: 'TABLE ONLY', p: 'TABLE ONLY', m: 'MATERIALIZED VIEW', v: 'VIEW', S: 'SEQUENCE', f: 'FOREIGN TABLE' };
  await restoreClient.query('BEGIN');
  try {
    const extensions = rows => rows.map(({ name, version, schema }) => ({ name, version, schema }));
    if (stable(extensions(await extensionInventory(restoreClient))) !== stable(extensions(metadata.extensions))) fail('extension_restore_versions', 'De herstelde extensienamen, versies of namespaces wijken af van de versleutelde bronmetadata.');
    const actual = await extensionOwners(restoreClient);
    const identities = rows => rows.map(({ schema, name, kind }) => ({ schema, name, kind }));
    if (stable(identities(actual)) !== stable(identities(metadata.owners))) fail('extension_restore_contract', 'De herstelde extensierelaties wijken af van de versleutelde bronmetadata.');
    for (let index = 0; index < actual.length; index++) {
      const row = metadata.owners[index];
      if (!commands[row.kind]) fail('extension_restore_contract', 'Onbekend extensierelatietype.');
      if (row.owner !== actual[index].owner) await restoreClient.query(`ALTER ${commands[row.kind]} ${quote(row.schema)}.${quote(row.name)} OWNER TO ${quote(row.owner)}`);
    }
    if (stable(await extensionOwners(restoreClient)) !== stable(metadata.owners)) fail('extension_restore_contract', 'Het aangevulde extensie-eigenaarschap wijkt nog af van de bron.');
    await restoreClient.query('COMMIT');
  } catch (error) { await restoreClient.query('ROLLBACK'); throw error; }
}

export async function backupAndRestore({ env, target, sourceClient, sourceVersion, prerequisites, poolFactory = defaultPoolFactory, spawnTool = spawn }) {
  const dumpMajor = await toolMajor('pg_dump', spawnTool), restoreMajor = await toolMajor('pg_restore', spawnTool);
  if (dumpMajor !== Math.floor(sourceVersion / 10000) || restoreMajor !== dumpMajor) fail('postgres_tool_version', 'pg_dump en pg_restore moeten dezelfde major-versie als de brondatabase hebben.');
  const restorePool = poolFactory(env.RESTORE_TEST_DATABASE_URL);
  const restoreClient = await restorePool.connect();
  const backupId = `milo-${target.projectRef}-${new Date().toISOString().replaceAll(/[^0-9TZ]/g, '')}-${randomUUID()}`;
  const encryptedPath = join(prerequisites.directory, `${backupId}.dump.aesgcm`);
  const extensionPath = join(prerequisites.directory, `${backupId}.extensions.json.aesgcm`);
  const proofPath = join(prerequisites.directory, `${backupId}.proof.json`);
  let restored = false, caDirectory;
  try {
    const scratch = (await restoreClient.query(`SELECT current_database() AS database,current_setting('server_version_num')::int AS version,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f','S') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') AS objects`)).rows[0];
    if (!scratch.database.startsWith('milo_restore_test_') || scratch.objects !== 0 || Math.floor(scratch.version / 10000) !== dumpMajor) fail('restore_database_not_empty', 'De hersteltestdatabase moet leeg, lokaal, afzonderlijk en van dezelfde PostgreSQL-major zijn.');
    await mkdir(prerequisites.directory, { recursive: true, mode: 0o700 });
    if ((await stat(prerequisites.directory)).mode & 0o077) fail('backup_directory_permissions', 'De backuplocatie moet uitsluitend voor de deploygebruiker toegankelijk zijn (0700).');
    const sourceBytes = (await sourceClient.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes;
    const capacity = await assertBackupCapacity(prerequisites.directory, sourceBytes);
    let rootCertFile;
    if (env.SUPABASE_DB_CA_BASE64 && !loopback(new URL(env.DATABASE_URL).hostname)) {
      const pem = postgresTlsOptions(env.DATABASE_URL, { caBase64: env.SUPABASE_DB_CA_BASE64 }).ssl.ca;
      caDirectory = await mkdtemp(join(tmpdir(), 'milo-postgres-ca-'));
      rootCertFile = join(caDirectory, 'supabase-root-ca.pem');
      await writeFile(rootCertFile, pem, { mode: 0o600, flag: 'wx' });
    }
    await sourceClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let sourceProof, sourceSecurity, extensionMetadata;
    try {
      const snapshot = (await sourceClient.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      const metadata = { format: 1, projectRef: target.projectRef, releaseSha: env.RELEASE_SHA, backupId, extensions: await extensionInventory(sourceClient), owners: await extensionOwners(sourceClient) };
      const metadataBody = stable(metadata);
      await encryptBackup(Readable.from(metadataBody), extensionPath, env.BACKUP_ENCRYPTION_KEY);
      extensionMetadata = { format: 1, filename: `${backupId}.extensions.json.aesgcm`, encryptedSha256: await fileDigest(extensionPath), metadataSha256: hash(metadataBody), relations: metadata.owners.length, extensions: metadata.extensions.length };
      const dump = startTool('pg_dump', ['--format=custom', `--snapshot=${snapshot}`], pgEnvironment(env.DATABASE_URL, rootCertFile), spawnTool);
      dump.child.stdin.end();
      try { await Promise.all([encryptBackup(dump.child.stdout, encryptedPath, env.BACKUP_ENCRYPTION_KEY), dump.done]); }
      catch (error) { dump.child.kill('SIGTERM'); throw error; }
      sourceProof = await dataProof(sourceClient);
      sourceSecurity = await securityProof(sourceClient);
      await sourceClient.query('COMMIT');
    } catch (error) { await sourceClient.query('ROLLBACK'); throw error; }
    // Authenticate the whole file before any restore command receives bytes.
    await decryptBackup(encryptedPath, new Writable({ write(chunk, encoding, callback) { callback(); } }), env.BACKUP_ENCRYPTION_KEY);
    const roles = (await sourceClient.query("SELECT rolname AS name FROM pg_roles WHERE left(rolname,3)<>'pg_' ORDER BY rolname")).rows;
    for (const role of roles) if (role.name !== 'public' && !(await restoreClient.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role.name])).rows.length) await restoreClient.query(`CREATE ROLE ${quote(role.name)} NOLOGIN`);
    const restore = startTool('pg_restore', [`--dbname=${decodeURIComponent(prerequisites.restore.pathname.slice(1))}`, '--exit-on-error', '--single-transaction'], pgEnvironment(env.RESTORE_TEST_DATABASE_URL), spawnTool);
    restore.child.stdout.resume();
    try { await Promise.all([decryptBackup(encryptedPath, restore.child.stdin, env.BACKUP_ENCRYPTION_KEY), restore.done]); }
    catch (error) { restore.child.kill('SIGTERM'); throw error; }
    const metadata = await readExtensionMetadata(extensionPath, env.BACKUP_ENCRYPTION_KEY, { ...extensionMetadata, projectRef: target.projectRef, releaseSha: env.RELEASE_SHA, backupId });
    await restoreExtensionOwners(restoreClient, metadata);
    await restoreClient.query('BEGIN READ ONLY');
    const restoredProof = await dataProof(restoreClient), restoredSecurity = await securityProof(restoreClient); await restoreClient.query('COMMIT');
    if (stable(sourceProof) !== stable(restoredProof)) fail('restore_proof_mismatch', 'De teruggezette database wijkt af in tabelaantallen of gegevenschecksums.');
    if (stable(sourceSecurity) !== stable(restoredSecurity)) fail('restore_security_mismatch', 'De teruggezette database wijkt af in eigenaarschap, ACLs, RLS of policies. Geen migratie toegestaan.');
    restored = true;
    const proof = { format: 1, projectRef: target.projectRef, releaseSha: env.RELEASE_SHA, backupId,
      encryptedSha256: await fileDigest(encryptedPath), extensionMetadata, postgresMajor: dumpMajor, sourceProof, restoredProof, sourceSecurity, restoredSecurity,
      capacity, verifiedAt: new Date().toISOString(), restoreVerified: true };
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return proof;
  } finally {
    try { restoreClient.release(); await restorePool.end(); }
    finally {
      if (caDirectory) await rm(caDirectory, { recursive: true, force: true });
      if (!restored) await unlink(proofPath).catch(() => {});
    }
  }
}

async function ensureBucket(target, env, fetcher) {
  const before = await bucketStatus(target, env, fetcher);
  if (before.ready) return before;
  if (before.exists) fail('existing_bucket_unready', 'De bestaande bevestigde bucket voldoet niet. Pas zijn toegangs-/typecontract expliciet aan; de deploytool overschrijft dit niet stilzwijgend.');
  const response = await fetcher(`${target.apiOrigin}/storage/v1/bucket`, { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: target.bucket, name: target.bucket, public: false, file_size_limit: minimumObjectLimit, allowed_mime_types: ['application/json'] }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) fail('bucket_create_failed', `De bevestigde privébucket kon niet worden aangemaakt (HTTP ${response.status}). De database kan al gemigreerd zijn.`);
  return bucketStatus(target, env, fetcher);
}

export async function applyDatabase({ env = process.env, expectedProjectRef, reviewedManifestSha256, manifest, poolFactory = defaultPoolFactory, fetcher = fetch, backupProvider = backupAndRestore } = {}) {
  const target = validateTarget(env, expectedProjectRef);
  const prerequisites = validateApplyPrerequisites(env);
  manifest ??= await loadManifest();
  if (!/^[a-f0-9]{64}$/.test(reviewedManifestSha256 || '') || reviewedManifestSha256 !== manifest.digest) fail('manifest_review_required', 'Geef de vooraf beoordeelde migrationManifestDigest met --reviewed-manifest-sha256 op.');
  const before = await auditDatabase({ env, expectedProjectRef, manifest, poolFactory, fetcher });
  if (before.ok) return { ...before, mode: 'apply', changed: false };
  const allowed = before.blockers.every(item => item.startsWith('migration_pending:') || item === 'bucket_missing');
  if (!allowed) fail('apply_preflight_blocked', 'Preflight vindt unmanaged tabellen, schema-/historiedrift of een ongeschikte bestaande bucket. Geen migratie toegepast.');
  if (before.pending.length && before.applicationTables.length) fail('existing_database_upgrade_review', 'Dit bootstrapcommando past geen nieuwe migratie toe op een bestaande appdatabase. Laat de upgrade en compatibiliteit afzonderlijk beoordelen.');
  if ((!before.connection.superuser && !before.connection.createrole) || !before.connection.schema_create || !before.connection.bypassrls && !before.connection.superuser) fail('migration_privileges', 'Gebruik een geautoriseerde migratieverbinding met schema-/rolbeheer en volledige backupleestoegang.');
  const pool = poolFactory(env.DATABASE_URL, { verifiedTls: true, caBase64: env.SUPABASE_DB_CA_BASE64 }), client = await pool.connect();
  let committed = false, backup;
  try {
    verifyDatabaseClientTls(client, target.database.hostname);
    await client.query("SELECT pg_advisory_lock(hashtextextended('milo-controlled-schema-bootstrap',0))");
    // Audit again under the lock; the backup and migration must use this exact
    // immutable manifest, even when another deployment completed while waiting.
    const fresh = await auditDatabase({ env, expectedProjectRef, manifest, poolFactory, fetcher });
    if (fresh.ok) return { ...fresh, mode: 'apply', changed: false };
    if (fresh.blockers.some(item => !item.startsWith('migration_pending:') && item !== 'bucket_missing') || fresh.pending.length && fresh.applicationTables.length) fail('locked_preflight_changed', 'De database veranderde vóór het verkrijgen van het migratieslot. Geen mutatie uitgevoerd.');
    backup = await backupProvider({ env, target, sourceClient: client, sourceVersion: fresh.connection.version, prerequisites, poolFactory });
    if (!backup?.restoreVerified || backup.projectRef !== target.projectRef || backup.releaseSha !== env.RELEASE_SHA || !/^[a-f0-9]{64}$/.test(backup.encryptedSha256 || '')) fail('backup_proof_invalid', 'Versleutelde backup en passend herstelbewijs zijn niet bevestigd.');
    if (fresh.pending.length) {
      await client.query('BEGIN');
      try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${historySchema}; REVOKE ALL ON SCHEMA ${historySchema} FROM PUBLIC`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${historyTable} (filename text PRIMARY KEY,checksum text NOT NULL,schema_digest text NOT NULL,project_ref text NOT NULL,release_sha text NOT NULL,backup_id text NOT NULL,applied_at timestamptz NOT NULL DEFAULT current_timestamp)`);
      await client.query(`REVOKE ALL ON TABLE ${historyTable} FROM PUBLIC`);
      const roles = (await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).rows;
      for (const { rolname } of roles) await client.query(`REVOKE ALL ON SCHEMA ${historySchema} FROM ${quote(rolname)}; REVOKE ALL ON TABLE ${historyTable} FROM ${quote(rolname)}`);
      for (const migration of manifest.migrations.filter(row => fresh.pending.includes(row.filename))) {
        await client.query('SET LOCAL search_path TO public');
        await client.query(migration.sql);
        const state = await inventory(client, manifest);
        if (contractProblems(state, manifest).length) fail('migration_postcondition', 'De migratie levert niet het beoordeelde schema-/rechtencontract op. Transactie teruggedraaid.');
        await client.query(`INSERT INTO ${historyTable} (filename,checksum,schema_digest,project_ref,release_sha,backup_id) VALUES ($1,$2,$3,$4,$5,$6)`, [migration.filename, migration.checksum, hash(stable(state)), target.projectRef, env.RELEASE_SHA, backup.backupId]);
      }
        await client.query('COMMIT'); committed = true;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    const storage = await ensureBucket(target, env, fetcher);
    if (!storage.ready) fail('storage_postcondition', 'De database is gemigreerd; de bevestigde Storagebucket is nog niet gereed. Geen appactivatie uitvoeren.');
    const after = await auditDatabase({ env, expectedProjectRef, manifest, poolFactory, fetcher });
    if (!after.ok) fail('apply_postcondition', 'De databasewijziging is gecommit, maar de volledige nacontrole faalt. Geen appactivatie uitvoeren.');
    return { ...after, mode: 'apply', changed: true, backup: { backupId: backup.backupId, encryptedSha256: backup.encryptedSha256, restoreVerified: true }, committed };
  } catch (error) {
    if (committed) fail('partial_database_apply', 'Database gemigreerd; een latere Storage-/nacontrole faalde. Backup en historie zijn behouden. Stop appactivatie en controleer de actieve release.');
    throw error;
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtextextended('milo-controlled-schema-bootstrap',0))"); } finally { client.release(); await pool.end(); }
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let apply = false, expectedProjectRef, reviewedManifestSha256;
  for (const argument of argv) {
    if (argument === '--apply') apply = true;
    else if (argument.startsWith('--expected-project-ref=')) expectedProjectRef = argument.slice('--expected-project-ref='.length);
    else if (argument.startsWith('--reviewed-manifest-sha256=')) reviewedManifestSha256 = argument.slice('--reviewed-manifest-sha256='.length);
    else fail('unknown_option', 'Gebruik --expected-project-ref=<ref> en voor bewuste toepassing --apply --reviewed-manifest-sha256=<beoordeelde-hash>.');
  }
  const result = await (apply ? applyDatabase : auditDatabase)({ env, expectedProjectRef, reviewedManifestSha256 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    const safe = error instanceof DatabaseGateError ? { code: error.code, message: error.message } : { code: 'database_operation_failed', causeCode: /^[A-Z0-9_]{1,64}$/.test(error.code || '') ? error.code : undefined, message: 'Databasecontrole mislukt. Controleer veilige beheerdiagnostiek; verbindingswaarden en toolstderr worden niet gelogd.' };
    process.stderr.write(`${JSON.stringify({ ok: false, ...safe })}\n`); process.exitCode = 1;
  }
}
