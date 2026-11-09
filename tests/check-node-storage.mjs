import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createStorageEnvironment, createSupabaseObjectStore, postgresSql } from '../server/node-storage.js';
import { BingoStore } from '../server/bingo-store.js';
import { ChatStore } from '../server/chat-store.js';
import { PresentationStore } from '../server/presentation-store.js';
import { handleMailAPI } from '../server/mail-api.js';

const game = (id = randomUUID()) => ({ id, ownerId: 'host', books: [], ops: [], status: 'draft', counter: 0 });
const execFileAsync = promisify(execFile);

async function localFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'milo-storage-'));
  const config = { SQLITE_PATH: join(directory, 'bingo.sqlite'), OBJECT_STORAGE_PATH: join(directory, 'objects') };
  const storage = await createStorageEnvironment(config);
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...storage, config, directory };
}

async function persistenceContract(DB) {
  const bingo = new BingoStore(DB), presentation = new PresentationStore(DB);
  const show = game(); await bingo.create(show);
  assert.equal((await bingo.game(show.id)).revision, 1);
  assert.equal(await DB.prepare('SELECT revision FROM bingo_games WHERE id=?').bind(show.id).first('revision'), 1);
  assert.equal(await DB.prepare('SELECT id FROM bingo_games WHERE id=?').bind('missing').first(), null);
  const saved = await presentation.save('host', { profiles: [], rules: [] }, 0);
  assert.equal(saved.revision, 1);
  assert.equal(await presentation.save('host', { profiles: [], rules: [] }, 0), null);
  const expires = Date.now() + 60_000;
  const rate = () => DB.prepare('INSERT INTO player_auth_limits (key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN until <= ? THEN 1 ELSE count + 1 END, until = CASE WHEN until <= ? THEN excluded.until ELSE until END RETURNING count,until').bind('rate-test', expires, 0, 0).first();
  assert.equal((await rate()).count, 1); const second = await rate();
  assert.equal(second.count, 2); assert.equal(second.until, expires);
  await bingo.family('lookup-family', 'family@example.test');
  const match = await DB.prepare("SELECT account_id FROM bingo_families WHERE lower(json_extract(document,'$.email'))=?").bind('family@example.test').first();
  assert.equal(match.account_id, 'lookup-family');
}

async function atomicContract(DB) {
  const bingo = new BingoStore(DB), show = game(); await bingo.create(show);
  const family = await bingo.family('atomic-family', 'atomic@example.test');
  const before = await bingo.game(show.id);
  const failed = await DB.batch([
    DB.prepare('UPDATE bingo_games SET revision=?,document=? WHERE id=? AND revision=? RETURNING revision').bind(2, JSON.stringify({ ...show, counter: 99 }), show.id, 1),
    DB.prepare('UPDATE bingo_families SET revision=? WHERE account_id=? AND revision=? RETURNING revision').bind(2, 'atomic-family', 999),
    DB.prepare('INSERT INTO bingo_codes (code,game_id) VALUES (?,?)').bind('must-not-commit', show.id),
  ]);
  assert.equal(failed[0].results.length, 0);
  assert.deepEqual(await bingo.game(show.id), before, 'a later failed CAS rolls back the first game update');
  assert.equal((await bingo.family('atomic-family')).revision, family.revision);
  assert.equal(await DB.prepare('SELECT code FROM bingo_codes WHERE code=?').bind('must-not-commit').first(), null);

  const shows = [game(), game(), game()];
  for (const entry of shows) await bingo.create(entry);
  await Promise.all(shows.flatMap(entry => Array.from({ length: 2 }, () => bingo.mutate(entry.id, { accountId: 'shared-family' }, (current, currentFamily) => {
    current.counter++; currentFamily.counter = (currentFamily.counter || 0) + 1;
    current.books.push({ code: randomUUID(), admitted: true, accountId: 'shared-family' });
  }))));
  assert.equal((await bingo.family('shared-family')).data.counter, 6);
  for (const entry of shows) {
    const current = await bingo.game(entry.id);
    assert.equal(current.data.counter, 2); assert.equal(current.data.books.length, 2);
    const codes = (await DB.prepare('SELECT code FROM bingo_codes WHERE game_id=?').bind(entry.id).all()).results;
    assert.deepEqual(new Set(codes.map(row => row.code)), new Set(current.data.books.map(book => book.code)));
  }

  const collision = randomUUID(), competingShows = [game(), game()];
  for (const entry of competingShows) await bingo.create(entry);
  await Promise.all(competingShows.map(async entry => {
    let attempts = 0;
    await bingo.mutate(entry.id, { accountId: `family-${entry.id}` }, (current, currentFamily) => {
      currentFamily.counter = (currentFamily.counter || 0) + 1;
      current.books.push({ code: attempts++ ? randomUUID() : collision });
    });
  }));
  assert.equal((await DB.prepare('SELECT code FROM bingo_codes WHERE code=?').bind(collision).all()).results.length, 1);
  for (const entry of competingShows) {
    const current = await bingo.game(entry.id);
    assert.equal(current.revision, 2); assert.equal(current.data.books.length, 1);
    assert.equal((await bingo.family(`family-${entry.id}`)).data.counter, 1);
  }
}

