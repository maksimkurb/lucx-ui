#!/bin/bash
# =============================================================================
# Синхронизация ветки `fork` с апстримом AlexeyLCP/lucx-ui.
#
#   1. Забирает main апстрима и вмерживает его в текущую ветку `fork`.
#      Конфликтующие куски берутся из апстрима (-X theirs): форк отличается
#      только заменой репозитория, а она применяется заново на шаге 2.
#   2. Заменяет AlexeyLCP/lucx-ui → maksimkurb/lucx-ui во всех файлах
#      (README, install.sh, update.sh, x-ui.sh, панель, docker и т.д.).
#      Ссылки на конкретные PR/issues/релизы апстрима и зеркало SourceCraft
#      не трогаются, иначе они станут битыми.
#   3. Дописывает замену в merge-коммит (или делает отдельный коммит).
#
# Использование:  bin/sync-fork.sh && git push origin fork
#
# Если merge остановился на конфликте, который -X theirs не разрешает
# (например, файл удалён с одной стороны): разрешите его, сделайте
# `git commit` и запустите скрипт ещё раз — он применит замену.
# =============================================================================
set -euo pipefail

UPSTREAM_URL="https://github.com/AlexeyLCP/lucx-ui.git"
UPSTREAM_BRANCH="main"
UPSTREAM_REPO="AlexeyLCP/lucx-ui"
FORK_REPO="maksimkurb/lucx-ui"
FORK_BRANCH="fork"
SELF="bin/sync-fork.sh"

cd "$(git rev-parse --show-toplevel)"

current=$(git symbolic-ref --short HEAD)
if [[ "$current" != "$FORK_BRANCH" ]]; then
    echo "Ошибка: нужно быть на ветке '$FORK_BRANCH' (сейчас '$current')." >&2
    exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Ошибка: есть незакоммиченные изменения." >&2
    exit 1
fi

# shellcheck disable=SC2016  # $ENV{...} раскрывает perl, а не bash
rewrite_repo_refs() {
    local upstream_lc="${UPSTREAM_REPO,,}" fork_lc="${FORK_REPO,,}"
    git grep -lz -e "$UPSTREAM_REPO" -e "ghcr.io/$upstream_lc" -- . ":!$SELF" |
        FROM="$UPSTREAM_REPO" TO="$FORK_REPO" FROM_LC="$upstream_lc" TO_LC="$fork_lc" \
            xargs -0 -r perl -pi -e '
                s{ghcr\.io/\Q$ENV{FROM_LC}\E\b}{ghcr.io/$ENV{TO_LC}}g;
                s{\Q$ENV{FROM}\E(?!/(?:pull/|issues|commit/|releases/tag/|releases/download/v\d))}{$ENV{TO}}g;
            '
}

echo "→ Забираю $UPSTREAM_URL ($UPSTREAM_BRANCH)"
git fetch --no-tags "$UPSTREAM_URL" "$UPSTREAM_BRANCH"

before=$(git rev-parse HEAD)
git merge --no-edit -X theirs -m "Merge $UPSTREAM_REPO@$UPSTREAM_BRANCH into $FORK_BRANCH" FETCH_HEAD

echo "→ Заменяю $UPSTREAM_REPO → $FORK_REPO"
rewrite_repo_refs

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    git add -u
    if [[ "$(git rev-parse HEAD)" != "$before" ]]; then
        git commit -q --amend --no-edit
    else
        git commit -q -m "chore(fork): заменить $UPSTREAM_REPO на $FORK_REPO"
    fi
fi

echo "→ Готово. Отличия форка от апстрима:"
git diff --stat FETCH_HEAD HEAD
echo
echo "Оставшиеся упоминания (ссылки на PR/релизы апстрима и SourceCraft, оставлены специально):"
git grep -c -i "$UPSTREAM_REPO" -- . ":!$SELF" || true
echo
echo "Проверьте и отправьте:  git push origin $FORK_BRANCH"
