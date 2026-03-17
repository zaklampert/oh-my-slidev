# oh-my-slidev

`oh-my-slidev` is a monorepo for building a higher-order platform around [Slidev](https://sli.dev).

The current focus is `slidev-hub`: a control plane and runtime gateway that can manage multiple Slidev decks from one UI while preserving real Slidev features like presenter mode, overview mode, and deck-specific runtimes.

## What This Repo Is

This repo is not a fork-first rewrite of Slidev.

The intended architecture is:

- keep Slidev close to upstream
- build product logic outside Slidev
- use addons and runtime orchestration to extend Slidev safely
- grow toward deck-scoped agents, template management, and enterprise controls

## Current Status

Working today:

- `slidev-hub` runs as a standalone app inside this monorepo
- active decks launch real `@slidev/cli` runtimes
- decks are proxied under slug routes like `/<slug>/`, `/<slug>/presenter/`, and `/<slug>/overview/`
- the hub injects a custom manual-save in-deck editor through a Slidev addon
- Railway deployment is working through Docker and a mounted `/data` volume

## Monorepo Layout

```text
oh-my-slidev/
  apps/
    slidev-hub/
  packages/
    shared-types/
    shared-client/
    slidev-hub-editor-addon/
    slidev-agent-runtime/
    slidev-agent-shared-types/
    slidev-addon-agent/
    deck-runtime-sdk/
  vendor/
    slidev/
  infra/
    docker/
    scripts/
```

### `apps/slidev-hub`

The active application.

Owns:

- hub UI
- deck registry APIs
- runtime orchestration
- proxying and transport handling
- logs and observability
- current Railway deployment target

Read:

- [apps/slidev-hub/README.md](/Users/zaklampert/projects/oh-my-slidev/apps/slidev-hub/README.md)
- [apps/slidev-hub/docs/myslides/architecture.md](/Users/zaklampert/projects/oh-my-slidev/apps/slidev-hub/docs/myslides/architecture.md)
- [apps/slidev-hub/docs/myslides/implementation-plan.md](/Users/zaklampert/projects/oh-my-slidev/apps/slidev-hub/docs/myslides/implementation-plan.md)

### `packages/shared-types`

Shared domain types used across the platform:

- deck metadata
- runtime metadata
- agent thread/task/change types

### `packages/shared-client`

Reserved for shared typed API clients between apps, addons, and future services.

### `packages/slidev-hub-editor-addon`

The custom Slidev addon that replaces the built-in autosaving `SideEditor` with a manual-save editor while keeping the same in-deck mount points.

### `packages/slidev-agent-runtime`

The current in-process agent runtime package used by the hub. This is the starting point for deck-scoped agent execution.

### `packages/slidev-agent-shared-types`

Shared types for the agent runtime and future agent-facing surfaces.

### `packages/slidev-addon-agent`

Reserved for a future in-deck agent addon UI.

### `packages/deck-runtime-sdk`

Reserved for extracted Slidev runtime and gateway helpers once more of the current hub runtime logic is factored out.

### `vendor/slidev`

The upstream Slidev checkout, managed as a git submodule.

Rule of thumb:

- integrate with Slidev through addons and extension seams first
- patch Slidev internals only when there is no better seam
- treat any such patches as temporary

### `infra`

Reserved for deployment helpers, Docker support, and workspace-level scripts.

## Quick Start

From the repo root:

```bash
pnpm install
pnpm run dev:hub
```

Open:

- [http://localhost:4310](http://localhost:4310)

Other useful commands:

```bash
pnpm run build
pnpm run check
pnpm run build:hub
pnpm run start:hub
```

## Railway

The repo root is deployable on Railway.

Expected setup:

1. Deploy the repo root, not `apps/slidev-hub` as an isolated subdirectory.
2. Let Railway use the root [railway.json](/Users/zaklampert/projects/oh-my-slidev/railway.json).
3. Mount a persistent volume at `/data`.
4. Set:

```bash
SLIDEV_HUB_PUBLIC_BASE_URL=https://your-app.up.railway.app
```

The deploy uses:

- [apps/slidev-hub/Dockerfile](/Users/zaklampert/projects/oh-my-slidev/apps/slidev-hub/Dockerfile)

## Design Principles

- Slidev stays upstream-facing and external to product logic.
- The hub is a control plane, not a replacement Slidev renderer.
- Each active deck is its own real Slidev runtime.
- Addons are the preferred way to extend in-deck UX.
- Production correctness matters more than pretending dev-only features are free in hosted environments.

## Agent Context

If you are an agent working in this repo, start with:

- [AGENTS.md](/Users/zaklampert/projects/oh-my-slidev/AGENTS.md)

That file captures the current runtime, gateway, deployment, and architectural constraints.
