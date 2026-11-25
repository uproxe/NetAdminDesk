#!/usr/bin/env bash
# Находит зелёную проверку коммита в main — из неё выпуск релиза берёт готовые установщики,
# ничего не собирая заново. Печатает номер запуска; если подходящего нет — код выхода 1.
#
# Обязательны все задания, кроме сборки macOS: её результат необязателен — .dmg, собранный позже
# (например, после ночного «Re-run failed jobs»), сам добавится в уже выпущенный релиз.
#
#   REPO=владелец/репозиторий SHA=<коммит> bash scripts/ci-release-source.sh
set -euo pipefail
: "${REPO:?нужен REPO}" "${SHA:?нужен SHA}"

runs="$(gh api "repos/$REPO/actions/workflows/build.yml/runs?head_sha=$SHA&event=push&branch=main&per_page=30" \
  --jq '.workflow_runs[] | select(.status == "completed") | .id')"
[ -n "$runs" ] || { echo "Для коммита ${SHA:0:7} в main нет завершённых проверок" >&2; exit 1; }

for r in $runs; do
  jobs="$(gh api "repos/$REPO/actions/runs/$r/jobs?filter=latest&per_page=100")"
  # Задания, которые не прошли (macOS и пропущенные — не в счёт)
  bad="$(jq -r '[.jobs[] | select((.name | startswith("Установщик macOS")) | not)
                 | select(.conclusion != "success" and .conclusion != "skipped") | .name] | join(", ")' <<<"$jobs")"
  # Обязательные: тесты, SSH, Windows, сборка пакетов Linux и установка в шести дистрибутивах
  have="$(jq '[.jobs[] | select(.conclusion == "success") | .name
              | select(startswith("Тесты") or startswith("SSH") or startswith("Установщик Windows")
                       or startswith("Пакеты Linux") or startswith("Установка в"))] | length' <<<"$jobs")"
  if [ -z "$bad" ] && [ "$have" -ge 10 ]; then
    echo "$r"
    exit 0
  fi
  echo "Проверка $r не подходит: ${bad:-прошли не все обязательные задания ($have из 10)}" >&2
done
exit 1