async function chatContract(DB) {
  const bingo = new BingoStore(DB), chat = new ChatStore(DB), show = game();
  for (const account of ['chat-a', 'chat-b']) {
    await bingo.editFamily(account, `${account}@example.test`, family => { family.profiles = [{ id: account, name: account }]; });
    show.books.push({ code: randomUUID(), admitted: true, accountId: account });
  }
  await bingo.create(show); await chat.open(show.id);
  const ownerContext = await chat.read(show.id, 'chat-a', { books: true });
  await chat.joinParticipants(ownerContext);
  const contexts = await Promise.all(['chat-a', 'chat-b'].map(account => chat.read(show.id, account)));
  assert.equal(Boolean(contexts[0].linked), true);
  assert.equal(contexts[0].game.status, 'draft');
  const write = (context, account, text) => chat.commit(context, account, { requestId: randomUUID(), action: 'message', resultId: randomUUID(), message: { id: randomUUID(), profileId: account, name: account, role: 'player', text }, now: Date.now() });
  const first = await Promise.all(contexts.map((context, index) => write(context, ['chat-a', 'chat-b'][index], `hello-${index}`)));
  // A SERIALIZABLE conflict is a retry signal, as consumed by the chat handler.
  for (let i = 0; i < first.length; i++) if (!first[i]) assert.equal(await write(await chat.read(show.id, ['chat-a', 'chat-b'][i]), ['chat-a', 'chat-b'][i], `hello-${i}`), true);
  const snapshot = await chat.read(show.id, 'chat-a', { members: true, books: true });
  assert.equal(snapshot.messages.length, 2); assert.equal(snapshot.cursor, 2);
  assert.deepEqual(snapshot.messages.map(message => message.seq), [1, 2]);
  assert.equal(snapshot.messages[0].deleted, false); assert.equal(snapshot.members.length, 2);
  const events = await chat.read(show.id, 'chat-a', { after: 0 });
  assert.equal(events.events.length, 2); assert.equal(events.events[0].message.text.startsWith('hello-'), true);
  assert.equal((await chat.message(show.id, snapshot.messages[0].id)).message.id, snapshot.messages[0].id);

  const stale = await chat.read(show.id, 'chat-a');
  const simultaneous = await Promise.all([write(stale, 'chat-a', 'same-tab-a'), write(stale, 'chat-a', 'same-tab-b')]);
  assert.equal(simultaneous.filter(Boolean).length, 1, 'one account cannot bypass its SQL send guard using parallel tabs');
  assert.equal((await chat.read(show.id, 'chat-a')).cursor, 3);
}

async function objectContract(SETTINGS) {
  const key = '../private/secret.json';
  assert.equal(await SETTINGS.get(key), null);
  const created = await SETTINGS.put(key, 'secret-one', { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'text/plain' }, customMetadata: { source: 'contract' } });
  assert.ok(created.etag);
  assert.equal(await SETTINGS.put(key, 'bad', { onlyIf: { etagDoesNotMatch: '*' } }), null);
  const winners = await Promise.all(['secret-two', 'secret-three'].map(value => SETTINGS.put(key, value, { onlyIf: { etagMatches: created.etag } })));
  assert.equal(winners.filter(Boolean).length, 1);
  const saved = await SETTINGS.get(key);
  assert.match(await saved.text(), /^secret-(two|three)$/);
  assert.equal(new TextDecoder().decode(await saved.arrayBuffer()), await saved.text());
  assert.equal((await SETTINGS.head(key)).size, saved.size);
  await SETTINGS.put('metadata', JSON.stringify({ durable: true }), { httpMetadata: { contentType: 'application/json' }, customMetadata: { owner: 'host' } });
  const metadata = await SETTINGS.get('metadata');
  assert.deepEqual(await metadata.json(), { durable: true });
  assert.equal(metadata.httpMetadata.contentType, 'application/json'); assert.equal(metadata.customMetadata.owner, 'host');
  await SETTINGS.delete([key, 'missing']); assert.equal(await SETTINGS.get(key), null);
}

