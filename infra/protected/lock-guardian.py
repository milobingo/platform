#!/usr/bin/python3 -I
"""Root-only lock lifetime guardian, independent of the runner/helper cgroup.

FD 0 and FD 1 are the exact inherited global/site lock open-file descriptions.
Never write to them or pass them to repository code. This process has no token,
app configuration or activation rights. It stops only four fixed build units.
"""
import fcntl
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import time

RUN_RE = r'[1-9][0-9]{0,19}-[1-9][0-9]{0,9}'
STAGES = ('extract', 'version-node', 'version-pnpm', 'install', 'build', 'runtime-audit')
SERVICE = 'milobingo-staging.service'
BUILD_PREFIX = 'dg-milobingo-protected-build-'
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
GLOBAL_LOCK = Path('/run/lock/dg-build.lock')
SITE_LOCK = Path('/run/lock/milobingo-staging.deploy.lock')
finish_requested = False


def require(value):
    if not value:
        raise ValueError('Fixed lock guardian boundary refused')


def start_time(pid):
    # /proc comm may contain spaces and ')'; fields after its final ')' are stable.
    fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return fields[19]


def validate_lock(fd, path):
    item = os.fstat(fd)
    expected = path.stat(follow_symlinks=False)
    require(stat.S_ISREG(item.st_mode) and item.st_uid == 0 and item.st_nlink == 1 and not item.st_mode & 0o007 and (item.st_dev, item.st_ino) == (expected.st_dev, expected.st_ino))
    # This succeeds on the same OFD already locked by the root helper. No unlock.
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def notify(text):
    address = os.environ.get('NOTIFY_SOCKET', '')
    require(address and address[0] in ['/', '@'])
    if address.startswith('@'):
        address = '\0' + address[1:]
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM | socket.SOCK_CLOEXEC) as client:
        client.connect(address)
        client.send(text.encode())


def stop_builds(run, execute=subprocess.run):
    """Every command has a deadline; inability to prove a stop never releases locks."""
    safe = True
    for stage in STAGES:
        unit = BUILD_PREFIX + run + '-' + stage + '.service'
        try:
            execute(['/usr/bin/systemctl', 'stop', unit], env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12, check=False)
        except (OSError, subprocess.SubprocessError):
            pass
        try:
            status = execute(['/usr/bin/systemctl', 'is-active', '--quiet', unit], env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3, check=False)
            safe = safe and status.returncode in [3, 4]
        except (OSError, subprocess.SubprocessError):
            safe = False
    try:
        jobs = execute(['/usr/bin/systemctl', 'list-jobs', '--no-legend', '--no-pager', '--full'], env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, check=False)
        if jobs.returncode != 0 or len(jobs.stdout) > 65536:
            return False
        for line in jobs.stdout.decode().splitlines():
            fields = line.split()
            if not fields:
                continue
            if len(fields) < 4 or not fields[0].isdigit():
                return False
            # Do not stop a healthy app: let a manager-side restart/stop finish.
            if fields[1] == SERVICE or fields[1] in [BUILD_PREFIX + run + '-' + stage + '.service' for stage in STAGES]:
                return False
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
    return safe


def requested(_signal, _frame):
    global finish_requested
    finish_requested = True


def hold_until_done(parent_fd, run, stop=stop_builds, announce=notify, pause=time.sleep, finish=lambda: finish_requested):
    # READY reaches PID1 only after inherited descriptors and the exact parent
    # pidfd were verified. The helper waits for active/running before building.
    announce('READY=1\nSTATUS=Milo deployment locks held; monitoring helper')
    while not finish():
        readable, _, _ = select.select([parent_fd], [], [], 0.25)
        if readable:
            break
    while not stop(run):
        announce('STATUS=Build or app-job cleanup blocked; deployment locks retained; root recovery required')
        pause(5)
    announce('STATUS=Fixed builds stopped and app jobs drained; releasing deployment locks')


def main():
    require(len(sys.argv) == 4 and re.fullmatch(RUN_RE, sys.argv[1]) and re.fullmatch('[1-9][0-9]{0,9}', sys.argv[2]) and re.fullmatch('[0-9]+', sys.argv[3]))
    require(os.geteuid() == 0 and socket.gethostname() == 'dg-nxttrack-01')
    run, parent, expected_start = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    validate_lock(0, GLOBAL_LOCK)
    validate_lock(1, SITE_LOCK)
    # On an unavailable/dead parent, keep the inherited locks while cleaning up.
    parent_fd = None
    try:
        require(Path(f'/proc/{parent}').stat().st_uid == 0 and start_time(parent) == expected_start)
        parent_fd = os.pidfd_open(parent, 0)
        require(start_time(parent) == expected_start)
    except (OSError, ValueError):
        while not stop_builds(run):
            time.sleep(5)
        return
    try:
        hold_until_done(parent_fd, run)
    finally:
        os.close(parent_fd)


if __name__ == '__main__':
    # A normal stop/SIGHUP asks for cleanup; no RuntimeMax/stop deadline may kill
    # this holder while a build remains unconfirmed. Root may resolve fail-closed
    # cleanup explicitly. Simultaneous SIGKILL of helper and guardian is excluded.
    for signum in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGUSR1]:
        signal.signal(signum, requested)
    try:
        main()
    except Exception:
        # Retain already-inherited locks even after an unexpected guardian error.
        # No stdout/stderr: both standard lock FDs must remain untouched.
        while True:
            time.sleep(60)
