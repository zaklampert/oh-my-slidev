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

## Runtime model

- `slidev-hub` launches real per-deck Slidev runtimes and proxies them under slug routes such as `/<slug>/`, `/<slug>/presenter/`, and `/<slug>/overview/`.
- Presenter/viewer sync depends on Slidev's Vite and `vite-plugin-vue-server-ref` transport, so the gateway must preserve both HTTP and websocket semantics.
- Root control-channel requests like `/@server-reactive/nav` are deck-specific and are routed by `Referer`.
- The hub normalizes nav sync payloads so presenter mode does not crash on missing timer state.

## Railway

`slidev-hub` now has a valid production path:

```bash
pnpm run build
pnpm start
```

Recommended Railway setup:

1. Create a Railway service from this repo.
2. Attach a persistent volume and mount it at `/data`.
3. Set these environment variables:

```bash
PORT=4310
NODE_ENV=production
SLIDEV_HUB_DATA_ROOT=/data/slidev-hub
SLIDEV_HUB_PROJECTS_ROOT=/data/slidev-hub/projects
```

4. Use the provided [`railway.json`](/Users/zaklampert/projects/oh-my-slidev/slidev-hub/railway.json) or equivalent commands:

```bash
pnpm run build
pnpm start
```

Notes:

- first boot on Railway will have an empty deck registry
- decks, registry state, and logs should live on the persistent volume
- presenter sync requires live Slidev runtimes; this is not a static-export deployment model

## Known Quirks

- Presenter and viewer sync works reliably through the hub in separate browser windows.
- Testing the presenter and viewer as tabs in the same browser window can still show occasional stacked-slide rendering during mirrored navigation. Treat that as a browser/testing quirk unless it reproduces in separate windows.
