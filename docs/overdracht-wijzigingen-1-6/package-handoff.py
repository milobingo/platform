#!/usr/bin/env python3
"""Package the committed Milo handoff. Does not build, deploy, send or call providers.

Example (only after all 13 captures and the final source commit are ready):
  python package-handoff.py --commit <full-sha> --version 2026-11-06-v6
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
DEFAULT_REPO = Path('/workspace/sites/milo-friends')
DEFAULT_SHOTS = Path('/workspace/scratch')
PACKAGE_NAME = 'Milo-Friends-Codex-Overdracht-Wijzigingen-1-6'
DOCS = (
    'START-HIER.md', 'CODEX-PROMPT.md', 'WIJZIGINGEN-1-TM-6.md',
    'INSTALLATIE-EN-KOPPELINGEN.md', 'TESTEN-EN-ACCEPTATIE.md', 'SCREENSHOTS.md',
)
SHOTS = (
    ('01-bingo-prioriteit.jpg', 1),
    ('02-troostprijs-instellingen.jpg', 1),
    ('03-milo-studiorondje.jpg', 2),
    ('04-goochelatelier.jpg', 3),
    ('05-magie-onthulling.jpg', 3),
    ('06-gezin-bestellen.jpg', 4),
    ('07-organisatie-bestelling.jpg', 4),
    ('08-goedgekeurde-bladen.jpg', 4),
    ('09-regie-desktop.jpg', 5),
    ('10-familie-mobiel.jpg', 5),
    ('11-fluisteren-regie.jpg', 6),
    ('12-fluisteren-voorstel.jpg', 6),
    ('13-fluisteren-simulatie.jpg', 6),
)
BUILD_EXAMPLE = {
    'project_id': 'local-preview-only-do-not-deploy',
    'r2': 'SETTINGS',
    'd1': 'DB',
}
EXPORT_NOTICE = '''\n> **Bij deze ZIP-export:** lees eerst `PAKKET-LEESMIJ.md` in de pakketroot. Het accountgebonden hostingmanifest is weggelaten. Kopieer voor uitsluitend een lokale build in `bron/` eerst `.openai/hosting.example.json` naar `.openai/hosting.json`. Dit generieke bestand is een niet-deploybare builddummy; richt productie volgens de doelrepo in. De pakketroot en `handoff/` bevatten de leidende documenten en geldige screenshotlinks.\n\n'''
PORTABLE_README = '''# Eerst lezen bij deze ZIP-export

Open `index.html` in de pakketroot voor de offline galerij en lees daar `START-HIER.md` en `CODEX-PROMPT.md`. De documenten in de pakketroot en `handoff/` zijn leidend voor de screenshotlinks en deze exportaanvulling. De originele `bron/handoff/`-documenten komen ongewijzigd uit de broncommit; hun relatieve screenshotlinks zijn niet de navigatie voor deze pakketindeling.

## Lokale builddummy eerst aanmaken

Het oorspronkelijke accountgebonden `.openai/hosting.json` is bewust niet geëxporteerd. De bestaande build kopieert dat bestand onvoorwaardelijk. Daarom bevat deze export uitsluitend een aanvullend generiek `.openai/hosting.example.json` met `project_id: local-preview-only-do-not-deploy` en de logische bindingsnamen `SETTINGS` en `DB`.

Voer vanuit de pakketroot uit:

```sh
cd bron
cp .openai/hosting.example.json .openai/hosting.json
npm ci
npm run build
```

Deze expliciete kopieerstap is nodig vóór de eerste lokale build. De dummy bevat geen account, projecttoegang, fysieke Cloudflare-resource-ID, sleutel of database. **Nooit met deze dummy deployen.** De namen `SETTINGS` en `DB` documenteren alleen de logische serverbindings; de export maakt geen echte R2/D1 aan.

Gebruik bij integratie de echte hosting/auth/opslag- en deploymentconventies van de doelrepo. Vervang niet blind een al werkend manifest, framework of lockbestand. De oorspronkelijke repository en zijn hostingmanifest zijn voor deze export niet gewijzigd.

De lokale UI-preview en providerfixtures bewijzen geen echte backend-, mail-, betaal-, AI- of audioverbinding. Zie de installatie- en acceptatiedocumenten. De extra exportbestanden en documentaanvullingen staan expliciet in `SOURCE-INFO.json`.
'''
EXCLUDED_DIRS = {'.git', 'node_modules', '.sites-runtime', '__pycache__'}
FORBIDDEN_NAMES = {'id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'}
BINARY_SUFFIXES = {'.png','.jpg','.jpeg','.webp','.gif','.ico','.pdf','.mp3','.mp4','.wav','.woff','.woff2','.ttf','.otf','.zip','.gz','.wasm'}
SECRET_PATTERNS = (
    (re.compile(rb'(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}'), 'possible OpenAI secret'),
    (re.compile(rb'(?<![A-Za-z0-9_])re_[A-Za-z0-9]{24,}'), 'possible mail-provider secret'),
    (re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'), 'private key'),
)

def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()

def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()

def excluded(path: PurePosixPath) -> bool:
    if str(path) == '.openai/hosting.json':
        return True
    if any(part in EXCLUDED_DIRS for part in path.parts):
        return True
    if path.name.startswith('.env') and path.name != '.env.example':
        return True
    return False

def check_source_secret(path: PurePosixPath, data: bytes) -> None:
    if path.name in FORBIDDEN_NAMES or path.suffix.lower() in {'.pem', '.p12', '.pfx'}:
        raise ValueError(f'Credential-shaped file rejected: {path}')
    if path.suffix.lower() in BINARY_SUFFIXES or b'\0' in data[:4096]:
        return
    for pattern, label in SECRET_PATTERNS:
        if pattern.search(data):
            # Report only the path/category; never print the match or file data.
            raise ValueError(f'{label} rejected in {path}; review without printing its value')
    if path.name == '.env.example':
        sensitive = {'OPENAI_API_KEY','VLAMPIE_ADMIN_EMAIL','VLAMPIE_SETTINGS_KEY','RESEND_API_KEY','PLAYER_MAIL_FROM'}
        for line in data.decode('utf-8').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                if key.strip() in sensitive and value.strip():
                    raise ValueError(f'Nonempty secret/account example rejected in {path}: {key.strip()}')

def jpeg_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if not data.startswith(b'\xff\xd8'):
        raise ValueError(f'Not a JPEG capture: {path.name}')
    position = 2
    sof = {0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF}
    while position < len(data):
        if data[position] != 0xFF:
            position += 1
            continue
        while position < len(data) and data[position] == 0xFF:
            position += 1
        if position >= len(data):
            break
        marker = data[position]
        position += 1
        if marker in {0xD8,0xD9,0x01} or 0xD0 <= marker <= 0xD7:
            continue
        if position + 2 > len(data):
            break
        length = int.from_bytes(data[position:position+2], 'big')
        if length < 2 or position + length > len(data):
            break
        if marker in sof and length >= 8:
            height = int.from_bytes(data[position+3:position+5], 'big')
            width = int.from_bytes(data[position+5:position+7], 'big')
            if width < 250 or height < 150:
                raise ValueError(f'Capture is unexpectedly small: {path.name} ({width}x{height})')
            return width, height
        if marker == 0xDA:
            break
        position += length
    raise ValueError(f'JPEG dimensions not found: {path.name}')

def export_commit(repo: Path, commit: str, destination: Path, tar_path: Path) -> list[str]:
    with tar_path.open('wb') as output:
        subprocess.run(['git','-C',str(repo),'archive','--format=tar',commit], stdout=output, check=True)
    skipped = []
    with tarfile.open(tar_path, 'r:') as archive:
        for member in archive:
            relative = PurePosixPath(member.name)
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError(f'Unsafe archive path: {relative}')
            if excluded(relative):
                if member.isfile():
                    skipped.append(str(relative))
                continue
            target = destination.joinpath(*relative.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise ValueError(f'Unexpected non-regular source entry: {relative}')
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f'Unreadable archive member: {relative}')
            data = stream.read()
            check_source_secret(relative, data)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
    return sorted(skipped)

def write_json(path: Path, content: object) -> None:
    path.write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--commit', required=True, help='Final source commit (resolved once to a full SHA)')
    parser.add_argument('--version', required=True, help='Reviewable release label, e.g. 2026-11-06-v6')
    parser.add_argument('--repo', type=Path, default=DEFAULT_REPO)
    parser.add_argument('--screenshots-dir', type=Path, default=DEFAULT_SHOTS)
    parser.add_argument('--output', type=Path, default=HERE / (PACKAGE_NAME + '.zip'))
    parser.add_argument('--site-version', default='appgprj_6ac2dd7f3d6c819190b17cc04ae8daad~appgver_021341b4b8288191bdcd77837af3b9ca', help='Published reference Site version, recorded only as provenance')
    parser.add_argument('--deployed-at', default='2026-11-06T01:21:11Z', help='Published reference Site deployment time')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', args.version):
        parser.error('--version must contain only letters, digits, dots, hyphens or underscores (max 80 characters)')
    repo = args.repo.resolve()
    commit = git(repo, 'rev-parse', '--verify', args.commit + '^{commit}')
    if not re.fullmatch(r'[a-f0-9]{40,64}', commit):
        raise ValueError('Could not resolve a complete source commit')
    commit_time = git(repo, 'show', '-s', '--format=%cI', commit)
    screenshots = []
    missing = [name for name, _ in SHOTS if not (args.screenshots_dir / name).is_file()]
    if missing:
        raise ValueError('All 13 captures are required; missing: ' + ', '.join(missing))
    for name, change in SHOTS:
        path = args.screenshots_dir / name
        width, height = jpeg_dimensions(path)
        screenshots.append({'file':'screenshots/'+name, 'change':change, 'width':width, 'height':height, 'sha256':digest(path), 'kind':'actual-app-browser-capture', 'data':'fictional/demo; no real-provider claim'})
    template = HERE / 'index.html'
    if not template.is_file():
        raise ValueError('Offline gallery template missing beside this script')
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_zip = output.with_name(output.name + '.partial')
    with tempfile.TemporaryDirectory(prefix='milo-handoff-', dir=output.parent) as temporary:
        workspace = Path(temporary)
        package = workspace / PACKAGE_NAME
        source = package / 'bron'
        source.mkdir(parents=True)
        skipped = export_commit(repo, commit, source, workspace/'source.tar')
        (source/'.openai').mkdir(exist_ok=True)
        write_json(source/'.openai'/'hosting.example.json', BUILD_EXAMPLE)
        (source/'PAKKET-LEESMIJ.md').write_text(PORTABLE_README, encoding='utf-8')
        (package/'PAKKET-LEESMIJ.md').write_text(PORTABLE_README, encoding='utf-8')
        missing_docs = [name for name in DOCS if not (source/'handoff'/name).is_file()]
        if missing_docs:
            raise ValueError('Handoff docs must be included in the selected commit: ' + ', '.join(missing_docs))
        (package/'handoff').mkdir()
        for name in DOCS:
            data = (source/'handoff'/name).read_text(encoding='utf-8')
            if name in {'START-HIER.md','INSTALLATIE-EN-KOPPELINGEN.md'}:
                first_line, remainder = data.split('\n', 1)
                data = first_line + '\n' + EXPORT_NOTICE + remainder
            elif name == 'CODEX-PROMPT.md':
                data = data.replace('Voer de zes wijzigingen volledig door:', 'Deze ZIP-export bevat geen accountgebonden hostingmanifest. Voor een lokale build in `bron/`: kopieer eerst `.openai/hosting.example.json` naar `.openai/hosting.json`, zoals beschreven in `PAKKET-LEESMIJ.md`. Dit is uitsluitend een generieke niet-deploybare builddummy. Gebruik voor integratie de echte doelrepo-inrichting; maak geen cloudresources of deploy met deze placeholder. De pakketrootdocumenten en `handoff/` bevatten de leidende screenshotlinks en exportaanvullingen.\n\nVoer de zes wijzigingen volledig door:')
            (package/'handoff'/name).write_text(data, encoding='utf-8')
            root_copy = data.replace('../screenshots/', 'screenshots/') if name == 'SCREENSHOTS.md' else data
            (package/name).write_text(root_copy, encoding='utf-8')
        (package/'screenshots').mkdir()
        for name, _ in SHOTS:
            shutil.copyfile(args.screenshots_dir/name, package/'screenshots'/name)
        gallery = template.read_text(encoding='utf-8').replace('<!--VERSION-->', ' · ' + html.escape(args.version) + ' · ' + commit[:12])
        (package/'index.html').write_text(gallery, encoding='utf-8')
        shutil.copyfile(Path(__file__), package/'package-handoff.py')
        write_json(package/'SOURCE-INFO.json', {
            'project':'Milo & Friends BingoShow',
            'origin_kind':'existing Sites project',
            'origin_url':'https://vlampie-studio.dgwebserv.chatgpt.site',
            'published_site_version':args.site_version,
            'published_site_deployed_at':args.deployed_at,
            'source_commit':commit,
            'source_commit_time':commit_time,
            'export_method':'git archive of the resolved commit; no uncommitted source overlay. Explicit packaging-only additions listed below.',
            'source_directory':'bron',
            'omitted_source_files':skipped,
            'hosting_notice':'The origin-specific .openai/hosting.json is omitted. Use the target repository deployment workflow; this is not a ready VPS deployment.',
            'packaging_only_additions':[
                {'file':'bron/.openai/hosting.example.json','purpose':'Generic local-build-only dummy; no original project/account/resource IDs. Explicit copy required before local build; never deploy.'},
                {'file':'bron/PAKKET-LEESMIJ.md','purpose':'Portable build/read-order notice; original committed source files remain unchanged.'},
                {'file':'PAKKET-LEESMIJ.md','purpose':'Package entrypoint and explicit local-build copy step.'},
            ],
            'packaging_only_doc_supplements':['START-HIER.md','INSTALLATIE-EN-KOPPELINGEN.md','CODEX-PROMPT.md','handoff/START-HIER.md','handoff/INSTALLATIE-EN-KOPPELINGEN.md','handoff/CODEX-PROMPT.md'],
            'doc_supplement_notice':'Root/handoff copies add the explicit portable-build notice; committed bron/handoff originals remain byte-for-byte source. Root SCREENSHOTS.md adjusts only relative screenshot links.',
            'secrets_notice':'No real environment files, provider secrets, node_modules, session stores or local working-tree data are exported. .env.example contains empty account/secret fields.',
        })
        files_before_manifest = [path for path in package.rglob('*') if path.is_file()]
        write_json(package/'VERSIE.json', {
            'project':'Milo & Friends BingoShow',
            'version':args.version,
            'changes':[1,2,3,4,5,6],
            'source_commit':commit,
            'source_commit_time':commit_time,
            'packaged_at':datetime.now(timezone.utc).isoformat(),
            'entrypoint':'index.html',
            'codex_prompt':'CODEX-PROMPT.md',
            'source':'bron/',
            'docs':'handoff/',
            'screenshots':screenshots,
            'checksum_manifest':'SHA256SUMS',
            'checksum_scope':'Every package file except SHA256SUMS itself; external .zip.sha256 verifies the ZIP.',
            'test_notice':'Screenshots and provider fixtures do not prove an actual OpenAI, LiveKit, YouTube, email or payment rehearsal. See TESTEN-EN-ACCEPTATIE.md.',
            'source_file_count':sum(1 for path in source.rglob('*') if path.is_file()),
            'package_file_count':len(files_before_manifest)+2,
        })
        manifest_files = sorted((path for path in package.rglob('*') if path.is_file()), key=lambda path:path.relative_to(package).as_posix())
        (package/'SHA256SUMS').write_text(''.join(f'{digest(path)}  {path.relative_to(package).as_posix()}\n' for path in manifest_files), encoding='utf-8')
        final_files = sorted((path for path in package.rglob('*') if path.is_file()), key=lambda path:path.relative_to(package).as_posix())
        expected_prefix = PACKAGE_NAME + '/'
        try:
            with zipfile.ZipFile(temporary_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                for path in final_files:
                    archive.write(path, expected_prefix + path.relative_to(package).as_posix())
            with zipfile.ZipFile(temporary_zip) as archive:
                corrupt = archive.testzip()
                if corrupt:
                    raise ValueError('ZIP verification failed: ' + corrupt)
                names = set(archive.namelist())
                if any(name.endswith('/.openai/hosting.json') for name in names):
                    raise ValueError('Origin-specific hosting manifest unexpectedly included')
                for name, _ in SHOTS:
                    if expected_prefix+'screenshots/'+name not in names:
                        raise ValueError('Screenshot missing from ZIP: ' + name)
            os.replace(temporary_zip, output)
        finally:
            temporary_zip.unlink(missing_ok=True)
    checksum_path = output.with_name(output.name + '.sha256')
    checksum_path.write_text(f'{digest(output)}  {output.name}\n', encoding='utf-8')
    print('Created:', output)
    print('Source commit:', commit)
    print('Screenshots:', len(SHOTS))
    print('ZIP bytes:', output.stat().st_size)
    print('ZIP checksum:', checksum_path)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError, OSError) as error:
        raise SystemExit('Packaging stopped: ' + str(error)) from None
