#!/usr/bin/python3 -I
"""Fixed Milo protected-config entry. Install root-owned after review."""
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

HELPER = Path('/usr/local/libexec/dg-milo-deploy-helper')
HELPER_SHA256 = '__HELPER_SHA256__'
RUNNER = 'run-mil-stg'
HOST = 'dg-nxttrack-01'


def require(condition):
    if not condition:
        raise ValueError('Fixed Milo entry boundary refused')


def arguments(values):
    require(len(values) == 4 and values[0] == 'deploy'
            and re.fullmatch('[a-f0-9]{40}', values[1])
            and re.fullmatch('[1-9][0-9]{0,19}-[1-9][0-9]{0,9}', values[2])
            and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,95}', values[3]))
    return values


def trusted_helper():
    for component in [*reversed(HELPER.parents), HELPER]:
        item = component.lstat()
        require(item.st_uid == 0 and not item.st_mode & 0o022 and not stat.S_ISLNK(item.st_mode))
    require(HELPER.is_file() and re.fullmatch('[a-f0-9]{64}', HELPER_SHA256))
    require(hashlib.sha256(HELPER.read_bytes()).hexdigest() == HELPER_SHA256)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def request_body(stream):
    body = stream.read(8193)
    require(len(body) <= 8192)
    values = json.loads(body, object_pairs_hook=unique_object)
    require(isinstance(values, dict) and set(values) == {'githubToken'})
    token = values['githubToken']
    require(isinstance(token, str) and 8 <= len(token) <= 4096
            and all(33 <= ord(c) < 127 for c in token))
    return values


def main():
    args = arguments(sys.argv[1:])
    require(socket.gethostname() == HOST and os.getuid() == pwd.getpwnam(RUNNER).pw_uid
            and os.getuid() != 0)
    trusted_helper()
    values = request_body(sys.stdin.buffer)
    result = subprocess.run(['/usr/bin/sudo', '-n', str(HELPER), *args],
        input=json.dumps(values).encode(),
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}, check=False)
    return result.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Milo protected entry refused: verify host, caller, arguments and reviewed helper.', file=sys.stderr)
        sys.exit(1)
