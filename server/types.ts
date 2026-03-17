import type { Deck, DeckRuntime, DeckView, RuntimeStatus } from '@myslides/shared-types'
import type { ChildProcess } from 'node:child_process'

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
  pid?: number
  lastStartedAt: string
  error?: string
  logPath: string
  logTail: string[]
  process?: ChildProcess
  expectedExit?: boolean
}

export type ProjectView = DeckView
