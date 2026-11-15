#!/usr/bin/python3 -I
"""Fixed-target OpenPGP handoff. Root-only manual administration, never runner sudo."""
import base64
import ctypes
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import subprocess
import sys

ROOT = Path('/root/milo-production-bootstrap')
ROLE = 'milobingo_production_admin_bootstrap'
REF = 'msupvdycmtbycaonqgan'
HOST = 'dg-nxttrack-01'
PUBLIC_FIELDS = {'format', 'projectRef', 'hostname', 'role', 'nonce', 'fingerprint', 'encryptionFingerprint', 'publicKey'}
CIPHER_FIELDS = PUBLIC_FIELDS - {'publicKey'} | {'ciphertext'}
SECRET_FIELDS = PUBLIC_FIELDS - {'publicKey'} | {'password'}


def validate_directory(path, owner=0):
    value = Path(path).lstat()
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != owner or stat.S_IMODE(value.st_mode) != 0o700:
        raise ValueError('Untrusted private directory')


def read_private(path, owner=0, limit=20000):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        value = os.fstat(fd)
        if (not stat.S_ISREG(value.st_mode) or value.st_uid != owner or value.st_nlink != 1
                or stat.S_IMODE(value.st_mode) != 0o600 or value.st_size > limit):
            raise ValueError('Untrusted private file')
        raw = os.read(fd, limit + 1)
        if len(raw) > limit:
            raise ValueError('Private file too large')
        return json.loads(raw)
    finally:
        os.close(fd)


