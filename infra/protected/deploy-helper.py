#!/usr/bin/python3 -I
"""Fixed Milo protected-config broker; repository code never runs as root.

The root-owned, SHA-pinned legacy Milo helper provides the unchanged artifact
seal and app/config activation/rollback primitives. This broker replaces its
runner checkout and inherited-runtime inputs with independent GitHub provenance,
an immutable root-only bundle and bounded isolated builds. Legacy files and
existing releases are neither rewritten nor pruned.
"""
import contextlib
import fcntl
import grp
import hashlib
import http.client
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit, parse_qs

SITE = 'milobingo-staging'
HOST = 'dg-nxttrack-01'
RUNNER, BUILDER, APP = 'run-mil-stg', 'build-mil-stg', 'app-mil-stg'
PORT = 4173
SERVICE = SITE + '.service'
REPOSITORY = 'milobingo/platform'
LEGACY = Path('/usr/local/libexec/dg-milobingo-deploy-helper')
POLICY = Path('/etc/dg-sites/milobingo-staging/protected-deploy.json')
CONFIG_ROOT = Path('/etc/dg-sites/milobingo-staging/configs')
GATE = Path('/usr/local/libexec/milo-protected-release-gate.mjs')
EXTRACTOR = Path('/usr/local/libexec/milo-protected-extract-source.py')
GUARDIAN = Path('/usr/local/libexec/milo-protected-lock-guardian.py')
GLOBAL_LOCK = Path('/run/lock/dg-build.lock')
SITE_LOCK = Path('/run/lock/milobingo-staging.deploy.lock')
BUILD_PREFIX = 'dg-milobingo-protected-build-'
GUARDIAN_PREFIX = 'dg-milobingo-protected-lock-'
NOFOLLOW = os.O_NOFOLLOW | os.O_CLOEXEC
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
SHA_RE = r'[a-f0-9]{40}'
RUN_RE = r'[1-9][0-9]{0,19}-[1-9][0-9]{0,9}'
CONFIG_RE = r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}'
DERIVED_KEYS = ('NODE_ENV', 'HOSTNAME', 'MILO_LOCAL_AUTH', 'PORT', 'RELEASE_SHA', 'RELEASE_ID', 'CONFIG_VERSION')
BUILD_LOCK_FDS = ()


class Refused(ValueError):
    pass


class LockBusy(Refused):
    pass


def require(condition, message='Protected Milo deployment boundary refused'):
    if not condition:
        raise Refused(message)


def trusted_path(path, directory=False):
    path = Path(path)
    require(path.is_absolute())
    for component in [*reversed(path.parents), path]:
        item = component.lstat()
        require(item.st_uid == 0 and not item.st_mode & 0o022
                and not stat.S_ISLNK(item.st_mode), 'Untrusted protected path')
    require(path.is_dir() if directory else path.is_file())
    return path


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def file_digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_json(path, limit=262144):
    trusted_path(path)
    info = path.lstat()
    require(info.st_nlink == 1 and not info.st_mode & 0o077 and info.st_size <= limit,
            'Protected JSON must be private, bounded and singly linked')
    fd = os.open(path, os.O_RDONLY | NOFOLLOW)
    try:
        value = os.read(fd, limit + 1)
        require(len(value) <= limit)
        return json.loads(value.decode('utf-8'), object_pairs_hook=unique_object)
    finally:
        os.close(fd)


def arguments(values):
    require(len(values) == 4 and values[0] == 'deploy'
            and re.fullmatch(SHA_RE, values[1]) and re.fullmatch(RUN_RE, values[2])
            and re.fullmatch(CONFIG_RE, values[3]), 'Invalid fixed deployment arguments')
    return values


def request_body(stream):
    body = stream.read(8193)
    require(len(body) <= 8192)
    values = json.loads(body, object_pairs_hook=unique_object)
    require(isinstance(values, dict) and set(values) == {'githubToken'})
    token = values['githubToken']
    require(isinstance(token, str) and 8 <= len(token) <= 4096
            and all(33 <= ord(c) < 127 for c in token))
    return values


