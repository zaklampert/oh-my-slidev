import type { Deck, DeckRuntime, DeckView, RuntimeStatus } from '@myslides/shared-types'
import type { ResolvedSlidevOptions } from '../../slidev/packages/types/index.d.ts'
import type { ViteDevServer } from 'vite'

export type ProjectRecord = Deck

export interface RegistryFile {
  projects: ProjectRecord[]
}

export interface HubStateFile {
  activeProjectId?: string | null
  activeProjectIds?: string[]
}

export type ProjectRuntimeView = DeckRuntime

export interface ActiveRuntime {
  project: ProjectRecord
  port: number
  base: string
  status: RuntimeStatus
  lastStartedAt: string
  error?: string
  logPath: string
  logTail: string[]
  restartTimer?: ReturnType<typeof setTimeout>
  options?: ResolvedSlidevOptions
  server?: ViteDevServer
}

export type ProjectView = DeckView
