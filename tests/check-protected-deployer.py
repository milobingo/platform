#!/usr/bin/python3
"""Offline Milo broker security/rollback tests. No sudo, network or host writes."""
import array
import base64
import contextlib
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import select
import signal
import socket
import ssl
import stat
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


deploy = module('milo_protected', 'infra/protected/deploy-helper.py')
entry = module('milo_protected_entry', 'infra/protected/deploy-entry.py')
extractor = module('milo_protected_extractor', 'infra/protected/extract-source.py')
guardian = module('milo_protected_guardian', 'infra/protected/lock-guardian.py')
renderer = module('milo_protected_renderer', 'infra/protected/render-deployer.py')
SHA, OTHER, RUN, CONFIG = 'a' * 40, 'b' * 40, '42051941726-1', 'protected-test-1'
TOKEN = 'github-fixture-not-a-credential'


def legacy_module():
    return module('milo_legacy_fixture', 'infra/staging/deploy-helper.py')


def runtime():
    ca = ssl.DER_cert_to_PEM_cert(ssl.create_default_context().get_ca_certs(binary_form=True)[0])
    return {'APP_URL': 'https://milo-staging.dgwebservices.nl',
        'SUPABASE_URL': 'https://lfsdgxcpdyghidzkzzvn.supabase.co',
        'SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_fixture', 'SUPABASE_STORAGE_BUCKET': 'milo-staging',
        'SUPABASE_DB_CA_BASE64': base64.b64encode(ca.encode()).decode(),
        'DATABASE_URL': 'postgresql://milo_staging_runtime:fixture@db.lfsdgxcpdyghidzkzzvn.supabase.co:5432/postgres?sslmode=verify-full',
        'SUPABASE_SECRET_KEY': 'sb_secret_fixture', 'VLAMPIE_SETTINGS_KEY': 'c' * 64}


def safe_fixture_path(path, directory=False):
    """Only tests replace the root ownership boundary for their own tempfiles."""
    path = Path(path)
    if path.is_symlink() or not (path.is_dir() if directory else path.is_file()):
        raise deploy.Refused('Unsafe fixture path')
    return path


class EntryBoundary(unittest.TestCase):
    def test_fixed_arguments_match_entry_and_helper(self):
        good = ['deploy', SHA, RUN, CONFIG]
        self.assertEqual(entry.arguments(good), good)
        self.assertEqual(deploy.arguments(good), good)
        for bad in [[], ['rollback', SHA], ['other', SHA, RUN, CONFIG],
                    ['deploy', 'main', RUN, CONFIG], ['deploy', SHA.upper(), RUN, CONFIG],
                    ['deploy', SHA, '1-1;id', CONFIG], ['deploy', SHA, RUN, '../config'],
                    ['deploy', SHA, RUN, 'x' * 97], good + ['extra']]:
            for implementation in [entry, deploy]:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    implementation.arguments(bad)

    def test_only_bounded_unique_token_stdin_is_accepted(self):
        for implementation in [entry, deploy]:
            self.assertEqual(implementation.request_body(io.BytesIO(json.dumps({'githubToken': TOKEN}).encode())),
                {'githubToken': TOKEN})
            for body in [b'{}', b'[]', b'{"githubToken":"short"}',
                    b'{"githubToken":"x\\nunsafe"}', b'{"githubToken":"abcdefgh","DATABASE_URL":"secret"}',
                    b'{"githubToken":"abcdefgh","githubToken":"override"}', b'x' * 8193]:
                with self.subTest(body=body[:70]), self.assertRaises((ValueError, UnicodeError)):
                    implementation.request_body(io.BytesIO(body))

    def test_entry_passes_token_only_stdin_and_drops_inherited_provider_environment(self):
        user = SimpleNamespace(pw_uid=1001)
        with patch.object(entry.sys, 'argv', ['entry', 'deploy', SHA, RUN, CONFIG]), \
                patch.object(entry.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(json.dumps({'githubToken': TOKEN}).encode()))), \
                patch.object(entry.socket, 'gethostname', return_value=entry.HOST), \
                patch.object(entry.pwd, 'getpwnam', return_value=user), \
                patch.object(entry.os, 'getuid', return_value=1001), patch.object(entry, 'trusted_helper'), \
                patch.dict(os.environ, {'OPENAI_API_KEY': 'MUST_NOT_FORWARD', 'NODE_OPTIONS': '--inspect',
                    'DATABASE_URL': 'MUST_NOT_FORWARD', 'GITHUB_TOKEN': 'MUST_NOT_FORWARD'}), \
                patch.object(entry.subprocess, 'run', return_value=SimpleNamespace(returncode=75)) as run:
            self.assertEqual(entry.main(), 75)
        self.assertEqual(run.call_args.kwargs['env'], deploy.CLEAN_ENV)
        self.assertEqual(json.loads(run.call_args.kwargs['input']), {'githubToken': TOKEN})
        self.assertEqual(run.call_args.args[0], ['/usr/bin/sudo', '-n', str(entry.HELPER),
            'deploy', SHA, RUN, CONFIG])
        self.assertNotIn(TOKEN, repr(run.call_args.args))

    def test_real_untrusted_or_symlinked_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            item = Path(directory) / 'file'
            item.write_text('fixture')
            with self.assertRaises(ValueError):
                deploy.trusted_path(item)
            link = Path(directory) / 'link'
            link.symlink_to('/usr/bin/env')
            with self.assertRaises(ValueError):
                deploy.trusted_path(link)


