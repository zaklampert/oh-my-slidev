import type { AgentFileChange, AgentMessage, AgentProject, AgentProjectView, AgentRunEvent, AgentThread } from '@myslides/slidev-agent-shared-types'
import { getModel } from '@mariozechner/pi-ai'
import { AuthStorage, createAgentSession, createCodingTools, DefaultResourceLoader, ModelRegistry, SessionManager } from '@mariozechner/pi-coding-agent'
import type { ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentProjectState, AgentRuntimeConfig, AttachedProjectRef, SendMessageInput, SlidevAgentRuntime } from './types.js'

function timestamp() {
  return new Date().toISOString()
}

function withinRoot(rootDir: string, filePath: string) {
  const normalizedRoot = resolve(rootDir)
  const normalizedTarget = resolve(filePath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

const TRACKED_FILE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.css',
  '.yaml',
  '.yml',
])

async function collectProjectFiles(rootDir: string, currentDir = rootDir, files = new Map<string, string>()) {
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.slidev-hub' || entry.name === '.pi')
      continue

    const absolutePath = resolve(currentDir, entry.name)
    if (!withinRoot(rootDir, absolutePath))
      continue

    if (entry.isDirectory()) {
      await collectProjectFiles(rootDir, absolutePath, files)
      continue
    }

    if (!TRACKED_FILE_EXTENSIONS.has(extname(entry.name)))
      continue

    const fileStat = await stat(absolutePath)
    files.set(relative(rootDir, absolutePath), `${fileStat.mtimeMs}:${fileStat.size}`)
  }
  return files
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true })
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error.'
}

