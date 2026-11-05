#!/usr/bin/python3 -I
"""Bounded Milo-only privileged deploy helper v1. Never executes repo code as root."""
import base64
import fcntl
import grp
import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import re
import resource
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, unquote, urlsplit

SITE = 'milobingo-staging'
WORKSPACE = '/home/run-mil-stg/_work/platform/platform'
SITE_ROOT = Path('/srv/sites/milobingo-staging')
BUILD_ROOT = Path('/var/lib/dg-build/milobingo-staging')
PROFILE = Path('/etc/dg-sites/milobingo-staging.deploy.json')
RUNTIME_ROOT = Path('/etc/dg-sites/milobingo-staging.runtime.d')
SERVICE = 'milobingo-staging.service'
RUNTIME_KEYS = ('NODE_ENV', 'HOSTNAME', 'APP_URL', 'MILO_LOCAL_AUTH', 'PORT',
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_STORAGE_BUCKET',
    'SUPABASE_DB_CA_BASE64', 'DATABASE_URL', 'SUPABASE_SECRET_KEY',
    'VLAMPIE_SETTINGS_KEY', 'OPENAI_TEXT_MODEL', 'OPENAI_SPEECH_MODEL',
    'OPENAI_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET',
    'RELEASE_SHA', 'RELEASE_ID', 'CONFIG_VERSION')
FREE_BYTES, FREE_INODES = 4 * 1024 ** 3, 50000
NOFOLLOW = os.O_NOFOLLOW | os.O_CLOEXEC
DIRECTORY = NOFOLLOW | os.O_DIRECTORY | os.O_RDONLY
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def arguments(values):
    require(len(values) == 4, 'Expected four deployment arguments')
    site, workspace, sha, run = values
    require(site == SITE and workspace == WORKSPACE, 'Wrong fixed site or workspace')
    require(bool(re.fullmatch('[a-f0-9]{40}', sha)), 'Invalid release SHA')
    require(bool(re.fullmatch('[1-9][0-9]{0,19}-[1-9][0-9]{0,9}', run)), 'Invalid release ID')
    return sha, run


def trusted_path(path, directory=False):
    path = Path(path)
    require(path.is_absolute(), 'Trusted path must be absolute')
    for component in [*reversed(path.parents), path]:
        item = component.lstat()
        require(item.st_uid == 0 and not item.st_mode & 0o022
                and not stat.S_ISLNK(item.st_mode), 'Unsafe root-owned path')
    require(path.is_dir() if directory else path.is_file(), 'Wrong trusted file type')
    return path


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def read_profile():
    path = trusted_path(PROFILE)
    require(path.stat().st_mode & 0o077 == 0, 'Profile must be root-only')
    profile = json.loads(path.read_text(), object_pairs_hook=unique_object)
    require(set(profile) == {'node', 'pnpm', 'port'}, 'Unknown deployment profile field')
    require(type(profile['port']) is int and 1024 <= profile['port'] <= 65535, 'Invalid chosen port')
    for key in ['node', 'pnpm']:
        trusted_tool(profile[key])
        require(os.access(profile[key], os.X_OK), 'Toolchain executable missing')
    return profile


def trusted_tool(value):
    """Allow installed tool symlinks only when every traversed component is trusted."""
    require(isinstance(value, str) and value.startswith('/'), 'Invalid tool path')
    pending, resolved, links = value.split('/')[1:], [], 0
    while pending:
        part = pending.pop(0)
        if part in ['', '.']:
            continue
        if part == '..':
            require(bool(resolved), 'Tool path escapes root')
            resolved.pop()
            continue
        path = Path('/').joinpath(*resolved, part)
        item = path.lstat()
        require(item.st_uid == 0, 'Tool path is not root-owned')
        if stat.S_ISLNK(item.st_mode):
            links += 1
            require(links <= 40, 'Tool symlink cycle')
            target = os.readlink(path)
            if target.startswith('/'):
                resolved = []
            pending = target.split('/') + pending
        else:
            require(not item.st_mode & 0o022, 'Writable tool path')
            require(not pending or stat.S_ISDIR(item.st_mode), 'Invalid tool directory')
            resolved.append(part)
    require(stat.S_ISREG(Path('/').joinpath(*resolved).stat().st_mode), 'Invalid tool executable')


