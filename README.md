# slidev-hub

`slidev-hub` is the independent extraction target for the Slidev hub prototype.

## Current status

- boots as a sibling app outside the Slidev monorepo
- owns its own data under `.slidev-hub/`
- owns its own managed decks under `hub-projects/`
- still points at the local sibling `slidev/` checkout for Slidev internals during this transition
- is the primary working hub implementation in this workspace
- currently defaults to `http://localhost:4310`

## Current commands

```bash
pnpm install
pnpm run dev
```

If `4310` is already in use, stop the existing hub process first or override `PORT`.

## Transitional architecture

Right now `slidev-hub` is intentionally in between two states:

1. no longer living inside `slidev/packages/hub`
2. not yet fully decoupled from local Slidev source internals

That is expected at this stage. The next extraction goals are:

- keep stabilizing the sibling app
- reduce direct internal Slidev imports over time
- keep shared vocabulary in reusable packages
- move toward clearer boundaries with `slidev-agent`

## Runtime Notes

- `slidev-hub` currently launches real per-deck Slidev runtimes and proxies them under slug routes such as `/<slug>/`, `/<slug>/presenter/`, and `/<slug>/overview/`.
- Presenter/viewer sync depends on Slidev's Vite and `vite-plugin-vue-server-ref` transport, so the gateway must preserve both HTTP and websocket semantics.
- Root control-channel requests like `/@server-reactive/nav` are deck-specific and are routed by `Referer`.
- Local execution against the sibling `slidev/` checkout currently requires a few temporary compatibility patches in that repo for Node 22 + `tsx`.

## Known Quirks

- Presenter and viewer sync works reliably through the hub in separate browser windows.
- Testing the presenter and viewer as tabs in the same browser window can still show occasional stacked-slide rendering during mirrored navigation. Treat that as a browser/testing quirk unless it reproduces in separate windows.