test('Supabase missing-object envelopes allow first-open mail templates and conditional creation', async t => {
  const { DB } = await localFixture(t), objects = new Map(), requests = [];
  const SETTINGS = createSupabaseObjectStore({
    url: 'https://storage.example.test', secretKey: 'fixture-secret', bucket: 'milo-private',
    database: { withObjectLock: async (_key, operation) => operation() },
    fetcher: async (url, options = {}) => {
      requests.push(options.method || 'GET');
      if (options.method === 'POST') { objects.set(url, options.body); return Response.json({}); }
      return objects.has(url) ? new Response(objects.get(url)) : Response.json({statusCode:'404',code:'NoSuchKey',error:'not_found',message:'Object not found'}, {status:400});
    },
  });
  const env = { DB, SETTINGS, MAIL_MODE:'disabled', AUTH_IDENTITY:{user:'host',email:'host@example.test',admin:true} };
  for (const brand of ['milo','vlampie']) {
    const response = await handleMailAPI(new Request('https://studio.example/api/mail/state?brand='+brand), env, () => { throw Error('No mail providers allowed'); });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.templates.length, 17); assert.equal(state.provider.configured, false);
    assert.equal(state.templates.find(item => item.id === 'auth-code').editable, false);
    assert.equal(state.brandId, brand);
  }
  assert(requests.every(method => method === 'GET'), 'Opening templates must not create objects or send mail');
  assert.equal(await SETTINGS.get('new-private-setting'), null);
  const saved = await SETTINGS.put('new-private-setting', 'encrypted-fixture', {onlyIf:{etagDoesNotMatch:'*'}});
  assert.ok(saved.etag);
  assert.equal(await (await SETTINGS.get('new-private-setting')).text(), 'encrypted-fixture');
  assert.equal(await SETTINGS.put('new-private-setting', 'overwrite', {onlyIf:{etagDoesNotMatch:'*'}}), null);
});

test('Supabase object reads preserve bucket, permission, server and malformed-response failures', async () => {
  const failures = [
    [400,{statusCode:'404',code:'NoSuchBucket',error:'Bucket not found'}],
    [400,{statusCode:'403',code:'AccessDenied',error:'not_found'}],
    [400,{statusCode:'401',code:'InvalidJWT'}],
    [400,{statusCode:'404',message:'Object not found'}],
    [400,{statusCode:'403',code:'NoSuchKey'}],
    [403,{statusCode:'404',code:'NoSuchKey'}],
    [500,{statusCode:'404',code:'NoSuchKey'}],
    [400,'invalid json'],
  ];
  for (const [status,body] of failures) {
    const SETTINGS = createSupabaseObjectStore({url:'https://storage.example.test',secretKey:'fixture-secret',bucket:'milo-private',database:{withObjectLock:async(_key,operation)=>operation()},fetcher:async()=>typeof body==='string'?new Response(body,{status}):Response.json(body,{status})});
    await assert.rejects(SETTINGS.get('private/setting'), /Supabase Storage lezen mislukt/);
  }
});

test('durable SQLite adapter preserves CAS, game/family/code transactions and chat JSON behavior', async t => {
  const { DB, SETTINGS } = await localFixture(t);
  await persistenceContract(DB); await atomicContract(DB); await chatContract(DB); await objectContract(SETTINGS);
});

test('local data, private objects and roles survive a new storage instance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'milo-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { SQLITE_PATH: join(directory, 'bingo.sqlite'), OBJECT_STORAGE_PATH: join(directory, 'objects') };
  let storage = await createStorageEnvironment(config);
  const show = game(); await new BingoStore(storage.DB).create(show);
  await storage.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind('trusted-host', 'regie').run();
  await storage.SETTINGS.put('private/restart', new Uint8Array([0, 1, 255])); await storage.close();
  storage = await createStorageEnvironment(config);
  try {
    assert.equal((await new BingoStore(storage.DB).game(show.id)).revision, 1);
    assert.equal(await storage.DB.prepare('SELECT role FROM app_user_roles WHERE user_id=?').bind('trusted-host').first('role'), 'regie');
    assert.deepEqual(new Uint8Array(await (await storage.SETTINGS.get('private/restart')).arrayBuffer()), new Uint8Array([0, 1, 255]));
    assert.equal((await stat(config.SQLITE_PATH)).mode & 0o777, 0o600);
    assert.equal((await stat(config.OBJECT_STORAGE_PATH)).mode & 0o777, 0o700);
    assert.equal((await readdir(config.OBJECT_STORAGE_PATH)).filter(name => name.endsWith('.json')).length, 1, 'object key cannot escape the private directory');
  } finally { await storage.close(); }
});

