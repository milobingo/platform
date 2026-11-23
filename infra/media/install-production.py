#!/usr/bin/env python3
"""Promote the existing, pinned Milo media stack without touching other sites.

Plan is read-only. Apply needs a fresh root-owned activity receipt and an idle
provider. Secrets stay in root-managed host files and protected backups.
"""
import argparse
import base64
import datetime
import grp
import hashlib
import hmac
import json
import os
import pwd
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import subprocess
import tempfile
import time
import urllib.request

HOST = 'dg-nxttrack-01'
DOMAIN = 'milo.dgwebservices.nl'
STAGING_DOMAIN = 'milo-staging.dgwebservices.nl'
CADDY = Path('/etc/caddy/sites/milobingo-production.caddy')
COMPOSE = Path('/opt/milobingo-media/compose.yaml')
SFU = Path('/etc/milobingo-media/livekit.yaml')
CREDENTIALS = Path('/etc/milobingo-media/credentials.json')
BROADCAST = Path('/etc/milobingo-broadcast')
PRODUCTION = BROADCAST / 'production.json'
HLS = Path('/srv/sites/milobingo-production/shared/broadcast-hls')
SYNC = Path('/usr/local/sbin/milo-media-sync-cert')
PENDING = Path('/etc/milobingo-media/.tls-restart-pending')
APP_DROPIN = Path('/etc/systemd/system/milobingo-production.service.d/media.conf')
MAINT_DROPIN = Path('/etc/systemd/system/milo-media-maintenance.service.d/production.conf')
BACKUPS = Path('/var/backups/milo-media-production')
SOURCE_CERT = Path('/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory') / DOMAIN
TLS = Path('/etc/milobingo-media/tls')


def run(*arguments, input=None):
    result = subprocess.run(arguments, input=input, capture_output=True)
    if result.returncode:
        raise RuntimeError('Host command failed: ' + arguments[0] + ' ' + (arguments[1] if len(arguments) > 1 else ''))
    return result.stdout


def trusted_parents(path):
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('Managed system-file parents must be root-controlled: ' + str(parent))


