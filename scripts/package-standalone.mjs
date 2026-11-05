import {cp, readdir, access, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

// Next's standalone server omits public/static assets by design. Include them
// in each native release so Caddy only needs to proxy the loopback Node port.
const root = resolve('.next/standalone');
await access(`${root}/server.js`);
for (const entry of await readdir(root)) {
  if (/^\.env(?:\.|$)/.test(entry)) throw new Error('Een omgevingsbestand is in de build beland. Verwijder het vóór de releasebuild.');
}
for (const [source, target] of [
  ['public', `${root}/public`],
  ['.next/static', `${root}/.next/static`],
  // SQLite is supported for local production checks; staging uses PostgreSQL.
  ['drizzle', `${root}/drizzle`],
]) {
  await rm(target, {recursive: true, force: true});
  await cp(source, target, {recursive: true, errorOnExist: true, force: false});
}
const requireFromRelease = createRequire(`${root}/server.js`);
for (const dependency of ['pg', 'ws']) requireFromRelease.resolve(dependency);
console.log('Native standalone-release compleet: server, pg/ws, public, static en lokale SQLite-migraties.');
