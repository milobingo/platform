#!/usr/bin/python3 -I
"""Milo staging native deploy entry, version 1. Install only after review."""
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

HELPER = '/usr/local/libexec/dg-milobingo-deploy-helper'
HELPER_SHA256 = '__HELPER_SHA256__'  # Render the reviewed helper's digest at install.
SITE = 'milobingo-staging'
WORKSPACE = '/home/run-mil-stg/_work/platform/platform'
RUNTIME_KEYS = ('NODE_ENV', 'HOSTNAME', 'APP_URL', 'MILO_LOCAL_AUTH', 'PORT',
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_STORAGE_BUCKET',
    'SUPABASE_DB_CA_BASE64', 'DATABASE_URL', 'SUPABASE_SECRET_KEY',
    'VLAMPIE_SETTINGS_KEY', 'OPENAI_TEXT_MODEL', 'OPENAI_SPEECH_MODEL',
    'OPENAI_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET',
    'RELEASE_SHA', 'RELEASE_ID', 'CONFIG_VERSION')


def arguments(values):
    if (len(values) != 4 or values[0] != SITE or values[1] != WORKSPACE
            or not re.fullmatch('[a-f0-9]{40}', values[2])
            or not re.fullmatch('[1-9][0-9]{0,19}-[1-9][0-9]{0,9}', values[3])):
        raise ValueError('Invalid fixed-site deployment arguments')
    return values


def trusted_helper():
    path = Path(HELPER)
    for component in [*reversed(path.parents), path]:
        item = component.lstat()
        if item.st_uid != 0 or item.st_mode & 0o022 or stat.S_ISLNK(item.st_mode):
            raise ValueError('Untrusted helper path')
    if not path.is_file() or not re.fullmatch('[a-f0-9]{64}', HELPER_SHA256):
        raise ValueError('Helper has not been reviewed and pinned')
    if hashlib.sha256(path.read_bytes()).hexdigest() != HELPER_SHA256:
        raise ValueError('Reviewed helper digest differs')


def main():
    args = arguments(sys.argv[1:])
    if (socket.gethostname() != 'dg-nxttrack-01'
            or os.getuid() != pwd.getpwnam('run-mil-stg').pw_uid or os.getuid() == 0):
        raise ValueError('Wrong deployment caller or host')
    trusted_helper()
    declared = os.environ.get('DG_RUNTIME_ENV_KEYS', '').split()
    if len(declared) != len(set(declared)) or any(k not in RUNTIME_KEYS for k in declared):
        raise ValueError('Unknown or duplicate runtime key')
    if os.environ.get('DG_BUILD_ENV_KEYS', ''):
        raise ValueError('Build secrets are not supported')
    runtime = {key: os.environ[key] for key in declared if key in os.environ}
    body = json.dumps(runtime, ensure_ascii=True).encode()
    if len(body) > 262144:
        raise ValueError('Runtime payload is too large')
    result = subprocess.run(['/usr/bin/sudo', '-n', HELPER, *args], input=body,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}, check=False)
    return result.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError):
        print('Milo deploy entry refused: check host, caller, arguments and reviewed helper.', file=sys.stderr)
        sys.exit(1)
