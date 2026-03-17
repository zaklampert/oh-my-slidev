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

export type AgentClient = 'addon' | 'hub' | 'other'
export type AgentIntent = 'generate_deck' | 'edit_slide' | 'add_slide' | 'review_deck' | 'speaker_notes' | 'design_pass'
export type AgentMessageRole = 'user' | 'assistant' | 'system'
export type AgentRunEventType =
  | 'run.started'
  | 'message.delta'
  | 'message.completed'
  | 'tool.started'
  | 'tool.completed'
  | 'file.changed'
  | 'run.completed'
  | 'run.failed'

export interface SlideContext {
  slideNumber?: number
  slideTitle?: string
  slidePath?: string
  selection?: string
}

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  text: string
  createdAt: string
  intent?: AgentIntent
  client?: AgentClient
  slideContext?: SlideContext
}

export interface AgentThread {
  id: string
  projectId: string
  createdAt: string
  updatedAt: string
  messages: AgentMessage[]
}

export interface AgentProject {
  id: string
  rootDir: string
  entryFile: string
  attachedAt: string
  name?: string
  source?: DeckSource
}

export interface AgentFileChange {
  id: string
  projectId: string
  path: string
  action: 'created' | 'updated' | 'deleted'
  summary: string
  createdAt: string
}

export interface AgentRunEvent {
  id: string
  projectId: string
  threadId: string
  runId: string
  type: AgentRunEventType
  timestamp: string
  messageId?: string
  payload?: Record<string, unknown>
}

export interface AgentProjectView extends AgentProject {
  thread: AgentThread
  changes: AgentFileChange[]
}
