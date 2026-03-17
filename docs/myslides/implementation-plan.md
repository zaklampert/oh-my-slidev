# MySlides Implementation Plan

## Purpose

Translate the platform architecture into concrete packages, APIs, and extraction steps from the current prototype.

This document is intentionally execution-oriented.

## Current Prototype Map

Current implementation lives mostly in:

- `slidev-hub/server/*`
- `slidev-hub/src/App.vue`

The current server stack still combines too many responsibilities:

- deck registry
- deck creation and import
- runtime lifecycle
- slug routing and proxying
- log storage and retrieval
- API surface
- development server bootstrapping

That is acceptable for a transitional sibling app, but not for the target platform.

## Findings From The Current Working Build

These are now implementation constraints, not open guesses:

- the hub can support multiple active deck runtimes concurrently
- presenter/viewer sync through the hub is viable
- the gateway must distinguish between:
  - slugged deck asset/page traffic
  - root control-channel traffic such as `/@server-reactive/*`
- root control-channel requests need deck context, currently inferred from `Referer`
- some slugged control writes must be rewritten before forwarding
- nav sync payloads should preserve a valid `timer` shape to avoid presenter crashes
- the published Slidev CLI exits immediately if spawned with stdin ignored; runtime launchers must keep stdin open
- `slidev-hub` now has a valid standalone production path via `pnpm run build && pnpm start`

## Target Package Split

Long-term target:

```text
oh-my-slidev/
  slidev/
  slidev-hub/
  slidev-agent/
  packages/
    shared-types/
    shared-client/
    deck-runtime-sdk/
    slidev-addon-agent/
    slidev-addon-hub-bridge/
```

## Proposed Responsibilities

### `slidev-hub`

Owns:

- operator UI
- deck registry APIs
- template registry APIs later
- route binding metadata
- auth/policy later
- log APIs
- runtime orchestration

Consumes:

- `shared-client`
- `shared-types`
- `slidev-agent` APIs later

### Runtime manager concern inside `slidev-hub`

Owns:

- starting and stopping Slidev runtimes
- runtime health checks
- runtime state tracking
- port allocation
- route targets
- restart logic

Consumes:

- `deck-runtime-sdk`
- `shared-types`

This may later split out of `slidev-hub` if runtime orchestration needs its own deployable boundary.

### `slidev-agent`

Owns:

- `AgentTask` lifecycle
- agent session execution
- deck-scoped permissions
- task logs
- diffs and apply/revert flow

Consumes:

- `shared-types`

### `packages/shared-types`

Owns canonical types for:

- `Deck`
- `DeckRuntime`
- `Template`
- `AgentTask`
- `RouteBinding`
- `LogEvent`

This package should become the schema backbone across the system.

### `packages/shared-client`

Owns typed clients for:

- `slidev-hub` API
- runtime API if later separated
- `slidev-agent` API

### `packages/deck-runtime-sdk`

Owns reusable runtime helpers for:

- Slidev launch configuration
- health probing
- base path generation
- log formatting
- runtime metadata normalization

This package should hide Slidev-specific runtime details from the rest of the platform as much as possible.

### `packages/slidev-addon-agent`

Owns:

- in-deck prompt UI
- task stream UI
- diff/apply/revert UI

It should not own:

- agent execution
- heavy orchestration logic
- deck registry logic

### `packages/slidev-addon-hub-bridge`

Owns:

- deck identity discovery inside Slidev
- auth/session bridging to hub APIs
- lightweight deck-aware client glue

## Initial API Surface

These are the first platform APIs worth stabilizing.

### Deck APIs

- `GET /api/decks`
- `POST /api/decks`
- `POST /api/decks/import`
- `GET /api/decks/:deckId`
- `GET /api/decks/:deckId/logs`

### Runtime APIs

- `GET /api/runtimes`
- `GET /api/decks/:deckId/runtime`
- `POST /api/decks/:deckId/runtime/start`
- `POST /api/decks/:deckId/runtime/stop`
- `POST /api/decks/:deckId/runtime/restart`

Notes:

- current prototype uses `projects`; future naming should shift to `decks`
- current prototype uses `activate`; future model can support both `activate` and `start` semantics depending on whether multiple concurrent runtimes are allowed

### Agent APIs

- `GET /api/decks/:deckId/agent/tasks`
- `POST /api/decks/:deckId/agent/tasks`
- `GET /api/agent/tasks/:taskId`
- `POST /api/agent/tasks/:taskId/cancel`
- `POST /api/agent/tasks/:taskId/apply`
- `POST /api/agent/tasks/:taskId/revert`

### Template APIs

Later:

- `GET /api/templates`
- `POST /api/templates`
- `GET /api/templates/:templateId`
- `POST /api/decks/from-template`

## Core Domain Types

Initial type sketch:

```ts
type Deck = {
  id: string
  slug: string
  name: string
  path: string
  source: 'managed' | 'external'
  templateId?: string
  createdAt: string
  updatedAt: string
}

type DeckRuntime = {
  deckId: string
  status: 'stopped' | 'starting' | 'running' | 'error'
  port?: number
  pid?: number
  basePath?: string
  url?: string
  presenterUrl?: string
  overviewUrl?: string
  error?: string
  startedAt?: string
}

type AgentTask = {
  id: string
  deckId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  prompt: string
  createdAt: string
  updatedAt: string
}
```

## Recommended Extraction Order

### Step 1: Extract shared types

Move type definitions out of `packages/hub` first.

Reason:

- low risk
- reduces future churn
- gives the rest of the system a common vocabulary

### Step 2: Extract hub API concerns conceptually

Within the current prototype, separate code into modules for:

- registry
- runtime control
- logging
- proxy/gateway
- HTTP handlers

Reason:

- even before moving repos, internal modularization will expose the right future package boundaries

Status:

- done in `slidev-hub/server/*`

### Step 3: Reintroduce multiple active runtimes

Not by reviving the old brittle child-process model.

Instead:

- keep the current working routing base
- extend runtime state from one active runtime to many
- bind each slug to a runtime target

Reason:

- this validates the true multi-deck product requirement

### Step 4: Define the first agent task contract

Before building the full agent service, stabilize the contract for:

- creating a task
- reporting progress
- returning diffs and logs

Reason:

- the future Slidev addon depends on this contract more than on the exact backend implementation

### Step 5: Build the addon against stable APIs

Do not couple the addon directly to hub internals.

Reason:

- the addon should survive backend refactors

## Current Prototype To Future Package Mapping

Current concern in `packages/hub/server/index.ts` to future home:

- `createManagedProject`, `importExistingProject`, `findProject`
  - future `slidev-hub`
- `activateProject`, `stopActiveRuntime`, restart logic
  - future runtime manager concern in `slidev-hub`
- `logHub`, `logProject`, `readLogTail`
  - future observability module under `slidev-hub`
- `proxyHttpRequest`, upgrade handling
  - future gateway layer
- `handleApi`
  - future `slidev-hub`

## Short-Term Implementation Rule

Until extraction begins, changes to `packages/hub` should be judged by one question:

Does this validate the target platform architecture, or does it deepen accidental coupling to the prototype?

Only the first category should be preferred.
