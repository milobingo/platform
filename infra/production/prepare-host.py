#!/usr/bin/python3 -I
"""Manual, fixed-target host preparation. Never starts a service or publishes Milo."""
import argparse
import ctypes
import grp
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

HOST = 'dg-nxttrack-01'
SITE = 'milobingo-production'
NAMES = ('run-mil-prd', 'build-mil-prd', 'app-mil-prd')
BOOTSTRAP = Path('/root/milo-production-bootstrap')
PROFILE_DIGEST = 'efee2c3639ed1e59e24b3ec6f6bd741b1341a67416f8abaa07c58ce526a429d0'
CONFIG_ID = 'production-2026-11-15-v1'
GUARD = '/usr/local/libexec/milobingo-production-guard-control-plane.py'
GUARD_UNIT = 'milobingo-production-control-plane.service'
RUNNER_UNIT = 'milobingo-production-runner.service'
RUNNER_ROOT = Path('/home/run-mil-prd/actions-runner')
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}


def require(value, message='Host preparation refused'):
    if not value:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def trusted(path, directory=False):
    path = Path(path)
    require(path.is_absolute(), 'Absolute root-owned path required')
    for part in [*reversed(path.parents), path]:
        item = part.lstat()
        require(item.st_uid == 0 and not item.st_mode & 0o022
                and not stat.S_ISLNK(item.st_mode), 'Unsafe root-owned path')
    item = path.lstat()
    require(stat.S_ISDIR(item.st_mode) if directory else stat.S_ISREG(item.st_mode),
            'Unexpected trusted path type')
    return path