function createSseEvent(event: AgentRunEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

function makeAssistantReply(project: AttachedProjectRef, input: SendMessageInput) {
  const locationHint = input.slideContext?.slideTitle
    ? ` for slide "${input.slideContext.slideTitle}"`
    : input.slideContext?.slideNumber != null
      ? ` for slide ${input.slideContext.slideNumber}`
      : ''

  const intentHint = input.intent ? `Intent: ${input.intent}. ` : ''

  return [
    `${intentHint}Attached to Slidev project "${project.name || basename(project.rootDir)}"${locationHint}.`,
    'The reusable Slidev agent runtime is now hosted inside Slidev Hub.',
    `Project root: ${project.rootDir}`,
    `Entry file: ${project.entryFile}`,
    'Pi-backed execution is active through the embedded Slidev agent runtime.',
  ].join('\n')
}

function buildPrompt(project: AttachedProjectRef, input: SendMessageInput, thread: AgentThread) {
  const priorMessages = thread.messages
    .slice(-8)
    .map(message => `${message.role.toUpperCase()}: ${message.text}`)
    .join('\n\n')

  const slideContext = input.slideContext
    ? [
        input.slideContext.slideNumber != null ? `Current slide number: ${input.slideContext.slideNumber}` : '',
        input.slideContext.slideTitle ? `Current slide title: ${input.slideContext.slideTitle}` : '',
        input.slideContext.slidePath ? `Current slide path: ${input.slideContext.slidePath}` : '',
        input.slideContext.selection ? `Current selection:\n${input.slideContext.selection}` : '',
      ].filter(Boolean).join('\n')
    : 'No active slide context provided.'

  return [
    'You are the Slidev agent hosted inside Slidev Hub.',
    'You are an expert at working with Slidev projects.',
    `Project name: ${project.name || basename(project.rootDir)}`,
    `Project root: ${project.rootDir}`,
    `Entry file: ${project.entryFile}`,
    input.intent ? `User intent: ${input.intent}` : '',
    '',
    'Recent conversation:',
    priorMessages || 'No prior messages.',
    '',
    'Current slide context:',
    slideContext,
    '',
    'User request:',
    input.text,
  ].filter(Boolean).join('\n')
}

function buildRuntimeSystemPrompt(project: AttachedProjectRef) {
  return [
    'You are the Slidev agent hosted inside Slidev Hub.',
    'You are an expert at working with Slidev projects and presentation craft.',
    'Use the available Slidev skills progressively instead of front-loading every reference.',
    'Before making edits, inspect the relevant project files and only pull the specific Slidev skill details you need.',
    'Prefer targeted, minimal edits that preserve working Slidev syntax and structure.',
    'You may work across the entire attached Slidev project root, including imported markdown, components, styles, and config files.',
    `Attached project root: ${project.rootDir}`,
    `Primary entry file: ${project.entryFile}`,
  ].join('\n')
}

async function createPiSession(projectId: string, project: AttachedProjectRef, dataRoot: string, skillsRoot: string) {
  const provider = process.env.SLIDEV_AGENT_PROVIDER || 'zai'
  const modelId = process.env.SLIDEV_AGENT_MODEL || 'glm-4.7'
  const model = getModel(provider as never, modelId)
  if (!model)
    throw new Error(`Unable to resolve model ${provider}/${modelId}. Set SLIDEV_AGENT_PROVIDER and SLIDEV_AGENT_MODEL.`)

  const agentDir = resolve(dataRoot, 'pi')
  const sessionsRoot = resolve(dataRoot, 'sessions', projectId)
  await ensureDir(agentDir)
  await ensureDir(sessionsRoot)

  const authStorage = AuthStorage.create(resolve(agentDir, 'auth.json'))
  const envApiKey = process.env[`${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`]
  if (envApiKey)
    authStorage.setRuntimeApiKey(provider, envApiKey)
  const modelRegistry = new ModelRegistry(authStorage)
  const resourceLoader = new DefaultResourceLoader({
    cwd: project.rootDir,
    agentDir,
    additionalSkillPaths: [skillsRoot],
    appendSystemPrompt: buildRuntimeSystemPrompt(project),
  })
  await resourceLoader.reload()

  return createAgentSession({
    cwd: project.rootDir,
    agentDir,
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    tools: createCodingTools(project.rootDir),
    sessionManager: SessionManager.continueRecent(project.rootDir, sessionsRoot),
  })
}

export function createSlidevAgentRuntime(config: AgentRuntimeConfig): SlidevAgentRuntime {
  const listeners = new Map<string, Set<ServerResponse>>()
  const activeRuns = new Map<string, Promise<void>>()
  const stateMutations = new Map<string, Promise<void>>()

  async function getProjectStatePath(projectId: string) {
    const dir = resolve(config.dataRoot, 'projects')
    await ensureDir(dir)
    return resolve(dir, `${projectId}.json`)
  }

  async function loadState(projectId: string) {
    const path = await getProjectStatePath(projectId)
    if (!existsSync(path))
      return null
    try {
      return JSON.parse(await readFile(path, 'utf8')) as AgentProjectState
    }
    catch (error) {
      const backupPath = `${path}.corrupt-${Date.now()}`
      await rename(path, backupPath).catch(() => {})
      console.error(`[slidev-agent-runtime] state for ${projectId} was corrupt and has been moved to ${backupPath}: ${asErrorMessage(error)}`)
      return null
    }
  }

  async function saveState(state: AgentProjectState) {
    const path = await getProjectStatePath(state.project.id)
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`)
  }

  async function mutateState<T>(projectId: string, mutate: (state: AgentProjectState | null) => Promise<T>) {
    const previous = stateMutations.get(projectId) || Promise.resolve()
    let result!: T
    const next = previous
      .catch(() => {})
      .then(async () => {
        const state = await loadState(projectId)
        result = await mutate(state)
      })
    stateMutations.set(projectId, next.then(() => {}))
    await next
    if (stateMutations.get(projectId) === next)
      stateMutations.delete(projectId)
    return result
  }

  function emit(projectId: string, event: AgentRunEvent) {
    const subscribers = listeners.get(projectId)
    if (!subscribers?.size)
      return

    const payload = createSseEvent(event)
    for (const response of subscribers)
      response.write(payload)
  }

  async function attachProject(project: AttachedProjectRef): Promise<AgentProjectView> {
    if (!withinRoot(project.rootDir, project.entryFile))
      throw new Error(`Entry file ${project.entryFile} must be inside ${project.rootDir}`)

    return mutateState(project.id, async (existing) => {
      if (existing) {
        existing.project.rootDir = project.rootDir
        existing.project.entryFile = project.entryFile
        existing.project.name = project.name
        existing.project.source = project.source
        await saveState(existing)
        return {
          ...existing.project,
          thread: existing.thread,
          changes: existing.changes,
        }
      }

      const now = timestamp()
      const agentProject: AgentProject = {
        id: project.id,
        rootDir: project.rootDir,
        entryFile: project.entryFile,
        attachedAt: now,
        name: project.name,
        source: project.source,
      }

      const thread: AgentThread = {
        id: `thread-${project.id}`,
        projectId: project.id,
        createdAt: now,
        updatedAt: now,
        messages: [],
      }

      const state: AgentProjectState = {
        project: agentProject,
        thread,
        changes: [],
        events: [],
      }

      await saveState(state)
      return {
        ...state.project,
        thread: state.thread,
        changes: state.changes,
      }
    })
  }

  async function getProject(projectId: string) {
    const resolved = await config.resolveProject(projectId)
    return attachProject(resolved)
  }

  async function getThread(projectId: string) {
    const project = await getProject(projectId)
    return project.thread
  }

  async function listChanges(projectId: string) {
    const project = await getProject(projectId)
    return project.changes
  }

  async function getStatus(projectId: string) {
    const state = await loadState(projectId)
    return {
      attached: Boolean(state),
      projectId,
      threadId: state?.thread.id,
    }
  }

  async function appendEvent(projectId: string, event: AgentRunEvent, options?: { persist?: boolean }) {
    if (options?.persist !== false) {
      await mutateState(projectId, async (state) => {
        if (!state)
          return
        state.events.push(event)
        state.events = state.events.slice(-200)
        await saveState(state)
      })
    }
    emit(projectId, event)
  }

  async function sendMessage(projectId: string, input: SendMessageInput) {
    const state = await loadState(projectId) || (() => {
      throw new Error(`Project ${projectId} is not attached`)
    })()

    if (activeRuns.has(projectId))
      throw new Error(`Project ${projectId} already has an active agent run`)

    const runId = `run-${randomUUID()}`
    const createdAt = timestamp()
    const userMessage: AgentMessage = {
      id: `msg-${randomUUID()}`,
      role: 'user',
      text: input.text,
      createdAt,
      intent: input.intent,
      client: input.client,
      slideContext: input.slideContext,
    }

    await mutateState(projectId, async (latest) => {
      if (!latest)
        throw new Error(`Project ${projectId} is not attached`)
      latest.thread.messages.push(userMessage)
      latest.thread.updatedAt = createdAt
      await saveState(latest)
    })

    await appendEvent(projectId, {
      id: `event-${randomUUID()}`,
      projectId,
      threadId: state.thread.id,
      runId,
      type: 'run.started',
      timestamp: createdAt,
      messageId: userMessage.id,
      payload: {
        intent: input.intent,
        client: input.client,
      },
    })

    const execution = (async () => {
      const projectRef = await config.resolveProject(projectId)
      const prompt = buildPrompt(projectRef, input, state.thread)
      const beforeFiles = await collectProjectFiles(projectRef.rootDir)
      const assistantMessageId = `msg-${randomUUID()}`
      let assistantText = ''
      let piEnabled = true

      try {
        const { session } = await createPiSession(projectId, projectRef, config.dataRoot, config.skillsRoot)
        const unsubscribe = session.subscribe((event) => {
          try {
            if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta' && typeof event.assistantMessageEvent.delta === 'string') {
              assistantText += event.assistantMessageEvent.delta
              void appendEvent(projectId, {
                id: `event-${randomUUID()}`,
                projectId,
                threadId: state.thread.id,
                runId,
                type: 'message.delta',
                timestamp: timestamp(),
                messageId: assistantMessageId,
                payload: {
                  delta: event.assistantMessageEvent.delta,
                },
              }, { persist: false })
            }

            if (event.type === 'message_end' && typeof event.message === 'object' && event.message && 'role' in event.message && event.message.role === 'assistant') {
              const textBlocks = Array.isArray((event.message as { content?: unknown }).content)
                ? (event.message as { content: Array<{ type?: string, text?: string }> }).content
                    .filter(block => block?.type === 'text' && typeof block.text === 'string')
                    .map(block => block.text)
                : []
              if (textBlocks.length)
                assistantText = textBlocks.join('\n')
            }

            if (event.type === 'tool_execution_start') {
              void appendEvent(projectId, {
                id: `event-${randomUUID()}`,
                projectId,
                threadId: state.thread.id,
                runId,
                type: 'tool.started',
                timestamp: timestamp(),
                payload: {
                  toolName: event.toolName,
                },
              }, { persist: false })
            }

            if (event.type === 'tool_execution_end') {
              void appendEvent(projectId, {
                id: `event-${randomUUID()}`,
                projectId,
                threadId: state.thread.id,
                runId,
                type: 'tool.completed',
                timestamp: timestamp(),
                payload: {
                  toolName: event.toolName,
                  isError: event.isError,
                },
              }, { persist: false })
            }
          }
          catch (error) {
            console.error(`[slidev-agent-runtime] failed to process Pi event for ${projectId}: ${asErrorMessage(error)}`)
          }
        })

        await session.prompt(prompt)
        unsubscribe()
      }
      catch (error) {
        piEnabled = false
        assistantText = [
          'Pi is not configured for live execution yet.',
          asErrorMessage(error),
          '',
          makeAssistantReply(projectRef, input),
        ].join('\n')
      }

      const afterFiles = await collectProjectFiles(projectRef.rootDir)
      const changedFiles: AgentFileChange[] = []

      for (const [path, fingerprint] of afterFiles.entries()) {
        const previous = beforeFiles.get(path)
        if (!previous) {
          changedFiles.push({
            id: `change-${randomUUID()}`,
            projectId,
            path,
            action: 'created',
            summary: 'Created by agent run.',
            createdAt: timestamp(),
          })
          continue
        }
        if (previous !== fingerprint) {
          changedFiles.push({
            id: `change-${randomUUID()}`,
            projectId,
            path,
            action: 'updated',
            summary: 'Updated by agent run.',
            createdAt: timestamp(),
          })
        }
      }

      for (const path of beforeFiles.keys()) {
        if (!afterFiles.has(path)) {
          changedFiles.push({
            id: `change-${randomUUID()}`,
            projectId,
            path,
            action: 'deleted',
            summary: 'Deleted by agent run.',
            createdAt: timestamp(),
          })
        }
      }

      const assistantMessage: AgentMessage = {
        id: assistantMessageId,
        role: 'assistant',
        text: assistantText || (piEnabled ? 'Agent finished without text output.' : 'Agent runtime unavailable.'),
        createdAt: timestamp(),
      }

      await mutateState(projectId, async (latest) => {
        if (!latest)
          throw new Error(`Project ${projectId} is not attached`)
        latest.thread.messages.push(assistantMessage)
        latest.thread.updatedAt = assistantMessage.createdAt
        latest.changes.push(...changedFiles)
        latest.changes = latest.changes.slice(-50)
        await saveState(latest)
      })

      const latest = await loadState(projectId) || state

      await appendEvent(projectId, {
        id: `event-${randomUUID()}`,
        projectId,
        threadId: latest.thread.id,
        runId,
        type: 'message.completed',
        timestamp: assistantMessage.createdAt,
        messageId: assistantMessage.id,
        payload: {
          text: assistantMessage.text,
        },
      })

      for (const change of changedFiles) {
        await appendEvent(projectId, {
          id: `event-${randomUUID()}`,
          projectId,
          threadId: latest.thread.id,
          runId,
          type: 'file.changed',
          timestamp: change.createdAt,
          payload: {
            path: change.path,
            action: change.action,
            summary: change.summary,
          },
        })
      }

      await appendEvent(projectId, {
        id: `event-${randomUUID()}`,
        projectId,
        threadId: latest.thread.id,
        runId,
        type: piEnabled ? 'run.completed' : 'run.failed',
        timestamp: timestamp(),
        payload: {
          messageCount: latest.thread.messages.length,
          piEnabled,
        },
      })

      await config.onProjectTouched?.(projectId)
    })()

    activeRuns.set(projectId, execution)
    try {
      await execution
    }
    finally {
      activeRuns.delete(projectId)
    }

    return (await loadState(projectId) || state).thread
  }

  function stream(projectId: string, response: ServerResponse) {
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders?.()
    response.write(': connected\n\n')

    const subscribers = listeners.get(projectId) || new Set<ServerResponse>()
    subscribers.add(response)
    listeners.set(projectId, subscribers)

    void loadState(projectId).then((state) => {
      for (const event of state?.events || [])
        response.write(createSseEvent(event))
    })

    const heartbeat = setInterval(() => {
      response.write(': heartbeat\n\n')
    }, 15_000)

    const cleanup = () => {
      clearInterval(heartbeat)
      subscribers.delete(response)
      if (!subscribers.size)
        listeners.delete(projectId)
    }

    response.on('close', cleanup)
    response.on('error', cleanup)
    return cleanup
  }

  return {
    attachProject,
    getProject,
    getThread,
    sendMessage,
    listChanges,
    getStatus,
    stream,
  }
}
