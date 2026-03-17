# MySlides Roadmap

## Summary

Build MySlides as a platform around Slidev in phases.

The immediate priority is not more feature sprawl inside the prototype hub. The priority is to make the platform boundaries explicit and then extract toward them deliberately.

## Current State

Current implementation:

- `apps/slidev-hub`

Current strengths:

- proves hub UI can manage decks
- proves persistent logs are useful
- proves slug-based routing is viable
- proves a real Slidev runtime can sit behind the hub

Current weaknesses:

- runtime and agent concerns still live inside one app boundary
- several planning docs still reflect the earlier pre-monorepo extraction path
- deck and agent API contracts are still transitional

## Phase 1: Stabilize The Platform Boundary

Goals:

- document the target architecture
- keep the current prototype useful
- stop deepening accidental coupling to Slidev internals

Deliverables:

- architecture docs
- roadmap docs
- clear statement that `vendor/slidev/packages/hub` is a spike
- identify what can be extracted cleanly first

## Phase 2: Multiple Active Deck Runtimes

Goals:

- allow multiple decks to run at once
- allow one deck to be edited while another is being presented
- preserve stable slug routes

Deliverables:

- runtime manager abstraction
- one Slidev runtime per active deck
- route table from `slug -> runtime target`
- health checks and restart behavior
- better websocket routing validation

Success criteria:

- deck A and deck B can both be live
- presenter mode works independently per deck
- logs remain isolated per deck

## Phase 3: Deck-Scoped Agent Service

Goals:

- allow one or more agents to work on decks in parallel
- keep agent access scoped to the assigned deck

Deliverables:

- `AgentTask` model
- per-deck agent sessions
- task logs
- patch/apply/revert workflow
- task APIs consumed by the hub

Success criteria:

- an agent can safely modify one deck without touching another
- multiple decks can have active agent work at the same time

## Phase 4: Slidev Addon For In-Deck Agent UX

Goals:

- let users prompt agents from within the Slidev UI

Deliverables:

- addon package outside Slidev core
- deck-aware API client
- task progress panel
- diff/apply/revert UI

Success criteria:

- from inside a deck, a user can ask the agent to update slides
- results stream back into the deck UI cleanly

## Phase 5: Template Management

Goals:

- support team and enterprise standardization

Deliverables:

- `Template` model
- create deck from template
- template versioning
- org-level defaults
- prompt presets and brand presets

Success criteria:

- teams can create and govern reusable presentation starting points
- agents can use template metadata as part of their task context

## Phase 6: Enterprise Controls

Goals:

- make the platform safe and operable for organizations

Deliverables:

- auth and RBAC
- workspace and org boundaries
- audit logs
- runtime quotas
- deployment controls
- stronger sandboxing if needed

## Guiding Rules

1. Treat Slidev as a dependency and integration target, not as the home for the entire product.
2. Prefer external services plus addon integrations over deep Slidev-core modifications.
3. Keep deck isolation explicit in filesystem, runtime, logs, and agent execution.
4. Use the current prototype only to prove product and technical assumptions.
5. Promote code out of the prototype only when the package boundary is clear.

## Near-Term Next Steps

- keep improving the current implementation only where it validates the target architecture
- refactor toward multiple active deck runtimes
- define the first stable API contracts for deck registry, runtime state, and agent tasks
- begin extracting reusable runtime and agent concerns out of `apps/slidev-hub`
