export type DeckSource = 'managed' | 'external'
export type RuntimeStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface Deck {
  id: string
  name: string
  slug: string
  dir: string
  entry: string
  createdAt: string
  updatedAt: string
  source: DeckSource
}

export interface DeckRuntime {
  status: RuntimeStatus
  pid?: number
  port?: number
  url?: string
  presenterUrl?: string
  overviewUrl?: string
  lastStartedAt?: string
  error?: string
  logPath?: string
  logTail: string[]
}

export interface DeckView extends Deck {
  isActive: boolean
  runtime: DeckRuntime
}

export interface Template {
  id: string
  name: string
  slug: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface AgentTask {
  id: string
  deckId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  prompt: string
  createdAt: string
  updatedAt: string
}

export interface RouteBinding {
  slug: string
  target: string
  status: RuntimeStatus
}

export interface LogEvent {
  scope: string
  message: string
  timestamp: string
}