def read_public(path, limit=262144):
    path = trusted(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        require(info.st_nlink == 1 and info.st_size <= limit, 'Unsafe review file')
        value = os.read(fd, limit + 1)
        require(len(value) <= limit, 'Oversized review file')
        return value
    finally:
        os.close(fd)


def command(argv):
    subprocess.run(argv, check=True, env=CLEAN_ENV, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=30)


def ensure_directory(path, uid=0, gid=0, mode=0o700):
    """Only create a new directory or accept exactly the previously owned one."""
    path = Path(path)
    trusted(path.parent, directory=True)
    try:
        path.mkdir(mode=mode)
    except FileExistsError:
        item = path.lstat()
        require(stat.S_ISDIR(item.st_mode) and item.st_uid == uid
                and item.st_gid == gid and stat.S_IMODE(item.st_mode) == mode,
                'Existing preparation directory differs')
    else:
        os.chown(path, uid, gid)
        os.chmod(path, mode)


def publish(path, body, mode=0o600):
    """No replacement: an existing byte-identical root-owned file is accepted."""
    path = Path(path)
    trusted(path.parent, directory=True)
    require(isinstance(body, bytes), 'Bytes required')
    if path.exists() or path.is_symlink():
        require(read_public(path, max(len(body), 262144)) == body
                and stat.S_IMODE(path.lstat().st_mode) == mode, 'Existing file differs')
        return False
    temporary = path.parent / ('.milo-prepare-' + os.urandom(16).hex())
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        try:
            os.fchmod(fd, mode)
            with os.fdopen(fd, 'wb', closefd=False) as target:
                target.write(body)
                target.flush()
                os.fsync(fd)
        finally:
            os.close(fd)
        rename = ctypes.CDLL(None, use_errno=True).renameat2
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(-100, os.fsencode(temporary), -100, os.fsencode(path), 1):
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def accounts():
    result = {}
    for name in NAMES:
        user = pwd.getpwnam(name)
        group = grp.getgrnam(name)
        expected_home = '/home/run-mil-prd' if name == NAMES[0] else '/nonexistent'
        require(user.pw_uid > 0 and user.pw_gid == group.gr_gid > 0
                and user.pw_shell == '/usr/sbin/nologin' and user.pw_dir == expected_home,
                'Unexpected production identity')
        memberships = set(os.getgrouplist(name, user.pw_gid))
        expected_groups = {user.pw_gid}
        if name == NAMES[0]:
            expected_groups.add(grp.getgrnam('dg-build').gr_gid)
        require(memberships == expected_groups, 'Unexpected supplementary membership')
        result[name] = {'uid': user.pw_uid, 'gid': user.pw_gid}
    require(len({v['uid'] for v in result.values()}) == 3
            and len({v['gid'] for v in result.values()}) == 3, 'Identities overlap')
    return result


def check_port():
    for family, address in [(socket.AF_INET, '127.0.0.1'), (socket.AF_INET6, '::1')]:
        with socket.socket(family) as probe:
            probe.bind((address, 4178))
    for root in (Path('/etc/caddy/sites'), Path('/etc/dg-sites')):
        for path in root.rglob('*'):
            if path.is_symlink() or not path.is_file() or SITE in str(path):
                continue
            # Configuration metadata only; never print values or read runtime secrets.
            if path.suffix not in ('.caddy', '.json') or path.name == 'runtime.json':
                continue
            require(not re.search(rb'(?<![0-9])4178(?![0-9])', path.read_bytes()),
                    'Production port is already reserved by another site')


def prepare_accounts():
    check_port()
    grp.getgrnam('dg-build')  # Shared group must already exist; never replace it.
    for name in NAMES:
        try:
            pwd.getpwnam(name)
        except KeyError:
            try:
                grp.getgrnam(name)
            except KeyError:
                pass
            else:
                raise ValueError('A production group exists without its matching account')
            command(['/usr/sbin/useradd', '--system', '--user-group', '--no-create-home',
                     '--no-log-init', '--home-dir', '/home/run-mil-prd' if name == NAMES[0]
                     else '/nonexistent', '--shell', '/usr/sbin/nologin', name])
            if name == NAMES[0]:
                command(['/usr/sbin/usermod', '--append', '--groups', 'dg-build', name])
    actual = accounts()
    ensure_directory(BOOTSTRAP)
    ensure_directory('/home/run-mil-prd', **actual[NAMES[0]], mode=0o750)
    # Runner code and generated credentials stay in its own home, never staging's.
    try:
        RUNNER_ROOT.mkdir(mode=0o700)
    except FileExistsError:
        item = RUNNER_ROOT.lstat()
        require(stat.S_ISDIR(item.st_mode) and item.st_uid == actual[NAMES[0]]['uid']
                and item.st_gid == actual[NAMES[0]]['gid'] and not item.st_mode & 0o077,
                'Unexpected runner directory')
    else:
        os.chown(RUNNER_ROOT, actual[NAMES[0]]['uid'], actual[NAMES[0]]['gid'])
    directories = [
        (f'/srv/sites/{SITE}', 0, actual[NAMES[2]]['gid'], 0o750),
        (f'/srv/sites/{SITE}/releases', 0, actual[NAMES[2]]['gid'], 0o750),
        (f'/var/lib/dg-build/{SITE}', 0, actual[NAMES[1]]['gid'], 0o750),
        (f'/etc/dg-sites/{SITE}', 0, 0, 0o700),
        (f'/etc/dg-sites/{SITE}/configs', 0, 0, 0o700),
        (f'/etc/dg-sites/{SITE}/configs/{CONFIG_ID}', 0, 0, 0o700),
        (f'/etc/dg-sites/{SITE}/staging-acceptance', 0, 0, 0o700),
        (f'/etc/dg-sites/{SITE}.runtime.d', 0, 0, 0o700),
        (f'/var/backups/{SITE}', 0, 0, 0o700),
        (f'/etc/systemd/system/{SITE}.service.d', 0, 0, 0o755),
    ]
    for path, uid, gid, mode in directories:
        ensure_directory(path, uid, gid, mode)
    # Shared app data is the sole app-owned directory below the root-owned site.
    shared = Path(f'/srv/sites/{SITE}/shared')
    ensure_directory(shared, **actual[NAMES[2]], mode=0o700)
    publish(BOOTSTRAP / 'production-accounts.json',
            (json.dumps(actual, sort_keys=True, indent=2) + '\n').encode())
    return {'prepared': True, 'accounts': actual, 'servicesStarted': False,
            'runtimeWritten': False, 'publicRouteInstalled': False}


GUARD_SOURCE = '''#!/usr/bin/python3 -I
"""Add only fixed Milo production UID rules; never flush shared host rules."""
import os, pwd, socket, subprocess, sys
if os.geteuid()!=0 or socket.gethostname()!='dg-nxttrack-01' or sys.argv[1:] not in [['--install'],['--check']]:
    raise SystemExit('Fixed root host and --install/--check required')
users=[pwd.getpwnam(name) for name in ['run-mil-prd','build-mil-prd','app-mil-prd']]
if len({user.pw_uid for user in users})!=3 or any(user.pw_uid==0 for user in users):
    raise SystemExit('Distinct production identities required')
for binary,destination in [('/usr/sbin/iptables','127.0.0.0/8'),('/usr/sbin/ip6tables','::1/128')]:
    for user in users:
        rule=['-p','tcp','-d',destination,'--dport','2019','-m','owner','--uid-owner',str(user.pw_uid),'-m','comment','--comment','milobingo-production-control-plane','-j','REJECT','--reject-with','tcp-reset']
        check=subprocess.run([binary,'-w','10','-C','OUTPUT',*rule],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        if check.returncode:
            if sys.argv[1]!='--install': raise SystemExit('Milo production Caddy isolation missing')
            subprocess.run([binary,'-w','10','-I','OUTPUT','1',*rule],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
print('Milo production Caddy isolation verified')
'''

GUARD_SERVICE = f'''[Unit]
Description=Isolate Milo production identities from the Caddy control API
After=network-pre.target
Before={RUNNER_UNIT} {SITE}.service
[Service]
Type=oneshot
ExecStart={GUARD} --install
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
'''

RUNNER_SERVICE = f'''[Unit]
Description=Dedicated GitHub runner for Milo production
Wants=network-online.target
After=network-online.target {GUARD_UNIT}
Requires={GUARD_UNIT}
[Service]
User=run-mil-prd
Group=run-mil-prd
WorkingDirectory={RUNNER_ROOT}
ExecStart={RUNNER_ROOT}/bin/runsvc.sh
Environment=PATH=/opt/node-v24.18.0-linux-x64/bin:/opt/dg-toolchains/pnpm/11.25.0/bin:/usr/local/bin:/usr/bin:/bin
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=5min
UMask=0077
[Install]
WantedBy=multi-user.target
'''

APP_GUARD_DROPIN = f'''[Unit]
Requires={GUARD_UNIT}
After={GUARD_UNIT}
'''


def bundle_plan(bundle, manifest_sha):
    bundle = trusted(bundle, directory=True)
    raw = read_public(bundle / 'manifest.json')
    require(re.fullmatch('[a-f0-9]{64}', manifest_sha or '') and digest(raw) == manifest_sha,
            'The independently reviewed manifest hash differs')
    manifest = json.loads(raw)
    require(manifest.get('format') == 'milo-protected-production-bootstrap-v1'
            and manifest.get('profileDigest') == PROFILE_DIGEST
            and manifest.get('site') == SITE and manifest.get('host') == HOST
            and manifest.get('port') == 4178 and manifest.get('policyComplete') is True
            and manifest.get('credentialsIncluded') is False, 'Wrong production bundle')
    expected = {
        'legacy-deploy-helper.py': (f'/usr/local/libexec/dg-{SITE}-deploy-helper', '0755'),
        'deploy-helper.py': (f'/usr/local/libexec/dg-{SITE}-protected-deploy-helper', '0755'),
        'deploy-entry.py': (f'/usr/local/bin/dg-{SITE}-protected-deploy', '0755'),
        'release-gate.mjs': (f'/usr/local/libexec/{SITE}-protected-release-gate.mjs', '0644'),
        'extract-source.py': (f'/usr/local/libexec/{SITE}-protected-extract-source.py', '0755'),
        'lock-guardian.py': (f'/usr/local/libexec/{SITE}-protected-lock-guardian.py', '0755'),
        'protected-deploy.json': (f'/etc/dg-sites/{SITE}/protected-deploy.json', '0600'),
        'deploy.sudoers': (f'/etc/sudoers.d/{SITE}-protected-deploy', '0440'),
        'deploy-profile.json': (f'/etc/dg-sites/{SITE}.deploy.json', '0600'),
        'service.unit': (f'/etc/systemd/system/{SITE}.service', '0644'),
        'site.caddy': (f'/etc/caddy/sites/{SITE}.caddy', '0644'),
        'profile.json': ('infra/production/profile.json', '0644'),
        'deploy-production.yml': ('.github/workflows/deploy-production.yml', '0644'),
    }
    require(set(manifest.get('files', {})) == set(expected), 'Unexpected bundle file set')
    plan = []
    for name, (destination, mode) in expected.items():
        meta = manifest['files'][name]
        body = read_public(bundle / name, 1048576)
        require(meta == {'destination': destination, 'mode': mode, 'sha256': digest(body)},
                'Bundle contents differ from the reviewed manifest')
        if name in ('profile.json', 'deploy-production.yml'):
            continue  # Public repository files are committed through Git, never on the host.
        if name == 'site.caddy':
            destination = f'/etc/dg-sites/{SITE}/site.caddy.prepared'
        plan.append((Path(destination), body, int(mode, 8)))
    policy = json.loads(read_public(bundle / 'protected-deploy.json'))
    require(policy.get('accounts') == accounts()
            and policy.get('productionProfileSha256') == PROFILE_DIGEST
            and policy.get('allowedConfigIds') == [CONFIG_ID], 'Policy identity/configuration differs')
    return plan


def install_bundle(bundle, manifest_sha):
    check_port()
    plan = bundle_plan(bundle, manifest_sha)
    # Validate all existing targets before publishing any new target.
    plan.extend([(Path(GUARD), GUARD_SOURCE.encode(), 0o755),
                 (Path('/etc/systemd/system') / GUARD_UNIT, GUARD_SERVICE.encode(), 0o644),
                 (Path('/etc/systemd/system') / RUNNER_UNIT, RUNNER_SERVICE.encode(), 0o644),
                 (Path(f'/etc/systemd/system/{SITE}.service.d/control-plane.conf'),
                  APP_GUARD_DROPIN.encode(), 0o644)])
    for path, body, mode in plan:
        trusted(path.parent, directory=True)
        if path.exists() or path.is_symlink():
            require(read_public(path, 1048576) == body
                    and stat.S_IMODE(path.lstat().st_mode) == mode, 'Existing destination differs')
    # visudo examines the exact staged rule without installing any sudo authority.
    command(['/usr/sbin/visudo', '-cf', str(Path(bundle) / 'deploy.sudoers')])
    written = [str(path) for path, body, mode in plan if publish(path, body, mode)]
    return {'installed': written, 'manifestSha256': manifest_sha,
            'systemdReloaded': False, 'servicesStarted': False,
            'firewallChanged': False, 'publicRouteInstalled': False,
            'runtimeWritten': False, 'acceptanceWritten': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('accounts')
    sub.add_parser('prepare-accounts')
    for action in ('review-bundle', 'install-bundle'):
        child = sub.add_parser(action)
        child.add_argument('--bundle', required=True)
        child.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname() == HOST, 'Fixed target root required')
    os.umask(0o077)
    if args.action == 'accounts':
        result = {'accounts': accounts()}
    elif args.action == 'prepare-accounts':
        result = prepare_accounts()
    elif args.action == 'review-bundle':
        result = {'installPlan': [{'path': str(path), 'sha256': digest(body),
                                  'mode': f'{mode:04o}'} for path, body, mode
                                 in bundle_plan(args.bundle, args.manifest_sha256)],
                  'installed': False, 'publicRouteInstalled': False}
    else:
        result = install_bundle(args.bundle, args.manifest_sha256)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Milo production host preparation refused; no secret values logged. '
              'Inspect the reviewed stage and existing host metadata before retrying.', file=sys.stderr)
        sys.exit(1)
