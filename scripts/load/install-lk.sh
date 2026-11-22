#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'Deze vastgezette CLI-build is uitsluitend voor Linux x86_64.' >&2
  exit 1
fi
if [[ $# != 1 || "$1" != /* ]]; then
  echo 'Gebruik: bash scripts/load/install-lk.sh /absoluut/privaat/gereedschap-pad' >&2
  exit 1
fi
install -d -m 700 "$1"
archive="$1/lk_2.20.1_linux_amd64.tar.gz"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/livekit/livekit-cli/releases/download/v2.20.1/lk_2.20.1_linux_amd64.tar.gz \
  --output "$archive"
echo "9447d32fca1f2a1826c290e008c980b4279aaac7ac716bbcac6a5e4c722db182  $archive" | sha256sum --check --status
tar -xzf "$archive" -C "$1" lk
chmod 700 "$1/lk"
"$1/lk" --version
