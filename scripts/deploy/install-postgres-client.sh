#!/usr/bin/env bash
# Official PGDG client tooling for the dedicated Milo Ubuntu 24.04 host.
# Default is read-only. Obtain the actual source major from the verified audit.
set -euo pipefail

source_major=''
install_requested=false
for argument in "$@"; do
  case "$argument" in
    --source-major=*) source_major="${argument#--source-major=}" ;;
    --install) install_requested=true ;;
    *) printf '%s\n' 'Usage: bash scripts/deploy/install-postgres-client.sh --source-major=17 [--install]' >&2; exit 2 ;;
  esac
done
case "$source_major" in
  15|16|17|18) ;;
  *) printf '%s\n' 'Provide the actual supported source major from the verified staging audit.' >&2; exit 2 ;;
esac

# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != ubuntu || "${VERSION_ID:-}" != 24.04 || "${VERSION_CODENAME:-}" != noble || "$(dpkg --print-architecture)" != amd64 ]]; then
  printf '%s\n' 'This installer is bounded to Ubuntu 24.04 noble amd64.' >&2
  exit 1
fi
if [[ "$(hostname)" != dg-nxttrack-01 ]]; then
  printf '%s\n' 'This installer is bounded to the dedicated Milo staging host.' >&2
  exit 1
fi
for tool in curl gpg apt-get cmp install mktemp awk; do
  command -v "$tool" >/dev/null
done
key_fingerprint='B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8'
key_path='/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc'
source_path='/etc/apt/sources.list.d/pgdg.sources'
printf 'Plan: official PGDG noble repository; postgresql-client-%s only; signing key %s.\n' "$source_major" "$key_fingerprint"
if [[ "$install_requested" != true ]]; then
  printf '%s\n' 'Read-only plan completed. No package, repository or key was changed.'
  exit 0
fi
if [[ "$EUID" != 0 ]]; then
  printf '%s\n' 'Installation requires the authorized host administrator.' >&2
  exit 1
fi

temporary_directory="$(mktemp -d /tmp/milo-pgdg-client.XXXXXXXX)"
trap 'rm -rf -- "$temporary_directory"' EXIT
install -d -m 0700 "$temporary_directory/gnupg"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  --output "$temporary_directory/key.asc"
gpg --homedir "$temporary_directory/gnupg" --batch --with-colons --show-keys "$temporary_directory/key.asc" > "$temporary_directory/key.metadata"
mapfile -t primary_fingerprints < <(awk -F: '$1=="pub" {primary=1} $1=="fpr" && primary {print $10; primary=0}' "$temporary_directory/key.metadata")
if [[ "${#primary_fingerprints[@]}" != 1 || "${primary_fingerprints[0]:-}" != "$key_fingerprint" ]]; then
  printf '%s\n' 'The official PGDG signing-key fingerprint does not match the reviewed key.' >&2
  exit 1
fi
cat > "$temporary_directory/pgdg.sources" <<'SOURCES'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
SOURCES
for existing in "$key_path" "$source_path"; do
  if [[ -L "$existing" ]]; then
    printf '%s\n' 'An existing PGDG configuration path is a symlink; review it before installation.' >&2
    exit 1
  fi
done
if [[ -e "$key_path" ]] && ! cmp -s "$key_path" "$temporary_directory/key.asc"; then
  printf '%s\n' 'An existing PGDG key differs; review it before installation.' >&2
  exit 1
fi
if [[ -e "$source_path" ]] && ! cmp -s "$source_path" "$temporary_directory/pgdg.sources"; then
  printf '%s\n' 'An existing PGDG source differs; review it before installation.' >&2
  exit 1
fi
install -d -o root -g root -m 0755 /usr/share/postgresql-common/pgdg
install -o root -g root -m 0644 "$temporary_directory/key.asc" "$key_path"
install -o root -g root -m 0644 "$temporary_directory/pgdg.sources" "$source_path"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends "postgresql-client-$source_major"
for tool in psql pg_dump pg_restore; do
  "/usr/lib/postgresql/$source_major/bin/$tool" --version
done
printf '%s\n' 'Only client tooling was requested. No PostgreSQL server or application service was installed or started.'
