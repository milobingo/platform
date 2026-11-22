#!/usr/bin/env python3
"""Read-only sampler. No service, firewall, files, or settings are changed."""
import json
import math
import os
import re
import shutil
import subprocess
import time
import urllib.request

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
prometheus = {'measured': False, 'scope': 'own LiveKit SFU on loopback:6798'}
try:
    with urllib.request.urlopen('http://127.0.0.1:6798/metrics', timeout=2) as response:
        payload = response.read(2000001).decode('utf-8')
    if len(payload) > 2000000:
        raise ValueError('metrics limit')
    allowed = {'livekit_packet_bytes', 'livekit_packet_total', 'livekit_connection_total',
               'livekit_participant_total', 'livekit_track_subscribed_total',
               'process_cpu_seconds_total', 'process_resident_memory_bytes',
               'process_start_time_seconds'}
    totals = {}
    for line in payload.splitlines():
        match = re.match(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+0-9.eE]+)(?:\s+\d+)?$', line)
        if not match or match[1] not in allowed:
            continue
        number = float(match[3])
        if not math.isfinite(number):
            continue
        labels = dict(re.findall(r'([a-zA-Z_]+)="([^"\\]*)"', match[2] or ''))
        suffix = ','.join(key + '=' + labels[key] for key in ['direction', 'transmission', 'kind'] if key in labels)
        key = match[1] + ('{' + suffix + '}' if suffix else '')
        totals[key] = totals.get(key, 0) + number
    prometheus = {'measured': bool(totals), 'scope': 'own LiveKit SFU on loopback:6798',
                  'metrics': totals, 'dedicatedTurnMetrics': False}
except Exception as error:
    prometheus['error'] = type(error).__name__
turn = {'measured': False, 'scope': 'eth0 embedded TURN listeners UDP3480/TCP5349'}
try:
    result = subprocess.run(['sudo', '-n', 'nft', '-j', '-a', 'list', 'table', 'inet',
                             'milo_media_turn_observe'], capture_output=True,
                            text=True, check=True, timeout=3)
    if len(result.stdout) > 1000000:
        raise ValueError('counter output limit')
    counters = {}
    for entry in json.loads(result.stdout).get('nftables', []):
        counter = entry.get('counter', {})
        if counter.get('name') in {'udp_in', 'udp_out', 'tls_in', 'tls_out'}:
            counters[counter['name']] = {'packets': counter['packets'], 'bytes': counter['bytes'],
                                          'handle': counter.get('handle')}
    if len(counters) != 4:
        raise ValueError('missing named counter')
    turn = {'measured': True, 'scope': 'eth0 embedded TURN listeners UDP3480/TCP5349',
            'counters': counters, 'includesProtocolOverhead': True,
            'scopeLimitation': 'host-wide own TURN listeners; no per-room attribution'}
except Exception as error:
    turn['error'] = type(error).__name__
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
    'livekitPrometheus': prometheus,
    'turnNetwork': turn,
}))