def publish_private(path, value, owner=0):
    """Noreplace publication; identical retry is accepted, a different value refused."""
    path = Path(path)
    validate_directory(path.parent, owner)
    body = (json.dumps(value, sort_keys=True) + '\n').encode()
    temporary = path.parent / ('.handoff-' + secrets.token_hex(16))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        try:
            os.fchmod(fd, 0o600)
            pending = memoryview(body)
            while pending:
                count = os.write(fd, pending)
                if count <= 0:
                    raise OSError('Private write incomplete')
                pending = pending[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            rename = libc.renameat2
            rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            if rename(-100, os.fsencode(temporary), -100, os.fsencode(path), 1) != 0:
                code = ctypes.get_errno()
                raise OSError(code, os.strerror(code))
            created = True
        except FileExistsError:
            if read_private(path, owner) != value:
                raise ValueError('Existing private handoff differs; no overwrite')
            created = False
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return created
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def gpg(home, arguments, data=None):
    result = subprocess.run(['/usr/bin/gpg', '--no-options', '--homedir', str(home),
                             '--batch', '--no-tty', '--pinentry-mode', 'loopback',
                             '--passphrase', '', '--no-auto-key-retrieve',
                             '--auto-key-locate', 'clear', *arguments],
                            input=data, capture_output=True, timeout=120,
                            env={'PATH': '/usr/bin:/bin', 'LANG': 'C', 'GNUPGHOME': str(home)})
    if result.returncode != 0:
        raise ValueError('OpenPGP operation refused')
    return result.stdout


def key_info(home):
    raw = gpg(home, ['--with-colons', '--list-secret-keys']).decode('ascii')
    primary = []
    encryption = []
    awaiting_primary = False
    awaiting_encryption = False
    for line in raw.splitlines():
        fields = line.split(':')
        if fields[0] == 'sec':
            awaiting_primary = True
        elif fields[0] == 'fpr' and awaiting_primary:
            primary.append(fields[9])
            awaiting_primary = False
        elif fields[0] == 'ssb' and 'e' in fields[11].lower():
            awaiting_encryption = True
        elif fields[0] == 'fpr' and awaiting_encryption:
            encryption.append(fields[9])
            awaiting_encryption = False
    if len(primary) > 1 or len(encryption) > 1:
        raise ValueError('Unexpected extra private key')
    return (primary[0] if primary else None), (encryption[0] if encryption else None)


def prepare(root=ROOT, owner=0):
    validate_directory(root, owner)
    home = root / 'credential-gpg'
    try:
        home.mkdir(mode=0o700)
    except FileExistsError:
        pass
    validate_directory(home, owner)
    fingerprint, encryption = key_info(home)
    if fingerprint is None:
        gpg(home, ['--quick-generate-key', 'Milo production bootstrap <bootstrap@milobingo.invalid>',
                   'rsa3072', 'cert', '7d'])
        fingerprint, encryption = key_info(home)
    if not re.fullmatch('[A-F0-9]{40}', fingerprint or ''):
        raise ValueError('Wrong public key fingerprint')
    if not encryption:
        gpg(home, ['--quick-add-key', fingerprint, 'rsa3072', 'encr', '7d'])
        fingerprint, encryption = key_info(home)
    public_key = gpg(home, ['--armor', '--export', fingerprint]).decode('ascii')
    destination = root / 'public-handoff.json'
    try:
        previous = read_private(destination, owner)
    except FileNotFoundError:
        previous = None
    manifest = {'format': 1, 'projectRef': REF, 'hostname': HOST, 'role': ROLE,
                'nonce': previous['nonce'] if previous else secrets.token_hex(32),
                'fingerprint': fingerprint, 'encryptionFingerprint': encryption, 'publicKey': public_key}
    if set(manifest) != PUBLIC_FIELDS or (previous is not None and previous != manifest):
        raise ValueError('Existing handoff key differs')
    publish_private(destination, manifest, owner)
    return manifest


def install(cipher, root=ROOT, owner=0):
    validate_directory(root, owner)
    home = root / 'credential-gpg'
    validate_directory(home, owner)
    manifest = read_private(root / 'public-handoff.json', owner)
    if (not isinstance(cipher, dict) or set(cipher) != CIPHER_FIELDS
            or set(manifest) != PUBLIC_FIELDS
            or any(cipher.get(key) != manifest.get(key) for key in CIPHER_FIELDS - {'ciphertext'})):
        raise ValueError('Encrypted handoff identity differs')
    raw = cipher.get('ciphertext')
    if not isinstance(raw, str) or not 300 <= len(raw) <= 16000:
        raise ValueError('Encrypted handoff size refused')
    encrypted = base64.b64decode(''.join(raw.split()), validate=True)
    plaintext = gpg(home, ['--max-output', '8192', '--decrypt'], encrypted)
    value = json.loads(plaintext)
    if (not isinstance(value, dict) or set(value) != SECRET_FIELDS
            or any(value.get(key) != manifest.get(key) for key in SECRET_FIELDS - {'password'})
            or not re.fullmatch('[a-f0-9]{64}', value.get('password', ''))):
        raise ValueError('Decrypted handoff identity or credential differs')
    destination = root / 'admin-database.json'
    credential = {'projectRef': REF, 'role': ROLE, 'nonce': manifest['nonce'],
                  'DATABASE_URL': 'postgresql://' + ROLE + ':' + value['password']
                  + '@db.' + REF + '.supabase.co:5432/postgres?sslmode=verify-full'}
    created = publish_private(destination, credential, owner)
    return {'status': 'stored-not-activated', 'created': created, 'projectRef': REF,
            'role': ROLE, 'path': str(destination), 'credentialsPrinted': False,
            'databaseLoginVerified': False, 'productionActivated': False}


def main():
    if os.geteuid() != 0 or socket.gethostname() != HOST or len(sys.argv) != 2:
        raise ValueError('Fixed target root administration required')
    # Follow no private directory links, including the existing /root anchor.
    validate_directory(Path('/root'))
    validate_directory(ROOT)
    if sys.argv[1] == 'prepare-key':
        print(json.dumps(prepare()))
    elif sys.argv[1] == 'install-ciphertext':
        raw = sys.stdin.buffer.read(20001)
        if len(raw) > 20000:
            raise ValueError('Encrypted handoff input too large')
        print(json.dumps(install(json.loads(raw))))
    else:
        raise ValueError('Unknown administration operation')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Milo-productieoverdracht geweigerd; bestaande credentials zijn niet vervangen. Geen credentialdetails gelogd.', file=sys.stderr)
        sys.exit(1)