def read_policy():
    value = read_json(POLICY, 32768)
    require(isinstance(value, dict) and set(value) == {'version', 'allowedConfigIds',
            'legacySha256', 'gateSha256', 'extractorSha256', 'guardianSha256', 'accounts'})
    require(value['version'] == 1)
    for key, path in [('legacySha256', LEGACY), ('gateSha256', GATE),
                      ('extractorSha256', EXTRACTOR), ('guardianSha256', GUARDIAN)]:
        require(isinstance(value[key], str) and re.fullmatch('[a-f0-9]{64}', value[key]))
        trusted_path(path)
        require(file_digest(path) == value[key], 'Installed protected code differs from policy')
    allowed = value['allowedConfigIds']
    require(isinstance(allowed, list) and 0 < len(allowed) <= 1000
            and len(set(allowed)) == len(allowed)
            and all(isinstance(c, str) and re.fullmatch(CONFIG_RE, c) for c in allowed),
            'Configuration allowlist is missing or invalid')
    accounts = value['accounts']
    require(isinstance(accounts, dict) and set(accounts) == {RUNNER, BUILDER, APP})
    uids, gids = {0}, set()
    for name, identity in accounts.items():
        require(isinstance(identity, dict) and set(identity) == {'uid', 'gid'}
                and all(type(identity[k]) is int and identity[k] > 0 for k in ['uid', 'gid']))
        user = pwd.getpwnam(name)
        require((user.pw_uid, user.pw_gid) == (identity['uid'], identity['gid']), 'Account identity differs')
        uids.add(user.pw_uid)
        gids.add(user.pw_gid)
    require(len(uids) == 4 and len(gids) == 3)
    builder = pwd.getpwnam(BUILDER)
    require(set(os.getgrouplist(BUILDER, builder.pw_gid)) == {builder.pw_gid})
    return value


def load_legacy(policy):
    # Only preinstalled root-owned bytes are imported; never the downloaded repo.
    trusted_path(LEGACY)
    require(file_digest(LEGACY) == policy['legacySha256'])
    loader = importlib.machinery.SourceFileLoader('milo_protected_legacy', str(LEGACY))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    require(module.SITE == SITE and module.SERVICE == SERVICE)
    return module


def read_bundle(config_id, sha, run, legacy, policy):
    require(re.fullmatch(CONFIG_RE, config_id) and config_id in policy['allowedConfigIds'])
    root = trusted_path(CONFIG_ROOT / config_id, directory=True)
    require(not root.stat().st_mode & 0o077, 'Configuration directory must be root-only')
    path = root / 'runtime.json'
    values = read_json(path)
    allowed = set(legacy.RUNTIME_KEYS) - set(DERIVED_KEYS)
    require(isinstance(values, dict) and set(values) <= allowed,
            'Bundle accepts only runtime infrastructure and compatible provider fallbacks')
    forced = {'NODE_ENV': 'production', 'HOSTNAME': '127.0.0.1', 'MILO_LOCAL_AUTH': 'false',
              'PORT': str(PORT), 'RELEASE_SHA': sha, 'RELEASE_ID': run, 'CONFIG_VERSION': config_id}
    runtime = legacy.runtime_values({**values, **forced}, sha, run, PORT)
    # Providers and delivery modes are editable encrypted settings. This fixed
    # environment gate keeps staging allowlists mandatory without freezing mode.
    runtime['MAIL_ENVIRONMENT'] = 'staging'
    return {'id': config_id, 'path': path, 'sha256': file_digest(path), 'runtime': runtime}


