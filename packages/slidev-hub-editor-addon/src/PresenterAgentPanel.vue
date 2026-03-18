<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useNav } from '@slidev/client/composables/useNav.ts'
import { useDynamicSlideInfo } from '@slidev/client/composables/useSlideInfo.ts'

defineEmits<{
  close: []
}>()

interface AgentMessageView {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
}

interface AgentFileChangeView {
  id: string
  path: string
  action: 'created' | 'updated' | 'deleted'
  summary: string
  createdAt: string
}

const { currentSlideNo, currentSlideRoute } = useNav()
const { info } = useDynamicSlideInfo(currentSlideNo)

const projectId = ref('')
const projectName = ref('')
const initialized = ref(false)
const loading = ref(false)
const running = ref(false)
const errorMessage = ref('')
const prompt = ref('')
const messages = ref<AgentMessageView[]>([])
const changes = ref<AgentFileChangeView[]>([])
const activity = ref<string[]>([])
const streamingText = ref('')

let authPromptTriggered = false
let agentEvents: EventSource | null = null

function inferDeckSlug() {
  const [slug] = window.location.pathname.split('/').filter(Boolean)
  return slug || ''
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function trimSelection(value: string) {
  const normalized = value.trim()
  if (!normalized)
    return undefined
  return normalized.slice(0, 4000)
}

function pushActivity(label: string) {
  activity.value = [`${formatTimestamp(new Date().toISOString())} ${label}`, ...activity.value].slice(0, 12)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (response.status === 401) {
    if (!authPromptTriggered) {
      authPromptTriggered = true
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.assign(`/api/auth/prompt?returnTo=${encodeURIComponent(returnTo)}`)
    }
    throw new Error('Authentication required')
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `Request failed with ${response.status}` }))
    throw new Error(payload.error ?? `Request failed with ${response.status}`)
  }

  return await response.json() as T
}

function closeEventStream() {
  agentEvents?.close()
  agentEvents = null
}

async function refreshAgentState() {
  if (!projectId.value)
    return

  const [threadPayload, changesPayload] = await Promise.all([
    request<{ thread: { messages: AgentMessageView[] } }>(`/api/agent/projects/${projectId.value}/thread`),
    request<{ changes: AgentFileChangeView[] }>(`/api/agent/projects/${projectId.value}/changes`),
  ])

  messages.value = threadPayload.thread.messages
  changes.value = changesPayload.changes
}

function connectEventStream() {
  if (!projectId.value || agentEvents)
    return

  const source = new EventSource(`/api/agent/projects/${projectId.value}/events`)
  agentEvents = source

  source.addEventListener('run.started', () => {
    running.value = true
    streamingText.value = ''
    pushActivity('Agent started a run.')
  })

  source.addEventListener('message.delta', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { payload?: { delta?: string } }
    if (payload.payload?.delta)
      streamingText.value += payload.payload.delta
  })

  source.addEventListener('message.completed', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { payload?: { text?: string } }
    if (payload.payload?.text)
      streamingText.value = payload.payload.text
    void refreshAgentState()
  })

  source.addEventListener('file.changed', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { payload?: { path?: string, action?: string } }
    pushActivity(`Changed ${payload.payload?.path || 'a file'}${payload.payload?.action ? ` (${payload.payload.action})` : ''}.`)
    void refreshAgentState()
  })

  source.addEventListener('run.completed', () => {
    running.value = false
    pushActivity('Agent run completed.')
    void refreshAgentState()
  })

  source.addEventListener('run.failed', () => {
    running.value = false
    pushActivity('Agent run failed.')
    void refreshAgentState()
  })

  source.onerror = () => {
    pushActivity('Agent event stream disconnected.')
  }
}

async function initializeAgent() {
  const slug = inferDeckSlug()
  if (!slug)
    throw new Error('Unable to determine the active deck slug from this URL.')

  const projectPayload = await request<{ project: { id: string, name: string } }>(`/api/projects/slug/${encodeURIComponent(slug)}`)
  projectId.value = projectPayload.project.id
  projectName.value = projectPayload.project.name

  const attachPayload = await request<{
    project: {
      thread: { messages: AgentMessageView[] }
      changes: AgentFileChangeView[]
    }
  }>('/api/agent/projects/attach', {
    method: 'POST',
    body: JSON.stringify({ projectId: projectId.value }),
  })

  messages.value = attachPayload.project.thread.messages
  changes.value = attachPayload.project.changes
  connectEventStream()
  initialized.value = true
  await refreshAgentState()
}

async function ensureInitialized() {
  if (initialized.value || loading.value)
    return

  loading.value = true
  errorMessage.value = ''
  try {
    await initializeAgent()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to initialize the deck agent'
  }
  finally {
    loading.value = false
  }
}

