# MySlides Extraction Checklist

## Purpose

Provide a compact checklist for moving from the current prototype to the intended platform structure.

## Rules

- treat `vendor/slidev/packages/hub` as a spike
- avoid adding new irreversible dependencies on Slidev source internals
- extract vocabulary and contracts before extracting processes
- prefer small clear boundaries over one large rewrite

## Checklist

### Vocabulary and Contracts

- [ ] define canonical `Deck` type
- [ ] define canonical `DeckRuntime` type
- [ ] define canonical `AgentTask` type
- [ ] define canonical `RouteBinding` type
- [ ] define canonical `Template` type
- [ ] define first stable deck API contract
- [ ] define first stable runtime API contract
- [ ] define first stable agent task API contract

### Prototype Internal Cleanup

- [x] split the hub server into modules
- [x] isolate registry logic
- [x] isolate runtime lifecycle logic
- [x] isolate proxy/gateway logic
- [x] isolate log storage and retrieval
- [x] isolate HTTP route handlers

### Runtime Platform Work

- [x] move from single active runtime to multiple active runtimes
- [ ] bind `slug -> runtime target`
- [ ] verify deck, presenter, and overview routing for multiple decks
- [ ] verify websocket proxying per deck
- [ ] add runtime health checks
- [ ] add runtime restart policy
- [x] keep presenter/viewer sync working through the hub for the active deck path
- [x] persist hub and per-deck logs
- [x] support root control-channel routing by deck context

### Agent Platform Work

- [ ] define deck-scoped agent execution model
- [ ] create agent task queue
- [ ] store agent task logs
- [ ] support diff/apply/revert lifecycle
- [ ] ensure one deck agent cannot modify another deck by default

### Addon Work

- [ ] define addon-to-platform auth model
- [ ] define deck identity discovery in Slidev UI
- [ ] build thin addon UI for prompting an agent
- [ ] stream task progress into Slidev
- [ ] render proposed changes cleanly in Slidev

### Template Work

- [ ] define `Template` object
- [ ] create deck from template flow
- [ ] version templates
- [ ] attach brand/theme presets to templates
- [ ] attach agent prompt presets to templates

### Extraction Work

- [x] create `shared-types`
- [x] create `shared-client`
- [x] create placeholder `deck-runtime-sdk`
- [x] move the hub app into `apps/slidev-hub`
- [x] extract control plane into `apps/slidev-hub`
- [ ] extract runtime control into the runtime manager concern inside `apps/slidev-hub`
- [x] introduce workspace agent packages
- [ ] build production-ready `slidev-addon-agent`

### Transitional Cleanup

- [ ] remove remaining temporary Slidev source compatibility shims
- [ ] reduce direct imports from `slidev` source internals
- [ ] document and, if possible, eliminate same-window presenter/viewer rendering quirks

## Current Highest-Leverage Next Steps

- [x] keep the current implementation working
- [x] modularize the hub server
- [x] prove multiple active deck runtimes
- [ ] define the first stable deck/runtime/agent contracts
- [ ] reduce runtime coupling between `apps/slidev-hub` and `vendor/slidev`

## Done Means

The prototype is no longer the center of gravity when:

- runtime orchestration has a clear home outside Slidev
- agent orchestration has a clear home outside Slidev
- the Slidev addon depends on stable APIs rather than local internals
- Slidev itself is mostly an upstream dependency plus extension target
