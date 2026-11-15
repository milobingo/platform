#!/usr/bin/python3 -I
"""Real GPG/SCRAM transport checks in an isolated local fixture, never Supabase."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


handoff = module('handoff', 'credential-handoff.py')
renderer = module('renderer', 'render-admin-credential.py')


class CredentialHandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory(prefix='milo-prod-handoff-')
        cls.root = Path(cls.fixture.name)
        cls.owner = os.getuid()
        cls.addClassCleanup(cls.cleanup)
        cls.container = None
        cls.manifest = handoff.prepare(cls.root, cls.owner)
        cls.pg_bin = next((path for path in [Path('/usr/lib/postgresql/17/bin'),
                                           Path('/usr/lib/postgresql/16/bin')]
                           if (path / 'initdb').exists()), None)
        cls.pgdata = cls.root / 'pgdata'
        cls.socket_dir = cls.root / 'socket'
        cls.socket_dir.mkdir(mode=0o700)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            cls.port = probe.getsockname()[1]
        cls.env = {**os.environ, 'PGHOST': str(cls.socket_dir), 'PGPORT': str(cls.port),
                   'PGUSER': 'fixture_superuser', 'PGDATABASE': 'postgres', 'PGPASSWORD': ''}
        if cls.pg_bin:
            cls.run_tool([str(cls.pg_bin / 'initdb'), '-D', str(cls.pgdata), '-U', 'fixture_superuser',
                          '--auth-local=trust', '--auth-host=scram-sha-256', '--no-instructions'])
            cls.run_tool([str(cls.pg_bin / 'pg_ctl'), '-D', str(cls.pgdata), '-l',
                          str(cls.root / 'postgres-fixture.log'), '-o',
                          '-k ' + str(cls.socket_dir) + ' -p ' + str(cls.port) + ' -h 127.0.0.1',
                          '-w', 'start'])
        else:
            # Cached reviewed image only: no download, host mount or published port.
            cls.container = 'milo-handoff-test-' + os.urandom(8).hex()
            cls.env.update(PGHOST='/var/run/postgresql', PGPORT='5432')
            cls.run_tool(['/usr/bin/docker', 'run', '--detach', '--rm', '--pull=never',
                          '--name', cls.container, '--network=none', '--memory=384m', '--cpus=1',
                          '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=192m',
                          '-e', 'POSTGRES_PASSWORD=milo-fixture-only',
                          '-e', 'POSTGRES_USER=fixture_superuser',
                          '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
                          'sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'])
            for attempt in range(100):
                if cls.sql('SELECT 1', tuples=True, required=False,
                           env={**cls.env, 'PGHOST': '127.0.0.1',
                                'PGPASSWORD': 'milo-fixture-only'}).returncode == 0:
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError('Isolated cached PostgreSQL fixture failed to start')
        setup = cls.sql('CREATE ROLE postgres LOGIN INHERIT NOSUPERUSER CREATEDB CREATEROLE BYPASSRLS;'
                'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;'
                'CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE SCHEMA extensions;'
                'CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE SCHEMA storage;'
                'CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);'
                'CREATE SCHEMA auth; CREATE TABLE auth.private_fixture(id text PRIMARY KEY);'
                "INSERT INTO auth.private_fixture VALUES('server-only-fixture');"
                'ALTER TABLE auth.private_fixture ENABLE ROW LEVEL SECURITY;'
                'GRANT pg_read_all_data TO postgres WITH ADMIN OPTION;'
                'GRANT INSERT,UPDATE ON TABLE storage.buckets TO postgres WITH GRANT OPTION;'
                'ALTER DATABASE postgres OWNER TO postgres;', required=False)
        if setup.returncode:
            # This phase contains fixed fixture SQL only, before any generated credential.
            raise AssertionError('Public fixture setup failed: ' + setup.stderr.decode()[:1000])
        cls.env['PGUSER'] = 'postgres'
        if cls.sql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user", tuples=True).stdout.decode().strip() != 'f':
            raise AssertionError('Bootstrap fixture must match the non-superuser production administrator')
        cls.cipher = json.loads(cls.sql(renderer.render(cls.manifest), tuples=True).stdout)
        cls.stored = handoff.install(cls.cipher, cls.root, cls.owner)
        private = handoff.read_private(cls.root / 'admin-database.json', cls.owner)
        cls.password = private['DATABASE_URL'].split(':', 2)[2].split('@')[0]
        cls.private = private
        cls.admin_env = {**cls.env, 'PGHOST': '127.0.0.1', 'PGUSER': handoff.ROLE,
                         'PGPASSWORD': cls.password}

    @classmethod
    def cleanup(cls):
        if getattr(cls, 'container', None):
            subprocess.run(['/usr/bin/docker', 'rm', '--force', cls.container],
                           capture_output=True, check=False)
        elif hasattr(cls, 'pgdata') and (cls.pgdata / 'postmaster.pid').exists():
            cls.run_tool([str(cls.pg_bin / 'pg_ctl'), '-D', str(cls.pgdata), '-m', 'fast', '-w', 'stop'])
        if hasattr(cls, 'root'):
            # Stop only the GPG agent for this owned private fixture home.
            subprocess.run(['/usr/bin/gpgconf', '--homedir', str(cls.root / 'credential-gpg'),
                            '--kill', 'all'], capture_output=True, check=False)
        cls.fixture.cleanup()

    @classmethod
    def run_tool(cls, arguments, data=None, env=None, required=True):
        if getattr(cls, 'container', None) and arguments[0] in ['/usr/bin/psql', '/usr/bin/pg_dump', '/usr/bin/pg_restore']:
            arguments = ['/usr/bin/docker', 'exec', '-i', '-e', 'PGHOST', '-e', 'PGPORT',
                         '-e', 'PGUSER', '-e', 'PGDATABASE', '-e', 'PGPASSWORD',
                         cls.container, Path(arguments[0]).name, *arguments[1:]]
        value = subprocess.run(arguments, input=data, capture_output=True, timeout=120,
                               env=env or cls.env)
        if required and value.returncode != 0:
            # Intentionally never print driver/tool stderr or credentials.
            raise AssertionError('Isolated fixture subprocess failed: ' + Path(arguments[0]).name)
        return value

    @classmethod
    def sql(cls, statement, tuples=False, env=None, required=True):
        return cls.run_tool(['/usr/bin/psql', '-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
                             *(['-Atq'] if tuples else []), '-c', statement],
                            env=env, required=required)

    def test_01_database_generated_password_survives_real_pgp_and_scram(self):
        self.assertTrue(self.stored['created'])
        self.assertFalse(self.stored['databaseLoginVerified'])
        self.assertFalse(self.stored['productionActivated'])
        raw = json.dumps(self.cipher)
        self.assertNotIn(self.password, raw)
        self.assertNotIn('DATABASE_URL', raw)
        self.assertEqual(os.stat(self.root / 'admin-database.json').st_mode & 0o777, 0o600)
        query = "SELECT json_build_object('user',current_user,'super',r.rolsuper,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'bypass',r.rolbypassrls,'readPrivate',(SELECT count(*) FROM auth.private_fixture),'memberships',(SELECT json_agg(g.rolname ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid),'publicGrant',has_schema_privilege(current_user,'public','USAGE WITH GRANT OPTION'),'dbCreate',has_database_privilege(current_user,current_database(),'CREATE'),'bucketInsert',has_table_privilege(current_user,'storage.buckets','INSERT')) FROM pg_roles r WHERE r.rolname=current_user"
        actual = json.loads(self.sql(query, tuples=True, env=self.admin_env).stdout)
        self.assertEqual(actual, {'user': handoff.ROLE, 'super': False, 'createRole': True,
                                  'createDb': False, 'bypass': True, 'readPrivate': 1,
                                  'memberships': ['pg_read_all_data'], 'publicGrant': True,
                                  'dbCreate': True, 'bucketInsert': True})

    def test_02_admin_can_dump_complete_database_including_rls_private_rows(self):
        dump = self.run_tool(['/usr/bin/pg_dump', '--format=custom'], env=self.admin_env).stdout
        self.assertTrue(dump.startswith(b'PGDMP'))
        listing = self.run_tool(['/usr/bin/pg_restore', '--list'], data=dump).stdout
        for marker in [b'auth private_fixture', b'storage buckets', b'milo_bootstrap credential_handoffs']:
            self.assertIn(marker, listing)
        self.sql('CREATE DATABASE milo_handoff_restore_test')
        restore_env = {**self.env, 'PGDATABASE': 'milo_handoff_restore_test', 'PGUSER': 'fixture_superuser'}
        self.run_tool(['/usr/bin/pg_restore', '--single-transaction', '--exit-on-error',
                       '--dbname=milo_handoff_restore_test'], data=dump, env=restore_env)
        value = json.loads(self.sql("SELECT json_build_object('private',(SELECT count(*) FROM auth.private_fixture),'ciphertext',(SELECT count(*) FROM milo_bootstrap.credential_handoffs),'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='auth.private_fixture'::regclass))", tuples=True, env=restore_env).stdout)
        self.assertEqual(value, {'private': 1, 'ciphertext': 1, 'rls': True})

    def test_03_exact_retry_never_rotates_database_or_private_destination(self):
        again = json.loads(self.sql(renderer.render(self.manifest), tuples=True).stdout)
        self.assertEqual(again, self.cipher)
        self.assertFalse(handoff.install(again, self.root, self.owner)['created'])
        self.assertEqual(handoff.read_private(self.root / 'admin-database.json', self.owner), self.private)

    def test_04_wrong_nonce_refuses_existing_role_without_credential_output(self):
        changed = {**self.manifest, 'nonce': 'b' * 64}
        result = self.sql(renderer.render(changed), tuples=True, required=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(self.password.encode(), result.stdout + result.stderr)
        self.assertEqual(self.sql('SELECT current_user', tuples=True, env=self.admin_env).stdout.decode().strip(), handoff.ROLE)

    def test_05_wrong_envelope_identity_and_ciphertext_are_refused(self):
        for changed in [{**self.cipher, 'projectRef': 'a' * 20},
                        {**self.cipher, 'nonce': 'b' * 64},
                        {**self.cipher, 'ciphertext': 'a' * 600}]:
            with self.assertRaises(ValueError):
                handoff.install(changed, self.root, self.owner)
        self.assertEqual(handoff.read_private(self.root / 'admin-database.json', self.owner), self.private)

    def test_06_bound_decrypted_payload_is_checked_before_any_overwrite(self):
        bad_payload = {key: value for key, value in self.manifest.items() if key != 'publicKey'}
        bad_payload.update(password='c' * 64, nonce='d' * 64)
        encoded = handoff.gpg(self.root / 'credential-gpg', ['--trust-model', 'always',
                              '--recipient', self.manifest['fingerprint'], '--encrypt'],
                             json.dumps(bad_payload).encode())
        with self.assertRaises(ValueError):
            handoff.install({**self.cipher, 'ciphertext': base64.b64encode(encoded).decode()},
                            self.root, self.owner)
        self.assertEqual(handoff.read_private(self.root / 'admin-database.json', self.owner), self.private)

    def test_07_symlink_and_overly_public_private_files_refused(self):
        target = self.root / 'ordinary.json'
        handoff.publish_private(target, {'fixture': True}, self.owner)
        link = self.root / 'link.json'
        link.symlink_to(target)
        with self.assertRaises(OSError):
            handoff.publish_private(link, {'fixture': False}, self.owner)
        target.chmod(0o644)
        with self.assertRaises(ValueError):
            handoff.read_private(target, self.owner)
        self.assertEqual(json.loads(target.read_text()), {'fixture': True})

    def test_08_public_manifest_rejects_private_key_and_injection_metadata(self):
        for changed in [{**self.manifest, 'publicKey': self.manifest['publicKey'].replace('PUBLIC KEY', 'PRIVATE KEY')},
                        {**self.manifest, 'nonce': "'; DROP ROLE postgres;--"},
                        {**self.manifest, 'projectRef': 'wrong'},
                        {**self.manifest, 'fingerprint': 'A' * 40},
                        {**self.manifest, 'encryptionFingerprint': 'B' * 40},
                        {**self.manifest, 'password': self.password}]:
            with self.assertRaises(ValueError):
                renderer.render(changed)
        sql = renderer.render(self.manifest)
        self.assertNotIn(self.password, sql)
        self.assertNotIn('GRANT postgres TO', sql)
        self.assertNotIn('SECURITY DEFINER', sql.replace('-- SECURITY DEFINER function', ''))

    def test_09_failed_private_write_cleans_temporary_and_atomic_publish_has_one_link(self):
        destination = self.root / 'failed-write.json'
        with patch.object(handoff.os, 'write', side_effect=OSError('fixture-write-failure')):
            with self.assertRaises(OSError):
                handoff.publish_private(destination, {'fixture': True}, self.owner)
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.root.glob('.handoff-*')), [])
        self.assertEqual(os.stat(self.root / 'admin-database.json').st_nlink, 1)

    def test_10_existing_ledger_extra_grant_is_refused_without_rotating_role(self):
        self.sql('GRANT SELECT ON TABLE milo_bootstrap.credential_handoffs TO anon')
        try:
            result = self.sql(renderer.render(self.manifest), tuples=True, required=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(self.password.encode(), result.stdout + result.stderr)
            self.assertEqual(self.sql('SELECT current_user', tuples=True, env=self.admin_env).stdout.decode().strip(), handoff.ROLE)
        finally:
            self.sql('REVOKE ALL ON TABLE milo_bootstrap.credential_handoffs FROM anon')

    def test_11_private_ledger_has_no_browser_service_or_public_grants(self):
        actual = json.loads(self.sql("SELECT json_agg(json_build_object('role',r.rolname,'usage',has_schema_privilege(r.rolname,'milo_bootstrap','USAGE'),'select',has_table_privilege(r.rolname,'milo_bootstrap.credential_handoffs','SELECT'))) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')", tuples=True).stdout)
        self.assertEqual(len(actual), 3)
        self.assertTrue(all(not row['usage'] and not row['select'] for row in actual))
        public_acl = self.sql("SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='milo_bootstrap.credential_handoffs'::regclass AND a.grantee=0", tuples=True).stdout.decode().strip()
        self.assertEqual(public_acl, '0')

    def test_12_secret_packets_disguised_as_public_armor_are_refused(self):
        secret = handoff.gpg(self.root / 'credential-gpg', ['--armor', '--export-secret-keys',
                              self.manifest['fingerprint']]).decode('ascii')
        disguised = secret.replace('PRIVATE KEY BLOCK', 'PUBLIC KEY BLOCK')
        with self.assertRaises(ValueError):
            renderer.render({**self.manifest, 'publicKey': disguised})


if __name__ == '__main__':
    unittest.main(verbosity=2)
