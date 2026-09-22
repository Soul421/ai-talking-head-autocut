#!/usr/bin/env bash
# One-click install wrapper. Python 3.9+ required.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$DIR/install.py" "$@"
