# Claude Instructions for better-tg-cli

## Version and Release Workflow

Changes land through a branch and a pull request (green CI) into `next`, never by pushing.
`main` is always the last stable release: only release PRs are merged into it.
The version lives only in `package.json`. `scripts/gen-version.mjs` (run by build, test and
`release.sh`) copies it into `src/version.ts`, the plugin manifests, `plugin/*` (including the
pinned `npx better-tg-cli@X.Y.Z`), `server.json` and `gemini-extension.json`; CI fails if any of
them drifts. Never edit a version by hand anywhere else. Releases
use `scripts/release.sh` (see Releasing below): a release PR from `next` into `main` bumps the
version, computed from the PR titles, then the tag `vX.Y.Z` is pushed from main after the merge.
`scripts/release.sh pre` publishes a release candidate (`vX.Y.Z-rc.N`) of `next` without a bump.

## Commit Message Format

PR titles become the squash commits on `next`, and they decide the next version
(`scripts/next-version.mjs`):
- `Add <feature>` for new features → minor
- `Fix <bug>` for bug fixes, `Update <component>` or anything else → patch
- a breaking change: put `BREAKING` in the title → minor while the version is 0.x
- Include `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>` at the end

## MTProto library

The client is `teleproto` (GramJS fork, current TL layer; `telegram`/GramJS is deprecated and
stuck on layer 198, which returns bot replies as `MessageMediaUnsupported` with empty text).
Layer 229 differences the code relies on: one `KeyboardButton`/`KeyboardInlineButton` class with a
`type` object (`ButtonType*` / `InlineButtonType*`) instead of a constructor per button kind;
`Poll` needs `hash`; outgoing poll answers are `InputPollAnswer`; `ImportChatInvite` returns
`messages.ChatInviteJoinResult*`; message text may live in `richMessage` — always read it through
`messageText()` in `src/client.ts`.

## Personal fork

This checkout is a fork of `skillhq/telegram` (remote `upstream`, push disabled); `origin` is the
public `TheVilfer/better-tg-cli`. The package is `better-tg-cli` and the binary stays `telegram`.
The agent skill lives in `skills/better-tg-cli/` (name `better-tg-cli`, published through skills.sh
via `npx skills add TheVilfer/better-tg-cli`); agents on this machine link straight to that folder
(`~/.claude/skills/better-tg-cli` → `…/telegram/skills/better-tg-cli`, same for Codex and others).
The checkout directory itself stays `~/.agents/skills/telegram`, so never run `npx skills add … -g`
here with a skill named `telegram`, and never create `~/.agents/skills/better-tg-cli` as a link into
this checkout (a global skills install would write through it). The global binary is an
`npm install -g <this dir>` symlink under homebrew node (`/opt/homebrew/bin/telegram`), so
`npm run build` is enough to ship a change. Never `npm i -g @skillhq/telegram` (old GramJS build).
Pull upstream with `git fetch upstream && git merge
upstream/main`, keeping `teleproto` imports and reading text through `messageText()`.

## Development

See `DEVELOPMENT.md`. The short version:
- `scripts/tg-dev <args>` runs `src/` with Bun under `TG_PROFILE=dev`. That profile is `~/.config/tg-dev`
  plus the Keychain service `tg-cli-dev`, isolated from the real session.
