<script setup lang="ts">
import type { DeckRuntime as ProjectRuntime, DeckView as ProjectRecord } from '@myslides/shared-types'
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
    <section class="masthead">
      <div class="masthead-copy">
        <p class="eyebrow">Slidev Control Room</p>
        <h1>One hub for every deck, with each project keeping its own native Slidev server.</h1>
        <p class="lede">
          Create a new presentation, register an existing deck, then activate any number of projects with stable slug-based routes
          for the deck, presenter mode, and overview.
        </p>
      </div>

      <div class="status-strip">
        <article>
          <span class="metric">{{ projects.length }}</span>
          <span class="label">Tracked decks</span>
        </article>
        <article>
          <span class="metric">{{ runningProjects }}</span>
          <span class="label">Active runtimes</span>
        </article>
        <article>
          <span class="metric">{{ selectedProject?.runtime.port ?? '—' }}</span>
          <span class="label">Selected port</span>
        </article>
      </div>
    </section>

    <section class="workspace">
      <aside class="rail">
        <div class="panel">
          <div class="panel-header">
            <h2>Create a managed deck</h2>
            <p>Stored under the workspace’s `hub-projects` directory.</p>
          </div>

          <label class="field">
            <span>Name</span>
            <input
              v-model="createName"
              type="text"
              placeholder="Quarterly kickoff"
              @keydown.enter.prevent="createProject"
            >
          </label>

          <button class="action solid" :disabled="creating" @click="createProject">
            {{ creating ? 'Creating…' : 'Create project' }}
          </button>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>Register an existing deck</h2>
            <p>Point the hub at any folder that already contains `slides.md`.</p>
          </div>

          <label class="field">
            <span>Absolute path</span>
            <input
              v-model="importPath"
              type="text"
              placeholder="/Users/you/talks/kubecon-2026"
              @keydown.enter.prevent="importProject"
            >
          </label>

          <button class="action outline" :disabled="importing" @click="importProject">
            {{ importing ? 'Registering…' : 'Add existing project' }}
          </button>
        </div>

        <div v-if="errorMessage" class="panel alert">
          <strong>Hub error</strong>
          <p>{{ errorMessage }}</p>
        </div>

        <div class="panel project-list">
          <div class="panel-header">
            <h2>Projects</h2>
            <p v-if="loading">Refreshing registry…</p>
            <p v-else>{{ projects.length }} available</p>
          </div>

          <button
            v-for="project in projects"
            :key="project.id"
            class="project-card"
            :class="{ active: selectedProject?.id === project.id }"
            @click="selectedId = project.id"
          >
            <span class="project-status" :data-status="project.runtime.status">{{ project.isActive ? 'active' : project.runtime.status }}</span>
            <strong>{{ project.name }}</strong>
            <small>{{ project.source === 'external' ? 'external' : 'managed' }} · {{ project.slug }}{{ project.isActive ? ' · active' : '' }}</small>
          </button>
        </div>
      </aside>

      <section class="detail">
        <div v-if="selectedProject" class="detail-stack">
          <header class="panel detail-header">
            <div>
              <p class="eyebrow">Selected deck</p>
              <h2>{{ selectedProject.name }}</h2>
              <p class="path">{{ selectedProject.dir }}</p>
            </div>

            <div class="detail-actions">
              <button
                v-if="selectedProject.runtime.status === 'running' || selectedProject.runtime.status === 'starting'"
                class="action ghost"
                :disabled="actingId === selectedProject.id"
                @click="stopProject(selectedProject.id)"
              >
                {{ actingId === selectedProject.id ? 'Deactivating…' : 'Deactivate' }}
              </button>
              <button
                v-else
                class="action solid"
                :disabled="actingId === selectedProject.id"
                @click="startProject(selectedProject.id)"
              >
                {{ actingId === selectedProject.id ? 'Activating…' : 'Activate presentation' }}
              </button>
              <button class="action outline" :disabled="!selectedProject.runtime.url" @click="openUrl(selectedProject.runtime.url)">
                Open deck
              </button>
              <button class="action outline" :disabled="!selectedProject.runtime.presenterUrl" @click="openUrl(selectedProject.runtime.presenterUrl)">
                Open presenter
              </button>
              <button class="action outline" :disabled="!selectedProject.runtime.overviewUrl" @click="openUrl(selectedProject.runtime.overviewUrl)">
                Open overview
              </button>
            </div>
          </header>

          <div class="detail-grid">
            <article class="panel metadata">
              <h3>Runtime</h3>
              <dl>
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
                  <dt>Entry</dt>
                  <dd>{{ selectedProject.entry }}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{{ new Date(selectedProject.createdAt).toLocaleString() }}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{{ new Date(selectedProject.updatedAt).toLocaleString() }}</dd>
                </div>
              </dl>
              <p v-if="selectedProject.runtime.error" class="runtime-error">{{ selectedProject.runtime.error }}</p>
            </article>

            <article class="panel terminal">
              <div class="log-toolbar">
                <div>
                  <h3>Logs</h3>
                  <p class="path">{{ logView === 'project' ? (projectLogPath || selectedProject.runtime.logPath || 'No project log yet.') : (hubLogPath || 'No hub log yet.') }}</p>
                </div>
                <div class="detail-actions">
                  <button class="action outline" :class="{ active: logView === 'project' }" @click="logView = 'project'">
                    Project log
                  </button>
                  <button class="action outline" :class="{ active: logView === 'hub' }" @click="logView = 'hub'">
                    Hub log
                  </button>
                  <button class="action ghost" @click="loadLogs">
                    Refresh logs
                  </button>
                </div>
              </div>
              <pre>{{ (logView === 'project' ? projectLogLines : hubLogLines).join('\n') || 'No logs yet.' }}</pre>
            </article>
          </div>

          <article class="panel preview">
            <div class="preview-header">
              <div>
                <p class="eyebrow">Live preview</p>
                <h3>{{ selectedProject.runtime.url ? 'Active presentation route' : 'No active presentation yet' }}</h3>
              </div>
              <span class="badge" :data-status="selectedProject.runtime.status">{{ selectedProject.runtime.status }}</span>
            </div>

            <div class="preview-frame">
              <iframe
                v-if="selectedProject.runtime.url"
                :src="selectedProject.runtime.url"
                title="Slidev preview"
              />
              <div v-else class="empty-state">
                <p>Activate the selected project to proxy the real Slidev UI here.</p>
                <p>The hub can run multiple active Slidev runtimes and route each one through its project slug.</p>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="panel empty-detail">
          <p>No project selected yet.</p>
        </div>
      </section>
    </section>
  </main>
</template>