def runtime_values(values, sha, run, port):
    require(isinstance(values, dict) and set(values) <= set(RUNTIME_KEYS), 'Unknown runtime key')
    require(all(isinstance(v, str) and len(v) <= (87384 if k == 'SUPABASE_DB_CA_BASE64' else 32768) and
                all(ord(c) >= 32 and ord(c) != 127 for c in v) for k, v in values.items()),
            'Runtime values must be bounded single lines')
    forced = {'NODE_ENV': 'production', 'HOSTNAME': '127.0.0.1', 'MILO_LOCAL_AUTH': 'false',
              'PORT': str(port), 'RELEASE_SHA': sha, 'RELEASE_ID': run}
    require(all(values.get(k) == v for k, v in forced.items()), 'Runtime release boundary differs')
    require(values.get('APP_URL') == 'https://milo-staging.dgwebservices.nl'
            and values.get('SUPABASE_URL') == 'https://lfsdgxcpdyghidzkzzvn.supabase.co'
            and values.get('SUPABASE_STORAGE_BUCKET') == 'milo-staging', 'Wrong staging project')
    require(bool(re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}', values.get('CONFIG_VERSION', ''))),
            'Invalid configuration version')
    require(values.get('SUPABASE_PUBLISHABLE_KEY', '').startswith('sb_publishable_') and
            values.get('SUPABASE_SECRET_KEY', '').startswith('sb_secret_') and
            bool(re.fullmatch('[a-fA-F0-9]{64}', values.get('VLAMPIE_SETTINGS_KEY', ''))),
            'Invalid runtime key types')
    database = urlsplit(values.get('DATABASE_URL', ''))
    ref = 'lfsdgxcpdyghidzkzzvn'
    require(database.scheme in ['postgres', 'postgresql'] and database.username and database.password
            and database.path not in ['', '/'] and not database.fragment, 'Incomplete database URL')
    require(not database.port or 1 <= database.port <= 65535, 'Invalid database port')
    require(database.hostname == f'db.{ref}.supabase.co' or
            (database.hostname and database.hostname.endswith('.pooler.supabase.com')
             and unquote(database.username).endswith('.' + ref)), 'Wrong database project')
    params = parse_qs(database.query, keep_blank_values=True)
    authority = {'host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname', 'service', 'servicefile'}
    require(not any(k.lower() in authority for k in params), 'Database authority query override')
    require(params.get('sslmode') == ['verify-full'] and not any(
        (k.lower().startswith('ssl') or k.lower() == 'uselibpqcompat') and k != 'sslmode'
        for k in params), 'Database TLS verification override')
    certificate = base64.b64decode(values.get('SUPABASE_DB_CA_BASE64', ''), validate=True).decode('ascii')
    pattern = r'-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----'
    require(len(certificate) <= 65536 and 1 <= len(re.findall(pattern, certificate)) <= 10 and
            not re.sub(pattern, '', certificate).strip(), 'Invalid public database CA material')
    certificates = ssl.create_default_context(cadata=certificate).get_ca_certs()
    require(len(certificates) == len(re.findall(pattern, certificate)) and all(
        ssl.cert_time_to_seconds(cert['notBefore']) <= time.time() < ssl.cert_time_to_seconds(cert['notAfter'])
        for cert in certificates), 'Database trust material must contain current CA certificates')
    live = [values.get(k, '') for k in ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']]
    require(not any(live) or all(live), 'Incomplete LiveKit environment')
    if any(live):
        url = urlsplit(live[0])
        require(url.scheme == 'wss' and url.hostname and url.hostname.endswith('.livekit.cloud')
                and not url.username and not url.password and not url.port and url.path in ['', '/']
                and not url.query and not url.fragment, 'Invalid LiveKit origin')
    return {key: values[key] for key in RUNTIME_KEYS if values.get(key, '') != ''}


def capacity(path, extra_bytes=0, extra_inodes=0):
    disk = os.statvfs(path)
    require(disk.f_bavail * disk.f_frsize >= FREE_BYTES + extra_bytes
            and disk.f_favail >= FREE_INODES + extra_inodes, 'Insufficient bytes or inodes')


def open_directory(root_fd, parts):
    fd = os.dup(root_fd)
    try:
        for part in parts:
            require(part not in ['', '.', '..'] and '/' not in part, 'Unsafe directory component')
            child = os.open(part, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def safe_link(root_fd, parent_parts, target):
    """Resolve every link relative to held directory descriptors, never outside root."""
    require(target and not target.startswith('/'), 'Absolute or empty artifact link')
    pending, resolved, links = list(parent_parts) + target.split('/'), [], 0
    while pending:
        part = pending.pop(0)
        if part in ['', '.']:
            continue
        if part == '..':
            require(bool(resolved), 'Artifact link escapes release')
            resolved.pop()
            continue
        fd = open_directory(root_fd, resolved)
        try:
            item = os.stat(part, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISLNK(item.st_mode):
                links += 1
                require(links <= 40, 'Artifact link cycle')
                link = os.readlink(part, dir_fd=fd)
                require(not link.startswith('/'), 'Artifact link escapes release')
                pending = link.split('/') + pending
            else:
                require(not pending or stat.S_ISDIR(item.st_mode), 'Artifact link traverses a file')
                require(stat.S_ISDIR(item.st_mode) or stat.S_ISREG(item.st_mode), 'Artifact link targets special file')
                resolved.append(part)
        finally:
            os.close(fd)


def copy_tree(source_fd, destination_fd, app_gid, root_fd=None, parts=(), budget=None):
    """Seal only regular files/directories and safe internal relative links."""
    root_fd = source_fd if root_fd is None else root_fd
    budget = {'bytes': 0, 'files': 0, 'digest': hashlib.sha256()} if budget is None else budget
    for name in sorted(os.listdir(source_fd)):
        require(not name.startswith('.env'), 'Environment files cannot enter an artifact')
        item = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        budget['files'] += 1
        require(budget['files'] <= 250000, 'Artifact contains too many files')
        if stat.S_ISDIR(item.st_mode):
            budget['digest'].update(json.dumps(['directory', *parts, name]).encode() + b'\0')
            child = os.open(name, DIRECTORY, dir_fd=source_fd)
            os.mkdir(name, 0o750, dir_fd=destination_fd)
            target = os.open(name, DIRECTORY, dir_fd=destination_fd)
            try:
                require(os.fstat(child).st_ino == item.st_ino, 'Artifact directory changed')
                copy_tree(child, target, app_gid, root_fd, (*parts, name), budget)
                os.fchown(target, 0, app_gid)
                os.fchmod(target, 0o550)
            finally:
                os.close(child)
                os.close(target)
        elif stat.S_ISREG(item.st_mode):
            require(item.st_nlink == 1, 'Hardlinked artifact file')
            budget['bytes'] += item.st_size
            require(budget['bytes'] <= 8 * 1024 ** 3, 'Artifact is too large')
            budget['digest'].update(json.dumps(['file', *parts, name, item.st_size, bool(item.st_mode & 0o111)]).encode() + b'\0')
            source = os.open(name, os.O_RDONLY | NOFOLLOW, dir_fd=source_fd)
            target = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600, dir_fd=destination_fd)
            try:
                before = os.fstat(source)
                require((before.st_dev, before.st_ino, before.st_nlink) ==
                        (item.st_dev, item.st_ino, 1), 'Artifact file changed')
                remaining = item.st_size
                while remaining:
                    block = os.read(source, min(1024 * 1024, remaining))
                    require(bool(block), 'Artifact file truncated')
                    budget['digest'].update(block)
                    view = memoryview(block)
                    while view:
                        view = view[os.write(target, view):]
                    remaining -= len(block)
                after = os.fstat(source)
                require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                        (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Artifact file changed during sealing')
                os.fchown(target, 0, app_gid)
                os.fchmod(target, 0o550 if item.st_mode & 0o111 else 0o440)
                os.fsync(target)
            finally:
                os.close(source)
                os.close(target)
        elif stat.S_ISLNK(item.st_mode):
            link = os.readlink(name, dir_fd=source_fd)
            safe_link(root_fd, parts, link)
            budget['digest'].update(json.dumps(['symlink', *parts, name, link]).encode() + b'\0')
            os.symlink(link, name, dir_fd=destination_fd)
            os.chown(name, 0, app_gid, dir_fd=destination_fd, follow_symlinks=False)
        else:
            raise ValueError('Special artifact file refused')
    os.fsync(destination_fd)
    return budget


def artifact_size(source_fd):
    size, count = 0, 0
    for name in os.listdir(source_fd):
        item = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        count += 1
        if stat.S_ISDIR(item.st_mode):
            child = os.open(name, DIRECTORY, dir_fd=source_fd)
            try:
                child_size, child_count = artifact_size(child)
                size, count = size + child_size, count + child_count
            finally:
                os.close(child)
        elif stat.S_ISREG(item.st_mode):
            size += item.st_size
        require(size <= 8 * 1024 ** 3 and count <= 250000, 'Artifact exceeds resource bounds')
    return size, count


def command(argv, **options):
    return subprocess.run(argv, env=CLEAN_ENV, check=True, **options)


def runner_archive(sha, destination, runner):
    clean = dict(CLEAN_ENV, HOME='/nonexistent', GIT_CONFIG_NOSYSTEM='1',
                 GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_SYSTEM='/dev/null')
    args = dict(env=clean, user=runner.pw_uid, group=runner.pw_gid, extra_groups=[],
                cwd=WORKSPACE, stderr=subprocess.DEVNULL, timeout=120)
    head = subprocess.check_output(['/usr/bin/git', 'rev-parse', '--verify', 'HEAD'], **args).decode().strip()
    require(head == sha, 'Checkout HEAD differs from approved SHA')
    with destination.open('xb') as archive:
        subprocess.run(['/usr/bin/git', 'archive', '--format=tar', sha], stdout=archive,
            preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 ** 3,) * 2), check=True, **args)


def build_command(argv, work, profile, run, stage, stdin=None):
    print(json.dumps({'site': SITE, 'buildStage': stage, 'isolatedUser': 'build-mil-stg'}), flush=True)
    path = f"{Path(profile['node']).parent}:{Path(profile['pnpm']).parent}:/usr/bin:/bin"
    command(['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe', '--service-type=exec',
        f'--unit=dg-milobingo-build-{run}-{stage}', '--uid=build-mil-stg', '--gid=build-mil-stg',
        f'--working-directory={work / "source"}', '--property=KillMode=control-group',
        '--property=RuntimeMaxSec=1800', '--property=TimeoutStopSec=10', '--property=UMask=0077',
        '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes',
        '--property=PrivateTmp=yes', '--property=RestrictSUIDSGID=yes', '--property=CapabilityBoundingSet=',
        f'--property=ReadWritePaths={work}', '/usr/bin/env', '-i', f'PATH={path}',
        f'HOME={work / "home"}', f'TMPDIR={work / "tmp"}', 'LANG=C.UTF-8', 'CI=true',
        'NEXT_TELEMETRY_DISABLED=1', *argv], stdin=stdin, timeout=1840)


EXTRACT = '''import sys,tarfile
with tarfile.open(fileobj=sys.stdin.buffer,mode="r|*") as archive:
 for entry in archive:
  if entry.islnk() or entry.isdev() or entry.isfifo(): raise ValueError("Unsafe source archive member")
  archive.extract(entry,path=".",filter="data")
'''


def metadata(root, name):
    require(bool(re.fullmatch('[a-f0-9]{12}-[1-9][0-9]{0,19}-[1-9][0-9]{0,9}', name)), 'Unknown release target')
    path = root / 'releases' / name
    require(path.is_dir() and not path.is_symlink(), 'Unknown release directory')
    info = (path / '.release.json').lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
            and not info.st_mode & 0o077 and info.st_size <= 16384, 'Unsafe release metadata')
    result = json.loads((path / '.release.json').read_text(), object_pairs_hook=unique_object)
    require(set(result) == {'version', 'sha', 'id', 'configVersion', 'port', 'artifactSha256', 'helperSha256', 'toolchain'}
            and result['version'] == 1 and bool(re.fullmatch('[a-f0-9]{40}', result['sha']))
            and bool(re.fullmatch('[1-9][0-9]{0,19}-[1-9][0-9]{0,9}', result['id']))
            and bool(re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}', result['configVersion']))
            and type(result['port']) is int and 1024 <= result['port'] <= 65535
            and all(bool(re.fullmatch('[a-f0-9]{64}', result[key])) for key in ['artifactSha256', 'helperSha256']),
            'Incomplete release evidence')
    require(name == result['sha'][:12] + '-' + result['id'], 'Release metadata differs')
    tools = result['toolchain']
    require(isinstance(tools, dict) and set(tools) == {'node', 'pnpm', 'nodeSha256', 'pnpmSha256'}
            and tools['node'] == '24.18.0' and tools['pnpm'] == '11.25.0'
            and all(bool(re.fullmatch('[a-f0-9]{64}', tools[key])) for key in ['nodeSha256', 'pnpmSha256']),
            'Incomplete toolchain evidence')
    return result


