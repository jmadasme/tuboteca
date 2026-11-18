#!/usr/bin/env bash
# Arranca Tuboteca (si hace falta) y abre la ventana de Brave.
set -euo pipefail
cd "$(dirname "$0")"
exec ./tuboteca-control.sh launch
