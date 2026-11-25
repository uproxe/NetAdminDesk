#!/usr/bin/env bash
# Перезапуск задач сборки, которым GitHub не выделил машину (вызывается процессом retry-no-runner).
#
# С ноября 2026 GitHub не хватает машин macOS: задача 15 минут ждёт в очереди и отменяется,
# не выполнив ни одного шага («The job was not acquired by Runner of type hosted even after
# multiple attempts»). Весь запуск становится красным, а релиз не публикуется, хотя ошибки
# в проекте нет. Такие задачи перезапускаются (вместе с зависящей от них публикацией релиза).
# Задачи с настоящими ошибками (у них есть выполненные шаги) не трогаются.
#
#   REPO=владелец/репозиторий RUN=<id запуска> bash scripts/ci-retry-no-runner.sh
#   ATTEMPT=<n> — только показать решение для указанной попытки (для проверки, ничего не меняет)
#   DRY_RUN=1   — решить, но не перезапускать
set -euo pipefail
: "${REPO:?нужен REPO}" "${RUN:?нужен RUN}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}" # первая попытка и до трёх перезапусков

BAD='.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out"'

# Запрос к API GitHub с повторами: кратковременный сбой связи не должен обрывать перезапуск
api() {
  local i out
  for i in 1 2 3 4 5; do
    if out="$(gh api "$@" 2>/tmp/gh-api.err)"; then
      # С переводом строки в конце: без него read возвращает ошибку и при set -e сценарий молча падает
      printf '%s\n' "$out"
      return 0
    fi
    echo "Сбой запроса к GitHub ($i из 5): $(tr '\n' ' ' </tmp/gh-api.err)" >&2
    sleep 20
  done
  return 1
}

jobs_json() {
  if [ -n "${ATTEMPT:-}" ]; then
    api "repos/$REPO/actions/runs/$RUN/attempts/$ATTEMPT/jobs?per_page=100"
  else
    api "repos/$REPO/actions/runs/$RUN/jobs?filter=latest&per_page=100"
  fi
}

# Печатает решение: ok — упавших задач нет; rerun — все упавшие не получили машину; real — есть настоящие ошибки
decide() {
  local j failed real
  j="$(jobs_json)"
  jq -r ".jobs[] | select($BAD) | \"  \\(.name): \\(.conclusion), машина: \\(.runner_name // \"\" | if . == \"\" then \"не выделена\" else . end), шагов: \\(.steps | length)\"" <<<"$j" >&2
  failed="$(jq "[.jobs[] | select($BAD)] | length" <<<"$j")"
  real="$(jq "[.jobs[] | select(($BAD) and (((.steps | length) > 0) or ((.runner_name // \"\") != \"\")))] | length" <<<"$j")"
  if [ "$failed" -eq 0 ]; then echo ok; elif [ "$real" -gt 0 ]; then echo real; else echo rerun; fi
}

if [ -n "${ATTEMPT:-}" ]; then
  echo "Запуск $RUN, попытка $ATTEMPT: $(decide)"
  exit 0
fi

while :; do
  # Дождаться окончания запуска (в том числе после перезапуска)
  status=""
  for _ in $(seq 1 90); do
    status="$(api "repos/$REPO/actions/runs/$RUN" --jq .status)"
    [ "$status" = completed ] && break
    sleep 60
  done
  [ "$status" = completed ] || { echo "Запуск не закончился за полтора часа — выхожу."; exit 0; }

  read -r conclusion attempt < <(api "repos/$REPO/actions/runs/$RUN" --jq '"\(.conclusion) \(.run_attempt)"')
  echo "Запуск $RUN, попытка $attempt: $conclusion"
  case "$conclusion" in
    success) echo "Всё прошло."; exit 0 ;;
    failure) ;;
    *) echo "Запуск не упал, а завершился так: $conclusion (например, отменён вручную) — не трогаю."; exit 0 ;;
  esac

  case "$(decide)" in
    ok) echo "Упавших задач нет."; exit 0 ;;
    real) echo "Есть настоящие ошибки сборки или тестов — перезапуск не поможет."; exit 0 ;;
  esac

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::warning::После $attempt попыток GitHub так и не выделил машину. Перезапустите позже вручную: откройте запуск и нажмите Re-run failed jobs."
    exit 0
  fi
  echo "Задачам не досталась машина GitHub — перезапускаю (попытка $((attempt + 1)) из $MAX_ATTEMPTS)."
  [ -n "${DRY_RUN:-}" ] && exit 0
  api -X POST "repos/$REPO/actions/runs/$RUN/rerun-failed-jobs" >/dev/null
  sleep 30
done
