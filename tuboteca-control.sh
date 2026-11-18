#!/usr/bin/env bash
# Tuboteca Control — gestiona el servidor y abre la app en Brave.
#
#   launch   arranca el servidor si hace falta y abre Brave (acción del dock)
#   start    solo arranca el servidor
#   stop     detiene el servidor
#   restart  reinicia el servidor
#   brave    solo abre Brave
#   toggle   alterna (para terminal)

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PORT="${PORT:-4321}"
URL="http://127.0.0.1:${PORT}"
PID_FILE="${PROJECT_DIR}/server.pid"
LOG_FILE="${PROJECT_DIR}/server.log"

server_pid() {
  # El PID real es quien escucha en el puerto, no un archivo que puede quedar viejo.
  fuser "${PORT}/tcp" 2>/dev/null | tr -s '[:space:]' ' ' | awk '{print $1}' || true
}

is_ours() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  [ "$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)" = "$PROJECT_DIR" ] || return 1
  tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null | grep -q 'server\.js'
}

is_running() {
  local pid body
  pid="$(server_pid)"
  [ -n "$pid" ] || return 1
  is_ours "$pid" || return 1
  body="$(curl -fsS -m 2 "${URL}/api/ping" 2>/dev/null || true)"
  [[ "$body" == *'"app":"tuboteca"'* ]]
}

start_server() {
  if is_running; then
    local pid; pid="$(server_pid)"
    echo "$pid" > "$PID_FILE"
    echo "El servidor ya está corriendo (PID ${pid})."
    return 0
  fi

  local busy; busy="$(server_pid)"
  if [ -n "$busy" ]; then
    if is_ours "$busy"; then
      echo "Hay una instancia de Tuboteca que no responde (PID ${busy}). Usa: $0 stop" >&2
    else
      echo "El puerto ${PORT} está ocupado por otro programa (PID ${busy}). Prueba con PORT=otro $0 launch" >&2
    fi
    return 1
  fi

  echo "Arrancando Tuboteca en ${URL} …"
  (
    cd "$PROJECT_DIR"
    nohup node server.js >>"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )

  for _ in $(seq 1 60); do
    if is_running; then
      echo "Servidor listo (PID $(cat "$PID_FILE"))."
      return 0
    fi
    sleep 0.2
  done

  echo "El servidor no respondió. Últimas líneas del log:" >&2
  tail -n 12 "$LOG_FILE" >&2 || true
  return 1
}

stop_server() {
  local pid; pid="$(server_pid)"
  if [ -z "$pid" ]; then
    echo "El servidor no está corriendo."
    rm -f "$PID_FILE"
    return 0
  fi

  if ! is_ours "$pid"; then
    echo "El puerto ${PORT} lo ocupa otro programa (PID ${pid}); no lo toco." >&2
    return 1
  fi

  echo "Deteniendo servidor (PID ${pid})…"
  kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 25); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo "Servidor detenido."
}

open_brave() {
  local brave_bin=""
  for b in brave-browser brave-browser-stable brave; do
    if command -v "$b" >/dev/null 2>&1; then
      brave_bin="$b"
      break
    fi
  done

  if [ -z "$brave_bin" ]; then
    echo "No encontré Brave; abriendo con xdg-open." >&2
    xdg-open "${URL}" >/dev/null 2>&1 &
    return 0
  fi

  # Ventana tipo app, sin barra de navegador.
  "$brave_bin" --app="${URL}" --class=Tuboteca >/dev/null 2>&1 &
}

launch() {
  start_server
  open_brave
}

case "${1:-launch}" in
  launch)
    launch
    ;;
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server
    start_server
    ;;
  brave)
    open_brave
    ;;
  toggle)
    if is_running; then stop_server; else launch; fi
    ;;
  *)
    echo "Uso: $0 {launch|start|stop|restart|brave|toggle}"
    exit 1
    ;;
esac
