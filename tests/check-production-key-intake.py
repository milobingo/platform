import contextlib
import getpass
import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import stat
import tempfile
import termios
import unittest
import urllib.error
import urllib.request
import warnings
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location('key_intake', Path(__file__).resolve().parents[1] / 'infra/bootstrap/intake-production-supabase-key.py')
intake = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(intake)
KEY = 'sb_secret_' + 'synthetic_fixture_only_' + 'A' * 24


class Response:
    def __init__(self, body=b'[]', status=200, url=intake.BUCKETS_URL, headers=None):
        self.body, self.status, self.url = body, status, url
        self.headers = headers or {}
        self.read_bound = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def geturl(self):
        return self.url

    def read(self, bound):
        self.read_bound = bound
        return self.body[:bound]


class Remote(unittest.TestCase):
    def test_only_the_fixed_read_endpoint_and_nonbrowser_headers(self):
        response = Response()
        opener = Mock()
        opener.open.return_value = response
        intake.verify_remote(KEY, opener)
        (request,), kwargs = opener.open.call_args
        self.assertEqual(request.full_url, intake.BUCKETS_URL)
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.get_header('Apikey'), KEY)
        self.assertEqual(request.get_header('User-agent'), 'MiloProductionKeyIntake/1.0')
        self.assertIsNone(request.data)
        self.assertEqual(kwargs, {'timeout': 15})
        self.assertEqual(response.read_bound, intake.MAX_RESPONSE + 1)

    def test_proxy_environment_is_ignored_and_redirects_are_blocked(self):
        opener = Mock()
        opener.open.return_value = Response()
        with patch.object(intake.urllib.request, 'build_opener', return_value=opener) as build:
            intake.verify_remote(KEY)
        handlers = build.call_args.args
        proxy = next(handler for handler in handlers if isinstance(handler, urllib.request.ProxyHandler))
        self.assertEqual(proxy.proxies, {})
        redirect = next(handler for handler in handlers if isinstance(handler, intake.NoRedirect))
        for code in [301, 302, 303, 307, 308]:
            with self.assertRaises(ValueError):
                redirect.redirect_request(None, None, code, 'move', {}, 'https://other.example/')

    def test_rejects_errors_redirects_malformed_and_oversized_responses(self):
        for response in [Response(status=401), Response(status=302), Response(url='https://other.example/'),
                         Response(b'{}'), Response(b'null'), Response(b'bad'),
                         Response(b'[' + b' ' * intake.MAX_RESPONSE + b']'),
                         Response(headers={'Content-Length': str(intake.MAX_RESPONSE + 1)}),
                         Response(headers={'Content-Length': '-1'})]:
            opener = Mock()
            opener.open.return_value = response
            with self.subTest(response=response.__dict__), self.assertRaises(ValueError) as error:
                intake.verify_remote(KEY, opener)
            self.assertNotIn(KEY, str(error.exception))
        for exception in [urllib.error.HTTPError(intake.BUCKETS_URL, 401, KEY, {}, None), OSError(KEY)]:
            opener = Mock()
            opener.open.side_effect = exception
            with self.assertRaises(ValueError) as error:
                intake.verify_remote(KEY, opener)
            self.assertNotIn(KEY, str(error.exception))

    def test_key_format_refuses_legacy_whitespace_controls_and_oversize(self):
        for value in ['', None, 'sb_publishable_' + 'A' * 32, 'eyJlegacyServiceRoleJWT',
                      'sb_secret_short', KEY + ' ', '\n' + KEY, KEY + '\x00', KEY + '\t', KEY + 'A' * 300]:
            opener = Mock()
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                intake.verify_remote(value, opener)
            opener.open.assert_not_called()


