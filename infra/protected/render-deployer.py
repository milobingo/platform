#!/usr/bin/python3 -I
"""Render fixed Milo broker files for review, never install or activate them."""
import argparse
import hashlib
import json
from pathlib import Path
import re

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[1]
LEGACY_HASH = 'ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8'
CONFIG_RE = r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def render(output, config_ids=(), accounts=None):
    legacy = ROOT / 'infra/staging/deploy-helper.py'
    if digest(legacy.read_bytes()) != LEGACY_HASH:
        raise ValueError('The reviewed legacy dependency changed')
    if len(set(config_ids)) != len(config_ids) or not all(re.fullmatch(CONFIG_RE, c) for c in config_ids):
        raise ValueError('Use unique safe configuration identifiers')
    output = Path(output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    files = {}

    def put(path, data, mode):
        data = data.encode() if isinstance(data, str) else data
        target = output / path.lstrip('/')
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(0o600)
        files[path] = {'sha256': digest(data), 'bytes': len(data), 'mode': mode}
        return digest(data)

    helper = put('/usr/local/libexec/dg-milo-deploy-helper', (SOURCE / 'deploy-helper.py').read_bytes(), '0755')
    gate = put('/usr/local/libexec/milo-protected-release-gate.mjs', (SOURCE / 'release-gate.mjs').read_bytes(), '0644')
    extractor = put('/usr/local/libexec/milo-protected-extract-source.py', (SOURCE / 'extract-source.py').read_bytes(), '0755')
    guardian = put('/usr/local/libexec/milo-protected-lock-guardian.py', (SOURCE / 'lock-guardian.py').read_bytes(), '0755')
    entry = (SOURCE / 'deploy-entry.py').read_text().replace('__HELPER_SHA256__', helper)
    put('/usr/local/bin/dg-milo-deploy', entry, '0755')
    sudoers = (f'run-mil-stg ALL=(root) NOPASSWD:NOSETENV: sha256:{helper} '
        '/usr/local/libexec/dg-milo-deploy-helper '
        '^deploy [a-f0-9]{40} [1-9][0-9]*-[1-9][0-9]* [A-Za-z0-9][A-Za-z0-9_.-]*$\n')
    put('/etc/sudoers.d/milobingo-protected-deploy', sudoers, '0440')
    policy = json.loads((SOURCE / 'deploy-policy.example.json').read_text())
    policy.update(allowedConfigIds=list(config_ids), gateSha256=gate,
        extractorSha256=extractor, guardianSha256=guardian)
    if accounts is not None:
        if not isinstance(accounts, dict) or set(accounts) != set(policy['accounts']):
            raise ValueError('Require exactly the three verified account identities')
        for identity in accounts.values():
            if not isinstance(identity, dict) or set(identity) != {'uid', 'gid'} or not all(
                    type(v) is int and v > 0 for v in identity.values()):
                raise ValueError('Account identities must be positive verified integers')
        policy['accounts'] = accounts
    put('/etc/dg-sites/milobingo-staging/protected-deploy.json', json.dumps(policy, indent=2) + '\n', '0600')
    manifest = {'format': 'milo-protected-broker-v1', 'installed': False,
        'policyComplete': bool(config_ids) and accounts is not None,
        'site': 'milobingo-staging', 'host': 'dg-nxttrack-01', 'port': 4173,
        'runtimeBundles': '/etc/dg-sites/milobingo-staging/configs/<config_id>/runtime.json',
        'legacyDependency': {'path': '/usr/local/libexec/dg-milobingo-deploy-helper', 'sha256': LEGACY_HASH},
        'files': files}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'manifest.json').chmod(0o600)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--config-id', action='append', default=[])
    parser.add_argument('--accounts-json', type=Path, help='Only verified uid/gid metadata, no credentials')
    options = parser.parse_args()
    identities = json.loads(options.accounts_json.read_text()) if options.accounts_json else None
    value = render(options.output, options.config_id, identities)
    print(json.dumps({'rendered': True, 'installed': False, 'policyComplete': value['policyComplete'],
        'fileCount': len(value['files']), 'credentialsIncluded': False}))
