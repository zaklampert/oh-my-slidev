<script setup lang="ts">
import type { DeckView as ProjectRecord } from '@myslides/shared-types'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const projects = ref<ProjectRecord[]>([])
const selectedId = ref('')
const loading = ref(false)
const creating = ref(false)
const importing = ref(false)
const actingId = ref('')
const createName = ref('')
const importPath = ref('')
const errorMessage = ref('')
const projectLogLines = ref<string[]>([])
const projectLogPath = ref('')
const hubLogLines = ref<string[]>([])
const hubLogPath = ref('')
const logView = ref<'project' | 'hub'>('project')

let pollHandle: number | undefined
let authPromptTriggered = false

const selectedProject = computed(() => projects.value.find(project => project.id === selectedId.value) ?? projects.value[0] ?? null)
const runningProjects = computed(() => projects.value.filter(project => project.isActive && project.runtime.status === 'running').length)

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

async function loadProjects() {
  loading.value = true
  try {
    const payload = await request<{ projects: ProjectRecord[] }>('/api/projects')
    projects.value = payload.projects

    if (!selectedProject.value && payload.projects[0])
      selectedId.value = payload.projects[0].id
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load projects'
  }
  finally {
    loading.value = false
  }
}

async function loadLogs() {
  try {
    const hubPayload = await request<{ path: string, lines: string[] }>('/api/logs/hub?lines=200')
    hubLogLines.value = hubPayload.lines
    hubLogPath.value = hubPayload.path

    if (selectedProject.value) {
      const projectPayload = await request<{ path: string, lines: string[] }>(`/api/projects/${selectedProject.value.id}/logs?lines=200`)
      projectLogLines.value = projectPayload.lines
      projectLogPath.value = projectPayload.path
    }
    else {
      projectLogLines.value = []
      projectLogPath.value = ''
    }
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load logs'
  }
}

async function createProject() {
  if (!createName.value.trim())
    return

  creating.value = true
  errorMessage.value = ''
  try {
    const payload = await request<{ project: ProjectRecord }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: createName.value }),
    })
    createName.value = ''
    await loadProjects()
    await loadLogs()
    selectedId.value = payload.project.id
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to create project'
  }
  finally {
    creating.value = false
  }
}

async function importProject() {
  if (!importPath.value.trim())
    return

  importing.value = true
  errorMessage.value = ''
  try {
    const payload = await request<{ project: ProjectRecord }>('/api/projects/import', {
      method: 'POST',
      body: JSON.stringify({ path: importPath.value }),
    })
    importPath.value = ''
    await loadProjects()
    await loadLogs()
    selectedId.value = payload.project.id
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to import project'
  }
  finally {
    importing.value = false
  }
}

async function startProject(id: string) {
  actingId.value = id
  errorMessage.value = ''
  try {
    const payload = await request<{ project: ProjectRecord }>(`/api/projects/${id}/start`, {
      method: 'POST',
      body: '{}',
    })
    await loadProjects()
    await loadLogs()
    selectedId.value = payload.project.id
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to start project'
  }
  finally {
    actingId.value = ''
  }
}

async function stopProject(id: string) {
  actingId.value = id
  errorMessage.value = ''
  try {
    await request<{ project: ProjectRecord }>(`/api/projects/${id}/stop`, {
      method: 'POST',
      body: '{}',
    })
    await loadProjects()
    await loadLogs()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to stop project'
  }
  finally {
    actingId.value = ''
  }
}

function openUrl(url?: string) {
  if (url)
    window.open(url, '_blank', 'noopener')
}

function formatDate(value: string) {
  return new Date(value).toLocaleString()
}

onMounted(async () => {
  await loadProjects()
  await loadLogs()
  pollHandle = window.setInterval(() => {
    void loadProjects()
    void loadLogs()
  }, 10000)
})

