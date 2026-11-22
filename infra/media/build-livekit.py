#!/usr/bin/env python3
"""Build the one-line staging SFU patch on an external Docker generator.

No runtime configuration, credentials, show data or host services are read.
The Go compiler/tests run in one container with hard CPU/memory limits.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tarfile
import time
import urllib.request
import uuid

COMMIT = "385aa40f9292fe1db8caad87301e4b285b7c198a"
SOURCE_SHA256 = "3e55849d55ddb01df0407f0896d564d09e9b2b6697be1a827c9f4854e963dbff"
ROOMMANAGER_SHA256 = "851fcb18f014e77678b4b3b91598dbd5f82a2c9c1ef4e131621580867d38898f"
BUILDER = "golang:1.27.3-alpine3.24@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd"
BASE = "livekit/livekit-server:v1.13.11@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20"
IMAGE = "milo-livekit-staging:1.13.11-turn-tls-port-v1"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="New empty build directory outside Git")
    parser.add_argument("--source-archive", type=Path, help="Optional cached archive; its pinned digest is always checked")
    parser.add_argument("--cache-dir", type=Path, help="Optional private Go cache from an earlier bounded build")
    args = parser.parse_args()
    if socket.gethostname() == "dg-nxttrack-01":
        raise SystemExit("Build on the external generator, never the shared show VPS.")
    if shutil.disk_usage(args.output.parent).free < 5 * 1024 ** 3:
        raise SystemExit("The external generator needs at least 5 GiB free disk.")
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    source_root = Path(__file__).resolve().parent
    report = {"format": 1, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "host": socket.gethostname(), "upstreamVersion": "1.13.11", "upstreamCommit": COMMIT,
              "sourceSha256": SOURCE_SHA256, "builder": BUILDER, "runtimeBase": BASE,
              "image": IMAGE, "credentialsRead": False, "hostServicesChanged": False}
    archive = output / "upstream.tar.gz"
    if args.source_archive:
        shutil.copyfile(args.source_archive, archive)
    else:
        with urllib.request.urlopen("https://codeload.github.com/livekit/livekit/tar.gz/" + COMMIT, timeout=60) as response:
            data = response.read(30 * 1024 * 1024 + 1)
        if len(data) > 30 * 1024 * 1024:
            raise SystemExit("Unexpectedly large upstream source archive.")
        archive.write_bytes(data)
    if sha256(archive) != SOURCE_SHA256:
        raise SystemExit("Pinned upstream source checksum differs.")
    with tarfile.open(archive) as package:
        package.extractall(output, filter="data")
    upstream = output / ("livekit-" + COMMIT)
    roommanager = upstream / "pkg/service/roommanager.go"
    if sha256(roommanager) != ROOMMANAGER_SHA256:
        raise SystemExit("Pinned roommanager.go checksum differs.")
    patch = source_root / "livekit-turn-tls-port.patch"
    report["patchSha256"] = sha256(patch)
    command("patch", "--fuzz=0", "-p1", "-i", str(patch), cwd=upstream)
    test = source_root / "livekit-turn-tls-port-test.go"
    shutil.copyfile(test, upstream / "pkg/service/milo_turn_port_test.go")
    report["testSha256"] = sha256(test)
    cache = args.cache_dir.resolve() if args.cache_dir else output / "cache"
    cache.mkdir(mode=0o700, exist_ok=args.cache_dir is not None)
    (cache / "tmp").mkdir(mode=0o700, exist_ok=True)
    container = "milo-sfu-port-build-" + uuid.uuid4().hex
    compiler_log = output / "compiler.log"
    compile_script = """set -eu
test "$(cat /sys/fs/cgroup/memory.max)" = 2147483648
test "$(cat /sys/fs/cgroup/cpu.max)" = '200000 100000'
go version
go mod download
go test ./pkg/service -run '^TestMiloEmbeddedTURNAdvertisedPort$' -count=1 -v -args -docker=false
go build -trimpath -buildvcs=false -ldflags='-s -w' -o /workspace/livekit-server ./cmd/server
go version -m /workspace/livekit-server
"""
    command("docker", "pull", BUILDER)
    command("docker", "create", "--name", container, "--cpus=2", "--memory=2g", "--memory-swap=2g",
            "--pids-limit=256", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--read-only",
            "--tmpfs=/tmp:rw,size=256m,mode=1777", "--mount", f"type=bind,src={upstream},dst=/workspace",
            "--mount", f"type=bind,src={cache},dst=/cache", "--workdir=/workspace",
            "--env=CGO_ENABLED=0", "--env=GOTOOLCHAIN=local", "--env=GOMAXPROCS=2", "--env=GOMEMLIMIT=1536MiB",
            "--env=GOFLAGS=-p=2", "--env=GOCACHE=/cache/build", "--env=GOMODCACHE=/cache/mod", "--env=GOPATH=/cache/gopath",
            "--env=GOTMPDIR=/cache/tmp",
            BUILDER, "/bin/sh", "-c", compile_script)
    try:
        inspection = json.loads(subprocess.check_output(["docker", "inspect", container], text=True))[0]
        limits = inspection["HostConfig"]
        if limits["Memory"] != 2147483648 or limits["NanoCpus"] != 2000000000:
            raise SystemExit("Compiler container resource limits were not applied.")
        report["compilerLimits"] = {"memoryBytes": limits["Memory"], "nanoCpus": limits["NanoCpus"],
                                    "pidsLimit": limits["PidsLimit"], "innerCgroupLimitsChecked": True}
        with compiler_log.open("w") as log:
            command("docker", "start", "--attach", container, stdout=log, stderr=subprocess.STDOUT)
        state = json.loads(subprocess.check_output(["docker", "inspect", container], text=True))[0]["State"]
        if state["ExitCode"] != 0 or state.get("OOMKilled"):
            raise SystemExit("Bounded compiler/test failed; inspect compiler.log.")
    finally:
        subprocess.run(["docker", "stop", "--time=5", container], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["docker", "rm", container], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    binary = upstream / "livekit-server"
    report["binarySha256"] = sha256(binary)
    report["targetedGoTestPassed"] = True
    context = output / "runtime"
    context.mkdir(mode=0o700)
    shutil.copyfile(binary, context / "livekit-server")
    (context / "livekit-server").chmod(0o755)
    shutil.copyfile(source_root / "LiveKit.Dockerfile", context / "Dockerfile")
    command("docker", "pull", BASE)
    command("docker", "build", "--network=none", "--build-arg", "MILO_LIVEKIT_BINARY_SHA256=" + report["binarySha256"],
            "--tag", IMAGE, str(context))
    image = json.loads(subprocess.check_output(["docker", "image", "inspect", IMAGE], text=True))[0]
    if image["Config"]["User"] != "65532:65532":
        raise SystemExit("Runtime UID changed.")
    report["imageId"] = image["Id"]
    report["runtimeUser"] = image["Config"]["User"]
    report["versionOutput"] = subprocess.check_output(["docker", "run", "--rm", "--network=none", "--read-only",
                                                       "--cpus=0.5", "--memory=128m", "--cap-drop=ALL",
                                                       "--security-opt=no-new-privileges:true", IMAGE, "--version"], text=True).strip()
    image_archive = output / "livekit-staging-image.tar"
    command("docker", "save", "--output", str(image_archive), IMAGE)
    report["imageArchiveSha256"] = sha256(image_archive)
    report["imageArchive"] = str(image_archive)
    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report["passed"] = True
    (output / "build-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
