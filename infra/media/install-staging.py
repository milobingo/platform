#!/usr/bin/env python3
"""Root-only, explicit installation on the verified shared Milo staging VPS.

Run from a copy of this directory. Does not restart any application or change
production configuration. apt prerequisites are installed separately, pinned.
"""
import grp
import hashlib
import json
import os
import pwd
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time


def run(*args):
    subprocess.run(args, check=True)


def write(path, value, mode=0o600, uid=0, gid=0):
    path = Path(path)
    if path.is_symlink():
        raise RuntimeError(f"Refusing symlink: {path}")
    path.write_text(value)
    os.chown(path, uid, gid)
    path.chmod(mode)


if os.geteuid() != 0 or socket.gethostname() != "dg-nxttrack-01":
    raise SystemExit("Only root on verified dg-nxttrack-01 is supported.")
if "128.140.93.95" not in subprocess.check_output(["ip", "-4", "addr"], text=True):
    raise SystemExit("Confirmed staging public IP is missing.")
try:
    pwd.getpwuid(63001)
except KeyError:
    pass
else:
    raise SystemExit("Reserved Egress UID 63001 is already assigned on this host.")
source = Path(__file__).resolve().parent
config = Path("/etc/milobingo-media")
install = Path("/opt/milobingo-media")
backup = Path("/var/backups/milo-media") / time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
backup.mkdir(parents=True, mode=0o700)
caddy = Path("/etc/caddy/sites/milobingo-staging.caddy")
shutil.copy2(caddy, backup / "milobingo-staging.caddy")
inventory = {}
for path in Path("/etc/caddy/sites").glob("*.caddy"):
    inventory[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
write(backup / "caddy-before.json", json.dumps(inventory, indent=2))

config.mkdir(mode=0o700, exist_ok=True)
install.mkdir(mode=0o755, exist_ok=True)
secret_file = config / "credentials.json"
if secret_file.exists():
    credentials = json.loads(secret_file.read_text())
else:
    credentials = {"apiKey": "MILO" + secrets.token_hex(12), "apiSecret": secrets.token_hex(32),
                   "redisPassword": secrets.token_hex(32), "signingSecret": secrets.token_hex(32)}
    write(secret_file, json.dumps(credentials))
replacements = {"REPLACE_API_KEY": credentials["apiKey"], "REPLACE_API_SECRET": credentials["apiSecret"],
                "REPLACE_PRIVATE_REDIS_PASSWORD": credentials["redisPassword"]}
for name, owner in [("livekit.yaml", 65532), ("ingress.yaml", 65532), ("redis.conf", 65532), ("egress.yaml", 63001)]:
    content = (source / (name + ".example")).read_text()
    for key, value in replacements.items():
        content = content.replace(key, value)
    write(config / name, content, 0o400, owner, owner)
(config / "tls").mkdir(mode=0o755, exist_ok=True)
for name in ["compose.yaml", "Egress.Dockerfile"]:
    shutil.copy2(source / name, install / name)
for name in ["milo-media.slice", "milo-media-staging.service", "milo-media-maintenance.service", "milo-media-maintenance.timer", "milo-media-observe.service"]:
    shutil.copy2(source / name, Path("/etc/systemd/system") / name)
shutil.copy2(source / "milo-media-sync-cert", "/usr/local/sbin/milo-media-sync-cert")
Path("/usr/local/sbin/milo-media-sync-cert").chmod(0o700)
shutil.copy2(source / "milo-media-observe", "/usr/local/sbin/milo-media-observe")
Path("/usr/local/sbin/milo-media-observe").chmod(0o700)
shutil.copy2(source / "turn-observe.nft", config / "turn-observe.nft")

app_gid = grp.getgrnam("app-mil-stg").gr_gid
hls = Path("/srv/sites/milobingo-staging/shared/broadcast-hls")
hls.mkdir(mode=0o750, exist_ok=True)
os.chown(hls, 63001, app_gid)
hls.chmod(0o2750)
broadcast_dir = Path("/etc/milobingo-broadcast")
broadcast_dir.mkdir(mode=0o750, exist_ok=True)
os.chown(broadcast_dir, 0, app_gid)
broadcast = {"version": 1, "enabled": True, "url": "wss://milo-staging.dgwebservices.nl",
             "apiKey": credentials["apiKey"], "apiSecret": credentials["apiSecret"],
             "hls": {"root": str(hls), "egressRoot": "/out", "signingSecret": credentials["signingSecret"], "tokenSeconds": 14400},
             "castAppId": "CC1AD845"}
write(broadcast_dir / "staging.json", json.dumps(broadcast), 0o640, 0, app_gid)
dropin = Path("/etc/systemd/system/milobingo-staging.service.d")
dropin.mkdir(mode=0o755, exist_ok=True)
write(dropin / "media.conf", "[Service]\nEnvironment=MILO_BROADCAST_CONFIG=/etc/milobingo-broadcast/staging.json\n", 0o644)

# This VPS had no Docker deployment. Never overwrite an unrelated daemon setup.
daemon = Path("/etc/docker/daemon.json")
docker_config = {"iptables": False, "ip6tables": False, "bridge": "none", "log-driver": "local"}
if daemon.exists() and json.loads(daemon.read_text()) != docker_config:
    raise SystemExit("Existing Docker configuration needs manual reconciliation.")
daemon.parent.mkdir(mode=0o755, exist_ok=True)
if not daemon.exists():
    unrelated = subprocess.check_output(["docker", "ps", "-aq"], text=True).strip()
    if unrelated:
        raise SystemExit("Do not change Docker daemon networking with existing containers.")
    write(daemon, json.dumps(docker_config), 0o644)
    run("systemctl", "restart", "docker.service")
run("systemctl", "daemon-reload")
sysctl_values = {}
for key in ["net.core.rmem_max", "net.core.wmem_max"]:
    current = int(subprocess.check_output(["sysctl", "-n", key], text=True))
    sysctl_values[key] = max(current, 5000000)
write("/etc/sysctl.d/90-milo-media.conf", "".join(f"{key} = {value}\n" for key, value in sysctl_values.items()), 0o644)
run("sysctl", "-p", "/etc/sysctl.d/90-milo-media.conf")
run("systemctl", "start", "milo-media.slice")
run("/usr/local/sbin/milo-media-sync-cert")
run("docker", "compose", "-f", str(install / "compose.yaml"), "pull", "--ignore-buildable", "--quiet")
run("docker", "compose", "-f", str(install / "compose.yaml"), "build", "egress")

for port, protocol in [(7881, "tcp"), (7882, "udp"), (7885, "udp"), (3480, "udp"), (5349, "tcp")]:
    run("ufw", "allow", f"{port}/{protocol}", "comment", "Milo staging media")

new_caddy = '''# Milo staging app and independent programme distribution.
milo-staging.dgwebservices.nl {
    encode zstd gzip
    # Successful error handling logs upstream failures at DEBUG rather than
    # leaking WHIP keys or RTC query tokens into the shared error journal.
    # Keep Caddy debug/request-body logging disabled for protected routes.
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
        reverse_proxy 127.0.0.1:4173 {
            header_up -oai-authenticated-user-id
            header_up -oai-authenticated-user-email
            header_up -x-milo-user
            header_up -x-milo-role
        }
    }
}
'''
write(caddy, new_caddy, 0o644)
try:
    run("caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
except subprocess.CalledProcessError:
    shutil.copy2(backup / "milobingo-staging.caddy", caddy)
    raise
run("systemctl", "reload", "caddy.service")
run("systemctl", "enable", "--now", "milo-media-staging.service", "milo-media-maintenance.timer", "milo-media-observe.service")
run("docker", "compose", "-f", str(install / "compose.yaml"), "up", "-d", "--wait")
for path, digest in inventory.items():
    if path != str(caddy) and hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
        raise SystemExit("An unrelated Caddy site changed during installation.")
write(backup / "caddy-installed.sha256", hashlib.sha256(caddy.read_bytes()).hexdigest())
print(json.dumps({"installed": True, "host": socket.gethostname(), "backup": str(backup),
                  "appRestarted": False, "productionChanged": False}))
