import type { AgentFileChange, AgentProjectView, AgentThread } from '@myslides/shared-types'
import type { ServerResponse } from 'node:http'
import type { RegistryController } from './registry.js'

export interface SendMessageInput {
  text: string
  intent?: string
  client?: string
  slideContext?: Record<string, unknown>
}

export interface HubAgentController {
  attachProject(projectId: string): Promise<AgentProjectView>
  getProject(projectId: string): Promise<AgentProjectView>
  getThread(projectId: string): Promise<AgentThread>
  sendMessage(projectId: string, input: SendMessageInput): Promise<AgentThread>
  listChanges(projectId: string): Promise<AgentFileChange[]>
  getStatus(projectId: string): Promise<{ attached: boolean, projectId: string, threadId?: string, message?: string }>
  stream(projectId: string, response: ServerResponse): () => void
}

function now() {
  return new Date().toISOString()
}

function createEmptyThread(projectId: string): AgentThread {
  const timestamp = now()
  return {
    id: `agent-disabled-${projectId}`,
    projectId,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      {
        id: `agent-disabled-message-${projectId}`,
        role: 'system',
        text: 'slidev-agent is not configured in this deployment.',
        createdAt: timestamp,
      },
    ],
  }
}

async function createDisabledProjectView(registry: RegistryController, projectId: string): Promise<AgentProjectView> {
  const project = await registry.findProject(projectId)
  return {
    id: project.id,
    rootDir: project.dir,
    entryFile: project.entry,
    attachedAt: now(),
    name: project.name,
    source: project.source,
    thread: createEmptyThread(project.id),
    changes: [],
  }
}

export function createHubAgentController(registry: RegistryController): HubAgentController {
  return {
    attachProject: projectId => createDisabledProjectView(registry, projectId),
    getProject: projectId => createDisabledProjectView(registry, projectId),
    getThread: async projectId => createEmptyThread((await registry.findProject(projectId)).id),
    sendMessage: async (projectId) => {
      const project = await registry.findProject(projectId)
      throw new Error(`slidev-agent is not configured for project ${project.id}`)
    },
    listChanges: async () => [],
    getStatus: async projectId => ({
      attached: false,
      projectId,
      message: 'slidev-agent is not configured in this deployment',
    }),
    stream: (_projectId, response) => {
      response.statusCode = 501
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: 'slidev-agent is not configured in this deployment' }))
      return () => {}
    },
  }
}
