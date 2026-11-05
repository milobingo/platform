import {cp, mkdtemp, readdir, realpath, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {basename, isAbsolute, join, relative, resolve, sep} from 'node:path';

const inside = (root, path) => {
  const location = relative(root, path);
  return location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
};
const repository = await realpath(resolve('.'));
const source = await realpath(join(repository, '.next/standalone'));
let temporary, child, childClosed, stoppingSignal, killTimer;
const stop = signal => {
  stoppingSignal ||= signal;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  killTimer ||= setTimeout(() => child.kill('SIGKILL'), 10_000);
  killTimer.unref();
};
const onTerm = () => stop('SIGTERM'), onInt = () => stop('SIGINT');
process.on('SIGTERM', onTerm);
process.on('SIGINT', onInt);

try {
  temporary = await mkdtemp(join(tmpdir(), 'milo-standalone-test-'));
  temporary = await realpath(temporary);
  if (inside(repository, temporary)) throw new Error('De standalone-testmap moet buiten de repository staan.');
  const artifact = join(temporary, 'release');
  await cp(source, artifact, {
    recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false,
    filter(path) {
      const location = relative(source, path);
      if (location === '.data' || location.startsWith(`.data${sep}`)) return false;
      if (/^\.env(?:\.|$)/.test(basename(path))) throw new Error('Een omgevingsbestand is in het standalone-artefact beland.');
      return true;
    },
  });
  for (const entry of await readdir(artifact, {recursive: true, withFileTypes: true})) {
    if (entry.isSymbolicLink() && !inside(artifact, await realpath(join(entry.parentPath, entry.name)))) throw new Error('Een standalone-symlink verwijst buiten het gekopieerde artefact.');
  }
  const requireFromArtifact = createRequire(join(artifact, 'server.js'));
  for (const dependency of ['pg', 'ws']) {
    if (!inside(artifact, await realpath(requireFromArtifact.resolve(dependency)))) throw new Error(`Standalone-dependency ${dependency} wordt buiten het gekopieerde artefact gevonden.`);
  }
  console.log('Standalone-test: pg/ws bevinden zich in het naar een tijdelijke map verplaatste artefact.');
  if (!stoppingSignal) {
    child = spawn(process.execPath, [join(artifact, 'server.js')], {
      cwd: artifact, stdio: 'inherit',
      env: {NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '4175', MILO_LOCAL_AUTH: 'false', NEXT_TELEMETRY_DISABLED: '1'},
    });
    childClosed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({code, signal}));
    });
    const result = await childClosed;
    if (!stoppingSignal) process.exitCode = result.code === 0 && !result.signal ? 0 : result.code || 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    stop('SIGTERM');
    await childClosed.catch(() => {});
  }
  clearTimeout(killTimer);
  if (temporary) await rm(temporary, {recursive: true, force: true});
  process.off('SIGTERM', onTerm);
  process.off('SIGINT', onInt);
}
