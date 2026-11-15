#!/usr/bin/python3 -I
"""Render reviewed SQL from public target metadata; never execute SQL."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROLE = 'milobingo_production_admin_bootstrap'
REF = 'msupvdycmtbycaonqgan'
HOST = 'dg-nxttrack-01'
PUBLIC_FIELDS = {'format', 'projectRef', 'hostname', 'role', 'nonce', 'fingerprint', 'encryptionFingerprint', 'publicKey'}


def validate_manifest(value):
    if (not isinstance(value, dict) or set(value) != PUBLIC_FIELDS
            or value['format'] != 1 or value['projectRef'] != REF
            or value['hostname'] != HOST or value['role'] != ROLE
            or not re.fullmatch('[a-f0-9]{64}', value.get('nonce', ''))
            or not re.fullmatch('[A-F0-9]{40}', value.get('fingerprint', ''))
            or not re.fullmatch('[A-F0-9]{40}', value.get('encryptionFingerprint', ''))):
        raise ValueError('Wrong public target manifest')
    key = value.get('publicKey')
    if (not isinstance(key, str) or len(key) > 16384 or len(key) < 500
            or not key.startswith('-----BEGIN PGP PUBLIC KEY BLOCK-----\n')
            or not key.rstrip().endswith('-----END PGP PUBLIC KEY BLOCK-----')
            or not all(character in '\r\n\t' or 32 <= ord(character) < 127 for character in key)
            or 'PRIVATE KEY' in key):
        raise ValueError('Only a bounded armored public key is accepted')
    with tempfile.TemporaryDirectory(prefix='milo-public-key-check-') as directory:
        checked = subprocess.run(['/usr/bin/gpg', '--no-options', '--batch', '--no-tty',
                                  '--homedir', directory, '--with-colons', '--show-keys'],
                                 input=key.encode('ascii'), capture_output=True, timeout=15)
    if checked.returncode:
        raise ValueError('Public key could not be checked')
    keys = []
    current = None
    for line in checked.stdout.decode('ascii').splitlines():
        fields = line.split(':')
        if fields[0] in ['sec', 'ssb']:
            raise ValueError('Secret-key packets are never accepted')
        if fields[0] in ['pub', 'sub']:
            current = {'kind': fields[0], 'algorithm': fields[3], 'capabilities': fields[11]}
        elif fields[0] == 'fpr' and current:
            keys.append({**current, 'fingerprint': fields[9]})
            current = None
    if (len(keys) != 2 or keys[0]['kind'] != 'pub' or keys[1]['kind'] != 'sub'
            or any(item['algorithm'] != '1' for item in keys)
            or 'e' not in keys[1]['capabilities'].lower()
            or keys[0]['fingerprint'] != value['fingerprint']
            or keys[1]['fingerprint'] != value['encryptionFingerprint']):
        raise ValueError('Actual RSA key fingerprints differ from target manifest')
    return value


def render(manifest, template=None):
    value = validate_manifest(manifest)
    if template is None:
        template = Path(__file__).with_name('admin-credential.sql.template').read_text()
    for name, field in [('NONCE', 'nonce'), ('FINGERPRINT', 'fingerprint'),
                        ('ENCRYPTION_FINGERPRINT', 'encryptionFingerprint'), ('PUBLIC_KEY', 'publicKey')]:
        token = '__' + name + '_LITERAL__'
        if template.count(token) != 1:
            raise ValueError('Reviewed SQL template differs')
        template = template.replace(token, "'" + value[field].replace("'", "''") + "'")
    if re.search('__.*_LITERAL__', template):
        raise ValueError('Unfilled SQL template')
    return template


if __name__ == '__main__':
    try:
        if len(sys.argv) != 1:
            raise ValueError('Use stdin public manifest only')
        raw = sys.stdin.buffer.read(20001)
        if len(raw) > 20000:
            raise ValueError('Public manifest too large')
        sys.stdout.write(render(json.loads(raw)))
    except Exception:
        print('Public production bootstrap SQL render refused; no database change executed.', file=sys.stderr)
        sys.exit(1)
