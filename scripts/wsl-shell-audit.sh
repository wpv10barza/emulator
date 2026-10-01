#!/usr/bin/env bash
# Audita configuraciones de Bash que pueden convertir fallos normales en cierres de terminal.
# Intencionalmente NO usa `set -e`, `set -u` ni `set -o pipefail`.

MODE="${1:-audit}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WARNINGS=0

USER_FILES=(
  "$HOME/.bashrc"
  "$HOME/.bash_profile"
  "$HOME/.profile"
  "$HOME/.bash_aliases"
)
SYSTEM_FILES=(
  "/etc/bash.bashrc"
  "/etc/profile"
)

is_errexit_line() {
  local line="$1"
  [[ "$line" =~ ^[[:space:]]*set[[:space:]]+-[A-Za-z]*e[A-Za-z]*([[:space:]]|$) ]] ||
  [[ "$line" =~ ^[[:space:]]*set[[:space:]]+-o[[:space:]]+errexit([[:space:]]|$) ]]
}

scan_file() {
  local file="$1"
  [ -f "$file" ] || return 0

  local number=0 line
  while IFS= read -r line || [ -n "$line" ]; do
    number=$((number + 1))
    if is_errexit_line "$line"; then
      printf 'WARN errexit: %s:%s: %s\n' "$file" "$number" "$line"
      WARNINGS=$((WARNINGS + 1))
    elif [[ "$line" =~ ^[[:space:]]*exit([[:space:]]|$) ]]; then
      printf 'WARN exit en inicio de shell: %s:%s: %s\n' "$file" "$number" "$line"
      WARNINGS=$((WARNINGS + 1))
    elif [[ "$line" =~ ^[[:space:]]*exec[[:space:]]+ ]]; then
      printf 'INFO exec en inicio de shell (revise si es intencional): %s:%s: %s\n' "$file" "$number" "$line"
    fi
  done < "$file"
}

fix_user_file() {
  local file="$1"
  [ -f "$file" ] || return 0

  local backup="${file}.backup-${STAMP}"
  cp -p "$file" "$backup" || {
    printf 'ERROR no se pudo respaldar %s\n' "$file" >&2
    return 1
  }

  local temp="${file}.tmp-${STAMP}"
  : > "$temp" || return 1
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    if is_errexit_line "$line"; then
      printf '# DISABLED_BY_EMULATOR_WSL_AUDIT %s\n' "$line" >> "$temp"
    else
      printf '%s\n' "$line" >> "$temp"
    fi
  done < "$file"

  cat "$temp" > "$file"
  rm -f "$temp"
  printf 'FIXED %s (backup: %s)\n' "$file" "$backup"
}

printf '=== WSL/BASH COLLAPSE AUDIT ===\n'
printf 'user=%s\n' "$(id -un 2>/dev/null || printf unknown)"
printf 'shell=%s\n' "${SHELL:-unknown}"
printf 'WSL_DISTRO_NAME=%s\n' "${WSL_DISTRO_NAME:-}"
printf 'DEVCONTAINER=%s\n' "${DEVCONTAINER:-}"
printf 'REMOTE_CONTAINERS=%s\n' "${REMOTE_CONTAINERS:-}"
printf 'BASH_VERSION=%s\n' "${BASH_VERSION:-not-bash}"
printf '\n=== STARTUP FILES ===\n'

for file in "${USER_FILES[@]}" "${SYSTEM_FILES[@]}"; do
  scan_file "$file"
done

if [ "$MODE" = "--fix-user-shell" ] || [ "$MODE" = "fix" ]; then
  printf '\n=== FIX USER STARTUP FILES ===\n'
  for file in "${USER_FILES[@]}"; do
    fix_user_file "$file" || printf 'WARN no se pudo corregir %s\n' "$file" >&2
  done
  printf '\nAbra una terminal nueva despues de la reparacion.\n'
fi

printf '\n=== RESULT ===\n'
if [ "$WARNINGS" -gt 0 ]; then
  printf '%s advertencia(s) detectada(s). El auditor termina con 0 para no cerrar la terminal.\n' "$WARNINGS"
else
  printf 'No se detectaron lineas directas de errexit/exit en los archivos revisados.\n'
fi

exit 0
