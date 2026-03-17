# slidev-hub

`slidev-hub` is the independent extraction target for the Slidev hub prototype.

## Current status

- runs as a standalone app outside the Slidev monorepo
- owns its own data under `.slidev-hub/`
- owns its own managed decks under `hub-projects/`
- launches the published `@slidev/cli` package for active deck runtimes
- is the primary working hub implementation in this workspace
- currently defaults to `http://localhost:4310`

## Current commands

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm start
```

If `4310` is already in use, stop the existing hub process first or override `PORT`.

## Agent runtime

`slidev-hub` now hosts the reusable Slidev agent runtime in-process via the local `slidev-agent` package.

Local agent testing uses environment variables loaded from `.env`:

```bash
SLIDEV_AGENT_PROVIDER=zai
SLIDEV_AGENT_MODEL=glm-4.7
ZAI_API_KEY=your-zai-api-key
```

Copy `.env.example` to `.env`, fill in `ZAI_API_KEY`, then run:

```bash
pnpm install
pnpm run dev
```

The Hub backend exposes agent endpoints under `/api/agent/*`.

## Runtime model

- `slidev-hub` launches real per-deck Slidev runtimes and proxies them under slug routes such as `/<slug>/`, `/<slug>/presenter/`, and `/<slug>/overview/`.
- Each active runtime now boots from a generated wrapper workspace under `.slidev-hub/runtime/<slug>/` so the hub can inject its own editor addon without mutating the source deck.
- The wrapper `slides.md` preserves the source deck headmatter, forces `editor: true`, and points back at the original deck via `src:`.
- The wrapper `package.json` injects `oh-my-slidev/packages/slidev-hub-editor-addon` plus any original package-level Slidev addons.
- Presenter/viewer sync depends on Slidev's Vite and `vite-plugin-vue-server-ref` transport, so the gateway must preserve both HTTP and websocket semantics.
- Root control-channel requests like `/@server-reactive/nav` are deck-specific and are routed by `Referer`.
- Root `@slidev/*` requests are also deck-specific and must be resolved by `Referer`, then forwarded under the active deck base path.
- The hub normalizes nav sync payloads so presenter mode does not crash on missing timer state.
- The hub rewrites proxied `@vite/client` host metadata so public deployments do not leak the internal Slidev runtime origin.
- The hub rewrites proxied Slidev `env.ts` compiler flags so raw `__DEV__`-style constants do not reach the browser.

## In-Deck Editor

- The built-in autosaving Slidev `SideEditor` is replaced by the workspace addon package `packages/slidev-hub-editor-addon`.
- The custom editor renders in the same `play` and `presenter` mount points Slidev already uses.
- Saving is manual only:
  - `Cmd/Ctrl+S`
  - `Save`
  - `Revert`
- Dirty close and slide-navigation flows prompt with `Save`, `Discard`, or `Cancel`.
- Saves still go through Slidev's existing `__slidev/slides/:n.json` update path, so the original deck file remains the source of truth.

## Railway

`slidev-hub` now has a valid production path:

```bash
pnpm run build
pnpm start
```

Recommended Railway setup:

1. Create a Railway service from this repo.
2. Let Railway build from the included `apps/slidev-hub/Dockerfile`.
2. Attach a persistent volume and mount it at `/data`.
3. Set these environment variables:

```bash
PORT=4310
NODE_ENV=production
SLIDEV_HUB_PUBLIC_BASE_URL=https://your-app.up.railway.app
```

4. Optional explicit overrides if you do not want the defaults:

```bash
SLIDEV_HUB_DATA_ROOT=/data/slidev-hub
SLIDEV_HUB_PROJECTS_ROOT=/data/slidev-hub/projects
```

Notes:

- if `/data` exists, `slidev-hub` now defaults to:
  - data root: `/data/slidev-hub`
  - managed decks: `/data/slidev-hub/projects`
- first boot on Railway will have an empty deck registry
- decks, registry state, and logs should live on the persistent volume, not `/app`
- presenter sync requires live Slidev runtimes; this is not a static-export deployment model
- the Docker image installs dependencies inside Linux, which avoids the missing native `oxc-parser` binding problem seen in builder-managed installs
- `SLIDEV_HUB_PUBLIC_BASE_URL` should include the protocol. `https://...` is required for Railway production.

## Known Quirks

- Presenter and viewer sync works reliably through the hub in separate browser windows.
- Testing the presenter and viewer as tabs in the same browser window can still show occasional stacked-slide rendering during mirrored navigation. Treat that as a browser/testing quirk unless it reproduces in separate windows.
