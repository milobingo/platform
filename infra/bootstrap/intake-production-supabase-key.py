#!/usr/bin/python3 -I
"""One-time production Storage credential intake; no deployment or DB changes."""
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import stat
import sys
import termios
import urllib.error
import urllib.request
import warnings

PROJECT_REF = 'msupvdycmtbycaonqgan'
DESTINATION = Path('/root/milo-production-bootstrap/supabase-storage-key.json')
BUCKETS_URL = 'https://' + PROJECT_REF + '.supabase.co/storage/v1/bucket'
MAX_RESPONSE = 131072
MAX_FILE = 2048


def validate_key(value):
    if not isinstance(value, str) or not re.fullmatch(r'sb_secret_[A-Za-z0-9_-]{20,246}', value):
        raise ValueError('Invalid modern server key')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused')


def verify_remote(value, opener=None):
    """Only a bounded read of the fixed production project's Storage API."""
    validate_key(value)
    if opener is None:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request = urllib.request.Request(BUCKETS_URL, method='GET', headers={
        'apikey': value, 'Accept': 'application/json',
        'User-Agent': 'MiloProductionKeyIntake/1.0',
    })
    try:
        with opener.open(request, timeout=15) as response:
            if response.status != 200 or response.geturl() != BUCKETS_URL:
                raise ValueError('Storage verification refused')
            length = response.headers.get('Content-Length')
            if length is not None and (not length.isdecimal() or int(length) > MAX_RESPONSE):
                raise ValueError('Storage response refused')
            body = response.read(MAX_RESPONSE + 1)
            if len(body) > MAX_RESPONSE or not isinstance(json.loads(body), list):
                raise ValueError('Storage response refused')
    except (OSError, ValueError, urllib.error.URLError):
        # HTTP error bodies and exception messages may contain credentials.
        raise ValueError('Production Storage verification failed') from None


def prompt_key():
    """Refuse getpass fallback: a real controlling tty and verified echo-off."""
    fd = os.open('/dev/tty', os.O_RDWR | os.O_NOCTTY | os.O_CLOEXEC)
    try:
        if not os.isatty(fd):
            raise ValueError('Interactive terminal required')
        previous = termios.tcgetattr(fd)
        hidden = list(previous)
        hidden[3] &= ~termios.ECHO
        try:
            termios.tcsetattr(fd, termios.TCSAFLUSH, hidden)
            if termios.tcgetattr(fd)[3] & termios.ECHO:
                raise ValueError('Terminal could not hide input')
            with os.fdopen(os.dup(fd), 'w', encoding='utf-8') as stream:
                with warnings.catch_warnings():
                    warnings.simplefilter('error', getpass.GetPassWarning)
                    value = getpass.getpass(
                        'milobingo-production — plak de Supabase-secretkey (sb_secret_…): ',
                        stream=stream)
            return validate_key(value)
        finally:
            termios.tcsetattr(fd, termios.TCSAFLUSH, previous)
    finally:
        os.close(fd)


def _directory(info, owner, private=False):
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner
            or (stat.S_IMODE(info.st_mode) != 0o700 if private else bool(info.st_mode & 0o022))):
        raise ValueError('Untrusted credential directory')


def _parent_fd(destination, owner, anchor):
    """Walk with directory descriptors; production checks every ancestor from /."""
    if not destination.is_absolute() or not anchor.is_absolute() or '..' in destination.parts or '..' in anchor.parts:
        raise ValueError('Invalid credential destination')
    parts = destination.parent.relative_to(anchor).parts
    fd = os.open(anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        _directory(os.fstat(fd), owner, private=anchor != Path('/'))
        for index, part in enumerate(parts):
            last = index == len(parts) - 1
            if last:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            try:
                _directory(os.fstat(next_fd), owner, private=True)
            except BaseException:
                os.close(next_fd)
                raise
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def _existing(parent_fd, name, expected, owner):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent_fd)
    except FileNotFoundError:
        return False
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_FILE):
            raise ValueError('Untrusted existing credential')
        if os.read(fd, MAX_FILE + 1) != expected:
            raise ValueError('Existing credential differs; never overwrite')
        return True
    finally:
        os.close(fd)


def persist(value, destination=DESTINATION, owner=0, anchor=Path('/')):
    """Publish a complete private file without replacing any existing target.

    Tests may supply a private temporary anchor; the installed CLI always uses /.
    """
    validate_key(value)
    destination = Path(destination)
    body = (json.dumps({'projectRef': PROJECT_REF, 'SUPABASE_SECRET_KEY': value}, sort_keys=True) + '\n').encode()
    previous_umask = os.umask(0o077)
    parent_fd = None
    temporary = None
    try:
        parent_fd = _parent_fd(Path(destination), owner, Path(anchor))
        if _existing(parent_fd, destination.name, body, owner):
            return False
        temporary = '.pending-' + secrets.token_hex(16)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=parent_fd)
        try:
            os.fchmod(fd, 0o600)
            pending = memoryview(body)
            while pending:
                written = os.write(fd, pending)
                if written <= 0:
                    raise OSError('Incomplete private write')
                pending = pending[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        try:
            os.link(temporary, destination.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd, follow_symlinks=False)
            created = True
        except FileExistsError:
            if not _existing(parent_fd, destination.name, body, owner):
                raise ValueError('Concurrent credential change; retry explicitly')
            created = False
        os.unlink(temporary, dir_fd=parent_fd)
        temporary = None
        os.fsync(parent_fd)
        return created
    finally:
        if parent_fd is not None:
            try:
                if temporary is not None:
                    os.unlink(temporary, dir_fd=parent_fd)
            finally:
                os.close(parent_fd)
        os.umask(previous_umask)


def main():
    if len(sys.argv) != 1 or os.geteuid() != 0 or socket.gethostname() != 'dg-nxttrack-01':
        raise ValueError('Wrong intake target or arguments')
    value = prompt_key()
    verify_remote(value)
    created = persist(value)
    print('Supabase-sleutel gecontroleerd en beschermd opgeslagen.')
    print(json.dumps({'status': 'passed', 'created': created, 'projectRef': PROJECT_REF,
                      'path': str(DESTINATION), 'keys': ['SUPABASE_SECRET_KEY'], 'credentialsPrinted': False}))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('Invoer niet voltooid. Controleer de productiekey, SSH-terminal en verbinding; bestaande gegevens zijn niet vervangen.', file=sys.stderr)
        sys.exit(1)