def health(meta):
    connection = http.client.HTTPConnection('127.0.0.1', meta['port'], timeout=2)
    try:
        connection.request('GET', '/api/health', headers={'Host': 'milo-staging.dgwebservices.nl'})
        response = connection.getresponse()
        body = response.read(65537)
        if response.status != 200 or len(body) > 65536:
            return False
        data = json.loads(body)
        return (data.get('status'), data.get('revision'), data.get('releaseId'), data.get('configVersion')) == (
            'ok', meta['sha'], meta['id'], meta['configVersion'])
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def service(action):
    require(action in ['restart', 'stop'], 'Invalid fixed service operation')
    command(['/usr/bin/systemctl', action, SERVICE], timeout=45)


def point_current(root, name):
    temporary = root / '.current-next'
    require(not temporary.exists() and not temporary.is_symlink(), 'Stale activation transaction')
    os.symlink('releases/' + name, temporary)
    os.replace(temporary, root / 'current')
    fd = os.open(root, DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def activate(root, name, check=health, operate=service, attempts=20, pause=time.sleep):
    next_meta = metadata(root, name)
    previous = None
    current = root / 'current'
    if current.is_symlink():
        target = os.readlink(current)
        require(target.startswith('releases/') and target.count('/') == 1, 'Unsafe current target')
        previous = target.split('/')[1]
    else:
        require(not current.exists(), 'Current must be an atomic release symlink')
    previous_meta = metadata(root, previous) if previous else None
    previous_healthy = previous_meta is not None and check(previous_meta)
    def ready(meta):
        for attempt in range(attempts):
            if check(meta):
                return True
            if attempt + 1 < attempts:
                pause(1)
        return False
    point_current(root, name)
    try:
        operate('restart')
        require(ready(next_meta), 'New release health did not match')
    except Exception as failure:
        if previous_healthy:
            point_current(root, previous)
            try:
                operate('restart')
                require(ready(previous_meta), 'Rollback health did not match')
            except Exception:
                operate('stop')
                raise ValueError('Deployment and rollback failed; Milo service stopped') from failure
            raise ValueError('Deployment failed; prior healthy Milo release restored') from failure
        operate('stop')
        current.unlink()
        raise ValueError('Deployment failed without healthy prior release; Milo service stopped') from failure


def env_file(values):
    return ''.join(key + '="' + value.replace('\\', '\\\\').replace('"', '\\"') + '"\n'
                   for key, value in values.items())


def private_file(path, body):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink()
        raise


def file_digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def deploy(sha, run, values, profile, runner, build, app):
    trusted_path(SITE_ROOT, directory=True)
    trusted_path(SITE_ROOT / 'releases', directory=True)
    trusted_path(BUILD_ROOT, directory=True)
    trusted_path(RUNTIME_ROOT, directory=True)
    require(RUNTIME_ROOT.stat().st_mode & 0o077 == 0, 'Runtime directory must be root-only')
    require(SITE_ROOT.stat().st_gid == app.pw_gid, 'Wrong app group on site')
    require(BUILD_ROOT.stat().st_gid == build.pw_gid and BUILD_ROOT.stat().st_mode & 0o007 == 0,
            'Wrong isolated build root')
    for location in [SITE_ROOT, BUILD_ROOT]:
        capacity(location)
    name = sha[:12] + '-' + run
    release = SITE_ROOT / 'releases' / name
    require(not release.exists() and not release.is_symlink(), 'Release already exists')
    work = Path(tempfile.mkdtemp(prefix=run + '-', dir=BUILD_ROOT))
    os.chown(work, build.pw_uid, build.pw_gid)
    archive = BUILD_ROOT / ('.archive-' + run + '.tar')
    pending = SITE_ROOT / 'releases' / ('.pending-' + name)
    runtime_path = RUNTIME_ROOT / (name + '.env')
    runtime_created = False
    try:
        for directory in ['source', 'home', 'tmp']:
            (work / directory).mkdir(mode=0o700)
            os.chown(work / directory, build.pw_uid, build.pw_gid)
        runner_archive(sha, archive, runner)
        with archive.open('rb') as stream:
            build_command(['/usr/bin/python3', '-I', '-c', EXTRACT], work, profile, run, 'extract', stream)
        require(not any(p.name != '.env.example' for p in (work / 'source').glob('.env*')),
                'Source contains root environment file')
        # Version output is captured separately inside the isolated build account.
        version_check = 'import subprocess,sys;sys.exit(0 if subprocess.check_output(sys.argv[1:3]).decode().strip()==sys.argv[3] else 1)'
        for tool, expected in [(profile['node'], 'v24.18.0'), (profile['pnpm'], '11.25.0')]:
            build_command(['/usr/bin/python3', '-I', '-c', version_check, tool, '--version', expected],
                          work, profile, run, 'version-' + ('node' if tool == profile['node'] else 'pnpm'))
        build_command([profile['pnpm'], 'install', '--frozen-lockfile'], work, profile, run, 'install')
        build_command([profile['pnpm'], 'build'], work, profile, run, 'build')
        # systemd has stopped the build cgroup, including lifecycle background processes.
        source_root = os.open(work / 'source', DIRECTORY)
        source_fd = open_directory(source_root, ['.next', 'standalone'])
        os.close(source_root)
        try:
            total_bytes, total_files = artifact_size(source_fd)
            capacity(SITE_ROOT, total_bytes, total_files)
            pending.mkdir(mode=0o750)
            (pending / '.next').mkdir(mode=0o750)
            (pending / '.next' / 'standalone').mkdir(mode=0o750)
            destination_fd = os.open(pending / '.next' / 'standalone', DIRECTORY)
            try:
                artifact = copy_tree(source_fd, destination_fd, app.pw_gid)
                os.fchown(destination_fd, 0, app.pw_gid)
                os.fchmod(destination_fd, 0o550)
            finally:
                os.close(destination_fd)
        finally:
            os.close(source_fd)
        require((pending / '.next' / 'standalone' / 'server.js').is_file()
                and (pending / '.next' / 'standalone' / 'drizzle').is_dir()
                and (pending / '.next' / 'standalone' / 'public').is_dir()
                and (pending / '.next' / 'standalone' / '.next' / 'static').is_dir(), 'Incomplete standalone contract')
        private_file(runtime_path, env_file(values))
        runtime_created = True
        (pending / '.runtime.env').symlink_to(runtime_path)
        meta = {'version': 1, 'sha': sha, 'id': run, 'configVersion': values['CONFIG_VERSION'], 'port': profile['port'],
                'artifactSha256': artifact['digest'].hexdigest(), 'helperSha256': file_digest(__file__),
                'toolchain': {'node': '24.18.0', 'pnpm': '11.25.0',
                    'nodeSha256': file_digest(profile['node']), 'pnpmSha256': file_digest(profile['pnpm'])}}
        private_file(pending / '.release.json', json.dumps(meta) + '\n')
        for directory in [pending / '.next', pending]:
            os.chown(directory, 0, app.pw_gid)
            directory.chmod(0o550)
        os.rename(pending, release)
        activate(SITE_ROOT, name)
        # Intentionally retain all known releases, including at least two once available.
        print(json.dumps({'deployment': 'passed', 'version': 1, 'site': SITE, 'sha': sha, 'releaseId': run}))
    finally:
        archive.unlink(missing_ok=True)
        shutil.rmtree(work)
        if pending.exists():
            shutil.rmtree(pending)
        if runtime_created and not release.exists():
            runtime_path.unlink()


def main():
    sha, run = arguments(sys.argv[1:])
    require(os.geteuid() == 0 and socket.gethostname() == 'dg-nxttrack-01', 'Wrong root helper host')
    runner, build, app = [pwd.getpwnam(name) for name in ['run-mil-stg', 'build-mil-stg', 'app-mil-stg']]
    require(len({0, runner.pw_uid, build.pw_uid, app.pw_uid}) == 4, 'Build, runner and app UIDs must differ')
    require(len({runner.pw_gid, build.pw_gid, app.pw_gid}) == 3
            and set(os.getgrouplist(build.pw_name, build.pw_gid)) == {build.pw_gid},
            'Build account must have a separate group without supplemental memberships')
    require(os.environ.get('SUDO_USER') == runner.pw_name and
            os.environ.get('SUDO_UID') == str(runner.pw_uid) and
            os.environ.get('SUDO_GID') == str(runner.pw_gid), 'Wrong sudo caller')
    profile = read_profile()
    body = sys.stdin.buffer.read(262145)
    require(len(body) <= 262144, 'Runtime payload exceeds limit')
    values = runtime_values(json.loads(body, object_pairs_hook=unique_object), sha, run, profile['port'])
    lock = os.open('/run/lock/dg-build.lock', os.O_RDWR | os.O_CREAT | NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        parent = Path('/run/lock').stat()
        require(parent.st_uid == 0 and (not parent.st_mode & 0o022 or parent.st_mode & stat.S_ISVTX),
                'Unsafe shared lock directory')
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and info.st_mode & 0o007 == 0 and
                (not info.st_mode & 0o070 or info.st_gid == grp.getgrnam('dg-build').gr_gid),
                'Unsafe shared build lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(sha, run, values, profile, runner, build, app)
    finally:
        os.close(lock)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception:
        print('Milo deployment refused or failed; no runtime secret values are logged.', file=sys.stderr)
        sys.exit(1)
