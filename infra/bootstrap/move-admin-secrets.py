#!/usr/bin/python3 -I
"""One-time, fixed-destination handoff; never a normal deployment operation."""
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import sys
from urllib.parse import urlparse, parse_qs

DESTINATION = Path('/etc/dg-sites/milobingo-staging/admin/github-transfer-2026-11-11.json')
KEYS = {'MIGRATION_DATABASE_URL', 'BACKUP_ENCRYPTION_KEY'}
PROJECT = 'lfsdgxcpdyghidzkzzvn'


def validate(values):
    if not isinstance(values, dict) or set(values) != KEYS:
        raise ValueError('Invalid handoff names')
    if any(not isinstance(value, str) or not value or len(value) > 32768 or any(ord(c) < 32 or ord(c) == 127 for c in value) for value in values.values()):
        raise ValueError('Invalid handoff values')
    url = urlparse(values['MIGRATION_DATABASE_URL'])
    query = parse_qs(url.query, keep_blank_values=True)
    direct = url.hostname == f'db.{PROJECT}.supabase.co'
    pooled = bool(url.hostname and url.hostname.endswith('.pooler.supabase.com') and url.username and url.username.endswith('.' + PROJECT))
    if url.scheme not in ['postgres', 'postgresql'] or not url.username or not url.password or url.port not in [None, 5432] or url.path in ['', '/'] or url.fragment or not (direct or pooled) or query != {'sslmode': ['verify-full']}:
        raise ValueError('Wrong database handoff target')
    if not re.fullmatch(r'[a-fA-F0-9]{64}', values['BACKUP_ENCRYPTION_KEY']):
        raise ValueError('Missing backup recovery material')
    return values


def persist(values, destination=DESTINATION, owner=0):
    validate(values)
    for parent in [*reversed(destination.parent.parents), destination.parent]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
            raise ValueError('Untrusted handoff parent')
    body = (json.dumps(values, sort_keys=True) + '\n').encode()
    try:
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        fd = os.open(destination, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != owner or info.st_mode & 0o077 or info.st_size > 70000:
                raise ValueError('Untrusted existing handoff')
            if json.loads(os.read(fd, 70001)) != values:
                raise ValueError('Existing handoff differs; never overwrite')
        finally:
            os.close(fd)
        return False
    try:
        pending = memoryview(body)
        while pending:
            pending = pending[os.write(fd, pending):]
        os.fsync(fd)
    finally:
        os.close(fd)
    parent_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
    return True


def main():
    runner = pwd.getpwnam('run-mil-stg')
    if len(sys.argv) != 1 or os.geteuid() != 0 or socket.gethostname() != 'dg-nxttrack-01' or os.environ.get('SUDO_USER') != runner.pw_name or os.environ.get('SUDO_UID') != str(runner.pw_uid):
        raise ValueError('Wrong handoff caller')
    body = sys.stdin.buffer.read(70001)
    if len(body) > 70000:
        raise ValueError('Oversized handoff')
    created = persist(json.loads(body))
    print(json.dumps({'status': 'passed', 'created': created, 'keys': sorted(KEYS), 'credentialsPrinted': False}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        print('Protected admin handoff refused; no credential values shown.', file=sys.stderr)
        sys.exit(1)
