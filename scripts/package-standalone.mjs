import {cp, readdir, access, rm, realpath, mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve, relative, isAbsolute, sep} from 'node:path';
import {build} from 'esbuild';
import {loadManifest} from './deploy/database.mjs';

// Next's standalone server omits public/static assets by design. Include them
// in each native release so Caddy only needs to proxy the loopback Node port.
const root = await realpath(resolve('.next/standalone'));
await access(`${root}/server.js`);
await rm(`${root}/.data`, {recursive: true, force: true});
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
for (const dependency of ['pg', 'ws']) {
  const canonicalPath = await realpath(requireFromRelease.resolve(dependency));
  const location = relative(root, canonicalPath);
  if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error(`Standalone-dependency ${dependency} ontbreekt in het releaseartefact.`);
}
// Run the release's own read-only backend checks as the unprivileged app user,
// before activation. Runtime credentials never enter this build environment.
await mkdir(`${root}/.milo`, {recursive:true});
await build({entryPoints:['scripts/deploy/runtime-audit.mjs'],outfile:`${root}/.milo/runtime-audit.mjs`,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'warning'});
await writeFile(`${root}/.milo/schema-tables.json`,JSON.stringify([...(await loadManifest()).tables.keys()].sort())+'\n');
console.log('Native standalone-release compleet: server, pg/ws, public, static, SQLite-migraties en read-only runtimecontrole.');
