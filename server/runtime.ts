import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, relative } from 'node:path'
import process from 'node:process'
import { getPort } from 'get-port-please'
import { getProjectLogPath, logHub, logProject } from './logs.js'
import type { RegistryController } from './registry.js'
import type { HubState } from './state.js'
import type { ActiveRuntime, ProjectRuntimeView, ProjectView } from './types.js'
import { packageRoot, publicBaseUrl, runtimeRoot, slidevHubEditorAddonRoot, timestamp } from './config.js'
import YAML from 'yaml'

const require = createRequire(import.meta.url)
const slidevCliPath = require.resolve('@slidev/cli/bin/slidev.mjs')
const STARTUP_TIMEOUT_MS = 20_000
const HEALTHCHECK_INTERVAL_MS = 250
const runtimePackageNodeModulesPath = resolve(packageRoot, 'node_modules')
const publicBaseHost = publicBaseUrl
  ? (() => {
      try {
        return new URL(publicBaseUrl).hostname
      }
      catch {
        return undefined
      }
    })()
  : undefined

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
  const args = [
    slidevCliPath,
    runtime.entry,
    '--port',
    String(runtime.port),
    '--base',
    runtime.base,
    '--log',
    'error',
  ]

  if (publicBaseUrl) {
    args.push('--remote')
    args.push('--bind')
    args.push('0.0.0.0')
  }

  return args
}

function toPosixPath(path: string) {
  return path.replace(/\\/g, '/')
}

function resolveDeckLocalSpecifier(specifier: string, projectDir: string) {
  if (!specifier)
    return specifier
  if (specifier.startsWith('/'))
    return specifier
  if (specifier.startsWith('@/'))
    return resolve(projectDir, specifier.slice(2))
  if (specifier.startsWith('.') || (!specifier.startsWith('@') && specifier.includes('/')))
    return resolve(projectDir, specifier)
  return specifier
}

function extractFrontmatter(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n'))
    return {}

  const end = normalized.indexOf('\n---\n', 4)
  if (end === -1)
    return {}

  try {
    return (YAML.parse(normalized.slice(4, end)) as Record<string, unknown> | null) ?? {}
  }
  catch {
    return {}
  }
}

async function readOriginalSlidevAddons(projectDir: string) {
  const packageJsonPath = resolve(projectDir, 'package.json')
  if (!existsSync(packageJsonPath))
    return []

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      slidev?: {
        addons?: string[]
      }
    }
    return Array.isArray(packageJson.slidev?.addons)
      ? packageJson.slidev.addons.map(addon => resolveDeckLocalSpecifier(addon, projectDir))
      : []
  }
  catch {
    return []
  }
}

async function ensureNodeModulesLink(wrapperDir: string, projectDir: string) {
  const wrapperNodeModulesPath = resolve(wrapperDir, 'node_modules')
  const preferredTarget = existsSync(resolve(projectDir, 'node_modules'))
    ? resolve(projectDir, 'node_modules')
    : runtimePackageNodeModulesPath

  try {
    const stats = await lstat(wrapperNodeModulesPath)
    if (stats.isSymbolicLink()) {
      const currentTarget = await readlink(wrapperNodeModulesPath)
      if (resolve(wrapperDir, currentTarget) === preferredTarget)
        return
    }
    if (stats.isDirectory())
      await rm(wrapperNodeModulesPath, { recursive: true, force: true })
    else
      await unlink(wrapperNodeModulesPath)
  }
  catch {
    // No existing node_modules entry to replace.
  }

  await symlink(preferredTarget, wrapperNodeModulesPath)
}

async function ensureRuntimeWorkspace(project: ProjectView | ActiveRuntime['project']) {
  const wrapperDir = resolve(runtimeRoot, project.slug)
  await mkdir(wrapperDir, { recursive: true })

  const source = await readFile(project.entry, 'utf8')
  const headmatter = extractFrontmatter(source)
  const wrapperHeadmatter: Record<string, unknown> = {
    ...headmatter,
  }

  if (typeof wrapperHeadmatter.theme === 'string')
    wrapperHeadmatter.theme = resolveDeckLocalSpecifier(wrapperHeadmatter.theme, project.dir)

  if (Array.isArray(wrapperHeadmatter.addons)) {
    wrapperHeadmatter.addons = wrapperHeadmatter.addons
      .map(value => typeof value === 'string' ? resolveDeckLocalSpecifier(value, project.dir) : value)
  }

  delete wrapperHeadmatter.src
  wrapperHeadmatter.editor = true
  wrapperHeadmatter.src = toPosixPath(relative(wrapperDir, project.entry) || 'slides.md')

  const wrapperSlidesPath = resolve(wrapperDir, 'slides.md')
  await writeFile(wrapperSlidesPath, `---\n${YAML.stringify(wrapperHeadmatter).trimEnd()}\n---\n`)

  const projectAddons = await readOriginalSlidevAddons(project.dir)
  const wrapperPackageJson = {
    name: `slidev-hub-runtime-${project.slug}`,
    private: true,
    type: 'module',
    slidev: {
      addons: [...new Set([...projectAddons, slidevHubEditorAddonRoot])],
    },
  }
  await writeFile(resolve(wrapperDir, 'package.json'), `${JSON.stringify(wrapperPackageJson, null, 2)}\n`)
  await ensureNodeModulesLink(wrapperDir, project.dir)

  return {
    entry: wrapperSlidesPath,
    wrapperDir,
  }
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
    const workspace = await ensureRuntimeWorkspace(project)

    const runtime: ActiveRuntime = {
      project,
      entry: workspace.entry,
      wrapperDir: workspace.wrapperDir,
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
    appendRuntimeLog(runtime, `runtime entry ${runtime.entry}`)
    logHub(`activating ${project.id} on internal port ${port} with base ${runtime.base}`)

    const child = spawn(
      process.execPath,
      buildSlidevArgs(runtime),
      {
        cwd: runtime.wrapperDir,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          ...(publicBaseHost ? { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: publicBaseHost } : {}),
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
