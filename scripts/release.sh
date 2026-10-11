#!/usr/bin/env bash
# Pull requests are merged into `next`; `main` is always the last stable release. Nothing is
# published by a merge, only by these commands:
#   scripts/release.sh pre [patch|minor|major]     pre-release everything on next: tag
#                                                    vX.Y.Z-rc.N (no PR, package.json untouched)
#   scripts/release.sh [patch|minor|major|X.Y.Z]   the real release, step 1: bump on a release
#                                                    branch off next, test, open a PR into main
#   scripts/release.sh tag                           step 2, after that PR is merged with a merge
#                                                    commit: tag main, open a PR main → next
# Without a level it comes from the PR titles since the last stable tag (scripts/next-version.mjs).
# A tag triggers .github/workflows/release.yml. vX.Y.Z goes everywhere (binaries → GitHub Release
# → npm → Homebrew → Scoop → MCP Registry). vX.Y.Z-rc.N becomes a GitHub pre-release plus
# `npm install -g better-tg-cli@next` and nothing else, so nobody gets it without asking.
set -euo pipefail

REPO=TheVilfer/better-tg-cli
NEXT=next
arg="${1:-auto}"
[ -z "$(git status --porcelain)" ] || { echo "Working tree is dirty; commit first." >&2; exit 1; }

if [ "$arg" = tag ]; then
  git checkout -q main
  git pull -q --ff-only origin main
  version="$(node -p "require('./package.json').version")"
  git rev-parse -q --verify "refs/tags/v${version}" >/dev/null && { echo "v${version} is already tagged." >&2; exit 1; }
  # A merge commit keeps the commits of next on main, so the tag is an ancestor of next and the
  # next release counts its PRs from there. Squash or rebase would cut that link.
  if ! git rev-parse -q --verify 'HEAD^2' >/dev/null || [ "$(git log -1 --format=%s 'HEAD^2')" != "Release v${version}" ]; then
    echo "main's last commit is not the 'Release v${version}' PR merged with a merge commit (not squash or rebase)." >&2
    exit 1
  fi
  git tag "v${version}"
  git push origin "v${version}"
  echo "Tagged v${version}. Follow the pipeline: gh run watch -R ${REPO}"
  # next is only ever changed through pull requests, this one included
  gh pr create -R "$REPO" --base "$NEXT" --head main --title "Update next with v${version}" \
    --body "Brings the v${version} release commit into \`${NEXT}\`. Merge with a **merge commit** (not squash) so the tag stays an ancestor of \`${NEXT}\`."
  echo "Merge the PR above (merge commit) before the next release."
  exit 0
fi

[ "$(git rev-parse --abbrev-ref HEAD)" = "$NEXT" ] || { echo "Releases start from ${NEXT}: git checkout ${NEXT}" >&2; exit 1; }
git pull -q --ff-only origin "$NEXT"
git fetch -q --tags origin
last_stable="$(git describe --tags --abbrev=0 --match 'v*' --exclude '*-rc.*')"
git merge-base --is-ancestor "$last_stable" HEAD \
  || { echo "${last_stable} is not part of ${NEXT}: merge main into ${NEXT} first (see 'scripts/release.sh tag')." >&2; exit 1; }

if [ "$arg" = pre ]; then
  version="$(node scripts/next-version.mjs pre ${2:+"$2"})"
  [ -n "$version" ] || { echo "Nothing to pre-release since ${last_stable}." >&2; exit 1; }
  [ -z "$(git tag --points-at HEAD --list 'v*')" ] || { echo "${NEXT} is already tagged $(git tag --points-at HEAD --list 'v*' | tr '\n' ' ')." >&2; exit 1; }
  echo "v${version} will contain everything on ${NEXT} since ${last_stable}:"
  git log --format='  %s' "${last_stable}..HEAD"
  npm run build >/dev/null
  npm test
  git tag "v${version}"
  git push origin "v${version}"
  echo "Tagged v${version}. Follow the pipeline: gh run watch -R ${REPO}"
  echo "Try it: npm install -g better-tg-cli@next   Ship it: scripts/release.sh"
  exit 0
fi

if [ "$arg" = auto ]; then
  arg="$(node scripts/next-version.mjs)"
  [ -n "$arg" ] || { echo "Nothing to release since ${last_stable}." >&2; exit 1; }
  echo "Release level from the PR titles: $arg"
fi
# Say so when the release would ship commits no release candidate ever contained
last_rc="$(git describe --tags --abbrev=0 --match 'v*-rc.*' 2>/dev/null || true)"
if [ -n "$last_rc" ] && git merge-base --is-ancestor "$last_stable" "$last_rc"; then
  untested="$(git rev-list --count "${last_rc}..HEAD")"
  if [ "$untested" = 0 ]; then echo "Releasing exactly what ${last_rc} contained."
  else echo "Note: ${untested} commit(s) on ${NEXT} are newer than ${last_rc} and were in no pre-release:"; git log --format='  %s' "${last_rc}..HEAD"; fi
fi
npm version "$arg" --no-git-tag-version >/dev/null
version="$(node -p "require('./package.json').version")"
git checkout -q -b "release/v${version}"
node scripts/gen-version.mjs
npm run build >/dev/null
npm test

git add package.json package-lock.json src/version.ts src/skill-files.ts plugin .claude-plugin/plugin.json server.json gemini-extension.json
git commit -m "Release v${version}"
git push -q -u origin "release/v${version}"
gh pr create -R "$REPO" --base main --head "release/v${version}" --title "Release v${version}" \
  --body "Everything on \`${NEXT}\` since ${last_stable}, plus the version bump for v${version}.

Merge with a **merge commit** (not squash), then run \`scripts/release.sh tag\`."
echo "Opened the release PR into main. When CI is green, merge it with a merge commit, then: scripts/release.sh tag"
