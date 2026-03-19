# Validation And Debugging

## Deck Validation

Use a real Slidev compile path after non-trivial deck edits.

From the repo root:

```bash
pnpm --dir apps/slidev-hub exec slidev build /absolute/path/to/slides.md --out /tmp/slidev-hub-validate
```

Use this when:

- the agent edited slide markdown
- the edit touched layouts, slots, imports, Vue blocks, or frontmatter
- presenter mode behaves differently from play mode

If the build fails:

1. Read the compiler error closely.
2. Repair the deck file.
3. Rerun the validation command.
4. Do not mark the task complete while the build still fails.

## Runtime Validation

If the deck is active in the hub, validate both routes:

- `/<slug>/`
- `/<slug>/presenter/`

Also verify:

- slide content renders
- overview opens
- presenter mode shows current and next slides
- no new proxy or websocket errors appear in the browser console

## High-Risk Slide Patterns

Check these manually after agent edits:

- explicit slot layouts using `<template v-slot:...>`
- slot sugar layouts using `::right::`, `::left::`, `::default::`
- imported slides via `src:`
- inline Vue `<script setup>`, `<template>`, or `<style>` blocks
- code blocks with Slidev-specific fences or Monaco options

If an explicit `v-slot:default` is present, do not leave normal slide content above it.

## Agent Run Debugging

Useful hub APIs:

- `GET /api/agent/projects/<projectId>/thread`
- `GET /api/agent/projects/<projectId>/changes`
- `GET /api/agent/projects/<projectId>/status`
- `GET /api/agent/projects/<projectId>/events`

Saved local state:

- local: `.slidev-hub/agent/projects/<projectId>.json`
- deployed: `/data/slidev-hub/agent/projects/<projectId>.json`

Event stream signals currently available:

- `run.started`
- `message.delta`
- `message.completed`
- `tool.started`
- `tool.completed`
- `file.changed`
- `run.completed`
- `run.failed`

Current limitation:

- the runtime does not emit explicit "skill loaded" events
- you can infer behavior from tool usage, message text, validation warnings, and changed files, but not prove exactly which reference file was read

If you need stronger observability, add runtime events around resource/skill loading before relying on the UI alone.
