#!/usr/bin/env node
// Fixed-host, read-only recovery-key proof. Never writes plaintext or contacts a database.
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, readdirSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT = 'lfsdgxcpdyghidzkzzvn';
const HANDOFF = '/etc/dg-sites/milobingo-staging/admin/github-transfer-2026-11-11.json';
const BACKUPS = '/var/backups/milobingo-staging';
const MAX_BACKUP = 64 * 1024 * 1024;
const MAGIC = Buffer.from('MILOBAK1');
const NAME = new RegExp(`^(milo-${PROJECT}-([0-9]{8}T[0-9]{9}Z)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\\.(dump|extensions\\.json)\\.aesgcm$`);
const refuse = () => { throw new Error('Backup handoff verification refused.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateHandoff(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'BACKUP_ENCRYPTION_KEY,MIGRATION_DATABASE_URL') refuse();
  if (Object.values(value).some(item => typeof item !== 'string' || !item || item.length > 32768 || /[\x00-\x1f\x7f]/.test(item))) refuse();
  if (!/^[a-fA-F0-9]{64}$/.test(value.BACKUP_ENCRYPTION_KEY)) refuse();
  const url = new URL(value.MIGRATION_DATABASE_URL);
  const direct = url.hostname === `db.${PROJECT}.supabase.co`;
  const pooled = url.hostname.endsWith('.pooler.supabase.com') && url.username.endsWith(`.${PROJECT}`);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password || !['', '5432'].includes(url.port) || ['', '/'].includes(url.pathname) || url.hash || !(direct || pooled) || [...url.searchParams].length !== 1 || url.searchParams.get('sslmode') !== 'verify-full') refuse();
  return Buffer.from(value.BACKUP_ENCRYPTION_KEY, 'hex');
}

export function latestPair(names) {
  const candidates = names.map(name => ({ name, match: NAME.exec(name) })).filter(item => item.match);
  for (const { match } of candidates) {
    const stamp = match[2];
    const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`;
    if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().replaceAll(/[^0-9TZ]/g, '') !== stamp) refuse();
  }
  const ids = candidates.map(item => item.match[1]).sort();
  if (!ids.length) refuse();
  const id = ids.at(-1), dump = `${id}.dump.aesgcm`, metadata = `${id}.extensions.json.aesgcm`;
  // A newer orphan must fail instead of silently verifying an older complete pair.
  if (!names.includes(dump) || !names.includes(metadata)) refuse();
  return { id, dump, metadata };
}

export function decryptAuthenticated(envelope, key) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 36 || envelope.length > MAX_BACKUP || !envelope.subarray(0, 8).equals(MAGIC)) refuse();
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(8, 20));
  decipher.setAAD(envelope.subarray(0, 20));
  decipher.setAuthTag(envelope.subarray(-16));
  let pending;
  try {
    pending = decipher.update(envelope.subarray(20, -16));
    const end = decipher.final(); // Nothing is parsed or reported before authentication succeeds.
    const plaintext = Buffer.concat([pending, end]);
    end.fill(0);
    return plaintext;
  } finally { pending?.fill(0); }
}

function trustedParents(path) {
  for (let parent = dirname(path);; parent = dirname(parent)) {
    const info = lstatSync(parent);
    if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022)) refuse();
    if (parent === '/') break;
  }
}

function readPrivateFile(path, maxBytes, owner) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || Number(before.mode & 0o7777n) !== 0o600 || (owner !== undefined && before.uid !== BigInt(owner)) || before.size <= 0n || before.size > BigInt(maxBytes)) refuse();
    bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) refuse();
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(fd, extra, 0, 1, offset)) refuse();
    const after = fstatSync(fd, { bigint: true });
    if (['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].some(field => before[field] !== after[field])) refuse();
    return bytes;
  } catch (error) { bytes?.fill(0); throw error; }
  finally { closeSync(fd); }
}

export function main() {
  if (process.argv.length !== 2 || process.geteuid?.() !== 0 || hostname() !== 'dg-nxttrack-01') refuse();
  trustedParents(HANDOFF);
  trustedParents(BACKUPS);
  let handoffBytes, key, dumpBytes, metadataBytes, dump, metadata, dir;
  try {
    handoffBytes = readPrivateFile(HANDOFF, 70000, 0);
    key = validateHandoff(JSON.parse(handoffBytes.toString('utf8')));
    dir = openSync(BACKUPS, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const info = fstatSync(dir);
    // The existing private runner-owned map is allowed until its separate root-ownership migration.
    if (!info.isDirectory() || (info.mode & 0o7777) !== 0o700) refuse();
    const directory = `/proc/self/fd/${dir}`;
    const pair = latestPair(readdirSync(directory));
    dumpBytes = readPrivateFile(`${directory}/${pair.dump}`, MAX_BACKUP, info.uid);
    metadataBytes = readPrivateFile(`${directory}/${pair.metadata}`, MAX_BACKUP, info.uid);
    dump = decryptAuthenticated(dumpBytes, key);
    metadata = decryptAuthenticated(metadataBytes, key);
    if (!dump.subarray(0, 5).equals(Buffer.from('PGDMP'))) refuse();
    const parsed = JSON.parse(metadata.toString('utf8'));
    if (!object(parsed) || parsed.format !== 1 || parsed.projectRef !== PROJECT || parsed.backupId !== pair.id) refuse();
    // Only names and proof flags leave this process. No key, URL, digest or plaintext is printed.
    console.log(JSON.stringify({ files: [pair.dump, pair.metadata], authenticated: true, plaintextWritten: false }));
  } finally {
    for (const bytes of [handoffBytes, key, dumpBytes, metadataBytes, dump, metadata]) bytes?.fill(0);
    if (dir !== undefined) closeSync(dir);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); }
  catch { console.error('Backup handoff verification refused; no credential values or plaintext shown.'); process.exitCode = 1; }
}