class ProtectedConfiguration(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bundle = self.root / CONFIG
        self.bundle.mkdir(mode=0o700)
        self.path = self.bundle / 'runtime.json'
        self.values = runtime()
        self.write()
        self.legacy = legacy_module()
        self.policy = {'allowedConfigIds': [CONFIG]}
        self.stack = contextlib_stack = contextlib.ExitStack()
        self.addCleanup(contextlib_stack.close)
        self.stack.enter_context(patch.object(deploy, 'trusted_path', side_effect=safe_fixture_path))
        self.stack.enter_context(patch.object(deploy, 'CONFIG_ROOT', self.root))

    def write(self):
        self.path.write_text(json.dumps(self.values))
        self.path.chmod(0o600)

    def read(self):
        return deploy.read_bundle(CONFIG, SHA, RUN, self.legacy, self.policy)

    def test_bundle_preserves_infrastructure_key_and_provider_fallbacks_without_github(self):
        self.values.update(OPENAI_API_KEY='fixture-openai', OPENAI_TEXT_MODEL='fixture-model',
            LIVEKIT_URL='wss://fixture.livekit.cloud', LIVEKIT_API_KEY='fixture-api',
            LIVEKIT_API_SECRET='fixture-private')
        self.write()
        result = self.read()
        self.assertEqual(result['runtime']['VLAMPIE_SETTINGS_KEY'], self.values['VLAMPIE_SETTINGS_KEY'])
        self.assertEqual(result['runtime']['OPENAI_API_KEY'], 'fixture-openai')
        self.assertEqual(result['runtime']['MAIL_ENVIRONMENT'], 'staging')
        self.assertNotIn('MAIL_MODE', result['runtime'])
        self.assertEqual(result['runtime']['CONFIG_VERSION'], CONFIG)
        self.assertEqual(result['runtime']['RELEASE_SHA'], SHA)
        self.assertEqual(result['runtime']['PORT'], '4173')
        self.assertEqual(result['sha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_provider_keys_are_optional_and_new_beheer_configuration_does_not_block_deploy(self):
        result = self.read()
        self.assertFalse(any(key in result['runtime'] for key in ['OPENAI_API_KEY', 'LIVEKIT_URL', 'MAIL_MODE']))

    def test_bundle_forbids_derived_values_injections_admin_and_mail_policy(self):
        for key in [*deploy.DERIVED_KEYS, 'GITHUB_TOKEN', 'MIGRATION_DATABASE_URL', 'NODE_OPTIONS',
                    'MAIL_MODE', 'MAIL_ENVIRONMENT', 'SEND_EMAIL_HOOK_SECRET', 'RESEND_API_KEY']:
            self.values = {**runtime(), key: 'forbidden'}
            self.write()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.read()

    def test_wrong_project_tls_partial_livekit_and_unknown_config_fail_closed(self):
        for changed in [{'APP_URL': 'https://attacker.example'}, {'VLAMPIE_SETTINGS_KEY': ''},
                {'DATABASE_URL': self.values['DATABASE_URL'].replace('verify-full', 'disable')},
                {'DATABASE_URL': self.values['DATABASE_URL'] + '&host=attacker.example'},
                {'LIVEKIT_URL': 'wss://fixture.livekit.cloud'}]:
            self.values = {**runtime(), **changed}
            self.write()
            with self.subTest(changed=list(changed)), self.assertRaises(ValueError):
                self.read()
        self.values = runtime()
        self.write()
        self.policy['allowedConfigIds'] = []
        with self.assertRaises(ValueError):
            self.read()

    def test_private_json_rejects_world_readable_duplicate_hardlink_and_symlink(self):
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):
            self.read()
        self.path.chmod(0o600)
        self.path.write_text('{"APP_URL":"a","APP_URL":"b"}')
        with self.assertRaises(ValueError):
            self.read()
        self.write()
        hardlink = self.root / 'copy'
        os.link(self.path, hardlink)
        with self.assertRaises(ValueError):
            self.read()
        hardlink.unlink()
        self.path.rename(self.root / 'outside')
        self.path.symlink_to(self.root / 'outside')
        with self.assertRaises(ValueError):
            self.read()

    def test_configuration_directory_cannot_be_group_readable(self):
        self.bundle.chmod(0o750)
        with self.assertRaises(ValueError):
            self.read()


class SourceBoundary(unittest.TestCase):
    def archive(self, members):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w') as stream:
            root = tarfile.TarInfo('root/')
            root.type = tarfile.DIRTYPE
            stream.addfile(root)
            for name, content, kind in members:
                item = tarfile.TarInfo(name)
                if kind == 'file':
                    body = content.encode()
                    item.size = len(body)
                    stream.addfile(item, io.BytesIO(body))
                else:
                    item.type = tarfile.SYMTYPE if kind == 'link' else tarfile.LNKTYPE
                    item.linkname = content
                    stream.addfile(item)
        output.seek(0)
        return output

    def test_source_extraction_strips_only_top_level_wrapper_and_checks_internal_links(self):
        archive = self.archive([('root/package.json', '{"name":"fixture"}', 'file'),
            ('root/lib/source', 'code', 'file'), ('root/link', 'lib/source', 'link')])
        with tempfile.TemporaryDirectory() as directory:
            result = extractor.extract(archive, directory, 1024, 20)
            self.assertEqual((Path(directory) / 'link').read_text(), 'code')
            self.assertFalse((Path(directory) / 'root').exists())
            self.assertGreater(result['files'], 0)

    def test_source_extraction_refuses_traversal_env_secrets_hardlinks_and_duplicate_members(self):
        cases = [[('root/../escape', 'x', 'file')], [('root/.env.local', 'private', 'file')],
            [('root/a', '../escape', 'link')], [('root/a', '/etc/passwd', 'link')],
            [('root/a', 'root/b', 'hardlink')], [('different/a', 'x', 'file')],
            [('root/a', 'first', 'file'), ('root/a', 'second', 'file')]]
        for members in cases:
            with self.subTest(members=members), tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                extractor.extract(self.archive(members), directory, 1024, 20)

    def test_source_extraction_enforces_real_bytes_and_file_budget(self):
        for max_bytes, max_files in [(2, 10), (100, 1)]:
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                extractor.extract(self.archive([('root/a', '123', 'file'), ('root/b', 'x', 'file')]),
                    directory, max_bytes, max_files)

    def test_download_never_sends_token_to_cross_host_or_wrong_commit_redirect(self):
        for redirect in ['https://attacker.example/archive',
                'https://codeload.github.com/milobingo/platform/legacy.tar.gz/' + OTHER,
                'https://codeload.github.com/milobingo/platform/legacy.tar.gz/' + SHA + '?token=valid-fixture&host=other',
                'https://codeload.github.com/milobingo/platform/legacy.tar.gz/' + SHA + '?token=valid-fixture&token=second-fixture']:
            calls = []
            class Connection:
                def __init__(self, host, timeout):
                    calls.append(host)
                def request(self, *_args, **_options):
                    pass
                def getresponse(self):
                    return SimpleNamespace(status=302, getheader=lambda _key: redirect)
                def close(self):
                    pass
            with self.subTest(redirect=redirect), tempfile.TemporaryDirectory() as directory, \
                    patch.object(deploy.http.client, 'HTTPSConnection', Connection), self.assertRaises(ValueError):
                deploy.download_archive(SHA, TOKEN, Path(directory) / 'source')
            self.assertEqual(calls, ['api.github.com'])

    def test_download_exact_github_source_has_no_credential_in_url_or_file(self):
        responses = [SimpleNamespace(status=302, getheader=lambda _key:
            'https://codeload.github.com/milobingo/platform/legacy.tar.gz/' + SHA + '?token=signed-archive-fixture')]
        stream = io.BytesIO(b'compressed fixture')
        responses.append(SimpleNamespace(status=200, read=stream.read))
        calls = []
        class Connection:
            def __init__(self, host, timeout):
                calls.append(('host', host))
            def request(self, method, path, headers):
                calls.append(('request', path, headers))
            def getresponse(self):
                return responses.pop(0)
            def close(self):
                pass
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(deploy.http.client, 'HTTPSConnection', Connection):
            target = Path(directory) / 'archive'
            deploy.download_archive(SHA, TOKEN, target)
            self.assertEqual(target.read_bytes(), b'compressed fixture')
        self.assertEqual([c[1] for c in calls if c[0] == 'host'], ['api.github.com', 'codeload.github.com'])
        self.assertTrue(all(TOKEN not in c[1] for c in calls if c[0] == 'request'))
        requests = [c for c in calls if c[0] == 'request']
        self.assertEqual(requests[0][2]['Authorization'], 'Bearer ' + TOKEN)
        self.assertNotIn('Authorization', requests[1][2])
        self.assertTrue(requests[1][1].endswith('?token=signed-archive-fixture'))


class IsolationAndLocks(unittest.TestCase):
    def test_build_client_holds_locks_and_executes_without_inherited_runtime(self):
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=3 if 'is-active' in args else 0)
        profile = {'node': '/opt/node/bin/node', 'pnpm': '/opt/pnpm/bin/pnpm'}
        with patch.object(deploy, 'BUILD_LOCK_FDS', (31, 32)), \
                patch.dict(os.environ, {'DATABASE_URL': 'MUST_NOT_FORWARD', 'GITHUB_TOKEN': TOKEN,
                    'OPENAI_API_KEY': 'MUST_NOT_FORWARD'}), patch.object(deploy.subprocess, 'run', side_effect=run):
            deploy.build_command([profile['pnpm'], 'build'], Path('/synthetic/work'), profile, RUN, 'build')
        args, options = calls[0]
        self.assertEqual(options['env'], deploy.CLEAN_ENV)
        self.assertEqual(options['pass_fds'], (31, 32))
        self.assertIn('--uid=build-mil-stg', args)
        self.assertIn('--property=InaccessiblePaths=/etc/dg-sites /srv/sites /home/run-mil-stg', args)
        self.assertIn('-i', args)
        self.assertNotIn(TOKEN, repr(args))
        self.assertNotIn('MUST_NOT_FORWARD', repr(args))
        self.assertEqual(calls[1][0], ['/usr/bin/systemctl', 'stop', deploy.BUILD_PREFIX + RUN + '-build.service'])
        self.assertIn('is-active', calls[2][0])

    def test_build_failure_stops_actual_unit_and_uncertain_cleanup_fails_closed(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if args[0].endswith('systemd-run'):
                raise subprocess.TimeoutExpired(args, 1)
            return SimpleNamespace(returncode=3)
        with patch.object(deploy, 'BUILD_LOCK_FDS', (31, 32)), \
                patch.object(deploy.subprocess, 'run', side_effect=run), self.assertRaises(subprocess.TimeoutExpired):
            deploy.build_command(['pnpm', 'build'], Path('/synthetic/work'), {'node': '/node', 'pnpm': '/pnpm'}, RUN, 'build')
        self.assertEqual(len(calls), 3)
        with patch.object(deploy, 'BUILD_LOCK_FDS', (31, 32)), \
                patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(returncode=0)), \
                self.assertRaisesRegex(ValueError, 'stop could not be confirmed'):
            deploy.build_command(['pnpm', 'build'], Path('/synthetic/work'), {'node': '/node', 'pnpm': '/pnpm'}, RUN, 'build')

    def test_candidate_audit_runs_as_app_with_protected_envfile_path_and_no_secret_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = SHA[:12] + '-' + RUN
            candidate = root / 'releases' / name / '.next/standalone/.milo'
            candidate.mkdir(parents=True)
            for file in ['runtime-audit.mjs', 'schema-tables.json']:
                (candidate / file).write_text('fixture')
            private = root / 'private'
            private.mkdir()
            (private / (name + '.env')).write_text('DATABASE_URL="MUST_NOT_PRINT"\n')
            (private / (name + '.env')).chmod(0o600)
            calls = []
            def run(args, **kwargs):
                calls.append((args, kwargs))
                return SimpleNamespace(returncode=3 if 'is-active' in args else 0)
            with patch.object(deploy, 'BUILD_LOCK_FDS', (31, 32)), \
                    patch.object(deploy, 'trusted_path', side_effect=safe_fixture_path), \
                    patch.object(deploy.subprocess, 'run', side_effect=run):
                deploy.runtime_audit(SimpleNamespace(RUNTIME_ROOT=private), root, name, {'node': '/opt/node/bin/node'}, RUN)
            args, options = calls[0]
            self.assertIn('--uid=app-mil-stg', args)
            self.assertIn('--property=EnvironmentFile=' + str(private / (name + '.env')), args)
            self.assertNotIn('MUST_NOT_PRINT', repr(calls))
            self.assertEqual(options['env'], deploy.CLEAN_ENV)
            self.assertEqual(options['pass_fds'], (31, 32))

    def test_only_fixed_app_service_operations_keep_controller_locks(self):
        with patch.object(deploy, 'BUILD_LOCK_FDS', (31, 32)), patch.object(deploy.subprocess, 'run') as run:
            deploy.service('restart')
            self.assertEqual(run.call_args.args[0], ['/usr/bin/systemctl', 'restart', 'milobingo-staging.service'])
            self.assertEqual(run.call_args.kwargs['pass_fds'], (31, 32))
            with self.assertRaises(ValueError):
                deploy.service('restart dartflow-production')

    def test_guardian_start_uses_only_lock_descriptors_and_waits_for_manager_ready(self):
        client = SimpleNamespace(poll=lambda: None)
        with patch.object(deploy, 'trusted_path'), patch.object(deploy, 'file_digest', return_value='a' * 64), \
                patch.object(deploy.subprocess, 'Popen', return_value=client) as spawn, \
                patch.object(deploy, 'guardian_state', side_effect=[{'activating', 'start'}, {'active', 'running'}]), \
                patch.object(deploy.time, 'sleep'):
            result = deploy.start_guardian((31, 32), RUN, {'guardianSha256': 'a' * 64})
        self.assertEqual(result['client'], client)
        self.assertEqual(spawn.call_args.kwargs['stdin'], 31)
        self.assertEqual(spawn.call_args.kwargs['stdout'], 32)
        self.assertEqual(spawn.call_args.kwargs['env'], deploy.CLEAN_ENV)
        self.assertIn('--property=KillMode=process', spawn.call_args.args[0])
        self.assertIn('--property=TimeoutStopSec=infinity', spawn.call_args.args[0])

    def test_guardian_drains_only_own_build_audit_and_app_jobs(self):
        calls = []
        def execute(args, **_kwargs):
            calls.append(args)
            if 'is-active' in args:
                return SimpleNamespace(returncode=3)
            return SimpleNamespace(returncode=0, stdout=b'')
        self.assertTrue(guardian.stop_builds(RUN, execute=execute))
        stops = [args[2] for args in calls if args[1] == 'stop']
        self.assertEqual(len(stops), 6)
        self.assertTrue(any(name.endswith('-runtime-audit.service') for name in stops))
        self.assertFalse(any('dartflow' in name for name in stops))
        def pending(args, **kwargs):
            if 'list-jobs' in args:
                return SimpleNamespace(returncode=0, stdout=b'1 milobingo-staging.service restart running\n')
            return execute(args, **kwargs)
        self.assertFalse(guardian.stop_builds(RUN, execute=pending))

    def test_real_ofd_locks_survive_controller_death_until_guardian_job_drain(self):
        # SCM_RIGHTS transfers actual open-file descriptions, as systemd --pipe
        # does. The root-specific ownership wrapper is not bypassed on a host.
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ['global.lock', 'site.lock']]
            transport, child_transport = socket.socketpair()
            ready_r, ready_w = os.pipe()
            drain_r, drain_w = os.pipe()
            helper = os.fork()
            if helper == 0:
                try:
                    transport.close()
                    locks = [os.open(path, os.O_RDWR | os.O_CREAT, 0o600) for path in paths]
                    for fd in locks:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    child_transport.sendmsg([b'L'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', locks))])
                    signal.pause()
                finally:
                    os._exit(0)
            child_transport.close()
            locks = []
            guard = None
            try:
                _data, ancillary, _flags, _address = transport.recvmsg(1, socket.CMSG_SPACE(2 * array.array('i').itemsize))
                for level, kind, data in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        result = array.array('i')
                        result.frombytes(data[:2 * result.itemsize])
                        locks.extend(result)
                self.assertEqual(len(locks), 2)
                guard = os.fork()
                if guard == 0:
                    try:
                        os.close(ready_r)
                        os.close(drain_w)
                        parent = os.pidfd_open(helper)
                        def stop(_run):
                            return bool(select.select([drain_r], [], [], 0)[0])
                        guardian.hold_until_done(parent, RUN, stop=stop,
                            announce=lambda _text: os.write(ready_w, b'R'), pause=lambda _seconds: __import__('time').sleep(0.01),
                            finish=lambda: False)
                        os._exit(0)
                    except BaseException:
                        os._exit(2)
                os.close(ready_w)
                ready_w = None
                os.close(drain_r)
                drain_r = None
                for fd in locks:
                    os.close(fd)
                locks = []
                self.assertTrue(select.select([ready_r], [], [], 3)[0])
                self.assertEqual(os.read(ready_r, 1), b'R')
                os.kill(helper, signal.SIGKILL)
                os.waitpid(helper, 0)
                helper = None
                for path in paths:
                    fd = os.open(path, os.O_RDWR)
                    try:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    finally:
                        os.close(fd)
                os.write(drain_w, b'D')
                _pid, status = os.waitpid(guard, 0)
                guard = None
                self.assertEqual(os.waitstatus_to_exitcode(status), 0)
                for path in paths:
                    fd = os.open(path, os.O_RDWR)
                    try:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    finally:
                        os.close(fd)
            finally:
                for pid in [helper, guard]:
                    if pid:
                        try:
                            os.kill(pid, signal.SIGKILL)
                            os.waitpid(pid, 0)
                        except ProcessLookupError:
                            pass
                for fd in [ready_r, ready_w, drain_r, drain_w, *locks]:
                    if fd is not None:
                        os.close(fd)
                transport.close()


class ReleaseContract(unittest.TestCase):
    def test_policy_binds_installed_code_hashes_real_account_ids_and_private_builder_groups(self):
        accounts = {name: SimpleNamespace(pw_uid=100 + i, pw_gid=200 + i)
            for i, name in enumerate([deploy.RUNNER, deploy.BUILDER, deploy.APP])}
        value = {'version': 1, 'allowedConfigIds': [CONFIG],
            'legacySha256': 'a' * 64, 'gateSha256': 'a' * 64,
            'extractorSha256': 'a' * 64, 'guardianSha256': 'a' * 64,
            'accounts': {name: {'uid': user.pw_uid, 'gid': user.pw_gid} for name, user in accounts.items()}}
        with patch.object(deploy, 'read_json', return_value=value), patch.object(deploy, 'trusted_path'), \
                patch.object(deploy, 'file_digest', return_value='a' * 64), \
                patch.object(deploy.pwd, 'getpwnam', side_effect=lambda name: accounts[name]), \
                patch.object(deploy.os, 'getgrouplist', side_effect=lambda _name, gid: [gid]):
            self.assertEqual(deploy.read_policy(), value)
            with patch.object(deploy, 'file_digest', return_value='b' * 64), self.assertRaises(ValueError):
                deploy.read_policy()
            value['allowedConfigIds'] = [CONFIG, CONFIG]
            with self.assertRaises(ValueError):
                deploy.read_policy()
            value['allowedConfigIds'] = [CONFIG]
            value['accounts'][deploy.RUNNER]['uid'] += 1
            with self.assertRaises(ValueError):
                deploy.read_policy()
            value['accounts'][deploy.RUNNER]['uid'] -= 1
            with patch.object(deploy.os, 'getgrouplist', side_effect=lambda _name, gid: [gid, 0]), \
                    self.assertRaises(ValueError):
                deploy.read_policy()

    def test_renderer_pins_every_new_root_component_and_keeps_legacy_dependency_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'render'
            manifest = renderer.render(output)
            self.assertFalse(manifest['installed'])
            self.assertFalse(manifest['policyComplete'])
            helper = manifest['files']['/usr/local/libexec/dg-milo-deploy-helper']['sha256']
            self.assertIn(helper, (output / 'usr/local/bin/dg-milo-deploy').read_text())
            self.assertIn('sha256:' + helper, (output / 'etc/sudoers.d/milobingo-protected-deploy').read_text())
            self.assertEqual(manifest['legacyDependency']['sha256'], renderer.LEGACY_HASH)
            self.assertEqual(hashlib.sha256((ROOT / 'infra/staging/deploy-helper.py').read_bytes()).hexdigest(), renderer.LEGACY_HASH)
            for path, info in manifest['files'].items():
                self.assertEqual(hashlib.sha256((output / path.lstrip('/')).read_bytes()).hexdigest(), info['sha256'])
                self.assertEqual((output / path.lstrip('/')).stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                renderer.render(output)

    def test_rootgate_proves_fixed_ci_latest_attempt_current_dispatch_and_hides_token(self):
        code = r'''
import assert from 'node:assert/strict';
import {verifyRelease,validateReleaseInput} from './infra/protected/release-gate.mjs';
const sha='a'.repeat(40),head='b'.repeat(40),repository='milobingo/platform',token='fixture-token';
const input={repository,integrationBranch:'main',sha,requiredChecks:[{workflow:'ci.yml',jobs:['verify'],events:['push','workflow_dispatch']}],githubToken:token,deploymentWorkflow:'deploy-staging.yml',deploymentRun:{id:'5000',attempt:1}};
function fixture(changes={}) {
 const ci={id:20,workflow_id:9,head_sha:sha,head_branch:'main',head_repository:{full_name:repository},run_attempt:1,event:'push',status:'completed',conclusion:'success'};
 const values={repo:{id:42,full_name:repository},branch:{name:'main',commit:{sha:head}},commit:{sha},comparison:{status:'ahead',base_commit:{sha}},workflow:{id:9,path:'.github/workflows/ci.yml',state:'active'},runs:[ci],jobs:[{run_id:20,name:'verify',head_sha:sha,status:'completed',conclusion:'success'}],latest:ci,deployWorkflow:{id:10,path:'.github/workflows/deploy-staging.yml',state:'active'},deployment:{id:5000,workflow_id:10,head_sha:head,head_branch:'main',head_repository:{full_name:repository},run_attempt:1,event:'workflow_dispatch',status:'in_progress',conclusion:null},...changes};
 let calls=0;return {values,get calls(){return calls;},fetchFn:async (resource,options)=>{
  calls++;const url=new URL(resource);assert.equal(url.origin,'https://api.github.com');assert.equal(options.headers.Authorization,'Bearer '+token);assert(!url.href.includes(token));
  const path=url.pathname.replace('/repos/'+repository,'');let body;
  if(path==='')body=values.repo;else if(path==='/branches/main')body=values.branch;else if(path===`/commits/${sha}`)body=values.commit;else if(path===`/compare/${sha}...${head}`)body=values.comparison;else if(path==='/actions/workflows/ci.yml')body=values.workflow;else if(path==='/actions/workflows/9/runs')body={workflow_runs:values.runs};else if(path==='/actions/runs/20/attempts/1/jobs')body={jobs:values.jobs};else if(path==='/actions/runs/20')body=values.latest;else if(path==='/actions/workflows/deploy-staging.yml')body=values.deployWorkflow;else if(path==='/actions/runs/5000')body=values.deployment;else throw new Error('Unexpected fixture endpoint');
  return Response.json(body);
 }};
}
const good=fixture(),proof=await verifyRelease(input,{fetchFn:good.fetchFn});assert.equal(proof.status,'passed');assert.equal(proof.deploymentRunUrl,'https://github.com/milobingo/platform/actions/runs/5000');assert(!JSON.stringify(proof).includes(token));
for(const changes of [{repository:'dartflow/platform'},{integrationBranch:'feature'},{sha:'main'},{deploymentWorkflow:'deploy-production.yml'},{requiredChecks:[]}])assert.throws(()=>validateReleaseInput({...input,...changes}));
for(const changes of [{comparison:{status:'diverged',base_commit:{sha}}},{runs:[]},{jobs:[]},{latest:{...good.values.latest,run_attempt:2,status:'in_progress',conclusion:null}},{deployment:{...good.values.deployment,event:'push'}},{deployment:{...good.values.deployment,head_repository:{full_name:'attacker/fork'}}}]){const f=fixture(changes);await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}));}
for(const conclusion of ['failure','cancelled','skipped']){const f=fixture();f.values.runs=[{...f.values.latest,id:21,conclusion},f.values.latest];await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}));}
for(const fetchFn of [async()=>{throw Error(token);},async()=>new Response(token,{status:403})])await assert.rejects(verifyRelease(input,{fetchFn}),error=>!error.message.includes(token));
console.log('rootgate boundaries passed');
'''
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
            capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), 'rootgate boundaries passed')


class ReleaseSimulation(unittest.TestCase):
    """Exercise the real legacy seal/activate code through the protected adapter.

    Tests emulate only privileged ownership and external build/systemd/network
    effects inside owned tempfiles. Source sealing, env writing, metadata,
    immutable config checks and atomic current/rollback are real filesystem work.
    """
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.site, self.build, self.private = [self.root / p for p in ['site', 'build', 'private']]
        for path in [self.site / 'releases', self.build, self.private]:
            path.mkdir(parents=True)
        self.private.chmod(0o700)
        self.configroot = self.root / 'configs'
        self.bundle = self.configroot / CONFIG
        self.bundle.mkdir(parents=True, mode=0o700)
        self.configfile = self.bundle / 'runtime.json'
        self.configfile.write_text(json.dumps(runtime()))
        self.configfile.chmod(0o600)
        self.profile = {'port': 4173}
        for key in ['node', 'pnpm']:
            path = self.root / key
            path.write_text('synthetic pinned tool')
            self.profile[key] = str(path)
        self.policy = {'allowedConfigIds': [CONFIG]}
        self.events = []
        self.audit_failure = False
        self.candidate_failure = False
        self.oldname = OTHER[:12] + '-19-1'
        old = self.site / 'releases' / self.oldname
        old.mkdir()
        oldenv = self.private / (self.oldname + '.env')
        oldenv.write_text('CONFIG_VERSION="old-config"\n')
        oldenv.chmod(0o600)
        (old / '.runtime.env').symlink_to(oldenv)
        info = {'version': 1, 'sha': OTHER, 'id': '19-1', 'configVersion': 'old-config',
            'port': 4173, 'artifactSha256': 'c' * 64, 'helperSha256': renderer.LEGACY_HASH,
            'toolchain': {'node': '24.18.0', 'pnpm': '11.25.0', 'nodeSha256': 'c' * 64, 'pnpmSha256': 'c' * 64}}
        (old / '.release.json').write_text(json.dumps(info))
        (old / '.release.json').chmod(0o600)
        (self.site / 'current').symlink_to('releases/' + self.oldname)

    def build_fixture(self, _argv, work, _profile, _run, stage, _stdin=None):
        self.events.append(('build', stage))
        if stage == 'build':
            artifact = work / 'source/.next/standalone'
            for directory in ['public', 'drizzle', '.next/static', '.milo']:
                (artifact / directory).mkdir(parents=True, exist_ok=True)
            for name in ['server.js', '.milo/runtime-audit.mjs', '.milo/schema-tables.json']:
                (artifact / name).write_text('synthetic artifact')

    def audit(self, _legacy, root, name, _profile, _run):
        self.events.append(('audit', name))
        artifact = root / 'releases' / name
        self.assertTrue((artifact / '.protected.json').is_file())
        self.assertEqual((artifact / '.next/standalone/server.js').stat().st_mode & 0o222, 0)
        self.assertEqual((self.private / (name + '.env')).stat().st_mode & 0o777, 0o600)
        self.assertEqual(os.readlink(root / 'current'), 'releases/' + self.oldname)
        if self.audit_failure:
            raise deploy.Refused('synthetic read-only audit failure')

    def candidate(self, run=RUN):
        legacy = legacy_module()
        original_activate, original_private = legacy.activate, legacy.private_file
        account = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
        def activate(root, name, **options):
            return original_activate(root, name,
                check=lambda meta: meta['sha'] == OTHER or not self.candidate_failure,
                operate=options['operate'], attempts=1, pause=lambda _seconds: None)
        def private_file(path, body):
            mode = path.parent.stat().st_mode & 0o777
            path.parent.chmod(mode | 0o200)
            try:
                original_private(path, body)
            finally:
                path.parent.chmod(mode)
        def download(_sha, _token, target):
            target.write_bytes(b'synthetic approved source')
        with contextlib.ExitStack() as stack:
            for name, value in [('SITE_ROOT', self.site), ('BUILD_ROOT', self.build),
                    ('RUNTIME_ROOT', self.private), ('trusted_path', safe_fixture_path),
                    ('capacity', lambda *_args: None), ('activate', activate), ('private_file', private_file)]:
                stack.enter_context(patch.object(legacy, name, value))
            stack.enter_context(patch.object(legacy.os, 'chown'))
            stack.enter_context(patch.object(legacy.os, 'fchown'))
            stack.enter_context(patch.object(deploy.pwd, 'getpwnam', return_value=account))
            stack.enter_context(patch.object(deploy, 'trusted_path', side_effect=safe_fixture_path))
            stack.enter_context(patch.object(deploy, 'CONFIG_ROOT', self.configroot))
            stack.enter_context(patch.object(deploy, 'download_archive', side_effect=download))
            stack.enter_context(patch.object(deploy, 'github_gate', return_value={'ciRunUrl':
                'https://github.com/milobingo/platform/actions/runs/123'}))
            stack.enter_context(patch.object(deploy, 'build_command', side_effect=self.build_fixture))
            stack.enter_context(patch.object(deploy, 'runtime_audit', side_effect=self.audit))
            stack.enter_context(patch.object(deploy, 'service', side_effect=lambda action:
                self.events.append(('service', action, os.readlink(self.site / 'current')))))
            return deploy.deploy_release(legacy, self.profile, self.policy, SHA, run, CONFIG, TOKEN)

    def tearDown(self):
        # Sealed fixture directories are readonly just like real artifacts.
        # The ordinary test user restores ownership permissions for temp cleanup.
        for path in self.root.rglob('*'):
            if path.is_dir() and not path.is_symlink():
                path.chmod(path.stat().st_mode | 0o700)

    def test_real_seal_audits_before_atomic_activation_and_binds_private_configuration(self):
        result = self.candidate()
        name = SHA[:12] + '-' + RUN
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(os.readlink(self.site / 'current'), 'releases/' + name)
        release = self.site / 'releases' / name
        self.assertEqual(os.readlink(release / '.runtime.env'), str(self.private / (name + '.env')))
        marker = json.loads((release / '.protected.json').read_text())
        self.assertEqual(marker['bundleSha256'], hashlib.sha256(self.configfile.read_bytes()).hexdigest())
        self.assertEqual(marker['runtimeSha256'], hashlib.sha256((release / '.runtime.env').read_bytes()).hexdigest())
        self.assertIn('MAIL_ENVIRONMENT="staging"', (release / '.runtime.env').read_text())
        self.assertNotIn(TOKEN, (release / '.runtime.env').read_text())
        self.assertLess(self.events.index(('audit', name)),
            self.events.index(('service', 'restart', 'releases/' + name)))
        self.assertEqual(list(self.build.iterdir()), [])

    def test_failed_backend_audit_leaves_old_app_and_config_untouched_without_restart(self):
        self.audit_failure = True
        with self.assertRaisesRegex(ValueError, 'read-only audit failure'):
            self.candidate()
        self.assertEqual(os.readlink(self.site / 'current'), 'releases/' + self.oldname)
        self.assertEqual((self.site / 'current/.runtime.env').read_text(), 'CONFIG_VERSION="old-config"\n')
        self.assertFalse(any(event[0] == 'service' for event in self.events))
        self.assertEqual(list(self.build.iterdir()), [])

    def test_failed_candidate_health_restores_real_previous_app_and_original_config(self):
        self.candidate_failure = True
        with self.assertRaisesRegex(ValueError, 'prior healthy Milo release restored'):
            self.candidate()
        self.assertEqual(os.readlink(self.site / 'current'), 'releases/' + self.oldname)
        self.assertEqual((self.site / 'current/.runtime.env').read_text(), 'CONFIG_VERSION="old-config"\n')
        switches = [event for event in self.events if event[0] == 'service']
        self.assertEqual([event[2] for event in switches],
            ['releases/' + SHA[:12] + '-' + RUN, 'releases/' + self.oldname])
        self.assertEqual(list(self.build.iterdir()), [])

    def test_reusing_a_changed_configuration_id_blocks_switch_from_prior_sealed_release(self):
        self.candidate()
        first = SHA[:12] + '-' + RUN
        self.oldname = first
        self.configfile.write_text(json.dumps({**runtime(), 'OPENAI_TEXT_MODEL': 'changed-under-used-id'}))
        with self.assertRaisesRegex(ValueError, 'Immutable configuration changed'):
            self.candidate('42051941727-1')
        self.assertEqual(os.readlink(self.site / 'current'), 'releases/' + first)
        self.assertEqual(len([event for event in self.events if event[0] == 'service']), 1)
        self.assertEqual(list(self.build.iterdir()), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
