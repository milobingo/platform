#!/usr/bin/env python3
"""Focused safety checks for the production promotion, without a VPS or secrets."""
import copy
import datetime
import importlib.machinery
import importlib.util
import io
import hashlib
from types import SimpleNamespace
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    value = importlib.util.module_from_spec(spec)
    loader.exec_module(value)
    return value


INSTALL = module('milo_production_media', ROOT / 'infra/media/install-production.py')
CERT = module('milo_production_certificate', ROOT / 'infra/media/milo-media-sync-production-cert')


def receipt():
    return {'format': 1, 'host': 'dg-nxttrack-01', 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'activeRealShow': False, 'environments': {name: {'activeRealShow': False, 'freshRunningRows': 0, 'freshProducerOrOutputSessions': 0, 'freshCalls': 0} for name in ['production', 'staging']}, 'namespace': {'sharedGameIds': 0, 'productionBroadcastRows': 0}, 'databaseWrites': 0}


CADDY = '''milo.dgwebservices.nl {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4178 {
        header_up Host milo.dgwebservices.nl
        header_up X-Forwarded-Host milo.dgwebservices.nl
        header_up X-Forwarded-Proto https
        header_up -oai-authenticated-user-id
        header_up -oai-authenticated-user-email
        header_up -x-milo-user
        header_up -x-milo-role
    }
}
'''


class ProductionTransforms(unittest.TestCase):
    def test_compose_keeps_every_original_line_and_is_idempotent(self):
        before = (ROOT / 'infra/media/compose.yaml').read_text()
        after = INSTALL.compose_production(before)
        added = '      - /srv/sites/milobingo-production/shared/broadcast-hls:/out-production\n'
        self.assertEqual(after.replace(added, ''), before)
        self.assertEqual(INSTALL.compose_production(after), after)
        self.assertEqual(after.count(added), 1)

    def test_compose_rejects_missing_duplicate_and_unexpected_mounts(self):
        original = (ROOT / 'infra/media/compose.yaml').read_text()
        for text in [original.replace(':/out\n', ':/different\n'), original + '      - /srv/sites/milobingo-staging/shared/broadcast-hls:/out\n', original + '      - /unknown:/out-production\n']:
            with self.subTest(text=text[-80:]):
                with self.assertRaises(RuntimeError):
                    INSTALL.compose_production(text)

    def test_sfu_changes_only_canonical_domains_keeps_keys_ports(self):
        before = (ROOT / 'infra/media/livekit.yaml.example').read_text()
        expected = before.replace('milo-staging.dgwebservices.nl', 'milo.dgwebservices.nl')
        self.assertEqual(INSTALL.sfu_production(before), expected)
        self.assertEqual(INSTALL.sfu_production(expected), expected)
        for invalid in [before.replace('  domain:', '  wrong:'), before.replace('milo-staging.dgwebservices.nl', 'unapproved.example')]:
            with self.assertRaises(RuntimeError):
                INSTALL.sfu_production(invalid)

    def test_caddy_preserves_exact_app_headers_and_hides_upstream_errors(self):
        rendered = INSTALL.caddy_production(CADDY)
        self.assertIn('handle_errors {', rendered)
        self.assertIn('handle_path /whip/*', rendered)
        self.assertIn('rewrite * /w{path}', rendered)
        self.assertIn('reverse_proxy 127.0.0.1:7880', rendered)
        self.assertIn('@programme_hls path /api/broadcast/hls/*', rendered)
        self.assertIn('header @programme_hls >Referrer-Policy "no-referrer"', rendered)
        self.assertEqual(rendered.count('Referrer-Policy'), 1)
        self.assertNotIn('header >Referrer-Policy', rendered)
        previous = rendered.replace('    @programme_hls path /api/broadcast/hls/*\n    # Defer until Next has written its response headers; scope to signed media.\n    header @programme_hls >Referrer-Policy "no-referrer"\n', '')
        self.assertEqual(INSTALL.caddy_production(previous), rendered)
        self.assertEqual([line.strip() for line in rendered.splitlines() if 'header_up' in line], [line.strip() for line in CADDY.splitlines() if 'header_up' in line])
        self.assertEqual(INSTALL.caddy_production(rendered), rendered)

    def test_caddy_refuses_modified_headers_logging_other_upstreams(self):
        for text in [CADDY.replace('header_up Host milo.dgwebservices.nl', 'header_up Host other.example'), CADDY.replace('    encode', '    log\n    encode'), CADDY.replace('4178', '4173'), CADDY.replace('    encode', '    import arbitrary\n    encode')]:
            with self.assertRaises(RuntimeError):
                INSTALL.caddy_production(text)

    def test_activity_requires_fresh_unambiguous_idle_both_environments(self):
        good = receipt()
        self.assertTrue(INSTALL.validate_activity(good))
        cases = []
        old = copy.deepcopy(good)
        old['checkedAt'] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=61)).isoformat()
        cases.append(old)
        future = copy.deepcopy(good)
        future['checkedAt'] = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=6)).isoformat()
        cases.append(future)
        for name in ['production', 'staging']:
            for field in ['freshRunningRows', 'freshProducerOrOutputSessions', 'freshCalls']:
                bad = copy.deepcopy(good)
                bad['environments'][name][field] = 1
                cases.append(bad)
        for field in ['sharedGameIds', 'productionBroadcastRows']:
            bad = copy.deepcopy(good)
            bad['namespace'][field] = 1
            cases.append(bad)
        bad = copy.deepcopy(good)
        del bad['environments']['staging']
        cases.append(bad)
        for index, value in enumerate(cases):
            with self.subTest(case=index):
                with self.assertRaises(RuntimeError):
                    INSTALL.validate_activity(value)

    def test_activity_rejects_wrong_host_writes_and_missing_time(self):
        for field, value in [('host', 'another-vps'), ('databaseWrites', 1), ('activeRealShow', True), ('checkedAt', None)]:
            bad = receipt()
            bad[field] = value
            with self.assertRaises(RuntimeError):
                INSTALL.validate_activity(bad)


