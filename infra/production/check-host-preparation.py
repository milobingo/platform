#!/usr/bin/python3
"""Offline adversarial checks; no host/account/firewall/provider mutations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('milo_production_host', Path(__file__).with_name('prepare-host.py'))
host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host)
ACCOUNTS = {name: {'uid': 21000 + index, 'gid': 22000 + index}
            for index, name in enumerate(host.NAMES)}


class HostPreparation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = '''import {loadProductionProfile} from './scripts/deploy/production-profile.mjs';
import {renderProtectedProductionBundle} from './scripts/deploy/protected-production-render.mjs';
const profile=await loadProductionProfile('infra/production/profile.proposed.json');
process.stdout.write(JSON.stringify(await renderProtectedProductionBundle(profile,{accounts:JSON.parse(process.argv[1]),configIds:['production-2026-11-15-v1']})));
'''
        cls.bundle = json.loads(subprocess.run(['node', '--input-type=module', '-e', script,
                                                json.dumps(ACCOUNTS)], cwd=ROOT,
                                               capture_output=True, text=True,
                                               check=True, timeout=30).stdout)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='milo-host-fixture-')
        self.directory = Path(self.temporary.name)
        for name, item in self.bundle['files'].items():
            (self.directory / name).write_text(item['content'])
        self.manifest = json.loads(json.dumps(self.bundle['manifest']))
        self.manifest_digest = self.write_manifest()
        # Owner checks are tested separately. No production paths are written.
        self.owner = patch.object(host, 'trusted', side_effect=lambda path, directory=False: Path(path))
        self.owner.start()
        self.accounts = patch.object(host, 'accounts', return_value=ACCOUNTS)
        self.accounts.start()

    def tearDown(self):
        self.accounts.stop()
        self.owner.stop()
        self.temporary.cleanup()

    def write_manifest(self):
        raw = (json.dumps(self.manifest) + '\n').encode()
        (self.directory / 'manifest.json').write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def plan(self):
        return host.bundle_plan(self.directory, self.manifest_digest)

    def test_actual_renderer_bundle_keeps_route_staged_and_repository_files_outside_host(self):
        plan = self.plan()
        paths = [str(path) for path, _, _ in plan]
        self.assertIn('/etc/dg-sites/milobingo-production/site.caddy.prepared', paths)
        self.assertNotIn('/etc/caddy/sites/milobingo-production.caddy', paths)
        self.assertEqual(len(paths), 11)
        self.assertFalse(any(path.startswith('infra/') or path.startswith('.github/') for path in paths))
        self.assertFalse(any('runtime.json' in path or 'staging-acceptance/' in path for path in paths))

    def test_independent_manifest_hash_is_required(self):
        with self.assertRaises(ValueError):
            host.bundle_plan(self.directory, '0' * 64)

    def test_modified_helper_bytes_are_refused(self):
        with (self.directory / 'deploy-helper.py').open('a') as output:
            output.write('\n# changed\n')
        with self.assertRaises(ValueError):
            self.plan()

    def test_manifest_cannot_redirect_a_file_to_another_site_even_with_new_manifest_hash(self):
        self.manifest['files']['site.caddy']['destination'] = '/etc/caddy/sites/dartflow-production.caddy'
        self.manifest_digest = self.write_manifest()
        with self.assertRaises(ValueError):
            self.plan()

    def test_unknown_install_target_is_refused(self):
        self.manifest['files']['extra'] = {'destination': '/etc/sudoers', 'mode': '0440', 'sha256': '0' * 64}
        self.manifest_digest = self.write_manifest()
        with self.assertRaises(ValueError):
            self.plan()

    def test_actual_accounts_are_rechecked(self):
        other = {**ACCOUNTS, host.NAMES[0]: {'uid': 31000, 'gid': 32000}}
        with patch.object(host, 'accounts', return_value=other), self.assertRaises(ValueError):
            self.plan()

    def test_source_symlinks_are_not_followed(self):
        original = self.directory / 'deploy-helper.py'
        relocated = self.directory / 'untrusted.py'
        original.rename(relocated)
        original.symlink_to(relocated)
        with self.assertRaises(OSError):
            self.plan()

    def test_publication_never_overwrites_different_bytes_or_changes_modes(self):
        path = self.directory / 'new-private.json'
        self.assertTrue(host.publish(path, b'first', 0o600))
        self.assertFalse(host.publish(path, b'first', 0o600))
        with self.assertRaises(ValueError):
            host.publish(path, b'second', 0o600)
        with self.assertRaises(ValueError):
            host.publish(path, b'first', 0o644)
        self.assertEqual(path.read_bytes(), b'first')
        self.assertEqual(path.stat().st_nlink, 1)

    def test_failed_write_leaves_no_partial_executable_or_temporary_file(self):
        path = self.directory / 'new-executable'
        with patch.object(host.os, 'fsync', side_effect=OSError('fixture disk failure')):
            with self.assertRaises(OSError):
                host.publish(path, b'#!/usr/bin/python3\n', 0o755)
        self.assertFalse(path.exists())
        self.assertEqual(list(self.directory.glob('.milo-prepare-*')), [])

    def test_root_ownership_validation_rejects_unprivileged_paths(self):
        self.owner.stop()
        try:
            if self.directory.stat().st_uid == 0:
                self.skipTest('Unprivileged-owner fixture requires a non-root test process')
            with self.assertRaises(ValueError):
                host.trusted(self.directory, directory=True)
        finally:
            self.owner.start()

    def test_install_stage_uses_only_visudo_and_never_starts_services_or_changes_network(self):
        writes = []
        existing = Path.exists
        linked = Path.is_symlink
        with patch.object(host, 'check_port'), patch.object(host, 'command') as command, \
                patch.object(Path, 'exists', autospec=True,
                             side_effect=lambda path: existing(path) if path.is_relative_to(self.directory) else False), \
                patch.object(Path, 'is_symlink', autospec=True,
                             side_effect=lambda path: linked(path) if path.is_relative_to(self.directory) else False), \
                patch.object(host, 'publish', side_effect=lambda path, body, mode: writes.append(str(path)) or True):
            result = host.install_bundle(self.directory, self.manifest_digest)
        command.assert_called_once_with(['/usr/sbin/visudo', '-cf', str(self.directory / 'deploy.sudoers')])
        self.assertFalse(result['servicesStarted'])
        self.assertFalse(result['systemdReloaded'])
        self.assertFalse(result['firewallChanged'])
        self.assertFalse(result['publicRouteInstalled'])
        self.assertIn('/etc/systemd/system/milobingo-production-runner.service', writes)
        self.assertIn('/etc/systemd/system/milobingo-production.service.d/control-plane.conf', writes)
        self.assertIn(host.GUARD, writes)
        self.assertIn('Requires=' + host.GUARD_UNIT, host.APP_GUARD_DROPIN)
        self.assertIn('After=' + host.GUARD_UNIT, host.APP_GUARD_DROPIN)
        self.assertIn('WorkingDirectory=' + str(host.RUNNER_ROOT), host.RUNNER_SERVICE)
        self.assertIn('ExecStart=' + str(host.RUNNER_ROOT) + '/bin/runsvc.sh\n', host.RUNNER_SERVICE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
