#!/usr/bin/env python3
"""Read-only sampler. No service, firewall, files, or settings are changed."""
import json
import os
import shutil
import time

def read(path):
    with open(path, encoding='utf-8') as handle:
        return handle.read()

memory = {line.split(':')[0]: int(line.split()[1]) * 1024
          for line in read('/proc/meminfo').splitlines()}
cpu = [int(value) for value in read('/proc/stat').splitlines()[0].split()[1:]]
vm = dict(line.split() for line in read('/proc/vmstat').splitlines())
tx = 0
rx = 0
interfaces = []
for line in read('/proc/net/dev').splitlines()[2:]:
    name, values = line.split(':')
    name = name.strip()
    if name == 'lo' or name.startswith(('veth', 'docker', 'br-', 'tailscale')):
        continue
    values = values.split()
    rx += int(values[0])
    tx += int(values[8])
    interfaces.append(name)
pressure = 0.0
if os.path.exists('/proc/pressure/memory'):
    for line in read('/proc/pressure/memory').splitlines():
        if line.startswith('full '):
            pressure = float(dict(part.split('=') for part in line.split()[1:])['avg10'])
print(json.dumps({
    'format': 'milo-media-host-observation-v1',
    'observedAtMs': int(time.time() * 1000),
    'host': os.uname().nodename,
    'cpuCount': os.cpu_count(),
    'cpuTotal': sum(cpu[:8]),
    'cpuIdle': cpu[3] + (cpu[4] if len(cpu) > 4 else 0),
    'memTotalBytes': memory['MemTotal'],
    'memAvailableBytes': memory['MemAvailable'],
    'diskAvailableBytes': shutil.disk_usage('/').free,
    'txBytes': tx,
    'rxBytes': rx,
    'interfaces': interfaces,
    'oomKills': int(vm.get('oom_kill', 0)),
    'pressureMemoryFullAvg10': pressure,
}))