class ProviderSafety(unittest.TestCase):
    def provider(self, rooms=None, egress=None):
        bodies = [{'rooms': [] if rooms is None else rooms}, {'items': [] if egress is None else egress}]
        captured = []
        def open_request(request, timeout):
            captured.append(request)
            return io.BytesIO(json.dumps(bodies.pop(0)).encode())
        return open_request, captured

    def test_provider_checks_rooms_and_active_egress_with_server_auth(self):
        opener, requests = self.provider()
        with patch.object(INSTALL.urllib.request, 'urlopen', opener):
            self.assertEqual(INSTALL.provider_idle({'apiKey': 'synthetic-key', 'apiSecret': 'synthetic-secret'}), {'participants': 0, 'activeEgress': 0})
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(request.full_url.startswith('http://127.0.0.1:7880/') for request in requests))
        self.assertTrue(all(request.headers['Authorization'].startswith('Bearer ') for request in requests))
        self.assertEqual(json.loads(requests[1].data), {'active': True})

    def test_provider_refuses_participants_active_egress_and_outage(self):
        for rooms, egress in [([{'numParticipants': 1}], []), ([], [{'egressId': 'synthetic'}])]:
            opener, _ = self.provider(rooms, egress)
            with patch.object(INSTALL.urllib.request, 'urlopen', opener):
                with self.assertRaises(RuntimeError):
                    INSTALL.provider_idle({'apiKey': 'synthetic-key', 'apiSecret': 'synthetic-secret'})
        with patch.object(INSTALL.urllib.request, 'urlopen', side_effect=TimeoutError('unreachable')):
            with self.assertRaises(TimeoutError):
                INSTALL.provider_idle({'apiKey': 'synthetic-key', 'apiSecret': 'synthetic-secret'})

    def test_certificate_maintenance_defers_for_private_rooms_and_egress(self):
        for rooms, egress, expected in [([], [], True), ([{'num_participants': 1}], [], False), ([], [{'egressId': 'synthetic'}], False)]:
            opener, _ = self.provider(rooms, egress)
            with patch.object(CERT.urllib.request, 'urlopen', opener):
                self.assertEqual(CERT.idle_provider({'apiKey': 'synthetic-key', 'apiSecret': 'synthetic-secret'}), expected)