def open_lock(path, shared=False):
    parent = path.parent.stat()
    require(parent.st_uid == 0 and (not parent.st_mode & 0o022 or parent.st_mode & stat.S_ISVTX))
    fd = os.open(path, os.O_RDWR | os.O_CREAT | NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and not info.st_mode & 0o007, 'Untrusted lock')
        if info.st_mode & 0o070:
            require(shared and info.st_gid == grp.getgrnam('dg-build').gr_gid and not info.st_mode & 0o011)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise LockBusy('Protected deployment lock occupied') from None
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextlib.contextmanager
def deployment_locks(global_path=GLOBAL_LOCK, site_path=SITE_LOCK):
    global_fd = open_lock(global_path, shared=True)
    site_fd = None
    try:
        site_fd = open_lock(site_path)
        yield (global_fd, site_fd)
    finally:
        if site_fd is not None:
            os.close(site_fd)
        os.close(global_fd)


def guardian_state(unit):
    result = subprocess.run(['/usr/bin/systemctl', 'show', unit, '--property=ActiveState,SubState', '--value'],
        env=CLEAN_ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, check=False)
    require(len(result.stdout) <= 256)
    return set(result.stdout.decode().splitlines()) if result.returncode == 0 else set()


def start_guardian(lock_fds, run, policy):
    require(re.fullmatch(RUN_RE, run))
    trusted_path(GUARDIAN)
    require(file_digest(GUARDIAN) == policy['guardianSha256'])
    unit = GUARDIAN_PREFIX + run + '.service'
    start = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19]
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe', '--service-type=notify',
        '--unit=' + unit, '--uid=root', '--gid=root', '--property=NotifyAccess=main',
        '--property=TimeoutStartSec=10', '--property=TimeoutStopSec=infinity', '--property=KillMode=process',
        '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes',
        '--property=PrivateTmp=yes', '--property=CapabilityBoundingSet=', '--property=TasksMax=32',
        '--property=MemoryMax=64M', '--property=CPUQuota=10%', '/usr/bin/python3', '-I', str(GUARDIAN),
        run, str(os.getpid()), start]
    client = subprocess.Popen(args, stdin=lock_fds[0], stdout=lock_fds[1], stderr=subprocess.DEVNULL,
        env=CLEAN_ENV, close_fds=True)
    for _ in range(15):
        state = guardian_state(unit)
        if {'active', 'running'} <= state:
            return {'unit': unit, 'client': client}
        require('failed' not in state and client.poll() in [None, 0])
        time.sleep(1)
    raise Refused('Lock guardian did not become ready')


def finish_guardian(guardian):
    subprocess.run(['/usr/bin/systemctl', 'kill', '--kill-whom=main', '--signal=SIGUSR1', guardian['unit']],
        env=CLEAN_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False)
    for _ in range(20):
        state = guardian_state(guardian['unit'])
        if 'inactive' in state or (not state and guardian['client'].poll() == 0):
            try:
                guardian['client'].wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            return
        time.sleep(1)
    raise Refused('Guardian retains locks; inspect fixed build units before root recovery')


def github_gate(node, sha, run, token, policy):
    require(file_digest(GATE) == policy['gateSha256'])
    run_id, attempt = run.split('-')
    payload = {'repository': REPOSITORY, 'integrationBranch': 'main', 'sha': sha,
        'requiredChecks': [{'workflow': 'ci.yml', 'jobs': ['verify'], 'events': ['push', 'workflow_dispatch']}],
        'githubToken': token, 'deploymentRun': {'id': run_id, 'attempt': int(attempt)},
        'deploymentWorkflow': 'deploy-staging.yml'}
    result = subprocess.run([node, str(GATE), '--stdin'], input=json.dumps(payload).encode(),
        env=CLEAN_ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=90, check=True)
    require(len(result.stdout) <= 65536)
    evidence = json.loads(result.stdout, object_pairs_hook=unique_object)
    require(isinstance(evidence, dict) and evidence.get('status') == 'passed'
            and evidence.get('sha') == sha
            and evidence.get('deploymentRunUrl') == 'https://github.com/' + REPOSITORY + '/actions/runs/' + run_id
            and isinstance(evidence.get('ciRunUrl'), str)
            and re.fullmatch(r'https://github\.com/milobingo/platform/actions/runs/[1-9][0-9]*', evidence['ciRunUrl']))
    return evidence


