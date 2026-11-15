import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { postgresTlsOptions } from '../../server/node-postgres-tls.js';
import { auditDatabase, applyDatabase, backupAndRestore, validateApplyPrerequisites, validateTarget, verifyDatabaseClientTls, DatabaseGateError } from '../../scripts/deploy/database.mjs';
import { loadProductionEnvironment, projectRef } from './provision-runtime.mjs';

const root = '/root/milo-production-bootstrap';
const manifestDigest = '183e6712a781c64992bffe5c195931995350ffdfb2f1e6eb098fb2d61c937c4b';

const privateInputs = Object.freeze({
  'backup-key.json': ['BACKUP_ENCRYPTION_KEY'],
  'scratch-connection.json': ['RESTORE_TEST_DATABASE_URL'],
});

export async function privateJson(name, keys, openFile = open) {
  if (!Object.hasOwn(privateInputs, name) || JSON.stringify(keys) !== JSON.stringify(privateInputs[name])) throw new Error('Unexpected private input');
  const file = await openFile(`${root}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== 0 || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > 16384) throw new Error('Unsafe private input');
    let value;
    try { value = JSON.parse(await file.readFile('utf8')); }
    catch { throw new Error('Invalid private input'); }
    if (!value || Object.keys(value).length !== keys.length || keys.some(key => typeof value[key] !== 'string' || !value[key])) throw new Error('Unexpected private input');
    return value;
  } finally { await file.close(); }
}

export async function validateRootDirectories(operation, inspect = lstat) {
  if (!['audit', 'backup', 'apply'].includes(operation)) throw new Error('Unexpected production database operation');
  const privatePaths = ['/root', root];
  const paths = operation === 'audit' ? privatePaths : [...privatePaths, '/var', '/var/backups', '/var/backups/milobingo-production'];
  for (const path of paths) {
    const info = await inspect(path);
    const privateLeaf = privatePaths.includes(path) || path === '/var/backups/milobingo-production';
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) || privateLeaf && (info.mode & 0o777) !== 0o700) throw new Error('Unsafe private directory');
  }
}

async function main() {
  if (process.getuid() !== 0 || process.geteuid() !== 0 || hostname() !== 'dg-nxttrack-01' || process.argv.length !== 3 || !['audit', 'backup', 'apply'].includes(process.argv[2])) throw new Error('Fixed root administration required');
  await validateRootDirectories(process.argv[2]);
  const env = await loadProductionEnvironment();
  let result;
  if (process.argv[2] === 'audit') result = await auditDatabase({ env, expectedProjectRef: projectRef });
  else {
    Object.assign(env, await privateJson('backup-key.json', ['BACKUP_ENCRYPTION_KEY']), await privateJson('scratch-connection.json', ['RESTORE_TEST_DATABASE_URL']), { DATABASE_BACKUP_DIRECTORY: '/var/backups/milobingo-production' });
    if (process.argv[2] === 'apply') result = await applyDatabase({ env, expectedProjectRef: projectRef, reviewedManifestSha256: manifestDigest });
    else {
      const target = validateTarget(env, projectRef), prerequisites = validateApplyPrerequisites(env);
      const pool = new Pool({ ...postgresTlsOptions(env.DATABASE_URL, { caBase64: env.SUPABASE_DB_CA_BASE64 }), max: 1, connectionTimeoutMillis: 10000, statement_timeout: 60000 });
      pool.on('error', () => {});
      const client = await pool.connect();
      try {
        verifyDatabaseClientTls(client, target.database.hostname);
        const version = (await client.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
        result = { ok: true, mode: 'backup-only', ...await backupAndRestore({ env, target, sourceClient: client, sourceVersion: version, prerequisites }) };
      } finally { client.release(); await pool.end(); }
    }
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error instanceof DatabaseGateError ? error.code : 'production_database_bootstrap_failed', message: error instanceof DatabaseGateError ? error.message : 'Productiedatabasevoorbereiding gestopt; geen credentials of driverdetails gelogd.' }));
  process.exitCode = 1;
});
