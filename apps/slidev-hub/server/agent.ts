import type { AgentFileChange, AgentProjectView, AgentThread } from '@myslides/shared-types'
import { createSlidevAgentRuntime } from '@myslides/slidev-agent-runtime'
import type { SendMessageInput as RuntimeSendMessageInput } from '@myslides/slidev-agent-runtime'
import type { ServerResponse } from 'node:http'
import { agentDataRoot, slidevAgentSkillsRoot } from './config.js'
import type { RegistryController } from './registry.js'

export interface SendMessageInput extends RuntimeSendMessageInput {}

export interface HubAgentController {
  attachProject(projectId: string): Promise<AgentProjectView>
  getProject(projectId: string): Promise<AgentProjectView>
  getThread(projectId: string): Promise<AgentThread>
  sendMessage(projectId: string, input: SendMessageInput): Promise<AgentThread>
  listChanges(projectId: string): Promise<AgentFileChange[]>
  getStatus(projectId: string): Promise<{ attached: boolean, projectId: string, threadId?: string, message?: string }>
  stream(projectId: string, response: ServerResponse): () => void
}

export function createHubAgentController(registry: RegistryController): HubAgentController {
  const runtime = createSlidevAgentRuntime({
    dataRoot: agentDataRoot,
    skillsRoot: slidevAgentSkillsRoot,
    async resolveProject(projectId) {
      const project = await registry.findProject(projectId)
      return {
        id: project.id,
        rootDir: project.dir,
        entryFile: project.entry,
        name: project.name,
        source: project.source,
      }
    },
    onProjectTouched: projectId => registry.updateProjectTimestamp(projectId),
  })

  return {
    attachProject: async (projectId) => {
      const project = await registry.findProject(projectId)
      return runtime.attachProject({
        id: project.id,
        rootDir: project.dir,
        entryFile: project.entry,
        name: project.name,
        source: project.source,
      })
    },
    getProject: projectId => runtime.getProject(projectId),
    getThread: projectId => runtime.getThread(projectId),
    sendMessage: (projectId, input) => runtime.sendMessage(projectId, input),
    listChanges: projectId => runtime.listChanges(projectId),
    getStatus: projectId => runtime.getStatus(projectId),
    stream: (projectId, response) => runtime.stream(projectId, response),
  }
}