test('local object CAS coordinates separate processes and recovers a process-killed lock', { timeout: 10_000 }, async t => {
  const { SETTINGS, config } = await localFixture(t);
  const initial = await SETTINGS.put('shared-process-object', 'initial');
  const moduleUrl = new URL('../server/node-storage.js', import.meta.url).href;
  const code = `import {createStorageEnvironment} from ${JSON.stringify(moduleUrl)};
    const storage=await createStorageEnvironment(JSON.parse(process.env.MILO_CHILD_CONFIG));
    try { const saved=await storage.SETTINGS.put('shared-process-object',process.env.MILO_CHILD_VALUE,{onlyIf:{etagMatches:process.env.MILO_CHILD_REVISION}});process.stdout.write(saved?'saved':'conflict'); }
    finally { await storage.close(); }`;
  const writes = await Promise.all(['one', 'two'].map(value => execFileAsync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, MILO_CHILD_CONFIG: JSON.stringify(config), MILO_CHILD_VALUE: value, MILO_CHILD_REVISION: initial.etag } })));
  assert.deepEqual(writes.map(write => write.stdout).sort(), ['conflict', 'saved']);
  const lockPath = join(config.OBJECT_STORAGE_PATH, '.object-locks.sqlite');
  const crashing = spawn(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(lockPath)});db.exec('BEGIN IMMEDIATE');process.stdout.write('locked');setInterval(()=>{},1000);`]);
  t.after(() => crashing.kill('SIGKILL'));
  assert.equal((await once(crashing.stdout, 'data'))[0].toString(), 'locked');
  const exited = once(crashing, 'exit'); crashing.kill('SIGKILL'); await exited;
  assert.ok(await SETTINGS.put('after-crash', 'the operating system released the lock'));
});

test('PostgreSQL translator numbers placeholders outside quoted literals and rejects unknown JSON shapes', () => {
  assert.equal(postgresSql("SELECT '?' AS literal,? AS value"), "SELECT '?' AS literal,$1 AS value");
  assert.match(postgresSql('SELECT value FROM json_each(?)'), /jsonb_array_elements/);
  assert.throws(() => postgresSql("SELECT json_extract(document,'$[0]')"), /JSON-pad/);
});

const postgresUrl = process.env.MILO_TEST_DATABASE_URL;
test('PostgreSQL adapter executes the same persistence/concurrency contract with RLS and shared object CAS', { skip: !postgresUrl }, async t => {
  const source = new URL(postgresUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'integration tests require a local PostgreSQL database');
  assert.match(source.pathname, /test/i, 'integration database name must contain test');
  const { Pool } = await import('pg');
  const admin = new Pool({ connectionString: postgresUrl });
  const schema = `milo_storage_${randomUUID().replaceAll('-', '')}`;
  const browserRole = `milo_browser_${randomUUID().replaceAll('-', '')}`;
  const runtimeRole = `milo_runtime_${randomUUID().replaceAll('-', '')}`;
  let storage, directory;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE ROLE ${browserRole} NOLOGIN`);
  t.after(async () => {
    if (storage) await storage.close();
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.query(`DROP ROLE ${browserRole}`); await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`); }
    finally { await admin.end(); if (directory) await rm(directory, { recursive: true, force: true }); }
  });
  const client = await admin.connect();
  try {
    await client.query(`SET search_path TO ${schema}`);
    const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
    for (const filename of migrations) await client.query((await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`).replaceAll('SCHEMA public', `SCHEMA ${schema}`));
  } finally { client.release(); }
  source.searchParams.set('options', `-c search_path=${schema}`);
  directory = await mkdtemp(join(tmpdir(), 'milo-pg-objects-'));
  storage = await createStorageEnvironment({ DATABASE_URL: source.toString(), OBJECT_STORAGE_PATH: directory });
  await persistenceContract(storage.DB); await atomicContract(storage.DB); await chatContract(storage.DB);
  await assert.rejects(storage.DB.withObjectLock('invalid-timeout',()=>assert.fail('Invalid lease must not execute'),{idleTimeoutMs:180001}),RangeError);
  await storage.DB.withObjectLock('bounded-lease',async lease=>{
    assert.equal(lease.signal.aborted,false);
    const remaining=lease.deadline-Date.now();assert(remaining>170000&&remaining<=175000);
  },{idleTimeoutMs:180000});
  const signalKey='disconnect-'+randomUUID();
  await assert.rejects(storage.DB.withObjectLock(signalKey,async lease=>{
    const lock=(await admin.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND ((classid::bigint << 32) | objid::bigint)=hashtextextended($1,0)",['milo-object:'+signalKey])).rows[0];
    assert.ok(lock?.pid,'Only the exact own fixture lock may be terminated');
    const aborted=new Promise(resolve=>lease.signal.addEventListener('abort',resolve,{once:true}));
    await admin.query('SELECT pg_terminate_backend($1)',[lock.pid]);
    await aborted;assert.equal(lease.signal.aborted,true);
  },{idleTimeoutMs:180000}),/objectlockverbinding/);
  const secured = await admin.query('SELECT bool_and(relrowsecurity) AS enabled,count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind=$2', [schema, 'r']);
  assert.equal(secured.rows[0].enabled, true); assert.equal(secured.rows[0].count, 23);
  await storage.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind('real-regie-account', 'regie').run();
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${browserRole}`);
  const browser = await admin.connect();
  try {
    await browser.query(`SET ROLE ${browserRole}`);
    await assert.rejects(browser.query(`SELECT * FROM ${schema}.bingo_families`), error => error.code === '42501');
    await browser.query('RESET ROLE');
    // Even an accidental future table grant must not expose family or role rows.
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${schema}.bingo_families,${schema}.app_user_roles TO ${browserRole}`);
    await browser.query(`SET ROLE ${browserRole}`);
    assert.equal((await browser.query(`SELECT * FROM ${schema}.bingo_families`)).rowCount, 0);
    assert.equal((await browser.query(`SELECT * FROM ${schema}.app_user_roles`)).rowCount, 0);
    await assert.rejects(browser.query(`INSERT INTO ${schema}.app_user_roles (user_id,role) VALUES ('attacker','regie')`), error => error.code === '42501');
    assert.equal((await browser.query(`UPDATE ${schema}.app_user_roles SET role='regie' WHERE user_id='real-regie-account'`)).rowCount, 0);
  } finally { await browser.query('RESET ROLE'); browser.release(); }
  const objects = new Map();
  const fetcher = async (url, options = {}) => {
    assert.equal(options.headers.apikey, 'server-test-secret');
    assert.equal(options.headers.Authorization, undefined, 'opaque sb_secret keys are not JWT Bearer tokens');
    await new Promise(done => setTimeout(done, 4));
    if (options.method === 'POST') { objects.set(url, options.body); return new Response('{}'); }
    if (options.method === 'DELETE') { objects.delete(url); return new Response('{}'); }
    return objects.has(url) ? new Response(objects.get(url)) : new Response('{}', { status: 404 });
  };
  const bucket = createSupabaseObjectStore({ url: 'https://storage.example.test', secretKey: 'server-test-secret', bucket: 'milo-private', database: storage.DB, fetcher });
  await objectContract(bucket);
  const reopened = await createStorageEnvironment({ DATABASE_URL: source.toString(), OBJECT_STORAGE_PATH: directory });
  try { assert.equal(await reopened.DB.prepare('SELECT role FROM app_user_roles WHERE user_id=?').bind('real-regie-account').first('role'), 'regie'); }
  finally { await reopened.close(); }
  const runtimePassword = randomUUID().replaceAll('-', '');
  await admin.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}' IN ROLE milo_backend`);
  const runtimeUrl = new URL(source); runtimeUrl.username = runtimeRole; runtimeUrl.password = runtimePassword;
  const restricted = await createStorageEnvironment({ DATABASE_URL: runtimeUrl.toString(), OBJECT_STORAGE_PATH: directory });
  try {
    assert.equal(await restricted.DB.prepare('SELECT role FROM app_user_roles WHERE user_id=?').bind('real-regie-account').first('role'), 'regie');
    await assert.rejects(restricted.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind('self-escalation', 'regie').run(), error => error.code === '42501');
    const backendStore = new BingoStore(restricted.DB), backendGame = game();
    await backendStore.create(backendGame);
    await backendStore.mutate(backendGame.id, { accountId: 'backend-family' }, (current, family) => { current.counter++; family.counter = 1; current.books.push({ code: randomUUID() }); });
    assert.equal((await backendStore.game(backendGame.id)).data.counter, 1);
    await assert.rejects(restricted.DB.prepare('DROP TABLE bingo_games').run(), error => error.code === '42501');
  } finally { await restricted.close(); }
});
