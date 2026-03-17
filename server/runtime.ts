import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import process from 'node:process'
import { getPort } from 'get-port-please'
import { getProjectLogPath, logHub, logProject } from './logs.js'
import type { RegistryController } from './registry.js'
import type { HubState } from './state.js'
import type { ActiveRuntime, ProjectRuntimeView, ProjectView } from './types.js'
import { timestamp } from './config.js'

const require = createRequire(import.meta.url)
const slidevCliPath = require.resolve('@slidev/cli/bin/slidev.mjs')
const STARTUP_TIMEOUT_MS = 20_000
const HEALTHCHECK_INTERVAL_MS = 250

function appendRuntimeLog(runtime: ActiveRuntime, message: string) {
  runtime.logTail.push(message)
  runtime.logTail = runtime.logTail.slice(-120)
  logProject(runtime.project.id, message)
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function probeRuntime(port: number, base: string) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: 'localhost',
        port,
        path: base,
        method: 'GET',
      },
      (res) => {
        res.resume()
        resolve(res.statusCode || 0)
      },
    )

    req.on('error', reject)
    req.end()
  })
}

async function waitForRuntimeReady(runtime: ActiveRuntime) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    const exitCode = runtime.process?.exitCode
    if (exitCode != null)
      throw new Error(`Slidev exited before becoming ready (exit code ${exitCode})`)

    try {
      const status = await probeRuntime(runtime.port, runtime.base)
      if (status >= 200 && status < 500)
        return
    }
    catch {
      // Runtime not ready yet.
    }

    await wait(HEALTHCHECK_INTERVAL_MS)
  }

  throw new Error(`Slidev did not become ready within ${STARTUP_TIMEOUT_MS}ms`)
}

function buildSlidevArgs(runtime: ActiveRuntime) {
  return [
    slidevCliPath,
    runtime.project.entry,
    '--port',
    String(runtime.port),
    '--base',
    runtime.base,
    '--log',
    'error',
  ]
}

export interface RuntimeController {
  activateProject(id: string, reason?: string): Promise<ProjectView>
  stopProject(id: string, reason?: string, clearActiveProject?: boolean): Promise<ProjectView | null>
  getRuntimeForPath(pathname: string): ActiveRuntime | null
  listActiveProjectIds(): string[]
}

export function createRuntimeController(
  state: HubState,
  registry: RegistryController,
  saveHubState: () => Promise<void>,
): RuntimeController {
  async function stopProject(id: string, reason = 'manual stop', clearActiveProject = true) {
    const runtime = state.runtimes.get(id)
    if (!runtime) {
      if (clearActiveProject)
        await saveHubState()
      return null
    }

    runtime.expectedExit = true
    appendRuntimeLog(runtime, `stopping active runtime: ${reason}`)
    logHub(`stopping active runtime for ${runtime.project.id}: ${reason}`)

    try {
      runtime.process?.kill('SIGTERM')
      await wait(250)
      if (runtime.process?.exitCode == null)
        runtime.process?.kill('SIGKILL')
    }
    finally {
      state.runtimes.delete(id)
      await saveHubState()
    }

    return {
      ...runtime.project,
      isActive: false,
      runtime: {
        status: 'stopped',
        lastStartedAt: runtime.lastStartedAt,
        logPath: runtime.logPath,
        logTail: runtime.logTail,
      } satisfies ProjectRuntimeView,
    }
  }

  async function activateProject(id: string, reason = 'manual activate') {
    const project = await registry.findProject(id)
    const existingRuntime = state.runtimes.get(id)

    if (existingRuntime?.status === 'running') {
      return {
        ...project,
        isActive: true,
        runtime: registry.getProjectRuntime(project),
      }
    }

    const port = await getPort({
      port: 3030,
      random: false,
      portRange: [3030, 4000],
      host: 'localhost',
    })

    const runtime: ActiveRuntime = {
      project,
      port,
      base: `/${project.slug}/`,
      status: 'starting',
      lastStartedAt: timestamp(),
      logPath: getProjectLogPath(project.id),
      logTail: [],
    }

    state.runtimes.set(id, runtime)
    await saveHubState()

    appendRuntimeLog(runtime, `activate requested: ${reason}`)
    appendRuntimeLog(runtime, `internal port ${port}`)
    appendRuntimeLog(runtime, `base path ${runtime.base}`)
    logHub(`activating ${project.id} on internal port ${port} with base ${runtime.base}`)

    const child = spawn(
      process.execPath,
      buildSlidevArgs(runtime),
      {
        cwd: project.dir,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
        },
        // The published Slidev CLI binds keyboard shortcuts on stdin and exits
        // immediately if it is spawned without a live input stream.
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    runtime.process = child
    runtime.pid = child.pid ?? undefined

    child.stdout?.on('data', (chunk) => {
      appendRuntimeLog(runtime, `stdout ${String(chunk).trimEnd()}`)
    })

    child.stderr?.on('data', (chunk) => {
      appendRuntimeLog(runtime, `stderr ${String(chunk).trimEnd()}`)
    })

    child.on('error', (error) => {
      appendRuntimeLog(runtime, `process error: ${error.message}`)
    })

    child.on('exit', (code, signal) => {
      if (runtime.expectedExit)
        return

      appendRuntimeLog(runtime, `runtime exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      logHub(`runtime exited unexpectedly for ${project.id} (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      state.runtimes.delete(id)
      void saveHubState()
    })

    try {
      await waitForRuntimeReady(runtime)
      runtime.status = 'running'
      runtime.error = undefined
      appendRuntimeLog(runtime, `runtime listening on internal port ${port}`)
      logHub(`active runtime ready for ${project.id} at ${runtime.base}`)
    }
    catch (error) {
      runtime.expectedExit = true
      runtime.process?.kill('SIGTERM')
      state.runtimes.delete(id)
      await saveHubState()
      runtime.status = 'error'
      runtime.error = error instanceof Error ? error.message : 'Failed to activate project'
      appendRuntimeLog(runtime, `activation failed: ${runtime.error}`)
      logHub(`failed to activate ${project.id}: ${runtime.error}`)
      throw error
    }

    await registry.updateProjectTimestamp(project.id)

    return {
      ...project,
      isActive: true,
      runtime: registry.getProjectRuntime(project),
    }
  }

  function getRuntimeForPath(pathname: string) {
    for (const runtime of state.runtimes.values()) {
      const prefix = `/${runtime.project.slug}`
      if (pathname === prefix || pathname.startsWith(`${prefix}/`))
        return runtime
    }
    return null
  }

  return {
    activateProject,
    stopProject,
    getRuntimeForPath,
    listActiveProjectIds: () => [...state.runtimes.keys()],
  }
}
