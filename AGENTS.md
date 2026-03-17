# MySlides Agent Context

This workspace currently contains:

- `slidev/`: upstream Slidev repo with a few temporary local compatibility patches
- `slidev-hub/`: active standalone app for the extracted hub
- `slidev-agent/`: reserved for future agent-specific work

## Read This First

If you are working on the MySlides platform direction, start with:

1. `slidev-hub/docs/myslides/architecture.md`
2. `slidev-hub/docs/myslides/roadmap.md`
3. `slidev-hub/docs/myslides/implementation-plan.md`
4. `slidev-hub/docs/myslides/extraction-checklist.md`

## Current Reality

- `slidev-hub/` is the active working hub app and should be treated as the current implementation.
- `slidev/packages/hub` is no longer the center of gravity and should not receive new product work.
- The long-term architecture is a platform around Slidev, not a permanent fork inside Slidev.
- Presenter/viewer sync works through the hub only because the gateway preserves Slidev's Vite/server-ref transport semantics; do not simplify those rules casually.
- `slidev-hub` now runs independently of sibling Slidev source internals by launching the published `@slidev/cli` package as a child process.
- `slidev-hub` has a working Railway deployment path using the repo `Dockerfile` plus a mounted `/data` volume.
- `slidev-hub` now injects its custom in-deck editor through the addon package `slidev-hub/packages/slidev-hub-editor-addon`.
- Active deck runtimes no longer launch the source deck entry directly; `slidev-hub` generates a wrapper workspace under `.slidev-hub/runtime/<slug>/` and launches Slidev from that wrapper entry.

## Known Findings

- Deck runtime traffic is not pure path-prefix proxying.
- Normal deck assets/pages keep the `/<slug>/...` prefix.
- Root control channels such as `/@server-reactive/*` and `/@server-ref/*` must be routed by deck `Referer` when multiple decks share one origin.
- Root `@slidev/*` requests must be routed by deck `Referer`, then rewritten to `/<slug>/@slidev/*` before forwarding.
- Some slugged control writes must be rewritten before forwarding to the deck runtime.
- Slugged `@slidev/*` virtual-module requests must keep the slug prefix when forwarded.
- Nav sync payloads must preserve a valid `timer` object; malformed payloads can crash presenter mode.
- The published Slidev CLI exits immediately if spawned with stdin ignored; child runtimes must keep stdin open.
- Public deployments need `SLIDEV_HUB_PUBLIC_BASE_URL` set with a protocol, for example `https://slidev-hub-production.up.railway.app`.
- The proxied Vite client must not leak the internal runtime origin like `localhost:3030`; `slidev-hub` rewrites that host metadata at the gateway layer.
- The proxied Slidev `env.ts` module can reach the browser with raw `__DEV__` and `__SLIDEV_HASH_ROUTE__` tokens; `slidev-hub` rewrites those compiler flags at the gateway layer.
- The custom in-deck editor uses explicit manual save semantics; do not reintroduce autosave behavior through proxy rewrites.
- Wrapper runtime workspaces copy deck headmatter, normalize local theme/addon paths, and keep writes targeting the original deck file rather than the generated wrapper file.
- Presenter and viewer testing in separate browser windows is more reliable than same-window tabs. Same-window tab testing can still show a slide-stacking quirk that does not appear to be the primary transport bug.

## Product Direction

MySlides is intended to become a higher-order platform with:

- deck management
- multi-deck runtime orchestration
- deck-scoped coding agents
- Slidev addon UX for in-deck agent prompting
- template management for enterprise teams

## Architectural Rule Of Thumb

Prefer this split:

- Slidev stays external and close to upstream
- `slidev-hub` lives outside Slidev and owns hub/control-plane concerns
- runtime manager lives outside Slidev
- `slidev-agent` lives outside Slidev
- Slidev addon packages live outside Slidev and integrate through extension points

Only patch Slidev internals when there is no viable extension seam, and treat such patches as temporary.
