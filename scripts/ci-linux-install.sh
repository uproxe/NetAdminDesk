#!/usr/bin/env bash
# Проверка пакета NetAdmin Desk в чистом контейнере дистрибутива (запускается в CI).
#
#   docker run --rm --shm-size=1g -v "$PWD/pkg:/pkg:ro" -v "$PWD/scripts:/ci:ro" fedora:latest \
#     bash /ci/ci-linux-install.sh rpm
#
# Пакет ставится штатным менеджером пакетов дистрибутива — зависимости берутся из его репозиториев.
# Затем проверяется, что программе хватает системных библиотек, и запускается её самопроверка (--smoke-test).
set -euo pipefail

fmt="${1:?укажите формат пакета: deb, rpm или pacman}"
pkg="/pkg/netadmindesk-linux-amd64.$fmt"
[ -f "$pkg" ] || { echo "Нет файла $pkg"; exit 1; }
. /etc/os-release
echo "== $PRETTY_NAME — установка $(basename "$pkg")"

case "$fmt" in
  deb)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q
    apt-get install -y -q "$pkg" xvfb
    ;;
  rpm)
    if command -v zypper >/dev/null 2>&1; then
      # Пакет не подписан ключом репозитория — для локального файла это ожидаемо
      zypper --non-interactive refresh
      zypper --non-interactive --no-gpg-checks install --allow-unsigned-rpm "$pkg" xorg-x11-server-Xvfb
    else
      dnf install -y "$pkg" xorg-x11-server-Xvfb
    fi
    ;;
  pacman)
    pacman -Syu --noconfirm --needed xorg-server-xvfb
    pacman -U --noconfirm "$pkg"
    ;;
  *)
    echo "Неизвестный формат: $fmt"; exit 1 ;;
esac

BIN="$(command -v netadmindesk || true)"
[ -n "$BIN" ] || { echo "После установки нет команды netadmindesk"; exit 1; }
REAL="$(readlink -f "$BIN")"
echo "== Команда: $BIN -> $REAL"

if command -v ldd >/dev/null 2>&1; then
  missing="$(ldd "$REAL" | grep 'not found' || true)"
  if [ -n "$missing" ]; then
    echo "Программе не хватает системных библиотек — их нужно добавить в зависимости пакета $fmt:"
    echo "$missing"
    exit 1
  fi
  echo "== Все библиотеки найдены"
fi

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99
for _ in $(seq 1 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.2; done

export NETADMIN_DESK_DATA=/tmp/nad-data NAD_SMOKE_OUT=/tmp/smoke.json
# В контейнере программа запущена от root: Chromium требует --no-sandbox. Видеокарты нет: --disable-gpu.
set +e
timeout 180 "$BIN" --smoke-test --no-sandbox --disable-gpu
rc=$?
set -e
echo "== Результат самопроверки (код $rc):"
cat "$NAD_SMOKE_OUT" 2>/dev/null || echo "(файл результата не создан)"
exit $rc