- Never add a watch mode that writes `dist/`, because the installed `telegram` runs it live.
- All state paths go through `src/paths.ts`, and every TelegramClient is built with `clientParams()`
  from `src/client-options.ts` (stderr logger, `TG_LOG_LEVEL`, the profile's `testServers`).

## Releasing

Two long-lived branches: pull requests are squash-merged into `next`, and `main` is always the
last stable release (README, `install.sh` and the plugin marketplaces read `main`, so they never
describe something unreleased). Never push to either directly. Merging a PR publishes nothing;
these commands do, all run on `next`:

- `scripts/release.sh pre` pre-releases what is on `next`: it tags HEAD `vX.Y.Z-rc.N` (the coming
  version, N counts up) with no PR and no version bump, because the workflow takes a candidate's
  version from its tag. A candidate becomes a GitHub pre-release and `better-tg-cli@next` on npm
  only; Homebrew, Scoop, the MCP Registry, `npm install -g better-tg-cli` and `telegram update`
  keep the last stable version. Cut as many candidates as needed.
- `scripts/release.sh` (no argument) takes the level from the PR titles since the last stable tag,
  bumps the version on `release/vX.Y.Z` off `next`, tests and opens a PR into `main` (an explicit
  `patch|minor|major|X.Y.Z` overrides). It says whether `next` has commits that were in no
  candidate. Merge that PR with a **merge commit**, never squash: the stable tag must stay an
  ancestor of `next`, because the next release counts its PRs from that tag.
- `scripts/release.sh tag` then tags main `vX.Y.Z`, pushes the tag and opens a `main` → `next`
  PR that brings the release commit back (merge commit again).

A fix that cannot wait for `next` goes as a PR into `main` like a release, followed by the same
`main` → `next` merge.

A stable tag runs `.github/workflows/release.yml`:
1. verify (tag == package.json, tests) and the Claude Desktop extension `better-tg-cli.mcpb`
   (`scripts/mcpb.mjs`)
2. Bun binaries for darwin-arm64/x64 (built and ad-hoc signed on macOS) and linux-x64/arm64
3. GitHub Release with the binaries, the `.mcpb` and SHA256SUMS
4. npm publish via trusted publishing (OIDC, no token; skipped if the version exists)
5. `Formula/better-tg-cli.rb` rendered by `scripts/homebrew-formula.mjs` and pushed to
   `TheVilfer/homebrew-tap` with the `TAP_DEPLOY_KEY` deploy key
6. MCP Registry entry (`server.json`, GitHub OIDC) once npm serves the version (waits up to 75 min)
7. Windows: `windows-x64` is cross-compiled and zipped on Linux, run on `windows-latest` in
   `windows-smoke` (it gates the GitHub Release), and `scripts/scoop-manifest.mjs` pushes
   `bucket/better-tg-cli.json` to `TheVilfer/scoop-bucket` with the `SCOOP_DEPLOY_KEY` deploy key

Windows specifics: secrets in `%APPDATA%\tg\secrets.dpapi` (DPAPI through the built-in
PowerShell 5.1, `src/dpapi.ts`), `write-access` asks in a MessageBox, every spawn sets
`windowsHide`, and npm/scoop shims need `shell: true`. CI runs the tests and the `.exe` on Windows.

`scripts/gen-version.mjs` also embeds `skills/better-tg-cli/*` into `src/skill-files.ts` for
`telegram skill install` (a test fails if the two drift). On this machine the agents' skill folders
are symlinks into this checkout; `skill install` skips symlinks unless `--force`, so never pass
`--force` here. `scripts/gen-version.mjs` keeps `.claude-plugin/plugin.json`, `server.json` and
`gemini-extension.json` on the package version; `release.sh` commits them.

`plugin/` is the Claude Code plugin (the marketplace points at it) and the folder submitted to
Anthropic's plugin directory (claude.ai/directory/manage, path `plugin`) and the Cursor Marketplace
plugin (`plugin/.cursor-plugin/plugin.json`, root `.cursor-plugin/marketplace.json`) and the Codex
plugin (`plugin/.codex-plugin/`, repo marketplace `.agents/plugins/marketplace.json`; its MCP config
sits in `.codex-plugin/mcp.json`, since a `.mcp.json` in the plugin root would load twice in Claude Code). `gen-version.mjs`
regenerates everything in it except `plugin/README.md`: regular-file copies of the skill and
LICENSE, and a manifest with the MCP server pinned to `better-tg-cli@<version>` (the directory
blocks `@latest`). Keep it free of symlinks, binaries and lockfiles.
The directory holds plugins that run a pinned npx package ("Runs a pinned npx or uvx package") and
suggests shipping a lockfile, but npm 12 dropped `npm-shrinkwrap.json` (not packed, not honored), so
there is no lockfile to ship; the package has zero runtime dependencies instead.

Grok Build reads `.claude-plugin/plugin.json` as is, but refuses a marketplace entry that points at
the repo root (`"./"`, which Claude Code requires), so `.grok-plugin/marketplace.json` (preferred
by Grok) points at the git URL instead.

The version is compiled in via `src/version.ts` (generated by `scripts/gen-version.mjs` on
build/test), because standalone binaries have no package.json.

## Build and size

`npm run build` = typecheck (`tsc --noEmit`) + `bun scripts/bundle.mjs node` → one file `dist/telegram.mjs`:
a ~0.3 MB loader holding the whole CJS bundle brotli-compressed (inflated at start, ~2 ms; zero
runtime dependencies, everything is in devDependencies). Release archives are `.tar.xz`. Binaries come from the same
script (`bun scripts/bundle.mjs bun-<target> <out>`). The bundle plugin shrinks teleproto:
- TL schema re-encoded (`scripts/tl-compact.mjs`, 1.8 MB → 0.3 MB);
- RPC error classes generated from a table (`scripts/errors-compact.mjs`);
- StoreSession, socks and mime replaced by stubs.
`test/bundle-shrink.test.ts` proves both re-encodings are exact. chalk/ora/json5 were replaced
by `src/colors.ts`, `src/spinner.ts` and `src/config-format.ts`.