class Persistence(unittest.TestCase):
    def run_fixture(self, callback):
        with tempfile.TemporaryDirectory() as tmp:
            anchor = Path(tmp)
            anchor.chmod(0o700)
            target = anchor / 'private' / 'supabase-storage-key.json'
            return callback(anchor, target)

    def save(self, target, anchor, key=KEY):
        return intake.persist(key, target, os.getuid(), anchor)

    def test_private_complete_file_and_idempotency_no_overwrite(self):
        def check(anchor, target):
            self.assertTrue(self.save(target, anchor))
            self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(target.stat().st_nlink, 1)
            self.assertEqual(json.loads(target.read_bytes()), {'projectRef': intake.PROJECT_REF, 'SUPABASE_SECRET_KEY': KEY})
            self.assertFalse(self.save(target, anchor))
            before = target.read_bytes()
            with self.assertRaises(ValueError):
                self.save(target, anchor, KEY + 'different')
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual(list(target.parent.iterdir()), [target])
        self.run_fixture(check)

    def test_symlink_parent_and_symlink_file_preserve_destination(self):
        def check(anchor, target):
            outside = anchor / 'untouched'
            outside.mkdir(0o700)
            target.parent.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(OSError):
                self.save(target, anchor)
            self.assertEqual(list(outside.iterdir()), [])
            target.parent.unlink()
            target.parent.mkdir(0o700)
            unrelated = outside / 'file'
            unrelated.write_text('preserve')
            target.symlink_to(unrelated)
            with self.assertRaises(OSError):
                self.save(target, anchor)
            self.assertEqual(unrelated.read_text(), 'preserve')
        self.run_fixture(check)

    def test_nonprivate_file_hardlink_directory_and_fifo_refused(self):
        for kind in ['readable', 'hardlink', 'directory', 'fifo']:
            def check(anchor, target):
                self.save(target, anchor)
                if kind == 'readable':
                    target.chmod(0o644)
                elif kind == 'hardlink':
                    os.link(target, target.parent / 'other')
                else:
                    target.unlink()
                    if kind == 'directory':
                        target.mkdir(0o700)
                    else:
                        os.mkfifo(target, 0o600)
                with self.assertRaises(ValueError):
                    self.save(target, anchor)
            with self.subTest(kind=kind):
                self.run_fixture(check)

    def test_untrusted_directory_or_owner_refused_without_chmod(self):
        for mode in [0o750, 0o770, 0o777, 0o2700]:
            def check(anchor, target):
                target.parent.mkdir(0o700)
                target.parent.chmod(mode)
                with self.assertRaises(ValueError):
                    self.save(target, anchor)
                self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), mode)
                self.assertFalse(target.exists())
            with self.subTest(mode=mode):
                self.run_fixture(check)
        def wrong_owner(anchor, target):
            with self.assertRaises(ValueError):
                intake.persist(KEY, target, os.getuid() + 1234, anchor)
            self.assertFalse(target.exists())
        self.run_fixture(wrong_owner)

    def test_partial_write_or_fsync_failure_never_publishes_partial_target(self):
        for failure in ['write', 'fsync']:
            def check(anchor, target):
                with patch.object(intake.os, failure, side_effect=OSError('synthetic failure')):
                    with self.assertRaises(OSError):
                        self.save(target, anchor)
                self.assertFalse(target.exists())
                self.assertEqual(list(target.parent.iterdir()), [])
            with self.subTest(failure=failure):
                self.run_fixture(check)

    def test_restrictive_caller_umask_cannot_break_explicit_private_modes(self):
        def check(anchor, target):
            previous = os.umask(0o777)
            try:
                self.save(target, anchor)
                current = os.umask(previous)
            finally:
                os.umask(previous)
            self.assertEqual(current, 0o777)
            self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.run_fixture(check)


class PromptAndMain(unittest.TestCase):
    def test_prompt_masks_a_real_tty_and_restores_echo(self):
        master, slave = pty.openpty()
        previous = termios.tcgetattr(slave)
        def open_tty(path, flags, *args, **kwargs):
            self.assertEqual(path, '/dev/tty')
            return os.dup(slave)
        def fake_getpass(*args, **kwargs):
            self.assertFalse(termios.tcgetattr(slave)[3] & termios.ECHO)
            self.assertIn('milobingo-production', args[0])
            self.assertTrue(os.isatty(kwargs['stream'].fileno()))
            return KEY
        try:
            with patch.object(intake.os, 'open', side_effect=open_tty), patch.object(intake.getpass, 'getpass', side_effect=fake_getpass):
                self.assertEqual(intake.prompt_key(), KEY)
            self.assertEqual(termios.tcgetattr(slave), previous)
            def fallback(*args, **kwargs):
                warnings.warn('Cannot control echo', getpass.GetPassWarning)
                self.fail('Fallback input must never be reached')
            with patch.object(intake.os, 'open', side_effect=open_tty), patch.object(intake.getpass, 'getpass', side_effect=fallback):
                with self.assertRaises(getpass.GetPassWarning):
                    intake.prompt_key()
            self.assertEqual(termios.tcgetattr(slave), previous)
        finally:
            os.close(master)
            os.close(slave)

    def test_noninteractive_input_is_refused_before_getpass(self):
        with patch.object(intake.os, 'open', side_effect=OSError('no tty')), patch.object(intake.getpass, 'getpass') as prompt:
            with self.assertRaises(OSError):
                intake.prompt_key()
            prompt.assert_not_called()

    def test_main_checks_host_root_arguments_before_prompt(self):
        for uid, host, args in [(1000, 'dg-nxttrack-01', ['helper']), (0, 'other-host', ['helper']), (0, 'dg-nxttrack-01', ['helper', KEY])]:
            with patch.object(intake.os, 'geteuid', return_value=uid), patch.object(intake.socket, 'gethostname', return_value=host), patch.object(intake.sys, 'argv', args), patch.object(intake, 'prompt_key') as prompt:
                with self.assertRaises(ValueError):
                    intake.main()
                prompt.assert_not_called()

    def test_main_only_saves_after_readonly_verification_and_redacts_output(self):
        order = []
        output = io.StringIO()
        with patch.object(intake.os, 'geteuid', return_value=0), patch.object(intake.socket, 'gethostname', return_value='dg-nxttrack-01'), patch.object(intake.sys, 'argv', ['helper']), patch.object(intake, 'prompt_key', return_value=KEY), patch.object(intake, 'verify_remote', side_effect=lambda value: order.append('verify')), patch.object(intake, 'persist', side_effect=lambda value: order.append('persist') or True), contextlib.redirect_stdout(output):
            intake.main()
        self.assertEqual(order, ['verify', 'persist'])
        self.assertIn('Supabase-sleutel gecontroleerd en beschermd opgeslagen.', output.getvalue())
        self.assertNotIn(KEY, output.getvalue())
        with patch.object(intake.os, 'geteuid', return_value=0), patch.object(intake.socket, 'gethostname', return_value='dg-nxttrack-01'), patch.object(intake.sys, 'argv', ['helper']), patch.object(intake, 'prompt_key', return_value=KEY), patch.object(intake, 'verify_remote', side_effect=ValueError('rejected')), patch.object(intake, 'persist') as persist:
            with self.assertRaises(ValueError):
                intake.main()
            persist.assert_not_called()


if __name__ == '__main__':
    unittest.main()
