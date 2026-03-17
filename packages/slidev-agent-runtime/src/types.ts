import type {
  AgentClient,
  AgentFileChange,
  AgentIntent,
  AgentProject,
  AgentProjectView,
  AgentRunEvent,
  AgentThread,
  SlideContext,
} from '@myslides/slidev-agent-shared-types'
import type { ServerResponse } from 'node:http'

export interface AttachedProjectRef {
  id: string
  rootDir: string
  entryFile: string
  name?: string
  source?: 'managed' | 'external'
}

export interface AgentRuntimeConfig {
  dataRoot: string
  skillsRoot: string
  resolveProject(projectId: string): Promise<AttachedProjectRef>
  onProjectTouched?(projectId: string): Promise<void>
}

export interface SendMessageInput {
  text: string
  intent?: AgentIntent
  client?: AgentClient
  slideContext?: SlideContext
}

export interface SlidevAgentRuntime {
  attachProject(project: AttachedProjectRef): Promise<AgentProjectView>
  getProject(projectId: string): Promise<AgentProjectView>
  getThread(projectId: string): Promise<AgentThread>
  sendMessage(projectId: string, input: SendMessageInput): Promise<AgentThread>
  listChanges(projectId: string): Promise<AgentFileChange[]>
  getStatus(projectId: string): Promise<{ attached: boolean, projectId: string, threadId?: string }>
  stream(projectId: string, response: ServerResponse): () => void
}

export interface AgentProjectState {
  project: AgentProject
  thread: AgentThread
  changes: AgentFileChange[]
  events: AgentRunEvent[]
}