def download_archive(sha, token, destination):
    require(re.fullmatch(SHA_RE, sha))
    target = 'https://api.github.com/repos/' + REPOSITORY + '/tarball/' + sha
    deadline = time.monotonic() + 120
    with destination.open('xb') as output:
        for redirect in range(4):
            url = urlsplit(target)
            require(url.scheme == 'https' and url.hostname in ['api.github.com', 'codeload.github.com']
                    and not url.username and not url.password and not url.port and not url.fragment)
            if url.hostname == 'codeload.github.com':
                require(url.path in ['/' + REPOSITORY + '/legacy.tar.gz/' + sha,
                        '/' + REPOSITORY + '/tar.gz/' + sha],
                        'GitHub source redirect changed identity')
                # GitHub issues a separate short-lived archive token for a
                # private repo. Forward only that bounded signed query to its
                # fixed codeload path, never the caller's API bearer token.
                query = parse_qs(url.query, keep_blank_values=True)
                require(not url.query or (set(query) == {'token'}
                        and len(query['token']) == 1 and 8 <= len(query['token'][0]) <= 4096
                        and re.fullmatch(r'[A-Za-z0-9_.-]+', query['token'][0])),
                        'Unexpected archive query')
            else:
                require(url.path == '/repos/' + REPOSITORY + '/tarball/' + sha and not url.query)
            connection = http.client.HTTPSConnection(url.hostname, timeout=10)
            try:
                headers = {'User-Agent': 'Milo-protected-release-v1', 'Accept': 'application/vnd.github+json'}
                if url.hostname == 'api.github.com':
                    headers['Authorization'] = 'Bearer ' + token
                connection.request('GET', url.path + ('?' + url.query if url.query else ''), headers=headers)
                response = connection.getresponse()
                if response.status in [301, 302, 307, 308]:
                    require(redirect < 3)
                    target = response.getheader('Location') or ''
                    require(len(target) <= 8192)
                    continue
                require(response.status == 200, 'Exact GitHub source unavailable')
                size = 0
                while True:
                    require(time.monotonic() <= deadline)
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    require(size <= 1024 ** 3, 'Source archive exceeds one GiB')
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
                require(size > 0)
                return
            finally:
                connection.close()
        raise Refused('Too many source redirects')


