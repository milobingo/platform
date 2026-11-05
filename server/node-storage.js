import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, chmodSync, writeFileSync, renameSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { postgresTlsOptions } from './node-postgres-tls.js';

// next start/dev run from the project root; webpack must not treat this path
// as a directory asset when bundling the server route.
const projectRoot = resolve(process.cwd());
const empty = () => ({ success: true, results: [], meta: { changes: 0 } });
const casUpdate = sql => /^\s*UPDATE\b/i.test(sql) && /\bRETURNING\b/i.test(sql);
const returning = sql => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
const checksum = value => createHash('sha256').update(value).digest('hex');

// A failed compare-and-swap must undo earlier statements too. The stores retry
// an empty result, so conflicts are returned in the same shape as D1 results.
class CompareAndSwapConflict extends Error {}

function prepared(database, sql, args = []) {
  return {
    database, sql, args,
    bind(...values) { return prepared(database, sql, values); },
    async first(column) {
      const row = (await database.execute(sql, args)).results[0] ?? null;
      return column && row ? row[column] : row;
    },
    all() { return database.execute(sql, args); },
    run() { return database.execute(sql, args); },
  };
}

function applySqliteMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS __milo_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
  const migrations = readdirSync(join(projectRoot, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    const sql = readFileSync(join(projectRoot, 'drizzle', name), 'utf8');
    const hash = checksum(sql);
    const applied = db.prepare('SELECT checksum FROM __milo_migrations WHERE name=?').get(name);
    if (applied) {
      if (applied.checksum !== hash) throw new Error(`Toegepaste SQLite-migratie is gewijzigd: ${name}`);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck while holding the write lock: another process may have started.
      const existing = db.prepare('SELECT checksum FROM __milo_migrations WHERE name=?').get(name);
      if (existing && existing.checksum !== hash) throw new Error(`Toegepaste SQLite-migratie is gewijzigd: ${name}`);
      if (!existing) {
        db.exec(sql);
        db.prepare('INSERT INTO __milo_migrations (name,checksum) VALUES (?,?)').run(name, hash);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec("CREATE TABLE IF NOT EXISTS app_user_roles (user_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('regie','player')))");
}

export function createSqliteDatabase(filename) {
  const path = filename === ':memory:' ? filename : resolve(filename);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  sqlite.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  applySqliteMigrations(sqlite);
  function execute(sql, args) {
    const statement = sqlite.prepare(sql);
    if (returning(sql)) {
      const rows = statement.all(...args).map(row => ({ ...row }));
      return { success: true, results: rows, meta: { changes: /^\s*SELECT\b/i.test(sql) ? 0 : rows.length } };
    }
    const result = statement.run(...args);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  const database = {
    kind: 'sqlite',
    prepare(sql) { return prepared(database, sql); },
    async execute(sql, args) { return execute(sql, args); },
    async batch(statements) {
      if (statements.some(statement => statement.database !== database)) throw new TypeError('Batch bevat een statement van een andere database.');
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => {
          const result = execute(statement.sql, statement.args);
          if (casUpdate(statement.sql) && result.results.length === 0) throw new CompareAndSwapConflict();
          return result;
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        if (error instanceof CompareAndSwapConflict || (error.code?.startsWith('ERR_SQLITE') && /UNIQUE constraint failed: bingo_codes.code/.test(error.message))) return statements.map(empty);
        throw error;
      }
    },
    async close() { sqlite.close(); },
  };
  return database;
}

// Rewrite only the SQLite JSON forms used by the existing stores. This parser
// respects quoted SQL strings and nested calls; a new JSON form fails closed.
function rewriteFunctions(source, transform) {
  let result = '';
  for (let i = 0; i < source.length;) {
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i]; let end = i + 1;
      while (end < source.length) {
        if (source[end] === quote) { if (source[end + 1] === quote) { end += 2; continue; } end++; break; }
        end++;
      }
      result += source.slice(i, end); i = end; continue;
    }
    const match = /^([a-z_][a-z_0-9]*)\s*\(/i.exec(source.slice(i));
    if (!match) { result += source[i++]; continue; }
    const name = match[1], start = i + match[0].length;
    let end = start, depth = 1, quote = null;
    const args = []; let argumentStart = start;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) { if (source[end + 1] === quote) end++; else quote = null; } continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === '(') depth++;
      if (char === ')') { depth--; if (!depth) { args.push(source.slice(argumentStart, end)); break; } }
      if (char === ',' && depth === 1) { args.push(source.slice(argumentStart, end)); argumentStart = end + 1; }
    }
    if (depth) throw new Error('Onvolledige SQL-functie.');
    const nested = args.map(arg => rewriteFunctions(arg, transform));
    result += transform(name.toLowerCase(), nested) ?? `${name}(${nested.join(',')})`;
    i = end + 1;
  }
  return result;
}