class FilesystemSafety(unittest.TestCase):
    def test_atomic_write_is_private_and_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'private.json'
            INSTALL.atomic_write(target, b'private synthetic data', 0o600, os.getuid(), os.getgid())
            self.assertEqual(target.read_bytes(), b'private synthetic data')
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            linked = root / 'link'
            linked.symlink_to(target)
            with self.assertRaises(RuntimeError):
                INSTALL.atomic_write(linked, b'changed', 0o600, os.getuid(), os.getgid())
            self.assertEqual(target.read_bytes(), b'private synthetic data')

    def test_hls_directory_uses_pinned_fd_and_refuses_app_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent = root / 'shared'
            parent.mkdir(mode=0o700)
            outside = root / 'unrelated'
            outside.mkdir(mode=0o700)
            child = parent / 'broadcast-hls'
            child.symlink_to(outside, target_is_directory=True)
            with patch.object(INSTALL, 'trusted_parents'):
                with self.assertRaises(OSError):
                    INSTALL.set_hls_directory(child, 0o2750, os.getuid(), os.getgid(), os.getuid())
                self.assertEqual(outside.stat().st_mode & 0o7777, 0o700)
                child.unlink()
                INSTALL.set_hls_directory(child, 0o2750, os.getuid(), os.getgid(), os.getuid())
            self.assertTrue(child.is_dir())
            self.assertEqual(child.stat().st_mode & 0o7777, 0o2750)

    def test_hls_rejects_symlink_parent_and_wrong_parent_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            actual = root / 'actual'
            actual.mkdir(mode=0o700)
            linked = root / 'linked'
            linked.symlink_to(actual, target_is_directory=True)
            with patch.object(INSTALL, 'trusted_parents'):
                with self.assertRaises(RuntimeError):
                    INSTALL.set_hls_directory(linked / 'broadcast-hls', 0o2750, os.getuid(), os.getgid(), os.getuid())
                with self.assertRaises(RuntimeError):
                    INSTALL.set_hls_directory(actual / 'broadcast-hls', 0o2750, os.getuid(), os.getgid(), os.getuid() + 1)
            self.assertFalse((actual / 'broadcast-hls').exists())

    def test_hardlink_target_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / 'first'
            first.write_bytes(b'synthetic')
            os.link(first, Path(directory) / 'second')
            with self.assertRaises(RuntimeError):
                INSTALL.file_state(first)

    def test_noop_never_reads_receipt_or_restarts_services(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'stable'
            path.write_bytes(b'already configured')
            path.chmod(0o600)
            files = {path: {'data': path.read_bytes(), 'mode': 0o600, 'uid': os.getuid(), 'gid': os.getgid()}}
            with patch.object(INSTALL, 'provider_idle', side_effect=AssertionError('No provider call')), patch.object(INSTALL, 'run', side_effect=AssertionError('No subprocess')):
                result = INSTALL.apply(files, {}, {}, Path('/does-not-exist'))
            self.assertFalse(result['changed'])
            self.assertFalse(result['productionAppRestarted'])

    def test_failed_validation_restores_original_file_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            managed = root / 'managed'
            managed.write_bytes(b'original')
            managed.chmod(0o640)
            evidence = root / 'activity.json'
            evidence.write_text(json.dumps(receipt()))
            evidence.chmod(0o600)
            calls = []
            def command(*args, **kwargs):
                calls.append(args)
                if args[:2] == ('caddy', 'validate') and len(calls) == 1:
                    raise RuntimeError('synthetic invalid Caddy')
                return b''
            original_atomic = INSTALL.atomic_write
            def write_current_user(path, data, mode, uid=0, gid=0):
                return original_atomic(path, data, mode, os.getuid(), os.getgid())
            files = {managed: {'data': b'updated', 'mode': 0o600, 'uid': os.getuid(), 'gid': os.getgid()}}
            with patch.object(INSTALL, 'BACKUPS', root / 'backups'), patch.object(INSTALL, 'trusted_parents'), patch.object(INSTALL, 'read_file', side_effect=lambda path, **kwargs: path.read_bytes()), patch.object(INSTALL, 'provider_idle', return_value={'participants': 0, 'activeEgress': 0}), patch.object(INSTALL, 'caddy_inventory', return_value={'unrelated': 'unchanged'}), patch.object(INSTALL, 'atomic_write', side_effect=write_current_user), patch.object(INSTALL, 'run', side_effect=command):
                with self.assertRaisesRegex(RuntimeError, 'managed files restored'):
                    INSTALL.apply(files, {}, {}, evidence)
            self.assertEqual(managed.read_bytes(), b'original')
            self.assertEqual(managed.stat().st_mode & 0o777, 0o640)
            backups = list((root / 'backups').iterdir())
            self.assertEqual(len(backups), 1)
            audit = json.loads((backups[0] / 'rollback.json').read_text())
            self.assertTrue(audit['rolledBack'])
            self.assertFalse(any('milobingo-production.service' in ' '.join(call) for call in calls))


class ManualRollbackSafety(unittest.TestCase):
    def fixture(self, root, *, dropin=False):
        backups = root / 'backups'
        backups.mkdir(mode=0o700)
        backup = backups / '20261123T175904Z-2553601a'
        backup.mkdir(mode=0o700)
        managed = root / ('media.conf' if dropin else 'production.caddy')
        managed.write_text('new app environment' if dropin else INSTALL.caddy_production(CADDY))
        managed.chmod(0o644)
        original = backup / '0.original'
        original.write_text(CADDY)
        original.chmod(0o600)
        record = None if dropin else {'backup': original.name, 'mode': 0o644, 'uid': 0, 'gid': 0, 'sha256': hashlib.sha256(original.read_bytes()).hexdigest()}
        manifest = {'format': 1, 'host': INSTALL.HOST, 'files': {str(managed): record}, 'directories': {}, 'unrelatedCaddy': {'another-site': 'original'}}
        (backup / 'manifest.json').write_text(json.dumps(manifest))
        evidence = root / 'activity.json'
        evidence.write_text(json.dumps(receipt()))
        credentials = root / 'credentials.json'
        credentials.write_text(json.dumps({'apiKey': 'synthetic-key', 'apiSecret': 'synthetic-secret'}))
        return backups, backup, managed, manifest, evidence, credentials

    def patches(self, backups):
        return [patch.object(INSTALL, 'BACKUPS', backups), patch.object(INSTALL, 'trusted_parents'), patch.object(INSTALL, 'read_file', side_effect=lambda path, **kwargs: path.read_bytes()), patch.object(INSTALL.grp, 'getgrnam', side_effect=lambda name: SimpleNamespace(gr_gid=955 if name=='app-mil-prd' else 987))]

    def test_manifest_refuses_unmanaged_paths_bad_hash_and_unknown_metadata(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as directory:
            backups, backup, managed, manifest, evidence, credentials = self.fixture(Path(directory))
            with ExitStack() as stack:
                for item in self.patches(backups):
                    stack.enter_context(item)
                stack.enter_context(patch.object(INSTALL, 'CADDY', managed))
                self.assertEqual(INSTALL.rollback_manifest(backup)[0][managed]['data'], CADDY.encode())
                cases = []
                bad = copy.deepcopy(manifest)
                bad['files']['/etc/shadow'] = bad['files'].pop(str(managed))
                cases.append(bad)
                bad = copy.deepcopy(manifest)
                bad['files'][str(managed)]['sha256'] = '0'*64
                cases.append(bad)
                bad = copy.deepcopy(manifest)
                bad['files'][str(managed)]['mode'] = 0o777
                cases.append(bad)
                bad = copy.deepcopy(manifest)
                bad['files'][str(managed)]['backup'] = '../credentials.json'
                cases.append(bad)
                for value in cases:
                    (backup / 'manifest.json').write_text(json.dumps(value))
                    with self.assertRaises(RuntimeError):
                        INSTALL.rollback_manifest(backup)
                with self.assertRaises(RuntimeError):
                    INSTALL.rollback_manifest(backups / 'not-an-exact-backup')

    def test_caddy_only_rollback_changes_no_media_or_app_service(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as directory:
            backups, backup, managed, manifest, evidence, credentials = self.fixture(Path(directory))
            commands = []
            original_write = INSTALL.atomic_write
            def current_write(path, data, mode, uid=0, gid=0):
                original_write(path, data, mode, os.getuid(), os.getgid())
            with ExitStack() as stack:
                for item in self.patches(backups):
                    stack.enter_context(item)
                for item in [patch.object(INSTALL, 'CADDY', managed), patch.object(INSTALL, 'CREDENTIALS', credentials), patch.object(INSTALL, 'caddy_inventory', return_value={'another-site': 'original'}), patch.object(INSTALL, 'provider_idle', return_value={'participants': 0, 'activeEgress': 0}), patch.object(INSTALL, 'atomic_write', side_effect=current_write), patch.object(INSTALL, 'run', side_effect=lambda *args, **kwargs: commands.append(args) or b'')]:
                    stack.enter_context(item)
                result = INSTALL.rollback(backup, evidence)
            self.assertEqual(managed.read_text(), CADDY)
            self.assertTrue(result['rolledBack'])
            self.assertFalse(result['productionAppRestarted'])
            self.assertEqual(result['mediaServicesRestarted'], [])
            self.assertFalse(any('restart' in command or 'up' in command for command in commands))
            self.assertIn(('systemctl', 'reload', 'caddy.service'), commands)

    def test_app_restarts_only_when_dropin_was_restored_and_validated(self):
        from contextlib import ExitStack
        for fail_validation in [False, True]:
            with self.subTest(fail_validation=fail_validation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                backups, backup, managed, manifest, evidence, credentials = self.fixture(root, dropin=True)
                caddy = root / 'production.caddy'
                caddy.write_text(INSTALL.caddy_production(CADDY))
                commands = []
                original_write = INSTALL.atomic_write
                def current_write(path, data, mode, uid=0, gid=0):
                    original_write(path, data, mode, os.getuid(), os.getgid())
                def command(*args, **kwargs):
                    commands.append(args)
                    if fail_validation and len(commands)==1:
                        raise RuntimeError('synthetic validation failure')
                    return b''
                with ExitStack() as stack:
                    for item in self.patches(backups):
                        stack.enter_context(item)
                    for item in [patch.object(INSTALL, 'CADDY', caddy), patch.object(INSTALL, 'APP_DROPIN', managed), patch.object(INSTALL, 'CREDENTIALS', credentials), patch.object(INSTALL, 'caddy_inventory', return_value={'another-site': 'original'}), patch.object(INSTALL, 'provider_idle', return_value={'participants': 0, 'activeEgress': 0}), patch.object(INSTALL, 'atomic_write', side_effect=current_write), patch.object(INSTALL, 'run', side_effect=command)]:
                        stack.enter_context(item)
                    if fail_validation:
                        with self.assertRaisesRegex(RuntimeError, 'current configuration was restored'):
                            INSTALL.rollback(backup, evidence)
                        self.assertEqual(managed.read_text(), 'new app environment')
                    else:
                        result = INSTALL.rollback(backup, evidence)
                        self.assertTrue(result['productionAppRestarted'])
                        self.assertFalse(managed.exists())
                count = commands.count(('systemctl', 'restart', 'milobingo-production.service'))
                self.assertEqual(count, 0 if fail_validation else 1)
                self.assertFalse(any('livekit' in command or 'egress' in command for command in commands))

    def test_rollback_refuses_changed_other_site_before_mutations(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as directory:
            backups, backup, managed, manifest, evidence, credentials = self.fixture(Path(directory))
            before = managed.read_bytes()
            with ExitStack() as stack:
                for item in self.patches(backups):
                    stack.enter_context(item)
                stack.enter_context(patch.object(INSTALL, 'CADDY', managed))
                stack.enter_context(patch.object(INSTALL, 'caddy_inventory', return_value={'another-site': 'changed'}))
                stack.enter_context(patch.object(INSTALL, 'run', side_effect=AssertionError('No host mutation')))
                with self.assertRaisesRegex(RuntimeError, 'Unrelated Caddy'):
                    INSTALL.rollback(backup, evidence)
            self.assertEqual(managed.read_bytes(), before)

    def test_rollback_can_keep_inactive_broadcast_records_but_never_active_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'activity.json'
            value = receipt()
            value['namespace']['productionBroadcastRows'] = 3
            evidence.write_text(json.dumps(value))
            with patch.object(INSTALL, 'read_file', side_effect=lambda path, **kwargs: path.read_bytes()):
                INSTALL.rollback_activity(evidence)
                value['environments']['production']['freshCalls'] = 1
                evidence.write_text(json.dumps(value))
                with self.assertRaises(RuntimeError):
                    INSTALL.rollback_activity(evidence)

    def test_nonempty_hls_is_preserved(self):
        import errno
        with tempfile.TemporaryDirectory() as directory:
            media = Path(directory) / 'hls'
            media.mkdir()
            segment = media / 'retained.ts'
            segment.write_bytes(b'retained media')
            with patch.object(INSTALL, 'HLS', media), patch.object(INSTALL, 'remove_hls_directory', side_effect=OSError(errno.ENOTEMPTY, 'not empty')):
                self.assertTrue(INSTALL.restore_directory(media, None))
            self.assertEqual(segment.read_bytes(), b'retained media')


if __name__ == '__main__':
    unittest.main(verbosity=2)
