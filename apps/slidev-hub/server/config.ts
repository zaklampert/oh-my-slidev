import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const isProduction = process.env.NODE_ENV === 'production'
const __dirname = dirname(fileURLToPath(import.meta.url))
const resolveEnvPath = (value: string | undefined, fallback: string) => value ? resolve(value) : fallback
const normalizePublicBaseUrl = (value: string | undefined) => {
  const trimmed = value?.trim()
  if (!trimmed)
    return ''

  const withProtocol = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `${isProduction ? 'https' : 'http'}://${trimmed}`

  return withProtocol.replace(/\/+$/, '')
}
const railwayVolumeRoot = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : existsSync('/data')
    ? '/data'
    : null

export const packageRoot = resolve(__dirname, isProduction ? '../..' : '..')
export const workspaceRoot = packageRoot
export const dataRoot = resolveEnvPath(
  process.env.SLIDEV_HUB_DATA_ROOT,
  railwayVolumeRoot ? resolve(railwayVolumeRoot, 'slidev-hub') : resolve(workspaceRoot, '.slidev-hub'),
)
export const registryPath = resolve(dataRoot, 'projects.json')
export const statePath = resolve(dataRoot, 'state.json')
export const logsRoot = resolve(dataRoot, 'logs')
export const projectsLogsRoot = resolve(logsRoot, 'projects')
export const hubLogPath = resolve(logsRoot, 'hub.log')
export const agentDataRoot = resolve(dataRoot, 'agent')
export const runtimeRoot = resolve(dataRoot, 'runtime')
export const managedProjectsRoot = resolveEnvPath(
  process.env.SLIDEV_HUB_PROJECTS_ROOT,
  railwayVolumeRoot ? resolve(dataRoot, 'projects') : resolve(workspaceRoot, 'hub-projects'),
)
export const hubPort = Number(process.env.PORT || 4310)
export const publicBaseUrl = normalizePublicBaseUrl(process.env.SLIDEV_HUB_PUBLIC_BASE_URL)
export const slidevAgentRoot = resolve(packageRoot, '../slidev-agent')
export const slidevHubEditorAddonRoot = resolve(packageRoot, 'packages/slidev-hub-editor-addon')
export const slidevAgentSkillsRoot = resolve(
  process.env.SLIDEV_AGENT_SKILLS_ROOT || resolve(slidevAgentRoot, 'skills'),
)

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
  await mkdir(agentDataRoot, { recursive: true })
  await mkdir(runtimeRoot, { recursive: true })

  if (!existsSync(registryPath))
    await writeFile(registryPath, JSON.stringify({ projects: [] }, null, 2))

  if (!existsSync(statePath))
    await writeFile(statePath, JSON.stringify({ activeProjectId: null, activeProjectIds: [] }, null, 2))
}
