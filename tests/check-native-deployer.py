#!/usr/bin/python3
"""Offline deployment boundary tests; no sudo, systemd, providers or host changes."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import tempfile
import tarfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('milo_deployer', ROOT / 'infra/staging/deploy-helper.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
entry_spec = importlib.util.spec_from_file_location('milo_entry', ROOT / 'infra/staging/deploy-entry.py')
entry = importlib.util.module_from_spec(entry_spec)
entry_spec.loader.exec_module(entry)
SHA = 'a' * 40
RUN = '42051941726-1'


def runtime():
    ca = ssl.DER_cert_to_PEM_cert(ssl.create_default_context().get_ca_certs(binary_form=True)[0])
    return dict(NODE_ENV='production', HOSTNAME='127.0.0.1', APP_URL='https://milo-staging.dgwebservices.nl',
        MILO_LOCAL_AUTH='false', PORT='14567', SUPABASE_URL='https://lfsdgxcpdyghidzkzzvn.supabase.co',
        SUPABASE_PUBLISHABLE_KEY='sb_publishable_test', SUPABASE_STORAGE_BUCKET='milo-staging',
        SUPABASE_DB_CA_BASE64=base64.b64encode(ca.encode()).decode(),
        DATABASE_URL='postgresql://milo:test@db.lfsdgxcpdyghidzkzzvn.supabase.co:5432/postgres?sslmode=verify-full',
        SUPABASE_SECRET_KEY='sb_secret_test', VLAMPIE_SETTINGS_KEY='c' * 64,
        RELEASE_SHA=SHA, RELEASE_ID=RUN, CONFIG_VERSION='native-test-1')


class Validation(unittest.TestCase):
    def test_fixed_site_workspace_sha_run(self):
        self.assertEqual(deploy.arguments([deploy.SITE, deploy.WORKSPACE, SHA, RUN]), (SHA, RUN))
        for bad in [['other', deploy.WORKSPACE, SHA, RUN],
                    [deploy.SITE, deploy.WORKSPACE + '/..', SHA, RUN],
                    [deploy.SITE, deploy.WORKSPACE, '-HEAD', RUN],
                    [deploy.SITE, deploy.WORKSPACE, SHA.upper(), RUN],
                    [deploy.SITE, deploy.WORKSPACE, SHA, '../release'],
                    [deploy.SITE, deploy.WORKSPACE, SHA, '1-1;reboot']]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                deploy.arguments(bad)

    def test_allowlist_matches_workflow_contract_and_entry(self):
        source = (ROOT / 'scripts/deploy/release-preflight.mjs').read_text()
        keys = re.search(r'RUNTIME_KEYS=Object.freeze\(\[(.*?)\]\)', source).group(1)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", keys)), deploy.RUNTIME_KEYS)
        entry = (ROOT / 'infra/staging/deploy-entry.py').read_text()
        entry_keys = re.search(r'RUNTIME_KEYS = \((.*?)\)\n', entry, re.S).group(1)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", entry_keys)), deploy.RUNTIME_KEYS)
        self.assertEqual(len(deploy.RUNTIME_KEYS), 21)
        self.assertNotIn('MIGRATION_DATABASE_URL', deploy.RUNTIME_KEYS)
        self.assertNotIn('GITHUB_TOKEN', deploy.RUNTIME_KEYS)

    def test_real_public_ca_and_runtime_are_accepted(self):
        values = runtime()
        self.assertEqual(deploy.runtime_values(values, SHA, RUN, 14567), values)

    def test_runtime_injection_and_wrong_boundary_rejected(self):
        cases = {'MIGRATION_DATABASE_URL': 'secret', 'GITHUB_TOKEN': 'secret',
                 'DATABASE_URL': 'postgresql://x:y@other.example/db?sslmode=verify-full',
                 'APP_URL': 'https://other.example', 'SUPABASE_STORAGE_BUCKET': 'other',
                 'MILO_LOCAL_AUTH': 'true', 'PORT': '14568', 'RELEASE_SHA': 'b' * 40,
                 'RELEASE_ID': '1-1', 'CONFIG_VERSION': 'ok\nOPENAI_API_KEY=bad',
                 'SUPABASE_DB_CA_BASE64': base64.b64encode(b'not a certificate').decode()}
        for key, value in cases.items():
            values = runtime()
            values[key] = value
            with self.subTest(key=key), self.assertRaises((ValueError, ssl.SSLError)):
                deploy.runtime_values(values, SHA, RUN, 14567)

    def test_tls_downgrade_duplicate_and_shadow_options_rejected(self):
        for query in ['sslmode=require', 'sslmode=verify-full&sslmode=disable',
                      'sslmode=verify-full&sslrootcert=/tmp/ca', 'sslmode=verify-full&ssl=false',
                      'sslmode=verify-full&uselibpqcompat=true', 'sslmode=verify-full&SSLMode=disable',
                      *['sslmode=verify-full&' + key + '=override' for key in
                        ['host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname', 'service', 'SERVICEFILE']]]:
            values = runtime()
            values['DATABASE_URL'] = values['DATABASE_URL'].split('?')[0] + '?' + query
            with self.subTest(query=query), self.assertRaises(ValueError):
                deploy.runtime_values(values, SHA, RUN, 14567)

    def test_json_duplicate_and_env_quoting(self):
        with self.assertRaises(ValueError):
            json.loads('{"PORT":"1","PORT":"2"}', object_pairs_hook=deploy.unique_object)
        self.assertEqual(deploy.env_file({'VALUE': 'quote" slash\\ dollar$ backtick`'}),
                         'VALUE="quote\\" slash\\\\ dollar$ backtick`"\n')

    def test_private_env_file_is_exclusive_and_does_not_follow_preexisting_links(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            outside = base / 'outside'
            outside.write_text('unchanged')
            link = base / 'link'
            link.symlink_to(outside)
            with self.assertRaises(FileExistsError):
                deploy.private_file(link, 'secret')
            self.assertEqual(outside.read_text(), 'unchanged')
            private = base / 'release.env'
            deploy.private_file(private, 'VALUE="test"\n')
            self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                deploy.private_file(private, 'replacement')

    def test_capacity_requires_dynamic_copy_headroom(self):
        disk = type('Disk', (), {'f_bavail': deploy.FREE_BYTES + 100, 'f_frsize': 1,
                                'f_favail': deploy.FREE_INODES + 10})()
        with patch.object(deploy.os, 'statvfs', return_value=disk):
            deploy.capacity('/unused', 100, 10)
            with self.assertRaises(ValueError):
                deploy.capacity('/unused', 101, 10)
            with self.assertRaises(ValueError):
                deploy.capacity('/unused', 100, 11)

    def test_build_uses_different_uid_empty_environment_and_cgroup_cleanup(self):
        profile = {'node': '/opt/node/bin/node', 'pnpm': '/opt/pnpm/bin/pnpm', 'port': 14567}
        calls = []
        with patch.object(deploy, 'command', side_effect=lambda args, **kwargs: calls.append((args, kwargs))):
            deploy.build_command([profile['pnpm'], 'install', '--frozen-lockfile'],
                                 Path('/var/lib/dg-build/milobingo-staging/test'), profile, RUN, 'install')
        args, options = calls[0]
        self.assertIn('--uid=build-mil-stg', args)
        self.assertIn('--gid=build-mil-stg', args)
        self.assertIn('--property=KillMode=control-group', args)
        self.assertIn('--property=ProtectHome=yes', args)
        self.assertIn('--property=ProtectSystem=strict', args)
        clean_start = args.index('/usr/bin/env')
        self.assertEqual(args[clean_start + 1], '-i')
        supplied = args[clean_start + 2:-3]
        keys = {value.split('=', 1)[0] for value in supplied}
        self.assertTrue(keys <= {'PATH', 'HOME', 'TMPDIR', 'LANG', 'CI', 'NEXT_TELEMETRY_DISABLED'})
        self.assertFalse(keys & set(deploy.RUNTIME_KEYS))
        self.assertEqual(args[-3:], [profile['pnpm'], 'install', '--frozen-lockfile'])

    def test_entry_passes_only_runtime_json_on_stdin_and_no_provider_environment_to_sudo(self):
        values = runtime()
        environment = dict(values, DG_RUNTIME_ENV_KEYS=' '.join(values), DG_BUILD_ENV_KEYS='',
                           GITHUB_TOKEN='do-not-forward', MIGRATION_DATABASE_URL='do-not-forward')
        with patch.dict(os.environ, environment, clear=True), \
                patch.object(sys, 'argv', ['entry', deploy.SITE, deploy.WORKSPACE, SHA, RUN]), \
                patch.object(entry.socket, 'gethostname', return_value='dg-nxttrack-01'), \
                patch.object(entry.os, 'getuid', return_value=1001), \
                patch.object(entry.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1001)), \
                patch.object(entry, 'trusted_helper'), \
                patch.object(entry.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as sudo:
            self.assertEqual(entry.main(), 0)
        args, options = sudo.call_args
        self.assertEqual(args[0][:3], ['/usr/bin/sudo', '-n', entry.HELPER])
        self.assertEqual(json.loads(options['input']), values)
        self.assertEqual(options['env'], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
        self.assertNotIn('do-not-forward', options['input'].decode())

    def test_real_tar_filter_rejects_parent_escape_and_absolute_symlink(self):
        for kind in ['parent', 'absolute-symlink', 'hardlink']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                (base / 'source').mkdir()
                outside = base / 'outside'
                outside.write_text('unchanged')
                archive = io.BytesIO()
                with tarfile.open(fileobj=archive, mode='w') as tar:
                    entry = tarfile.TarInfo('../outside' if kind == 'parent' else 'link')
                    if kind != 'parent':
                        entry.type = tarfile.SYMTYPE if kind == 'absolute-symlink' else tarfile.LNKTYPE
                        entry.linkname = str(outside)
                    else:
                        entry.size = 6
                    tar.addfile(entry, io.BytesIO(b'attack') if kind == 'parent' else None)
                result = deploy.subprocess.run([sys.executable, '-I', '-c', deploy.EXTRACT],
                    cwd=base / 'source', input=archive.getvalue(), capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(outside.read_text(), 'unchanged')


class Sealing(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.source, self.target = self.base / 'source', self.base / 'target'
        self.source.mkdir()
        self.target.mkdir()
        self.owners = [patch.object(deploy.os, 'fchown'), patch.object(deploy.os, 'chown')]
        for owner in self.owners:
            owner.start()

    def tearDown(self):
        for owner in self.owners:
            owner.stop()
        # Read-only artifacts are writable only here to clean the isolated test fixture.
        for item in self.target.rglob('*'):
            if item.is_dir() and not item.is_symlink():
                item.chmod(0o700)
        self.temporary.cleanup()

    def seal(self):
        source_fd, target_fd = os.open(self.source, deploy.DIRECTORY), os.open(self.target, deploy.DIRECTORY)
        try:
            return deploy.copy_tree(source_fd, target_fd, os.getgid())
        finally:
            os.close(source_fd)
            os.close(target_fd)

    def test_regular_nested_and_internal_relative_link_are_sealed(self):
        (self.source / 'node_modules').mkdir()
        (self.source / 'node_modules' / 'real.js').write_bytes(b'approved module')
        (self.source / 'node_modules' / 'alias.js').symlink_to('real.js')
        (self.source / 'server.js').write_bytes(b'approved server')
        result = self.seal()
        self.assertEqual(result['files'], 4)
        self.assertEqual((self.target / 'node_modules' / 'alias.js').read_bytes(), b'approved module')
        self.assertEqual(stat.S_IMODE((self.target / 'server.js').stat().st_mode), 0o440)
        self.assertEqual(stat.S_IMODE((self.target / 'node_modules').stat().st_mode), 0o550)
        self.assertFalse((self.target / 'server.js').stat().st_mode & 0o222)

    def test_artifact_digest_changes_when_same_length_file_content_changes(self):
        (self.source / 'server.js').write_text('first bytes')
        first = self.seal()['digest'].hexdigest()
        (self.source / 'server.js').write_text('other bytes')
        self.target = self.base / 'second-target'
        self.target.mkdir()
        second = self.seal()['digest'].hexdigest()
        self.assertNotEqual(first, second)
        self.assertRegex(first, '^[a-f0-9]{64}$')

    def test_absolute_and_parent_escape_links_rejected(self):
        outside = self.base / 'outside'
        outside.write_bytes(b'private outside bytes')
        for link in [str(outside), '../outside', '../../etc/passwd']:
            with self.subTest(link=link):
                (self.source / 'link').symlink_to(link)
                with self.assertRaises(ValueError):
                    self.seal()
                (self.source / 'link').unlink()
                self.assertFalse((self.target / 'link').exists())

    def test_indirect_link_escape_and_cycles_rejected(self):
        (self.source / 'a').symlink_to('b')
        (self.source / 'b').symlink_to('../outside')
        with self.assertRaises(ValueError):
            self.seal()
        (self.source / 'b').unlink()
        (self.source / 'b').symlink_to('a')
        with self.assertRaises(ValueError):
            self.seal()

    def test_hardlinks_fifo_and_env_files_rejected(self):
        outside = self.base / 'outside'
        outside.write_text('outside')
        for kind in ['hardlink', 'fifo', 'env']:
            path = self.source / ('.env.production' if kind == 'env' else 'attack')
            if kind == 'hardlink':
                os.link(outside, path)
            elif kind == 'fifo':
                os.mkfifo(path)
            else:
                path.write_text('SECRET=test')
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.seal()
            path.unlink()
        self.assertEqual(list(self.target.iterdir()), [])

    def test_file_swapped_to_outside_symlink_before_open_is_not_followed(self):
        path = self.source / 'race'
        path.write_bytes(b'normal')
        outside = self.base / 'outside'
        outside.write_bytes(b'private outside bytes')
        original = deploy.os.open
        def replace_before_open(name, flags, *args, **kwargs):
            if name == 'race' and flags & os.O_NOFOLLOW and not flags & os.O_CREAT:
                path.unlink()
                path.symlink_to(outside)
            return original(name, flags, *args, **kwargs)
        with patch.object(deploy.os, 'open', side_effect=replace_before_open):
            with self.assertRaises(OSError):
                self.seal()
        self.assertEqual(list(self.target.iterdir()), [])

    def test_directory_open_does_not_follow_symlink(self):
        (self.source / 'outside').symlink_to(self.base, target_is_directory=True)
        fd = os.open(self.source, deploy.DIRECTORY)
        try:
            with self.assertRaises(OSError):
                deploy.open_directory(fd, ['outside'])
            with self.assertRaises(ValueError):
                deploy.open_directory(fd, ['..'])
        finally:
            os.close(fd)


class Activation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / 'releases').mkdir()
        (self.root / 'private-runtime').mkdir(mode=0o700)
        self.old, self.new = self.release('b' * 40, '1-1'), self.release(SHA, RUN)
        self.operations = []

    def tearDown(self):
        self.temporary.cleanup()

    def release(self, sha, run):
        name = sha[:12] + '-' + run
        path = self.root / 'releases' / name
        path.mkdir()
        private_env = self.root / 'private-runtime' / (name + '.env')
        deploy.private_file(private_env, 'RELEASE_SHA=' + sha)
        (path / '.runtime.env').symlink_to(private_env)
        (path / '.release.json').write_text(json.dumps(dict(version=1, sha=sha, id=run,
            configVersion='test', port=14567, artifactSha256='c' * 64, helperSha256='d' * 64,
            toolchain=dict(node='24.18.0', pnpm='11.25.0', nodeSha256='e' * 64, pnpmSha256='f' * 64))))
        (path / '.release.json').chmod(0o600)
        return name

    def run_activation(self, check):
        deploy.activate(self.root, self.new, check=check, operate=self.operations.append,
                        attempts=2, pause=lambda _: None)

    def test_success_atomically_pairs_artifact_and_runtime_and_retains_prior(self):
        deploy.point_current(self.root, self.old)
        self.run_activation(lambda _: True)
        self.assertEqual(os.readlink(self.root / 'current'), 'releases/' + self.new)
        self.assertEqual((self.root / 'current' / '.runtime.env').read_text(), 'RELEASE_SHA=' + SHA)
        self.assertTrue((self.root / 'current' / '.runtime.env').is_symlink())
        self.assertFalse((self.root / 'current' / '.runtime.env').resolve().is_relative_to(self.root / 'releases'))
        self.assertEqual(self.operations, ['restart'])
        self.assertTrue((self.root / 'releases' / self.old).is_dir())

    def test_failed_new_release_restores_healthy_prior_app_and_env(self):
        deploy.point_current(self.root, self.old)
        with self.assertRaisesRegex(ValueError, 'prior healthy'):
            self.run_activation(lambda meta: meta['id'] == '1-1')
        self.assertEqual(os.readlink(self.root / 'current'), 'releases/' + self.old)
        self.assertEqual(self.operations, ['restart', 'restart'])
        self.assertIn('b' * 40, (self.root / 'current' / '.runtime.env').read_text())

    def test_first_failed_release_stops_and_removes_current(self):
        with self.assertRaisesRegex(ValueError, 'without healthy prior'):
            self.run_activation(lambda _: False)
        self.assertEqual(self.operations, ['restart', 'stop'])
        self.assertFalse((self.root / 'current').is_symlink())

    def test_failed_rollback_stops_service(self):
        deploy.point_current(self.root, self.old)
        checks = iter([True, False, False, False, False])
        with self.assertRaisesRegex(ValueError, 'rollback failed'):
            self.run_activation(lambda _: next(checks))
        self.assertEqual(self.operations, ['restart', 'restart', 'stop'])

    def test_unsafe_existing_current_cannot_trigger_service_operations(self):
        (self.root / 'current').symlink_to('/etc')
        with self.assertRaises(ValueError):
            self.run_activation(lambda _: True)
        self.assertEqual(self.operations, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
