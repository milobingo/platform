import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('handoff', Path(__file__).resolve().parents[1] / 'infra/bootstrap/move-admin-secrets.py')
handoff = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(handoff)

RUNTIME_SPEC = importlib.util.spec_from_file_location('runtime_bootstrap', Path(__file__).resolve().parents[1] / 'infra/bootstrap/seed-protected-runtime.py')
runtime_bootstrap = importlib.util.module_from_spec(RUNTIME_SPEC)
RUNTIME_SPEC.loader.exec_module(runtime_bootstrap)

class RuntimeParser(unittest.TestCase):
    def test_only_the_reviewed_systemd_format_is_parsed_without_shell_execution(self):
        self.assertEqual(runtime_bootstrap.parse_env('A="literal$(touch /tmp/never)"\nB="literal`command`"\n'), {'A': 'literal$(touch /tmp/never)', 'B': 'literal`command`'})
        encoded = 'A=' + json.dumps('a\\b"c') + '\n'
        self.assertEqual(runtime_bootstrap.parse_env(encoded), {'A': 'a\\b"c'})
        for invalid in ['export A="value"\n', 'A=value\n', 'A="one"\nA="two"\n', 'A="unterminated\n', 'A="bad\\xescape"\n', 'A="one"; echo bad\n']:
            with self.assertRaises(ValueError):
                runtime_bootstrap.parse_env(invalid)


class Handoff(unittest.TestCase):
    def setUp(self):
        self.values = {'MIGRATION_DATABASE_URL': 'postgresql://fixture:never-real@db.lfsdgxcpdyghidzkzzvn.supabase.co:5432/postgres?sslmode=verify-full', 'BACKUP_ENCRYPTION_KEY': 'a' * 64}

    def test_fixed_names_and_project_no_unexpected_credentials(self):
        self.assertEqual(handoff.validate(self.values), self.values)
        for value in [{}, {**self.values, 'OTHER_KEY': 'no'}, {**self.values, 'BACKUP_ENCRYPTION_KEY': ''}, {**self.values, 'BACKUP_ENCRYPTION_KEY': 'z' * 64}, {**self.values, 'BACKUP_ENCRYPTION_KEY': 'a' * 63}, {**self.values, 'MIGRATION_DATABASE_URL': self.values['MIGRATION_DATABASE_URL'].replace('lfsdgxcpdyghidzkzzvn', 'anotherproject')}, {**self.values, 'MIGRATION_DATABASE_URL': self.values['MIGRATION_DATABASE_URL'] + '&host=other.example'}]:
            with self.assertRaises(ValueError):
                handoff.validate(value)

    def safe_parents(self):
        # Production requires root-owned, nonwritable parents. Test only that
        # metadata boundary with fixtures; actual O_EXCL/O_NOFOLLOW/fstat and
        # filesystem writes below are not mocked.
        return patch.object(Path, 'lstat', return_value=os.stat_result((stat.S_IFDIR | 0o700, 0, 0, 1, os.getuid(), os.getgid(), 0, 0, 0, 0)))

    def test_exclusive_private_persistence_and_exact_retry(self):
        with tempfile.TemporaryDirectory() as tmp, self.safe_parents():
            target = Path(tmp) / 'handoff.json'
            self.assertTrue(handoff.persist(self.values, target, os.getuid()))
            self.assertFalse(handoff.persist(self.values, target, os.getuid()))
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(target.read_bytes()), self.values)
            with self.assertRaises(ValueError):
                handoff.persist({**self.values, 'BACKUP_ENCRYPTION_KEY': 'b' * 64}, target, os.getuid())
            self.assertEqual(json.loads(target.read_bytes()), self.values)

    def test_existing_symlink_cannot_redirect_the_handoff(self):
        with tempfile.TemporaryDirectory() as tmp, self.safe_parents():
            outside = Path(tmp) / 'untouched'; outside.write_text('preserve')
            target = Path(tmp) / 'handoff.json'; target.symlink_to(outside)
            with self.assertRaises(OSError):
                handoff.persist(self.values, target, os.getuid())
            self.assertEqual(outside.read_text(), 'preserve')

    def test_existing_hardlink_or_readable_file_is_refused(self):
        for hardlink in [True, False]:
            with tempfile.TemporaryDirectory() as tmp, self.safe_parents():
                target = Path(tmp) / 'handoff.json'; target.write_text(json.dumps(self.values)); target.chmod(0o600)
                if hardlink:
                    os.link(target, Path(tmp) / 'other')
                else:
                    target.chmod(0o644)
                with self.assertRaises(ValueError):
                    handoff.persist(self.values, target, os.getuid())

    def test_untrusted_parent_is_refused_before_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'handoff.json'
            with patch.object(Path, 'lstat', return_value=os.stat_result((stat.S_IFDIR | 0o777, 0, 0, 1, os.getuid(), os.getgid(), 0, 0, 0, 0))):
                with self.assertRaises(ValueError):
                    handoff.persist(self.values, target, os.getuid())
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