async function sendPrompt() {
  if (!projectId.value || !prompt.value.trim() || running.value)
    return

  const text = prompt.value.trim()
  messages.value = [...messages.value, {
    id: `local-${Date.now()}`,
    role: 'user',
    text,
    createdAt: new Date().toISOString(),
  }]
  prompt.value = ''
  running.value = true
  streamingText.value = ''
  errorMessage.value = ''
  pushActivity(`Prompted agent for slide ${currentSlideNo.value}.`)

  try {
    const payload = await request<{ thread: { messages: AgentMessageView[] } }>(`/api/agent/projects/${projectId.value}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        intent: 'edit_slide',
        client: 'addon',
        slideContext: {
          slideNumber: currentSlideNo.value,
          slideTitle: info.value?.title,
          slidePath: currentSlideRoute.value?.path,
          selection: trimSelection(info.value?.source.contentRaw || ''),
        },
      }),
    })

    messages.value = payload.thread.messages
    await refreshAgentState()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to send prompt to the agent'
    running.value = false
  }
}

const title = computed(() => info.value?.title ? `Slide ${currentSlideNo.value} · ${info.value.title}` : `Slide ${currentSlideNo.value}`)

void ensureInitialized()

onBeforeUnmount(() => {
  closeEventStream()
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-y-0 right-0 z-[1000] w-[420px] max-w-[92vw] bg-[#0e1117] text-gray-100 border-l border-white/10 shadow-2xl">
      <div class="h-full grid grid-rows-[max-content_1fr]">
        <header class="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <div class="text-xs uppercase tracking-[0.16em] text-cyan-300">
              Deck Agent
            </div>
            <h2 class="m-0 text-lg font-semibold">
              {{ projectName || 'Active deck' }}
            </h2>
            <p class="m-0 text-xs text-gray-400">
              {{ title }}
            </p>
          </div>
          <button class="rounded border border-white/10 px-2 py-1 text-xs" @click="$emit('close')">
            Close
          </button>
        </header>

        <div class="grid grid-rows-[max-content_1fr] min-h-0">
          <div class="grid gap-3 border-b border-white/10 px-4 py-3">
            <textarea
              v-model="prompt"
              rows="4"
              class="w-full resize-none rounded border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
              placeholder="Ask the agent to change the active deck from presenter mode."
            />
            <div class="flex items-center justify-between gap-3">
              <p class="m-0 text-xs text-gray-400">
                Separate from manual editing. The agent works against deck files and current slide context.
              </p>
              <div class="flex items-center gap-2">
                <button
                  class="rounded border border-white/10 px-2.5 py-1 text-xs disabled:opacity-40"
                  :disabled="loading"
                  @click="ensureInitialized"
                >
                  {{ loading ? 'Loading…' : 'Reconnect' }}
                </button>
                <button
                  class="rounded bg-cyan-500 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                  :disabled="!initialized || !prompt.trim() || running"
                  @click="sendPrompt"
                >
                  {{ running ? 'Running…' : 'Send' }}
                </button>
              </div>
            </div>
            <p v-if="errorMessage" class="m-0 text-xs text-red-400">
              {{ errorMessage }}
            </p>
          </div>

          <div class="grid grid-rows-[minmax(0,1fr)_max-content] min-h-0">
            <div class="overflow-auto px-4 py-3">
              <div v-if="streamingText" class="mb-3 rounded border border-cyan-500/25 bg-cyan-500/8 p-3">
                <div class="mb-2 text-[11px] uppercase tracking-wide text-cyan-300">
                  Live response
                </div>
                <pre class="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-5">{{ streamingText }}</pre>
              </div>

              <div
                v-for="message in messages"
                :key="message.id"
                class="mb-3 rounded border p-3"
                :class="message.role === 'user'
                  ? 'border-white/10 bg-white/5'
                  : message.role === 'assistant'
                    ? 'border-emerald-500/20 bg-emerald-500/8'
                    : 'border-amber-500/20 bg-amber-500/8'"
              >
                <div class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide">
                  <span>{{ message.role }}</span>
                  <span class="text-gray-500">{{ formatTimestamp(message.createdAt) }}</span>
                </div>
                <pre class="m-0 mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-5">{{ message.text }}</pre>
              </div>

              <div v-if="!messages.length && !streamingText" class="rounded border border-dashed border-white/10 p-3 text-sm text-gray-400">
                Prompt the agent to update the active deck and watch file changes appear below.
              </div>
            </div>

            <div class="grid gap-3 border-t border-white/10 bg-black/10 px-4 py-3">
              <section class="grid gap-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-400">
                  Recent changes
                </div>
                <div
                  v-for="change in changes"
                  :key="change.id"
                  class="rounded border border-white/10 bg-white/4 p-2"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-medium">{{ change.action }}</span>
                    <span class="text-[11px] text-gray-500">{{ formatTimestamp(change.createdAt) }}</span>
                  </div>
                  <div class="mt-1 break-all text-xs">{{ change.path }}</div>
                  <div class="mt-1 text-[11px] text-gray-400">{{ change.summary }}</div>
                </div>
                <div v-if="!changes.length" class="text-xs text-gray-500">
                  No recorded file changes yet.
                </div>
              </section>

              <section class="grid gap-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-400">
                  Activity
                </div>
                <div
                  v-for="entry in activity"
                  :key="entry"
                  class="rounded border border-white/8 bg-black/10 px-2 py-1.5 text-xs text-gray-400"
                >
                  {{ entry }}
                </div>
                <div v-if="!activity.length" class="text-xs text-gray-500">
                  Waiting for the first run.
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
