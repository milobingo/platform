#!/usr/bin/python3 -I
"""One-time, source-only Milo bootstrap installer; consumes bounded JSON stdin.

No repository imports, runtime configuration reads, service actions or Caddy edits.
Caller must review these bytes and the exact CI-approved source payload first.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import subprocess
import sys
import tempfile

HOST = 'dg-nxttrack-01'
LEGACY = Path('/usr/local/libexec/dg-milobingo-deploy-helper')
LEGACY_SHA = 'ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8'
SITE = Path('/etc/dg-sites/milobingo-staging')
NEW_DIRECTORIES = (SITE, SITE / 'admin')
ACCOUNTS = {'run-mil-stg': {'uid': 1001, 'gid': 1002},
    'build-mil-stg': {'uid': 990, 'gid': 983}, 'app-mil-stg': {'uid': 996, 'gid': 987}}
MODES = {
    '/usr/local/bin/dg-milo-deploy': '0755',
    '/usr/local/libexec/dg-milo-deploy-helper': '0755',
    '/usr/local/libexec/milo-protected-release-gate.mjs': '0644',
    '/usr/local/libexec/milo-protected-extract-source.py': '0755',
    '/usr/local/libexec/milo-protected-lock-guardian.py': '0755',
    '/etc/dg-sites/milobingo-staging/protected-deploy.json': '0600',
    '/etc/sudoers.d/milobingo-protected-deploy': '0440',
    '/usr/local/libexec/dg-milo-seed-protected-runtime': '0755',
    '/usr/local/libexec/dg-milo-move-admin-secrets': '0755',
    '/etc/sudoers.d/milobingo-admin-handoff': '0440',
}
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
NOFOLLOW = os.O_NOFOLLOW | os.O_CLOEXEC
VISUDO = Path('/usr/sbin/visudo')


def require(value):
    if not value:
        raise ValueError('Fixed source installation boundary refused')


def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value)
        value[key] = item
    return value


def digest(body):
    return hashlib.sha256(body).hexdigest()


def trusted(path, directory=False):
    path = Path(path)
    require(path.is_absolute())
    for component in [*reversed(path.parents), path]:
        info = component.lstat()
        require(info.st_uid == 0 and info.st_gid == 0 and not info.st_mode & 0o022
                and not stat.S_ISLNK(info.st_mode))
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
    return info


def payload(stream):
    raw = stream.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024)
    value = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(value, dict) and set(value) == {'format', 'files'}
            and value['format'] == 'milo-protected-host-install-v1'
            and isinstance(value['files'], list) and len(value['files']) == len(MODES))
    files = {}
    for item in value['files']:
        require(isinstance(item, dict) and set(item) == {'path', 'sha256', 'mode', 'base64'})
        path = item['path']
        require(isinstance(path, str) and path in MODES and path not in files
                and item['mode'] == MODES[path] and isinstance(item['sha256'], str)
                and re.fullmatch('[a-f0-9]{64}', item['sha256'])
                and isinstance(item['base64'], str) and len(item['base64']) <= 400000)
        body = base64.b64decode(item['base64'], validate=True)
        require(0 < len(body) <= 262144 and digest(body) == item['sha256'])
        body.decode('utf-8')  # Reviewed source and public policy only, never binary/runtime files.
        files[path] = {'body': body, 'sha256': item['sha256'], 'mode': int(item['mode'], 8)}
    require(set(files) == set(MODES))
    validate_pins(files)
    return files


def validate_pins(files):
    helper = files['/usr/local/libexec/dg-milo-deploy-helper']['sha256']
    source = files['/usr/local/bin/dg-milo-deploy']['body'].decode()
    declarations = [line for line in source.splitlines() if re.match(r'^\s*HELPER_SHA256\b', line)]
    require(len(declarations) == 1 and re.fullmatch(r"HELPER_SHA256 = '" + helper + r"'(?:[ \t]+#[^\r\n]*)?", declarations[0]))
    policy = json.loads(files[str(SITE / 'protected-deploy.json')]['body'], object_pairs_hook=unique)
    require(isinstance(policy, dict) and set(policy) == {'version', 'allowedConfigIds',
        'legacySha256', 'gateSha256', 'extractorSha256', 'guardianSha256', 'accounts'}
        and type(policy['version']) is int and policy['version'] == 1
        and policy['legacySha256'] == LEGACY_SHA and policy['accounts'] == ACCOUNTS)
    ids = policy['allowedConfigIds']
    require(isinstance(ids, list) and 0 < len(ids) <= 1000
        and all(isinstance(item, str) and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,95}', item) for item in ids)
        and len(set(ids)) == len(ids))
    for key, path in [('gateSha256', '/usr/local/libexec/milo-protected-release-gate.mjs'),
            ('extractorSha256', '/usr/local/libexec/milo-protected-extract-source.py'),
            ('guardianSha256', '/usr/local/libexec/milo-protected-lock-guardian.py')]:
        require(policy[key] == files[path]['sha256'])
    normal = (f'run-mil-stg ALL=(root) NOPASSWD:NOSETENV: sha256:{helper} '
        '/usr/local/libexec/dg-milo-deploy-helper '
        '^deploy [a-f0-9]{40} [1-9][0-9]*-[1-9][0-9]* [A-Za-z0-9][A-Za-z0-9_.-]*$\n')
    handoff_sha = files['/usr/local/libexec/dg-milo-move-admin-secrets']['sha256']
    temporary = (f'run-mil-stg ALL=(root) NOPASSWD:NOSETENV: sha256:{handoff_sha} '
        '/usr/local/libexec/dg-milo-move-admin-secrets ""\n')
    require(files['/etc/sudoers.d/milobingo-protected-deploy']['body'].decode() == normal
        and files['/etc/sudoers.d/milobingo-admin-handoff']['body'].decode() == temporary)


def existing(path, expected):
    trusted(path.parent, directory=True)
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0
        and info.st_nlink == 1 and info.st_mode & 0o7777 == expected['mode']
        and info.st_size == len(expected['body']))
    fd = os.open(path, os.O_RDONLY | NOFOLLOW)
    try:
        current = os.fstat(fd)
        require((info.st_dev, info.st_ino) == (current.st_dev, current.st_ino))
        with os.fdopen(fd, 'rb', closefd=False) as reader:
            require(hashlib.file_digest(reader, 'sha256').hexdigest() == expected['sha256'])
    finally:
        os.close(fd)
    return (info.st_dev, info.st_ino)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def check_sudoers(path):
    subprocess.run([str(VISUDO), '-c', '-f', str(path)], env=CLEAN, stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=True)


def install(files):
    require(os.geteuid() == 0 and socket.gethostname() == HOST and len(sys.argv) == 1)
    for name, identity in ACCOUNTS.items():
        account = pwd.getpwnam(name)
        require((account.pw_uid, account.pw_gid) == (identity['uid'], identity['gid']))
    require(set(os.getgrouplist('build-mil-stg', ACCOUNTS['build-mil-stg']['gid']))
        == {ACCOUNTS['build-mil-stg']['gid']})
    trusted(LEGACY)
    require(LEGACY.lstat().st_nlink == 1 and digest(LEGACY.read_bytes()) == LEGACY_SHA)
    trusted(VISUDO)
    require(os.access(VISUDO, os.X_OK))
    trusted(Path('/etc/sudoers'))
    check_sudoers('/etc/sudoers')
    for path in MODES:
        parent = Path(path).parent
        if parent not in NEW_DIRECTORIES:
            trusted(parent, directory=True)
    created_dirs, staged, installed = [], {}, []
    completed = False
    try:
        for directory in NEW_DIRECTORIES:
            trusted(directory.parent, directory=True)
            try:
                directory.mkdir(mode=0o700)
                created_dirs.append(directory)
                os.chown(directory, 0, 0)
                sync_directory(directory.parent)
            except FileExistsError:
                pass
            info = trusted(directory, directory=True)
            require(info.st_mode & 0o7777 == 0o700)
        # Refuse every preexisting difference before staging or installing anything.
        present = {path: existing(Path(path), value) for path, value in files.items()}
        for path, value in files.items():
            if present[path] is not None:
                continue
            fd, temporary = tempfile.mkstemp(prefix='.milo-install-', dir=Path(path).parent)
            staged[path] = Path(temporary)
            try:
                os.fchown(fd, 0, 0)
                os.fchmod(fd, value['mode'])
                body = memoryview(value['body'])
                while body:
                    body = body[os.write(fd, body):]
                os.fsync(fd)
            finally:
                os.close(fd)
        # Parse the entire current configuration plus BOTH proposed policy files
        # before any new policy can become active. Hidden temp names are ignored
        # by @includedir and are referenced explicitly by this private wrapper.
        fd, wrapper_name = tempfile.mkstemp(prefix='.milo-sudo-check-', dir=SITE)
        wrapper = Path(wrapper_name)
        try:
            includes = ['/etc/sudoers'] + [str(staged.get(path, Path(path))) for path in
                ['/etc/sudoers.d/milobingo-protected-deploy', '/etc/sudoers.d/milobingo-admin-handoff']]
            with os.fdopen(fd, 'w') as output:
                output.write(''.join('@include ' + name + '\n' for name in includes))
                output.flush()
                os.fsync(output.fileno())
            check_sudoers(wrapper)
        finally:
            wrapper.unlink()
            sync_directory(SITE)
        # Install complete source files atomically without replacing any target.
        # link+unlink is atomic/exclusive on each same-directory filesystem;
        # unlinking the staging name leaves exactly one link on the final file.
        order = sorted(staged, key=lambda name: (name.startswith('/etc/sudoers.d/'), name))
        for path in order:
            temporary, target = staged[path], Path(path)
            try:
                os.link(temporary, target, follow_symlinks=False)
                info = target.lstat()
                installed.append((target, (info.st_dev, info.st_ino)))
            except FileExistsError:
                existing(target, files[path])  # Exact concurrent retry only.
            temporary.unlink()
            sync_directory(target.parent)
        check_sudoers('/etc/sudoers')
        for path, value in files.items():
            existing(Path(path), value)
        completed = True
        return [{'path': path, 'sha256': files[path]['sha256']} for path in sorted(files)]
    except BaseException:
        # Only files created by THIS invocation, still carrying our exact inode,
        # are removed. Never alter a preexisting or independently replaced file.
        for path, identity in reversed(installed):
            try:
                info = path.lstat()
                if (info.st_dev, info.st_ino) == identity and info.st_uid == 0:
                    path.unlink()
                    sync_directory(path.parent)
            except FileNotFoundError:
                pass
        raise
    finally:
        for temporary in staged.values():
            if temporary.exists():
                temporary.unlink()
                sync_directory(temporary.parent)
        if not completed:
            for directory in reversed(created_dirs):
                try:
                    directory.rmdir()  # Only empty directories owned by this attempt.
                    sync_directory(directory.parent)
                except OSError:
                    pass


def main():
    # This script accepts source files/public policy ONLY, never runtime/admin
    # values. Reject any non-allowlisted destination before filesystem mutation.
    files = payload(sys.stdin.buffer)
    paths = install(files)
    print(json.dumps({'installed': paths}, sort_keys=True))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except BaseException:
        print('Milo source installation refused or failed; no runtime values read or printed.', file=sys.stderr)
        sys.exit(1)
