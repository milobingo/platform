#!/usr/bin/python3 -I
"""Root bootstrap: copy the active Milo runtime into a NEW private bundle."""
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys

LEGACY = Path('/usr/local/libexec/dg-milobingo-deploy-helper')
LEGACY_SHA256 = 'ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8'
CURRENT = Path('/srv/sites/milobingo-staging/current')
RUNTIME_ROOT = Path('/etc/dg-sites/milobingo-staging.runtime.d')
CONFIG_ROOT = Path('/etc/dg-sites/milobingo-staging/configs')
DERIVED = {'NODE_ENV', 'HOSTNAME', 'MILO_LOCAL_AUTH', 'PORT', 'RELEASE_SHA', 'RELEASE_ID', 'CONFIG_VERSION'}


def parse_env(body):
    values = {}
    for line in body.splitlines():
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=("(?:[^"\\\x00-\x1f\x7f]|\\["\\])*")', line)
        if not match or match[1] in values:
            raise ValueError('Unrecognized active runtime format')
        values[match[1]] = json.loads(match[2])
    return values


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > 262144:
        raise ValueError('Untrusted private input')


def main():
    if os.geteuid() != 0 or socket.gethostname() != 'dg-nxttrack-01' or len(sys.argv) != 2 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}', sys.argv[1]):
        raise ValueError('Wrong bootstrap target')
    info = LEGACY.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or hashlib.sha256(LEGACY.read_bytes()).hexdigest() != LEGACY_SHA256:
        raise ValueError('Reviewed legacy helper changed')
    loader = importlib.machinery.SourceFileLoader('reviewed_milo_legacy', str(LEGACY))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader)); loader.exec_module(module)
    source = (CURRENT / '.runtime.env').resolve(strict=True)
    if source.parent != RUNTIME_ROOT:
        raise ValueError('Active runtime points outside fixed private directory')
    private_file(source)
    values = parse_env(source.read_text())
    if module.env_file(values) != source.read_text() or set(values) - set(module.RUNTIME_KEYS):
        raise ValueError('Active runtime does not match reviewed format')
    validated = module.runtime_values(values, values['RELEASE_SHA'], values['RELEASE_ID'], 4173)
    body = {key: value for key, value in validated.items() if key not in DERIVED}
    if body.get('VLAMPIE_SETTINGS_KEY') != values['VLAMPIE_SETTINGS_KEY']:
        raise ValueError('Encryption key must remain exactly unchanged')
    # These directories are new app-specific root configuration, not app data.
    for path in [CONFIG_ROOT.parent, CONFIG_ROOT, CONFIG_ROOT / sys.argv[1]]:
        try:
            path.mkdir(mode=0o700)
        except FileExistsError:
            pass
        item = path.lstat()
        if not stat.S_ISDIR(item.st_mode) or item.st_uid != 0 or item.st_mode & 0o077:
            raise ValueError('Untrusted protected configuration directory')
    target = CONFIG_ROOT / sys.argv[1] / 'runtime.json'
    if target.exists() or target.is_symlink():
        private_file(target)
        if json.loads(target.read_bytes()) != body:
            raise ValueError('Configuration ID already exists with different values')
        created = False
    else:
        module.private_file(target, json.dumps(body, sort_keys=True) + '\n')
        created = True
    fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    print(json.dumps({'status': 'passed', 'configId': sys.argv[1], 'created': created, 'runtimeKeys': sorted(body), 'encryptionKeyPreserved': True, 'sourceReleaseId': values['RELEASE_ID'], 'credentialsPrinted': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Protected runtime bootstrap refused; active app and secret values were not changed or printed.', file=sys.stderr)
        sys.exit(1)