export function postgresSql(sql) {
  const codeArray = /\bbingo_codes\b/.test(sql);
  let translated = rewriteFunctions(sql, (name, args) => {
    if (name === 'json_object') return `jsonb_build_object(${args.join(',')})`;
    if (name === 'json_group_array') return `jsonb_agg(${args.join(',')})`;
    if (name === 'json') return `(${args[0]})::jsonb`;
    if (name === 'json_extract') {
      const path = /^\s*'\$\.([a-zA-Z][a-zA-Z0-9.]*)'\s*$/.exec(args[1]);
      if (!path) throw new Error('Niet ondersteund SQLite JSON-pad.');
      const accessor = `'\{${path[1].split('.').join(',')}\}'`;
      if (path[1] === 'admitted') return `(CASE WHEN (${args[0]})::jsonb #> ${accessor} = 'true'::jsonb THEN 1 ELSE 0 END)`;
      return `((${args[0]})::jsonb ${path[1] === 'books' ? '#>' : '#>>'} ${accessor})`;
    }
    if (name === 'json_each') {
      if (args.length === 1) return `${codeArray ? 'jsonb_array_elements_text' : 'jsonb_array_elements'}((${args[0]})::jsonb)`;
      if (args[1].trim() !== "'$.books'") throw new Error('Niet ondersteunde SQLite JSON-array.');
      return `jsonb_array_elements((${args[0]})::jsonb #> '{books}')`;
    }
    return null;
  });
  translated = translated.replace(/\bLIMIT (100|101)\)\)/g, 'LIMIT $1) AS chat_entries)');
  if (/INSERT INTO player_auth_limits/i.test(sql)) translated = translated
    .replace(/CASE WHEN until/g, 'CASE WHEN player_auth_limits.until')
    .replace(/ELSE count \+ 1/g, 'ELSE player_auth_limits.count + 1')
    .replace(/ELSE until END/g, 'ELSE player_auth_limits.until END');
  // PostgreSQL placeholders are numbered outside string literals only.
  let index = 0, quote = null, output = '';
  for (let i = 0; i < translated.length; i++) {
    const char = translated[i];
    if (quote) {
      output += char;
      if (char === quote) { if (translated[i + 1] === quote) output += translated[++i]; else quote = null; }
    } else if (char === "'" || char === '"') { quote = char; output += char; }
    else output += char === '?' ? `$${++index}` : char;
  }
  return output;
}