def read_file(path, *, private=False, trusted=True):
    if trusted:
        trusted_parents(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024 * 1024:
        raise RuntimeError('Expected a bounded regular file: ' + str(path))
    if trusted and (info.st_uid != 0 or info.st_mode & 0o022):
        raise RuntimeError('Managed file must be root-controlled: ' + str(path))
    if private and (info.st_uid != 0 or info.st_mode & 0o077):
        raise RuntimeError('Activity/credentials must be root-owned 0600: ' + str(path))
    return path.read_bytes()


def compose_production(text):
    staging = '      - /srv/sites/milobingo-staging/shared/broadcast-hls:/out'
    production = '      - /srv/sites/milobingo-production/shared/broadcast-hls:/out-production'
    if text.count(staging + '\n') != 1:
        raise RuntimeError('The known staging Egress mount is missing or ambiguous.')
    if text.count(production) > 1 or ('/out-production' in text and production not in text):
        raise RuntimeError('Unexpected production Egress mount.')
    if production in text:
        return text
    return text.replace(staging + '\n', staging + '\n' + production + '\n')


def sfu_production(text):
    for expression, allowed, replacement in [
        (r'(?m)^  whip_base_url: (\S+)$', ['https://' + STAGING_DOMAIN + '/whip', 'https://' + DOMAIN + '/whip'], 'https://' + DOMAIN + '/whip'),
        (r'(?m)^  domain: (\S+)$', [STAGING_DOMAIN, DOMAIN], DOMAIN),
    ]:
        matches = list(re.finditer(expression, text))
        if len(matches) != 1 or matches[0].group(1) not in allowed:
            raise RuntimeError('Unexpected current LiveKit WHIP/TURN hostname.')
        text = text[:matches[0].start(1)] + replacement + text[matches[0].end(1):]
    return text


def caddy_production(text):
    if text.count(DOMAIN + ' {') != 1 or re.search(r'(?m)^\s*(?:import|log)\b', text):
        raise RuntimeError('Unexpected production site structure or logging.')
    match = re.search(r'(?ms)^([ \t]*)reverse_proxy 127\.0\.0\.1:4178 \{\n(.*?)^\1\}', text)
    if not match or text.count('reverse_proxy 127.0.0.1:4178') != 1:
        raise RuntimeError('The existing production application upstream is ambiguous.')
    headers = [line.strip() for line in match.group(2).splitlines() if line.strip()]
    required = [
        'header_up Host ' + DOMAIN, 'header_up X-Forwarded-Host ' + DOMAIN,
        'header_up X-Forwarded-Proto https', 'header_up -oai-authenticated-user-id',
        'header_up -oai-authenticated-user-email', 'header_up -x-milo-user', 'header_up -x-milo-role',
    ]
    if headers != required:
        raise RuntimeError('Production upstream headers differ; reconcile explicitly.')
    rendered = '''# Milo production app and independent programme distribution.
''' + DOMAIN + ''' {
    encode zstd gzip
    @programme_hls path /api/broadcast/hls/*
    # Defer until Next has written its response headers; scope to signed media.
    header @programme_hls >Referrer-Policy "no-referrer"
    # Never log protected RTC/WHIP URLs or upstream request bodies.
    handle_errors {
        respond "Verbinding tijdelijk niet bereikbaar. Probeer opnieuw." {err.status_code}
    }
    @livekit path /rtc /rtc/* /twirp/livekit.*
    handle @livekit {
        reverse_proxy 127.0.0.1:7880
    }
    handle_path /whip/* {
        rewrite * /w{path}
        reverse_proxy 127.0.0.1:8086
    }
    handle {
        reverse_proxy 127.0.0.1:4178 {
''' + ''.join('            ' + line + '\n' for line in headers) + '''        }
    }
}
'''
    legacy = DOMAIN + ' {\n    encode zstd gzip\n    reverse_proxy 127.0.0.1:4178 {\n' + ''.join('        ' + line + '\n' for line in headers) + '    }\n}\n'
    normalize = lambda value: '\n'.join(line.strip() for line in value.splitlines() if line.strip() and not line.lstrip().startswith('#'))
    previous = rendered.replace('    @programme_hls path /api/broadcast/hls/*\n    # Defer until Next has written its response headers; scope to signed media.\n    header @programme_hls >Referrer-Policy "no-referrer"\n', '')
    if normalize(text) not in [normalize(legacy), normalize(previous), normalize(rendered)]:
        raise RuntimeError('Unrecognized production site directives; reconcile explicitly.')
    return rendered


def validate_activity(value, now=None):
    now = time.time() if now is None else now
    if not isinstance(value, dict) or value.get('format') != 1 or value.get('host') != HOST:
        raise RuntimeError('Unrecognized activity receipt.')
    try:
        timestamp = value['checkedAt']
        if not isinstance(timestamp, str):
            raise ValueError('Timestamp must be text.')
        parsed = datetime.datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Timestamp must include its timezone.')
        checked = parsed.timestamp()
    except (KeyError, ValueError, TypeError):
        raise RuntimeError('Activity receipt has no valid timestamp.')
    if not -5 <= now - checked <= 60:
        raise RuntimeError('Activity receipt is stale or from the future.')
    if value.get('activeRealShow') is not False or value.get('databaseWrites') != 0:
        raise RuntimeError('Activity receipt does not establish an unchanged, idle show state.')
    for name in ['production', 'staging']:
        environment = value.get('environments', {}).get(name, {})
        if environment.get('activeRealShow') is not False or any(environment.get(key) != 0 for key in ['freshRunningRows', 'freshProducerOrOutputSessions', 'freshCalls']):
            raise RuntimeError('Active or unconfirmed show/call state: ' + name)
    namespace = value.get('namespace', {})
    if namespace.get('sharedGameIds') != 0 or namespace.get('productionBroadcastRows') != 0:
        raise RuntimeError('Production/staging media namespace isolation is unconfirmed.')
    return True


def provider_idle(credentials):
    def encoded(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
    now = int(time.time())
    counts = {}
    for service, method, grants, body, field in [
        ('RoomService', 'ListRooms', {'roomList': True}, {}, 'rooms'),
        ('Egress', 'ListEgress', {'roomRecord': True}, {'active': True}, 'items'),
    ]:
        unsigned = encoded({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encoded({'iss': credentials['apiKey'], 'sub': 'milo-production-install', 'nbf': now - 5, 'exp': now + 30, 'video': grants})
        signature = base64.urlsafe_b64encode(hmac.new(credentials['apiSecret'].encode(), unsigned.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        request = urllib.request.Request('http://127.0.0.1:7880/twirp/livekit.' + service + '/' + method, data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + unsigned + '.' + signature, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=5) as response:
            data = json.load(response)
        if not isinstance(data, dict) or not isinstance(data.get(field, []), list):
            raise RuntimeError('Provider did not confirm an idle state.')
        records = data.get(field, [])
        if service == 'RoomService':
            counts['participants'] = sum(int(item.get('numParticipants', item.get('num_participants', 0))) for item in records)
        else:
            counts['activeEgress'] = len(records)
    if counts['participants'] or counts['activeEgress']:
        raise RuntimeError('Active media: restart refused.')
    return counts


def file_state(path):
    if not path.exists() and not path.is_symlink():
        return None
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RuntimeError('Managed target is not a unique regular file: ' + str(path))
    return {'data': path.read_bytes(), 'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}


def atomic_write(path, data, mode, uid=0, gid=0):
    if path.is_symlink():
        raise RuntimeError('Refusing managed target symlink: ' + str(path))
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), mode)
            os.fchown(handle.fileno(), uid, gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def same_file(path, desired):
    return file_state(path) == desired


def plan():
    credentials = json.loads(read_file(CREDENTIALS, private=True))
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,160}', credentials.get('apiKey', '')) or len(credentials.get('apiSecret', '')) < 32:
        raise RuntimeError('Existing SFU credentials are not recognized.')
    gid = grp.getgrnam('app-mil-prd').gr_gid
    staging = json.loads(read_file(BROADCAST / 'staging.json'))
    if staging.get('apiKey') != credentials['apiKey'] or staging.get('apiSecret') != credentials['apiSecret']:
        raise RuntimeError('Staging and SFU configuration disagree; do not rotate keys.')
    signing = secrets.token_hex(32)
    if PRODUCTION.exists():
        existing = json.loads(read_file(PRODUCTION))
        signing = existing.get('hls', {}).get('signingSecret', '')
        if not re.fullmatch(r'[a-f0-9]{64}', signing) or signing == staging.get('hls', {}).get('signingSecret'):
            raise RuntimeError('Production needs a distinct protected HLS signing secret.')
        if existing.get('apiKey') != credentials['apiKey'] or existing.get('apiSecret') != credentials['apiSecret']:
            raise RuntimeError('Existing production provider keys differ; explicit reconciliation required.')
    config = {'version': 1, 'enabled': True, 'url': 'wss://' + DOMAIN, 'apiKey': credentials['apiKey'], 'apiSecret': credentials['apiSecret'], 'hls': {'root': str(HLS), 'egressRoot': '/out-production', 'signingSecret': signing, 'tokenSeconds': 14400}, 'castAppId': 'CC1AD845'}
    files = {}
    def add(path, data, mode=0o644, uid=0, group=0):
        files[path] = {'data': data.encode() if isinstance(data, str) else data, 'mode': mode, 'uid': uid, 'gid': group}
    compose = compose_production(read_file(COMPOSE).decode())
    run('docker', 'compose', '-f', '-', '--project-directory', str(COMPOSE.parent), 'config', '--quiet', input=compose.encode())
    add(COMPOSE, compose, 0o640)
    add(SFU, sfu_production(read_file(SFU, trusted=False).decode()), 0o400, 65532, 65532)
    add(CADDY, caddy_production(read_file(CADDY).decode()))
    add(PRODUCTION, json.dumps(config, indent=2) + '\n', 0o640, 0, gid)
    helper = Path(__file__).resolve().parent / 'milo-media-sync-production-cert'
    add(SYNC, read_file(helper), 0o700)
    add(APP_DROPIN, '[Service]\nEnvironment=MILO_BROADCAST_CONFIG=/etc/milobingo-broadcast/production.json\n')
    add(MAINT_DROPIN, '[Service]\nExecStart=/usr/bin/find /srv/sites/milobingo-production/shared/broadcast-hls -mindepth 1 -type f -mmin +2880 -delete\nExecStart=/usr/bin/find /srv/sites/milobingo-production/shared/broadcast-hls -mindepth 1 -depth -type d -empty -delete\n')
    for suffix, destination in [('crt', 'cert.pem'), ('key', 'key.pem')]:
        source = SOURCE_CERT / (DOMAIN + '.' + suffix)
        if source.resolve() != source:
            raise RuntimeError('Caddy certificate paths may not contain symlinks.')
        add(TLS / destination, read_file(source, trusted=False), 0o400, 65532, 65532)
    # Validate the exact bytes to be installed, including during Caddy renewal.
    certificate = files[TLS / 'cert.pem']['data']
    private_key = files[TLS / 'key.pem']['data']
    cert_public = run('openssl', 'x509', '-pubkey', '-noout', input=certificate)
    key_public = run('openssl', 'pkey', '-pubout', input=private_key)
    run('openssl', 'x509', '-checkhost', DOMAIN, '-noout', input=certificate)
    run('openssl', 'x509', '-checkend', '3600', '-noout', input=certificate)
    if cert_public != key_public:
        raise RuntimeError('Caddy production certificate/key mismatch.')
    for target in files:
        if target not in [SFU, TLS / 'cert.pem', TLS / 'key.pem']:
            # Parent of a new drop-in directory is validated separately.
            trusted_parents(target if target.parent.exists() else target.parent)
        elif target.resolve() != target:
            raise RuntimeError('Media configuration may not contain symlink ancestors.')
    directories = {BROADCAST: (0o755, 0, 0), HLS: (0o2750, 63001, gid), APP_DROPIN.parent: (0o755, 0, 0), MAINT_DROPIN.parent: (0o755, 0, 0)}
    for directory in directories:
        if directory.is_symlink() or directory.exists() and not directory.is_dir():
            raise RuntimeError('Managed directory may not be a symlink: ' + str(directory))
    return files, directories, credentials


def hls_parent_fd(path, expected_parent_uid=None):
    """Pin the app-owned parent; no root pathname chown through its children."""
    parent = path.parent
    if parent.resolve() != parent:
        raise RuntimeError('HLS parent must not contain symlinks.')
    trusted_parents(parent)
    descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        expected = pwd.getpwnam('app-mil-prd').pw_uid if expected_parent_uid is None else expected_parent_uid
        if info.st_uid != expected or info.st_mode & 0o022:
            raise RuntimeError('Unexpected HLS parent ownership or permissions.')
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def set_hls_directory(path, mode, uid, gid, expected_parent_uid=None):
    parent = hls_parent_fd(path, expected_parent_uid)
    try:
        try:
            os.mkdir(path.name, mode=0o700, dir_fd=parent)
        except FileExistsError:
            pass
        child = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            os.fchown(child, uid, gid)
            os.fchmod(child, mode)
            current = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
            pinned = os.fstat(child)
            if (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino):
                raise RuntimeError('HLS directory changed during setup.')
        finally:
            os.close(child)
    finally:
        os.close(parent)


def remove_hls_directory(path):
    parent = hls_parent_fd(path)
    try:
        os.rmdir(path.name, dir_fd=parent)
    finally:
        os.close(parent)


def directory_state(path):
    if not path.exists():
        return None
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise RuntimeError('Expected a directory: ' + str(path))
    return (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)


def caddy_inventory():
    return {str(path): hashlib.sha256(read_file(path)).hexdigest() for path in Path('/etc/caddy/sites').glob('*.caddy') if path != CADDY}


def apply(files, directories, credentials, evidence):
    changes = {path: value for path, value in files.items() if not same_file(path, value)}
    changed_directories = {path: value for path, value in directories.items() if directory_state(path) != value}
    if not changes and not changed_directories:
        return {'applied': False, 'changed': False, 'productionAppRestarted': False, 'note': 'Already configured; no services restarted.'}
    validate_activity(json.loads(read_file(evidence, private=True)))
    provider = provider_idle(credentials)
    inventory = caddy_inventory()
    if BACKUPS.exists():
        trusted_parents(BACKUPS / 'placeholder')
    else:
        trusted_parents(BACKUPS)
        BACKUPS.mkdir(mode=0o700)
    if BACKUPS.stat().st_mode & 0o077:
        raise RuntimeError('Backup directory must remain root-only.')
    backup = BACKUPS / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + secrets.token_hex(4))
    backup.mkdir(mode=0o700)
    originals = {path: file_state(path) for path in changes}
    replaces_certificate = any(path in changes for path in [SFU, TLS / 'cert.pem', TLS / 'key.pem'])
    if replaces_certificate and PENDING.exists():
        read_file(PENDING, private=True)
        originals[PENDING] = file_state(PENDING)
    original_directories = {path: directory_state(path) for path in changed_directories}
    manifest = {'format': 1, 'host': HOST, 'files': {}, 'directories': {}, 'unrelatedCaddy': inventory, 'provider': provider}
    for index, (path, value) in enumerate(originals.items()):
        record = None
        if value is not None:
            name = str(index) + '.original'
            atomic_write(backup / name, value['data'], 0o600)
            record = {key: value[key] for key in ['mode', 'uid', 'gid']}
            record['backup'] = name
            record['sha256'] = hashlib.sha256(value['data']).hexdigest()
        manifest['files'][str(path)] = record
    manifest['directories'] = {str(path): value for path, value in original_directories.items()}
    atomic_write(backup / 'manifest.json', json.dumps(manifest, indent=2).encode(), 0o600)
    atomic_write(backup / 'activity.json', read_file(evidence, private=True), 0o600)
    services = []
    if COMPOSE in changes:
        services.append('egress')
    if SFU in changes or TLS / 'cert.pem' in changes or TLS / 'key.pem' in changes:
        services.append('livekit')
    daemon_reloaded = False
    media_touched = False
    try:
        # Recheck immediately before the first host mutation.
        validate_activity(json.loads(read_file(evidence, private=True)))
        provider_idle(credentials)
        for path, (mode, uid, gid) in changed_directories.items():
            if path == HLS:
                set_hls_directory(path, mode, uid, gid)
            else:
                path.mkdir(exist_ok=True)
                os.chown(path, uid, gid)
                path.chmod(mode)
        for path, value in changes.items():
            atomic_write(path, **value)
        run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
        run('docker', 'compose', '-f', str(COMPOSE), 'config', '--quiet')
        if caddy_inventory() != inventory:
            raise RuntimeError('An unrelated Caddy fragment changed; refusing promotion.')
        run('systemctl', 'daemon-reload')
        daemon_reloaded = True
        if services:
            provider_idle(credentials)
            # up recreates Egress only for its changed mount. Existing SFU YAML
            # is a bind mount, so LiveKit needs an explicit restart.
            if 'egress' in services:
                media_touched = True
                run('docker', 'compose', '-f', str(COMPOSE), 'up', '-d', '--wait', '--no-deps', 'egress')
            if 'livekit' in services:
                media_touched = True
                run('docker', 'compose', '-f', str(COMPOSE), 'restart', 'livekit')
                run('docker', 'compose', '-f', str(COMPOSE), 'up', '-d', '--wait', '--no-deps', 'livekit')
            for attempt in range(20):
                try:
                    provider_idle(credentials)
                    break
                except Exception:
                    if attempt == 19:
                        raise
                    time.sleep(0.5)
        if CADDY in changes:
            run('systemctl', 'reload', 'caddy.service')
        if caddy_inventory() != inventory:
            raise RuntimeError('An unrelated Caddy fragment changed during promotion.')
        if 'livekit' in services and PENDING.exists():
            if PENDING.is_symlink():
                raise RuntimeError('Unexpected certificate-pending symlink.')
            PENDING.unlink()
        result = {'applied': True, 'changed': True, 'backup': str(backup), 'changedFiles': [str(path) for path in changes], 'mediaServicesRestarted': services, 'productionAppRestarted': False, 'unrelatedCaddyUnchanged': True}
        atomic_write(backup / 'result.json', json.dumps(result, indent=2).encode(), 0o600)
        return result
    except Exception:
        errors = []
        for path, value in originals.items():
            try:
                if value is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, **value)
            except Exception:
                errors.append('file:' + str(path))
        for path, value in reversed(list(original_directories.items())):
            try:
                if value is None:
                    if path == HLS:
                        remove_hls_directory(path)
                    else:
                        path.rmdir()
                else:
                    mode, uid, gid = value
                    if path == HLS:
                        set_hls_directory(path, mode, uid, gid)
                    else:
                        os.chown(path, uid, gid)
                        path.chmod(mode)
            except Exception:
                errors.append('directory:' + str(path))
        if daemon_reloaded:
            try:
                run('systemctl', 'daemon-reload')
            except Exception:
                errors.append('daemon-reload')
        if media_touched:
            try:
                run('docker', 'compose', '-f', str(COMPOSE), 'up', '-d', '--wait', '--no-deps', 'egress')
                run('docker', 'compose', '-f', str(COMPOSE), 'restart', 'livekit')
            except Exception:
                errors.append('media-restore')
        try:
            run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
            run('systemctl', 'reload', 'caddy.service')
        except Exception:
            errors.append('caddy-restore')
        atomic_write(backup / 'rollback.json', json.dumps({'rolledBack': not errors, 'errors': errors}).encode(), 0o600)
        raise RuntimeError('Production media setup failed; protected backup: ' + str(backup) + ('; rollback requires attention: ' + ', '.join(errors) if errors else '; managed files restored.'))



def rollback_manifest(backup):
    if backup.parent != BACKUPS or not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{8}', backup.name):
        raise RuntimeError('Select one exact protected production backup directory.')
    trusted_parents(backup / 'manifest.json')
    if backup.is_symlink() or backup.stat().st_mode & 0o077:
        raise RuntimeError('Backup directory must remain root-owned and private.')
    value = json.loads(read_file(backup / 'manifest.json', private=True))
    if value.get('format') != 1 or value.get('host') != HOST or not isinstance(value.get('files'), dict) or not isinstance(value.get('directories'), dict) or not isinstance(value.get('unrelatedCaddy'), dict):
        raise RuntimeError('Unrecognized production rollback manifest.')
    metadata = {
        COMPOSE: {(0o640, 0, 0), (0o644, 0, 0)}, SFU: {(0o400, 65532, 65532)},
        CADDY: {(0o644, 0, 0)}, PRODUCTION: {(0o640, 0, grp.getgrnam('app-mil-prd').gr_gid)},
        SYNC: {(0o700, 0, 0)}, APP_DROPIN: {(0o644, 0, 0)}, MAINT_DROPIN: {(0o644, 0, 0)},
        TLS / 'cert.pem': {(0o400, 65532, 65532)}, TLS / 'key.pem': {(0o400, 65532, 65532)},
        PENDING: {(0o600, 0, 0)},
    }
    originals, names = {}, set()
    for raw, record in value['files'].items():
        path = Path(raw)
        if path not in metadata or str(path) != raw:
            raise RuntimeError('Backup contains a path outside the Milo rollback allowlist.')
        if record is None:
            originals[path] = None
            continue
        if not isinstance(record, dict) or not all(type(record.get(key)) is int for key in ['mode', 'uid', 'gid']) or tuple(record[key] for key in ['mode', 'uid', 'gid']) not in metadata[path]:
            raise RuntimeError('Backup file metadata is not an approved original state.')
        name = record.get('backup', '')
        if not re.fullmatch(r'\d+\.original', name) or name in names or not re.fullmatch(r'[a-f0-9]{64}', record.get('sha256', '')):
            raise RuntimeError('Backup file identity is invalid or duplicated.')
        names.add(name)
        data = read_file(backup / name, private=True)
        if hashlib.sha256(data).hexdigest() != record['sha256']:
            raise RuntimeError('Backup original hash mismatch.')
        originals[path] = {'data': data, **{key: record[key] for key in ['mode', 'uid', 'gid']}}
    directory_metadata = {
        BROADCAST: {(0o750, 0, grp.getgrnam('app-mil-stg').gr_gid), (0o755, 0, 0)},
        HLS: {(0o2750, 63001, grp.getgrnam('app-mil-prd').gr_gid)},
        APP_DROPIN.parent: {(0o755, 0, 0)}, MAINT_DROPIN.parent: {(0o755, 0, 0)},
    }
    directories = {}
    for raw, record in value['directories'].items():
        path = Path(raw)
        if path not in directory_metadata or str(path) != raw or record is not None and (not isinstance(record, list) or len(record) != 3 or not all(type(item) is int for item in record) or tuple(record) not in directory_metadata[path]):
            raise RuntimeError('Backup directory metadata is outside the rollback allowlist.')
        directories[path] = None if record is None else tuple(record)
    if not originals:
        raise RuntimeError('The selected backup contains no managed changes.')
    return originals, directories, value['unrelatedCaddy']


def rollback_activity(evidence):
    value = json.loads(read_file(evidence, private=True))
    # Existing inactive media configuration is legitimate after production use;
    # the original strict zero-record condition remains unchanged for apply.
    count = value.get('namespace', {}).get('productionBroadcastRows')
    if type(count) is not int or count < 0:
        raise RuntimeError('Rollback activity does not establish production media state.')
    value = {**value, 'namespace': {**value['namespace'], 'productionBroadcastRows': 0}}
    validate_activity(value)


def restore_directory(path, state):
    if state is None:
        if not path.exists() and not path.is_symlink():
            return False
        try:
            if path == HLS:
                remove_hls_directory(path)
            else:
                if path.is_symlink():
                    raise RuntimeError('Refusing rollback directory symlink.')
                path.rmdir()
            return False
        except OSError as error:
            if error.errno in [__import__('errno').ENOTEMPTY, __import__('errno').EEXIST]:
                return True  # Preserve media and any unrelated directory contents.
            raise
    mode, uid, gid = state
    if path == HLS:
        set_hls_directory(path, mode, uid, gid)
    else:
        if path.is_symlink() or not path.is_dir():
            raise RuntimeError('Rollback directory must remain a real directory.')
        os.chown(path, uid, gid)
        path.chmod(mode)
    return False


def rollback(backup, evidence):
    originals, directories, inventory = rollback_manifest(backup)
    if caddy_inventory() != inventory:
        raise RuntimeError('Unrelated Caddy configuration changed since this backup; reconcile first.')
    # Refuse unrecognized additions even within the Milo production fragment.
    caddy_production(read_file(CADDY).decode())
    for path in originals:
        if path not in [SFU, TLS / 'cert.pem', TLS / 'key.pem']:
            trusted_parents(path if path.parent.exists() else path.parent)
        elif path.resolve() != path:
            raise RuntimeError('Rollback target has symlink ancestors.')
        file_state(path)
    current = {path: file_state(path) for path in originals}
    current_directories = {path: directory_state(path) for path in directories}
    changes = {path: state for path, state in originals.items() if current[path] != state}
    changed_directories = {path: state for path, state in directories.items() if current_directories[path] != state}
    if not changes and not changed_directories:
        return {'rolledBack': True, 'changed': False, 'backup': str(backup), 'productionAppRestarted': False}
    rollback_activity(evidence)
    credentials = json.loads(read_file(CREDENTIALS, private=True))
    provider_idle(credentials)
    services = []
    if COMPOSE in changes:
        services.append('egress')
    if any(path in changes for path in [SFU, TLS / 'cert.pem', TLS / 'key.pem']):
        services.append('livekit')
    app_restart = APP_DROPIN in changes
    retained = []
    media_touched = False
    app_restarted = False
    def restart_media():
        nonlocal media_touched
        if services:
            media_touched = True
        if 'egress' in services:
            run('docker', 'compose', '-f', str(COMPOSE), 'up', '-d', '--wait', '--no-deps', 'egress')
        if 'livekit' in services:
            run('docker', 'compose', '-f', str(COMPOSE), 'restart', 'livekit')
            run('docker', 'compose', '-f', str(COMPOSE), 'up', '-d', '--wait', '--no-deps', 'livekit')
    try:
        rollback_activity(evidence)
        provider_idle(credentials)
        for path, state in changes.items():
            if state is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, **state)
        run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
        run('docker', 'compose', '-f', str(COMPOSE), 'config', '--quiet')
        if caddy_inventory() != inventory:
            raise RuntimeError('Unrelated Caddy configuration changed during rollback.')
        run('systemctl', 'daemon-reload')
        provider_idle(credentials)
        restart_media()
        if CADDY in changes:
            run('systemctl', 'reload', 'caddy.service')
        for attempt in range(20):
            try:
                provider_idle(credentials)
                break
            except Exception:
                if attempt == 19:
                    raise
                time.sleep(0.5)
        if app_restart:
            app_restarted = True
            run('systemctl', 'restart', 'milobingo-production.service')
        for path, state in reversed(list(changed_directories.items())):
            if restore_directory(path, state):
                retained.append(str(path))
        result = {'rolledBack': True, 'changed': True, 'backup': str(backup), 'restoredFiles': [str(path) for path in changes], 'mediaServicesRestarted': services, 'productionAppRestarted': app_restart, 'retainedNonemptyDirectories': retained, 'databaseChanged': False, 'redisChanged': False}
        atomic_write(backup / ('manual-rollback-' + str(int(time.time())) + '.json'), json.dumps(result, indent=2).encode(), 0o600)
        return result
    except Exception:
        errors = []
        # Keep the working production configuration recoverable after any failed
        # rollback; only files/directories from this exact allowlisted manifest.
        for path, state in current_directories.items():
            if state is not None and not path.exists():
                try:
                    if path == HLS:
                        set_hls_directory(path, *state)
                    else:
                        path.mkdir()
                except Exception:
                    errors.append('directory:' + str(path))
        for path, state in current.items():
            try:
                if state is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, **state)
            except Exception:
                errors.append('file:' + str(path))
        for path, state in current_directories.items():
            if state is not None:
                try:
                    restore_directory(path, state)
                except Exception:
                    errors.append('metadata:' + str(path))
        try:
            run('systemctl', 'daemon-reload')
            if media_touched:
                restart_media()
            run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
            run('systemctl', 'reload', 'caddy.service')
            if app_restarted:
                run('systemctl', 'restart', 'milobingo-production.service')
        except Exception:
            errors.append('service-restore')
        raise RuntimeError('Manual rollback failed; current configuration ' + ('requires protected host recovery: ' + ', '.join(errors) if errors else 'was restored.'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'apply', 'rollback'])
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--activity-evidence', type=Path)
    args = parser.parse_args(argv)
    if os.geteuid() != 0 or socket.gethostname() != HOST:
        raise RuntimeError('Run only as root on verified ' + HOST + '.')
    if '128.140.93.95' not in run('ip', '-4', 'addr').decode():
        raise RuntimeError('The verified public IPv4 address is missing.')
    if args.action == 'rollback':
        if not args.backup or not args.activity_evidence:
            raise RuntimeError('Rollback requires --backup and --activity-evidence.')
        print(json.dumps(rollback(args.backup, args.activity_evidence), indent=2))
        return
    if args.backup:
        raise RuntimeError('--backup applies only to rollback.')
    files, directories, credentials = plan()
    if args.action == 'apply':
        if not args.activity_evidence:
            raise RuntimeError('Apply requires --activity-evidence from the protected root activity check.')
        result = apply(files, directories, credentials, args.activity_evidence)
    else:
        result = {'plan': True, 'changedFiles': [str(path) for path, value in files.items() if not same_file(path, value)], 'changedDirectories': [str(path) for path, value in directories.items() if directory_state(path) != value], 'productionAppRestarted': False, 'secretsPrinted': False}
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=__import__('sys').stderr)
        raise SystemExit(1)
