#!/usr/bin/env python3
"""Bounded, own staging-only network check; temporary IP-limited Caddy route.

Run only after the host/no-real-show audit. This is bandwidth evidence, not AV,
TURN or viewer-capacity evidence. No credentials are accepted or printed.
"""
import datetime
import json
import pathlib
import secrets
import subprocess
import sys
import threading
import time
import urllib.request

if len(sys.argv) != 2:
    raise SystemExit('Gebruik: python3 scripts/load/probe-https-margin.py /private/result.json')
nonce = secrets.token_hex(12)
remote = r'''
import hashlib,http.server,json,os,pathlib,stat,subprocess,tempfile,time
assert os.uname().nodename=='dg-nxttrack-01'
fragment=pathlib.Path('/etc/caddy/sites/milobingo-staging.caddy')
original=fragment.read_bytes();metadata=fragment.stat();original_digest=hashlib.sha256(original).hexdigest()
assert b'milo-staging.dgwebservices.nl' in original
assert b'@milo_capacity_probe' not in original
backup_dir=pathlib.Path(tempfile.mkdtemp(prefix='milo-capacity-',dir='/run'));os.chmod(backup_dir,0o700)
backup=backup_dir/'original-fragment';backup.write_bytes(original);os.chmod(backup,0o600)
route='/_milo_capacity_NONCE'
insertion=('\n @milo_capacity_probe {\n  remote_ip 65.108.158.112\n  path '+route+'\n }\n handle @milo_capacity_probe {\n  reverse_proxy 127.0.0.1:5201\n }\n').encode()
offset=original.index(b'{')+1;modified=original[:offset]+insertion+original[offset:]
modified_digest=hashlib.sha256(modified).hexdigest();applied=False;result={'sourceOnly':'65.108.158.112','requestedSeconds':15,'ceilingMbps':400}
def replace(value):
 temporary=fragment.with_name(fragment.name+'.capacity-NONCE.tmp')
 with open(temporary,'xb') as handle:os.fchmod(handle.fileno(),stat.S_IMODE(metadata.st_mode));os.fchown(handle.fileno(),metadata.st_uid,metadata.st_gid);handle.write(value);handle.flush();os.fsync(handle.fileno())
 os.replace(temporary,fragment)
def validate_reload():
 subprocess.run(['caddy','validate','--config','/etc/caddy/Caddyfile'],check=True,capture_output=True,timeout=10)
 subprocess.run(['systemctl','reload','caddy'],check=True,capture_output=True,timeout=10)
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path!=route:self.send_error(404);return
  limit=750000000;chunk=bytes(65536);sent=0;start=time.monotonic()
  self.send_response(200);self.send_header('Content-Length',str(limit));self.send_header('Content-Type','application/octet-stream');self.send_header('Cache-Control','no-store');self.end_headers()
  try:
   while sent<limit:
    due=sent/50000000-(time.monotonic()-start)
    if due>0:time.sleep(due)
    if time.monotonic()-start>20:raise TimeoutError('bounded sender limit')
    size=min(65536,limit-sent);self.wfile.write(chunk[:size]);sent+=size
   result.update(sentBytes=sent,senderSeconds=time.monotonic()-start)
  except Exception as error:result['senderError']=type(error).__name__
server=http.server.HTTPServer(('127.0.0.1',5201),Handler);server.timeout=20
try:
 replace(modified);applied=True;validate_reload()
 print(json.dumps({'ready':True,'route':route,'originalDigest':original_digest,'boundedMbps':400,'boundedSeconds':15}),flush=True)
 server.handle_request()
except Exception as error:result['setupError']=type(error).__name__
finally:
 server.server_close()
 if applied:
  if hashlib.sha256(fragment.read_bytes()).hexdigest()!=modified_digest:
   result['cleanupConfirmed']=False;result['restoreBlockedByConcurrentEdit']=True;result['privateBackup']=str(backup)
  else:
   replace(original)
   try:
    validate_reload();result['cleanupConfirmed']=hashlib.sha256(fragment.read_bytes()).hexdigest()==original_digest
   except Exception as error:result['cleanupConfirmed']=False;result['restoreError']=type(error).__name__
 else:result['cleanupConfirmed']=True
 if result.get('cleanupConfirmed'):backup.unlink();backup_dir.rmdir()
 print(json.dumps(result),flush=True)
'''.replace('NONCE', nonce)
command = ['ssh', '-F', '/home/codex/.ssh/dg-nxttrack-admin.conf', '-o',
           'BatchMode=yes', '-o', 'ConnectTimeout=8', 'dg-nxttrack-01-admin',
           'sudo -n python3 -']
process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, text=True)
process.stdin.write(remote)
process.stdin.close()
ready_line = process.stdout.readline().strip()
report = {'format': 'milo-media-https-network-probe-v1',
          'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'target': '128.140.93.95', 'generator': '65.108.158.112',
          'requestedSeconds': 15, 'ceilingMbps': 400, 'receivedBytes': 0,
          'achievedMbps': None, 'mediaCapacityProven': False, 'healthProbes': []}
stop_health = threading.Event()
unhealthy = threading.Event()
def health_monitor():
    while not stop_health.is_set():
        for origin in ['https://milo-staging.dgwebservices.nl', 'https://milo.dgwebservices.nl']:
            try:
                with urllib.request.urlopen(origin + '/api/health', timeout=5) as response:
                    report['healthProbes'].append({'origin': origin, 'status': response.status})
                    if response.status != 200:
                        unhealthy.set()
            except Exception as error:
                report['healthProbes'].append({'origin': origin, 'error': type(error).__name__})
                unhealthy.set()
        if unhealthy.is_set():
            return
        stop_health.wait(2)
monitor = threading.Thread(target=health_monitor, daemon=True)
if ready_line:
    ready = json.loads(ready_line)
    report['setup'] = {key: value for key, value in ready.items() if key != 'route'}
    if ready.get('ready'):
        monitor.start()
        try:
            request = urllib.request.Request('https://milo-staging.dgwebservices.nl' + ready['route'])
            start = time.monotonic()
            with urllib.request.urlopen(request, timeout=10) as response:
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    report['receivedBytes'] += len(chunk)
                    if unhealthy.is_set():
                        raise RuntimeError('neighbor health check failed; stop load')
                    if time.monotonic() - start > 25:
                        raise TimeoutError('bounded receiver limit')
            report['elapsedSeconds'] = time.monotonic() - start
            report['achievedMbps'] = report['receivedBytes'] * 8 / report['elapsedSeconds'] / 1000000
        except Exception as error:
            report['receiverError'] = type(error).__name__
        finally:
            stop_health.set()
            monitor.join(timeout=6)
remainder = process.stdout.read().splitlines()
process.wait(timeout=35)
report['senderResult'] = [json.loads(line) for line in remainder if line.startswith('{')]
report['passed'] = bool(report['achievedMbps'] and report['achievedMbps'] >= 350 and
                        report.get('elapsedSeconds', 0) >= 14 and
                        not unhealthy.is_set() and
                        any(item.get('cleanupConfirmed') for item in report['senderResult']))
destination = pathlib.Path(sys.argv[1])
with open(destination, 'x', encoding='utf-8') as handle:
    import os
    os.fchmod(handle.fileno(), 0o600)
    json.dump(report, handle, indent=2)
    handle.write('\n')
print(json.dumps(report, indent=2))
if not report['passed']:
    raise SystemExit(1)
