# MySlides Platform Architecture

## Purpose

MySlides is a higher-order platform built around Slidev.

It is intended to support:

- multiple decks managed from one hub
- multiple active deck runtimes at once
- multiple coding agents working on different decks in parallel
- embedded agent UX inside Slidev via addons
- future enterprise template management

The goal is not to permanently embed product logic inside the Slidev monorepo.

## Non-Goals

- turning one Slidev runtime into a magical router for all decks
- maintaining a deep long-lived Slidev fork if it can be avoided
- putting orchestration, agent execution, and product concerns directly into Slidev core

## Core Model

Treat each deck as an isolated unit with:

- a slug
- a workspace directory
- deck files and assets
- a runtime state
- logs
- zero or more agent sessions
- template ancestry

The platform then adds a control plane above those isolated deck units.

## System Layers

### 1. Hub / Control Plane

Responsibilities:

- deck registry
- template registry
- runtime lifecycle
- route binding
- auth and policy
- observability
- agent task orchestration

This is the system of record for what decks exist and where they are running.

### 2. Gateway / Routing Layer

Responsibilities:

- serve the management UI
- proxy public deck routes
- proxy presenter and overview routes
- proxy websocket traffic

Expected route model:

- `/hub/...`
- `/<slug>/`
- `/<slug>/presenter/`
- `/<slug>/overview/`

### 3. Deck Runtime Layer

Responsibilities:

- run a real Slidev instance per active deck
- isolate deck-specific file watching, HMR, theme resolution, and presenter state
- expose health and runtime metadata to the control plane

Short version: each active deck gets its own Slidev runtime.

### 4. Agent Layer

Responsibilities:

- run deck-scoped coding agents
- queue and execute tasks
- emit logs, status, and diffs
- keep each agent scoped to its deck workspace by default

### 5. Slidev Addon Layer

Responsibilities:

- expose in-deck agent UX inside Slidev
- let a user prompt an agent from within the deck UI
- stream task progress and proposed edits
- call hub and agent APIs for the current deck

The addon should stay thin. The heavy backend logic belongs in the platform, not in the addon.

## Isolation Model

Each deck should be treated as a sandboxed unit.

Minimum isolation:

- one deck workspace directory
- one Slidev runtime per active deck
- one deck-scoped log stream
- one or more deck-scoped agent sessions

Possible future hardening:

- containerized deck runtimes
- stronger resource controls
- deck-specific dependency isolation
- org-level permissions and quotas

## Recommended Package Boundaries

Long-term target structure:

```text
oh-my-slidev/
  slidev/
  slidev-hub/
  slidev-agent/
  packages/
    slidev-addon-agent/
    slidev-addon-hub-bridge/
    shared-types/
    shared-client/
    deck-runtime-sdk/
```

What lives where:

- `slidev-hub`: operator UI plus control-plane and runtime orchestration concerns
- `slidev-agent`: deck-scoped agents and tasks
- `slidev-addon-agent`: in-deck UI
- `slidev-addon-hub-bridge`: integration glue between Slidev and hub APIs

## Current Prototype Status

Current working implementation lives in:

- `slidev-hub/`

What it currently proves:

- deck registry
- multiple active deck runtimes
- slug-based routing
- persistent hub and project logs
- presenter and overview routing through the hub
- presenter/viewer sync through the hub when the gateway preserves Slidev transport semantics

What the current implementation has taught us:

- deck traffic is not simple prefix proxying
- normal deck pages and assets should preserve the `/<slug>/...` path
- root control channels like `/@server-reactive/*` and `/@server-ref/*` must be routed by deck context
- presenter sync depends on Slidev's Vite/HMR-style transport, not just static HTTP routes
- malformed nav sync payloads can break presenter UI unless the gateway preserves required state shape
- a standalone hub can launch published `@slidev/cli` runtimes without importing Slidev source internals
- the published Slidev CLI must be spawned with a live stdin stream; if stdin is ignored it exits immediately after boot

What it does not represent:

- final repo structure
- final API boundaries
- final production deployment shape

Treat it as a proving ground, not the final architecture.

## Upstream Strategy

Preferred strategy:

- keep Slidev near-upstream
- integrate through addons and extension seams
- move product-specific systems outside Slidev

Only make Slidev-core changes when:

- an extension seam is missing
- the change is small and upstreamable
- there is a clear benefit to keeping it near upstream

Current temporary exception:

- local experimentation may still keep unrelated compatibility patches in the sibling `slidev/` checkout
- `slidev-hub` itself should avoid depending on them

## Enterprise Direction

Templates should become first-class objects alongside decks and agent tasks.

Long-term template capabilities likely include:

- branded starter decks
- standard layouts and components
- theme and addon presets
- prompt presets for agents
- organizational defaults and guardrails

That belongs in the control plane, not only in deck files.