export async function createPostgresDatabase(connectionString, { caBase64, allowLoopback = false } = {}) {
  const tls = postgresTlsOptions(connectionString, { caBase64, allowLoopback });
  const { Pool, types } = await import('pg');
  const pool = new Pool({ ...tls, max: 10, connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000, statement_timeout: 15_000, lock_timeout: 10_000, idle_in_transaction_session_timeout: 45_000,
    types: { getTypeParser(oid, format) {
      if (oid === 20 && format !== 'binary') return value => {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new RangeError('Databasegetal valt buiten het veilige JavaScript-bereik.');
        return number;
      };
      return types.getTypeParser(oid, format);
    } },
  });
  pool.on('error', () => { /* Individual queries report failures without logging connection secrets. */ });
  const execute = async (sql, args, client = pool) => {
    const result = await client.query(postgresSql(sql), args);
    return { success: true, results: result.rows, meta: { changes: result.command === 'SELECT' ? 0 : result.rowCount ?? 0 } };
  };
  const database = {
    kind: 'postgres',
    prepare(sql) { return prepared(database, sql); },
    execute,
    async batch(statements) {
      if (statements.some(statement => statement.database !== database)) throw new TypeError('Batch bevat een statement van een andere database.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const results = [];
        for (const statement of statements) {
          const result = await execute(statement.sql, statement.args, client);
          if (casUpdate(statement.sql) && !result.results.length) throw new CompareAndSwapConflict();
          results.push(result);
        }
        await client.query('COMMIT');
        return results;
      } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof CompareAndSwapConflict || ['40001', '40P01'].includes(error.code) || (error.code === '23505' && error.constraint === 'bingo_codes_pkey')) return statements.map(empty);
        throw error;
      } finally { client.release(); }
    },
    async withObjectLock(key, operation) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`milo-object:${key}`]);
        const result = await operation();
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
  try { await pool.query('SELECT 1 FROM bingo_games LIMIT 0'); }
  catch (error) { await pool.end(); throw error; }
  return database;
}

function keyName(key) {
  if (typeof key !== 'string' || !key || key.length > 2048 || key.includes('\0')) throw new TypeError('Ongeldige objectnaam.');
  return checksum(key);
}
function objectView(envelope, content = true) {
  const bytes = Buffer.from(envelope.data, 'base64');
  const value = { key: envelope.key, etag: envelope.etag, httpEtag: `"${envelope.etag}"`,
    size: bytes.length, uploaded: new Date(envelope.uploaded), httpMetadata: envelope.httpMetadata ?? {}, customMetadata: envelope.customMetadata ?? {} };
  if (content) Object.assign(value, { body: new Uint8Array(bytes),
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    async text() { return bytes.toString('utf8'); }, async json() { return JSON.parse(bytes.toString('utf8')); } });
  return value;
}
function matches(previous, onlyIf) {
  if (!onlyIf) return true;
  if (onlyIf.etagMatches !== undefined && (!previous || previous.etag !== onlyIf.etagMatches.replace(/^"|"$/g, ''))) return false;
  if (onlyIf.etagDoesNotMatch === '*' && previous) return false;
  if (onlyIf.etagDoesNotMatch && onlyIf.etagDoesNotMatch !== '*' && previous?.etag === onlyIf.etagDoesNotMatch.replace(/^"|"$/g, '')) return false;
  return true;
}
async function envelopeFor(key, data, options) {
  const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(await new Response(data).arrayBuffer());
  return { version: 1, key, etag: randomUUID(), uploaded: new Date().toISOString(), data: bytes.toString('base64'), httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {} };
}
async function fileOrNull(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function createLocalObjectStore(directory) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, '.object-locks.sqlite');
  const locks = new DatabaseSync(lockPath);
  chmodSync(lockPath, 0o600);
  locks.exec('PRAGMA busy_timeout=15000; CREATE TABLE IF NOT EXISTS object_lock (id INTEGER PRIMARY KEY);');
  // A native SQLite writer lock coordinates processes and is released by the
  // OS after a crash. Local critical sections contain synchronous file I/O
  // only, so another request cannot enter this connection's transaction.
  function locked(operation) {
    locks.exec('BEGIN IMMEDIATE');
    try { const result = operation(); locks.exec('COMMIT'); return result; }
    catch (error) { locks.exec('ROLLBACK'); throw error; }
  }
  const filename = key => join(root, `${keyName(key)}.json`);
  const readSync = path => {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const removeSync = path => { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
  return {
    kind: 'local',
    async get(key) { const value = await fileOrNull(filename(key)); return value ? objectView(value) : null; },
    async head(key) { const value = await fileOrNull(filename(key)); return value ? objectView(value, false) : null; },
    async put(key, data, options = {}) {
      const next = await envelopeFor(key, data, options);
      return locked(() => {
        const path = filename(key), previous = readSync(path);
        if (!matches(previous, options.onlyIf)) return null;
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const handle = openSync(temporary, 'wx', 0o600);
          try { writeFileSync(handle, JSON.stringify(next)); fsyncSync(handle); }
          finally { closeSync(handle); }
          renameSync(temporary, path);
          const directoryHandle = openSync(root, 'r');
          try { fsyncSync(directoryHandle); } finally { closeSync(directoryHandle); }
        } finally { removeSync(temporary); }
        return objectView(next, false);
      });
    },
    async delete(key) {
      if (Array.isArray(key)) { for (const entry of key) await this.delete(entry); return; }
      return locked(() => removeSync(filename(key)));
    },
    async close() { locks.close(); },
  };
}