def build_command(argv, work, profile, run, stage, stdin=None):
    require(stage in ['extract', 'version-node', 'version-pnpm', 'install', 'build'])
    require(len(BUILD_LOCK_FDS) == 2 and all(fd >= 3 for fd in BUILD_LOCK_FDS))
    if stage == 'extract':
        argv = ['/usr/bin/python3', '-I', str(EXTRACTOR), str(1024 ** 3), '100000']
    path = f"{Path(profile['node']).parent}:{Path(profile['pnpm']).parent}:/usr/bin:/bin"
    env = {'PATH': path, 'HOME': str(work / 'home'), 'TMPDIR': str(work / 'tmp'),
        'LANG': 'C.UTF-8', 'CI': 'true', 'NEXT_TELEMETRY_DISABLED': '1'}
    unit = BUILD_PREFIX + run + '-' + stage
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe', '--service-type=exec',
        '--unit=' + unit, '--uid=' + BUILDER, '--gid=' + BUILDER,
        '--working-directory=' + str(work / 'source'), '--property=KillMode=control-group',
        '--property=RuntimeMaxSec=1800', '--property=TimeoutStopSec=10', '--property=UMask=0077',
        '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes',
        '--property=PrivateTmp=yes', '--property=ProtectProc=invisible', '--property=RestrictSUIDSGID=yes',
        '--property=CapabilityBoundingSet=', '--property=TasksMax=256', '--property=MemoryMax=3G',
        '--property=CPUQuota=100%', '--property=InaccessiblePaths=/etc/dg-sites /srv/sites /home/' + RUNNER,
        '--property=ReadWritePaths=' + str(work), '/usr/bin/env', '-i',
        *[key + '=' + value for key, value in env.items()], *argv]
    print(json.dumps({'site': SITE, 'buildStage': stage, 'isolatedUser': BUILDER}), flush=True)
    try:
        subprocess.run(args, env=CLEAN_ENV, stdin=stdin, check=True, timeout=1840, pass_fds=BUILD_LOCK_FDS)
    finally:
        subprocess.run(['/usr/bin/systemctl', 'stop', unit + '.service'], env=CLEAN_ENV,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
        stopped = subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', unit + '.service'],
            env=CLEAN_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
        require(stopped.returncode in [3, 4], 'Build cgroup stop could not be confirmed')


def service(action):
    require(action in ['restart', 'stop'] and len(BUILD_LOCK_FDS) == 2)
    subprocess.run(['/usr/bin/systemctl', action, SERVICE], env=CLEAN_ENV,
        check=True, timeout=45, pass_fds=BUILD_LOCK_FDS)


def runtime_audit(legacy, root, name, profile, run):
    """Run candidate read-only checks as the app; PID1 reads the private envfile.

    Only the protected file path appears in process arguments. Repository code
    cannot run with root privilege, and the build/runner never receives these
    runtime credentials. The audit source is part of the CI-approved artifact.
    """
    require(len(BUILD_LOCK_FDS) == 2)
    candidate = root / 'releases' / name / '.next' / 'standalone'
    audit = candidate / '.milo' / 'runtime-audit.mjs'
    tables = candidate / '.milo' / 'schema-tables.json'
    for path in [audit, tables]:
        trusted_path(path)
        require(path.stat().st_nlink == 1 and not path.stat().st_mode & 0o022)
    runtime = legacy.RUNTIME_ROOT / (name + '.env')
    trusted_path(runtime)
    require(not runtime.stat().st_mode & 0o077 and runtime.stat().st_nlink == 1)
    unit = BUILD_PREFIX + run + '-runtime-audit'
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe', '--service-type=exec',
        '--unit=' + unit, '--uid=' + APP, '--gid=' + APP, '--working-directory=' + str(candidate),
        '--property=EnvironmentFile=' + str(runtime), '--property=KillMode=control-group',
        '--property=RuntimeMaxSec=180', '--property=TimeoutStopSec=10', '--property=UMask=0077',
        '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes',
        '--property=PrivateTmp=yes', '--property=ProtectProc=invisible', '--property=RestrictSUIDSGID=yes',
        '--property=CapabilityBoundingSet=', '--property=TasksMax=64', '--property=MemoryMax=512M',
        '--property=CPUQuota=50%', profile['node'], str(audit)]
    try:
        subprocess.run(args, env=CLEAN_ENV, check=True, timeout=210, pass_fds=BUILD_LOCK_FDS)
    finally:
        subprocess.run(['/usr/bin/systemctl', 'stop', unit + '.service'], env=CLEAN_ENV,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
        stopped = subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', unit + '.service'],
            env=CLEAN_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
        require(stopped.returncode in [3, 4], 'Read-only app audit stop could not be confirmed')


def deploy_release(legacy, profile, policy, sha, run, config_id, token):
    bundle = read_bundle(config_id, sha, run, legacy, policy)
    evidence = github_gate(profile['node'], sha, run, token, policy)
    original_activate = legacy.activate
    original_metadata = legacy.metadata

    def metadata(root, name):
        value = original_metadata(root, name)
        marker = root / 'releases' / name / '.protected.json'
        if marker.exists() or marker.is_symlink():
            info = read_json(marker, 16384)
            require(isinstance(info, dict) and set(info) == {'format', 'configId', 'bundleSha256',
                    'runtimeSha256', 'brokerSha256', 'ciRunUrl'})
            require(info['format'] == 1 and info['configId'] == value['configVersion'])
            require(all(isinstance(info[k], str) and re.fullmatch('[a-f0-9]{64}', info[k])
                    for k in ['bundleSha256', 'runtimeSha256', 'brokerSha256']))
            saved = read_bundle(info['configId'], value['sha'], value['id'], legacy, policy)
            require(saved['sha256'] == info['bundleSha256'], 'Immutable configuration changed')
            runtime_path = legacy.RUNTIME_ROOT / (name + '.env')
            trusted_path(runtime_path)
            require(not runtime_path.stat().st_mode & 0o077 and runtime_path.stat().st_nlink == 1)
            link = root / 'releases' / name / '.runtime.env'
            require(link.is_symlink() and link.lstat().st_uid == os.geteuid()
                    and os.readlink(link) == str(runtime_path))
            require(file_digest(runtime_path) == info['runtimeSha256'], 'Sealed runtime changed')
            require(runtime_path.read_text() == legacy.env_file(saved['runtime']),
                    'Sealed runtime differs from immutable bundle')
        return value

    def activate(root, name):
        marker = {'format': 1, 'configId': config_id, 'bundleSha256': bundle['sha256'],
            'runtimeSha256': file_digest(legacy.RUNTIME_ROOT / (name + '.env')),
            'brokerSha256': file_digest(__file__), 'ciRunUrl': evidence['ciRunUrl']}
        legacy.private_file(root / 'releases' / name / '.protected.json', json.dumps(marker) + '\n')
        runtime_audit(legacy, root, name, profile, run)
        return original_activate(root, name, operate=service)

    legacy.runner_archive = lambda source_sha, destination, _runner: download_archive(source_sha, token, destination)
    legacy.build_command = build_command
    legacy.metadata = metadata
    legacy.activate = activate
    legacy.deploy(sha, run, bundle['runtime'], profile,
        pwd.getpwnam(RUNNER), pwd.getpwnam(BUILDER), pwd.getpwnam(APP))
    return {'status': 'passed', 'operation': 'deploy', 'site': SITE, 'sha': sha,
        'releaseId': run, 'configId': config_id, 'ciRunUrl': evidence['ciRunUrl'],
        'runtimeValuesPrinted': False, 'buildRuntimeCredentials': False}


def main():
    global BUILD_LOCK_FDS
    args = arguments(sys.argv[1:])
    require(os.geteuid() == 0 and socket.gethostname() == HOST)
    policy = read_policy()
    runner = pwd.getpwnam(RUNNER)
    require(os.environ.get('SUDO_USER') == RUNNER
            and os.environ.get('SUDO_UID') == str(runner.pw_uid)
            and os.environ.get('SUDO_GID') == str(runner.pw_gid))
    body = request_body(sys.stdin.buffer)
    legacy = load_legacy(policy)
    profile = legacy.read_profile()
    require(profile['port'] == PORT)
    with deployment_locks() as lock_fds:
        BUILD_LOCK_FDS = lock_fds
        guardian = start_guardian(lock_fds, args[2], policy)
        try:
            result = deploy_release(legacy, profile, policy, args[1], args[2], args[3], body['githubToken'])
        finally:
            finish_guardian(guardian)
        print(json.dumps(result, sort_keys=True))


def interrupted(_signal, _frame):
    raise Refused('Operation interrupted')


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    os.umask(0o077)
    for signum in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
        signal.signal(signum, interrupted)
    try:
        main()
    except LockBusy:
        print('Milo deployment lock occupied; retry only exit 75 after bounded delay.', file=sys.stderr)
        sys.exit(75)
    except Exception:
        print('Milo protected deployment refused or failed; no runtime credential values logged.', file=sys.stderr)
        sys.exit(1)
