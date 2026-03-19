---
name: slidev-hub
description: Work on decks and runtime issues inside Slidev Hub, including deployed hub environments, presenter/viewer proxy behavior, deck-scoped agent runs, and hub-specific validation/debugging loops. Use when the task depends on apps/slidev-hub, hub-managed runtimes, deployed base URLs, or validating a deck through the hub instead of plain Slidev alone.
---

# Slidev Hub

Use this skill when the task is about the hub-managed runtime, not plain upstream Slidev alone.

## First Read

Start with:

- `/Users/zaklampert/projects/oh-my-slidev/apps/slidev-hub/README.md`
- `/Users/zaklampert/projects/oh-my-slidev/apps/slidev-hub/docs/myslides/architecture.md`

Use the upstream `slidev` skill alongside this one for slide syntax, layouts, and feature usage.

## Core Model

- `apps/slidev-hub` is the active control plane.
- Active decks run as real Slidev runtimes behind the hub, not as static files.
- Each active deck gets a generated wrapper workspace under `.slidev-hub/runtime/<slug>/`.
- The wrapper injects hub addons without mutating the source deck.
- The custom in-deck editor is manual-save only; do not reintroduce autosave behavior.
- Presenter/viewer sync depends on preserving Slidev transport semantics. Do not simplify proxy routing casually.

## Deployment Constraints

- Public deploys need `SLIDEV_HUB_PUBLIC_BASE_URL` with protocol.
- Railway-style deploys persist data under `/data/slidev-hub`.
- Health checks should use `/api/health`, not an authenticated API route.
- Hub API auth may be enabled with `SLIDEV_HUB_BASIC_AUTH_USERNAME` and `SLIDEV_HUB_BASIC_AUTH_PASSWORD`.
- Agent execution depends on runtime env such as `SLIDEV_AGENT_PROVIDER`, `SLIDEV_AGENT_MODEL`, and provider API keys.

## Validation Loop

There is no single built-in `slidev validate` command. Validate like a human would:

1. Inspect the edited slide file for obvious Slidev syntax hazards.
2. If the edit touches layouts or slots, load the relevant Slidev reference before changing the file.
3. After edits, validate through a real Slidev compile path.
4. If the deck is active in the hub, reload both:
   - `/<slug>/`
   - `/<slug>/presenter/`
5. Treat presenter and viewer as separate validation surfaces. A deck can appear fine in one and fail in the other.
6. If validation fails, fix the deck and rerun validation before declaring success.

For exact commands and debugging surfaces, read [references/validation-debugging.md](references/validation-debugging.md).

## Slide Safety Rules

- If a slide uses named layout slots, keep content in valid slot structure.
- Never place normal slide content before an explicit `<template v-slot:default>` block.
- Prefer Slidev slot sugar like `::right::` and `::default::` when editing slot-based slides.
- If an agent edit introduces a compile error, treat that as a failed run and repair it.

## Presenter Bugs

- Validate presenter mode in a separate browser window when possible.
- Same-window tabs can show quirks that are not the primary transport bug.
- If overview works but presenter does not, inspect presenter-specific routing, client boot, and sync behavior before blaming slide content alone.

## Agent Runs

- Hub agent runs are deck-scoped.
- Use the hub agent APIs and saved state to inspect what happened during a run.
- Current telemetry shows run/tool/file events, but does not explicitly prove which skill reference was read.
- When debugging a suspicious run, inspect the thread, changed files, event stream, and saved agent project state together.