export function createSupabaseObjectStore({ url, secretKey, bucket, database, fetcher = fetch }) {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Supabase Storage vereist HTTPS.');
  if (!database.withObjectLock) throw new Error('Gedeelde Supabase Storage vereist DATABASE_URL voor atomaire objectwijzigingen.');
  // New sb_secret keys are API keys, not JWTs. The gateway authenticates this
  // server request through apikey; never send an opaque key as a Bearer token.
  const headers = { apikey: secretKey };
  const path = key => `${origin.origin}/storage/v1/object/${encodeURIComponent(bucket)}/milo-envelopes/${keyName(key)}.json`;
  async function read(key) {
    const response = await fetcher(path(key), { headers, signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Supabase Storage lezen mislukt (${response.status}).`);
    const value = await response.json();
    if (value.version !== 1 || value.key !== key) throw new Error('Ongeldig object in Supabase Storage.');
    return value;
  }
  return {
    kind: 'supabase',
    async get(key) { const value = await read(key); return value ? objectView(value) : null; },
    async head(key) { const value = await read(key); return value ? objectView(value, false) : null; },
    async put(key, data, options = {}) {
      const next = await envelopeFor(key, data, options);
      return database.withObjectLock(`${bucket}:${key}`, async () => {
        if (!matches(await read(key), options.onlyIf)) return null;
        const response = await fetcher(path(key), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(next), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`Supabase Storage schrijven mislukt (${response.status}).`);
        return objectView(next, false);
      });
    },
    async delete(key) {
      if (Array.isArray(key)) { for (const entry of key) await this.delete(entry); return; }
      return database.withObjectLock(`${bucket}:${key}`, async () => {
        const response = await fetcher(path(key), { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) });
        if (!response.ok && response.status !== 404) throw new Error(`Supabase Storage verwijderen mislukt (${response.status}).`);
      });
    },
  };
}

export async function createStorageEnvironment(config = process.env) {
  const DB = config.DATABASE_URL ? await createPostgresDatabase(config.DATABASE_URL, { caBase64: config.SUPABASE_DB_CA_BASE64, allowLoopback: (config.NODE_ENV || process.env.NODE_ENV) !== 'production' }) : createSqliteDatabase(config.SQLITE_PATH || '.data/milobingo.sqlite');
  try {
    const remote = Boolean(config.SUPABASE_STORAGE_BUCKET);
    if (remote && (!config.SUPABASE_URL || !config.SUPABASE_SECRET_KEY)) throw new Error('Supabase Storage vereist SUPABASE_URL en SUPABASE_SECRET_KEY.');
    const SETTINGS = remote ? createSupabaseObjectStore({ url: config.SUPABASE_URL, secretKey: config.SUPABASE_SECRET_KEY, bucket: config.SUPABASE_STORAGE_BUCKET, database: DB }) : await createLocalObjectStore(config.OBJECT_STORAGE_PATH || '.data/objects');
    return { DB, SETTINGS, async close() { await SETTINGS.close?.(); await DB.close(); } };
  } catch (error) { await DB.close(); throw error; }
}

export const createStorage = createStorageEnvironment;
