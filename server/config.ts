import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const isProduction = process.env.NODE_ENV === 'production'
const __dirname = dirname(fileURLToPath(import.meta.url))
const resolveEnvPath = (value: string | undefined, fallback: string) => value ? resolve(value) : fallback

export const packageRoot = resolve(__dirname, isProduction ? '../..' : '..')
export const workspaceRoot = packageRoot
export const dataRoot = resolveEnvPath(process.env.SLIDEV_HUB_DATA_ROOT, resolve(workspaceRoot, '.slidev-hub'))
export const registryPath = resolve(dataRoot, 'projects.json')
export const statePath = resolve(dataRoot, 'state.json')
export const logsRoot = resolve(dataRoot, 'logs')
export const projectsLogsRoot = resolve(logsRoot, 'projects')
export const hubLogPath = resolve(logsRoot, 'hub.log')
export const managedProjectsRoot = resolveEnvPath(process.env.SLIDEV_HUB_PROJECTS_ROOT, resolve(workspaceRoot, 'hub-projects'))
export const hubPort = Number(process.env.PORT || 4310)

export function timestamp() {
  return new Date().toISOString()
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'deck'
}

export const starterSlides = (name: string) => `---
theme: default
title: ${name}
---

# ${name}

Welcome to your new deck.

---

## Why this exists

- Managed by the Slidev Hub
- Runs on one active Slidev runtime
- Keeps presenter mode and overview intact

---

## Next steps

1. Edit this file
2. Activate the project from the hub
3. Open presenter mode when you rehearse
`

export async function ensureDataLayout() {
  await mkdir(dataRoot, { recursive: true })
  await mkdir(logsRoot, { recursive: true })
  await mkdir(projectsLogsRoot, { recursive: true })
  await mkdir(managedProjectsRoot, { recursive: true })

  if (!existsSync(registryPath))
    await writeFile(registryPath, JSON.stringify({ projects: [] }, null, 2))

  if (!existsSync(statePath))
    await writeFile(statePath, JSON.stringify({ activeProjectId: null, activeProjectIds: [] }, null, 2))
}