onBeforeUnmount(() => {
  if (pollHandle)
    window.clearInterval(pollHandle)
})
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <h1>slidev-hub</h1>
    </header>

    <section class="dashboard">
      <aside class="sidebar">
        <article class="panel composer">
          <div class="section-heading">
            <p class="eyebrow">Add deck</p>
            <h2>Start with a clean deck or bring an existing one in.</h2>
          </div>

          <div class="stack">
            <label class="field">
              <span>New deck name</span>
              <input
                v-model="createName"
                type="text"
                placeholder="Quarterly kickoff"
                @keydown.enter.prevent="createProject"
              >
            </label>

            <button class="action solid" :disabled="creating" @click="createProject">
              {{ creating ? 'Creating…' : 'Add new deck' }}
            </button>
          </div>

          <div class="divider" />

          <div class="stack">
            <label class="field">
              <span>Existing deck path</span>
              <input
                v-model="importPath"
                type="text"
                placeholder="/Users/you/talks/kubecon-2026"
                @keydown.enter.prevent="importProject"
              >
            </label>

            <button class="action subtle" :disabled="importing" @click="importProject">
              {{ importing ? 'Importing…' : 'Import deck' }}
            </button>
          </div>
        </article>

        <article class="panel stats">
          <div>
            <span class="stat-value">{{ projects.length }}</span>
            <span class="stat-label">Decks</span>
          </div>
          <div>
            <span class="stat-value">{{ runningProjects }}</span>
            <span class="stat-label">Live</span>
          </div>
        </article>

        <article v-if="errorMessage" class="panel alert">
          <p class="eyebrow">Hub error</p>
          <p>{{ errorMessage }}</p>
        </article>
      </aside>

      <section class="content">
        <article class="panel decks-panel">
          <div class="panel-topline">
            <div>
              <p class="eyebrow">Dashboard</p>
              <h2>Your decks</h2>
            </div>
            <p class="status-note">{{ loading ? 'Refreshing…' : `${projects.length} total` }}</p>
          </div>

          <div v-if="projects.length" class="deck-grid">
            <button
              v-for="project in projects"
              :key="project.id"
              class="deck-card"
              :class="{ active: selectedProject?.id === project.id }"
              @click="selectedId = project.id"
            >
              <div class="deck-card-head">
                <span class="badge" :data-status="project.runtime.status">
                  {{ project.runtime.status === 'running' ? 'Live' : project.isActive ? 'Active' : project.runtime.status }}
                </span>
                <span class="deck-kind">{{ project.source === 'external' ? 'Imported' : 'Managed' }}</span>
              </div>

              <div class="deck-copy">
                <strong>{{ project.name }}</strong>
                <p>{{ project.slug }}</p>
              </div>

              <div class="deck-meta">
                <span>{{ project.runtime.port ? `:${project.runtime.port}` : 'Not running' }}</span>
                <span>Updated {{ formatDate(project.updatedAt) }}</span>
              </div>

              <div class="deck-actions">
                <button
                  v-if="project.runtime.status === 'running' || project.runtime.status === 'starting'"
                  class="action subtle"
                  :disabled="actingId === project.id"
                  @click.stop="stopProject(project.id)"
                >
                  {{ actingId === project.id ? 'Stopping…' : 'Stop' }}
                </button>
                <button
                  v-else
                  class="action solid"
                  :disabled="actingId === project.id"
                  @click.stop="startProject(project.id)"
                >
                  {{ actingId === project.id ? 'Starting…' : 'Start' }}
                </button>
                <button class="action minimal" :disabled="!project.runtime.url" @click.stop="openUrl(project.runtime.url)">
                  Deck
                </button>
                <button class="action minimal" :disabled="!project.runtime.presenterUrl" @click.stop="openUrl(project.runtime.presenterUrl)">
                  Presenter
                </button>
              </div>
            </button>
          </div>

          <div v-else class="empty-state">
            <h3>No decks yet</h3>
            <p>Add a new deck or import one from disk to populate the dashboard.</p>
          </div>
        </article>

        <article v-if="selectedProject" class="panel selected-panel">
          <div class="panel-topline">
            <div>
              <p class="eyebrow">Selected deck</p>
              <h2>{{ selectedProject.name }}</h2>
            </div>
            <span class="badge" :data-status="selectedProject.runtime.status">{{ selectedProject.runtime.status }}</span>
          </div>

          <div class="selected-summary">
            <div>
              <span class="summary-label">Location</span>
              <p>{{ selectedProject.dir }}</p>
            </div>
            <div>
              <span class="summary-label">Entry</span>
              <p>{{ selectedProject.entry }}</p>
            </div>
            <div>
              <span class="summary-label">Last updated</span>
              <p>{{ formatDate(selectedProject.updatedAt) }}</p>
            </div>
          </div>

          <div class="selected-actions">
            <button class="action solid" :disabled="!selectedProject.runtime.url" @click="openUrl(selectedProject.runtime.url)">
              Open deck
            </button>
            <button class="action subtle" :disabled="!selectedProject.runtime.presenterUrl" @click="openUrl(selectedProject.runtime.presenterUrl)">
              Open presenter
            </button>
            <button class="action subtle" :disabled="!selectedProject.runtime.overviewUrl" @click="openUrl(selectedProject.runtime.overviewUrl)">
              Open overview
            </button>
          </div>
        </article>

        <details v-if="selectedProject" class="panel advanced-panel">
          <summary>
            <span>Advanced</span>
            <span class="summary-hint">Logs, runtime state, and debugging</span>
          </summary>

          <div class="advanced-grid">
            <article class="advanced-card">
              <h3>Runtime</h3>
              <dl class="metadata">
                <div>
                  <dt>Status</dt>
                  <dd>{{ selectedProject.runtime.status }}</dd>
                </div>
                <div>
                  <dt>PID</dt>
                  <dd>{{ selectedProject.runtime.pid ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Port</dt>
                  <dd>{{ selectedProject.runtime.port ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{{ formatDate(selectedProject.createdAt) }}</dd>
                </div>
              </dl>
              <p v-if="selectedProject.runtime.error" class="runtime-error">{{ selectedProject.runtime.error }}</p>
            </article>

            <article class="advanced-card terminal">
              <div class="log-toolbar">
                <div>
                  <h3>Logs</h3>
                  <p>{{ logView === 'project' ? (projectLogPath || selectedProject.runtime.logPath || 'No project log yet.') : (hubLogPath || 'No hub log yet.') }}</p>
                </div>
                <div class="toggle-group">
                  <button class="action minimal" :class="{ current: logView === 'project' }" @click="logView = 'project'">
                    Project
                  </button>
                  <button class="action minimal" :class="{ current: logView === 'hub' }" @click="logView = 'hub'">
                    Hub
                  </button>
                  <button class="action minimal" @click="loadLogs">
                    Refresh
                  </button>
                </div>
              </div>
              <pre>{{ (logView === 'project' ? projectLogLines : hubLogLines).join('\n') || 'No logs yet.' }}</pre>
            </article>
          </div>
        </details>
      </section>
    </section>
  </main>
</template>
