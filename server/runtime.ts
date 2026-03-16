import type { SlidevConfig, SlidevData } from '../../slidev/packages/types/index.d.ts'
import equal from 'fast-deep-equal'
import { getPort } from 'get-port-please'
import { createServer as createSlidevServer } from '../../slidev/packages/slidev/node/commands/serve.ts'
import { getThemeMeta } from '../../slidev/packages/slidev/node/integrations/themes.ts'
import { resolveOptions } from '../../slidev/packages/slidev/node/options.ts'
import { parser } from '../../slidev/packages/slidev/node/parser.ts'
import { getProjectLogPath, logHub, logProject } from './logs'
import type { RegistryController } from './registry'
import type { HubState } from './state'
import type { ActiveRuntime, ProjectRuntimeView, ProjectView } from './types'
import { timestamp } from './config'

const CONFIG_RESTART_FIELDS: (keyof SlidevConfig)[] = [
  'monaco',
  'routerMode',
  'fonts',
  'css',
  'mdc',
  'editor',
  'theme',
  'seoMeta',
]

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
      if (clearActiveProject) {
        await saveHubState()
      }
      return null
    }

    clearTimeout(runtime.restartTimer)
    runtime.restartTimer = undefined

    logHub(`stopping active runtime for ${runtime.project.id}: ${reason}`)
    runtime.logTail.push(`stopping active runtime: ${reason}`)
    runtime.logTail = runtime.logTail.slice(-120)
    logProject(runtime.project.id, `stopping active runtime: ${reason}`)

    try {
      await runtime.server?.close()
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

  function scheduleActiveRestart(projectId: string, reason: string) {
    const runtime = state.runtimes.get(projectId)
    if (!runtime)
      return
    clearTimeout(runtime.restartTimer)
    runtime.restartTimer = setTimeout(() => {
      void (async () => {
        const current = state.runtimes.get(projectId)
        if (!current)
          return
        logHub(`restarting active runtime for ${projectId}: ${reason}`)
        current.logTail.push(`restarting active runtime: ${reason}`)
        current.logTail = current.logTail.slice(-120)
        logProject(projectId, `restarting active runtime: ${reason}`)
        await stopProject(projectId, reason, false)
        await activateProject(projectId, `${reason} restart`)
      })()
    }, 500)
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

    logHub(`activating ${project.id} on internal port ${port} with base ${runtime.base}`)
    runtime.logTail.push(`activate requested: ${reason}`, `internal port ${port}`, `base path ${runtime.base}`)
    logProject(project.id, `activate requested: ${reason}`)
    logProject(project.id, `internal port ${port}`)
    logProject(project.id, `base path ${runtime.base}`)

    const options = await resolveOptions({ entry: project.entry, base: runtime.base }, 'dev')
    runtime.options = options

    const slidevServer = await createSlidevServer(
      options,
      {
        server: {
          host: 'localhost',
          port,
          strictPort: true,
        },
        logLevel: 'error',
        base: runtime.base,
      },
      {
        async loadData(loadedSource) {
          const currentRuntime = state.runtimes.get(project.id)
          if (!currentRuntime || !currentRuntime.options)
            return false

          const { data: oldData, entry } = currentRuntime.options
          const loaded = await parser.load(currentRuntime.options.userRoot, entry, loadedSource, 'dev')
          const themeRaw = loaded.headmatter.theme as string || 'default'

          if (currentRuntime.options.themeRaw !== themeRaw) {
            currentRuntime.logTail.push('theme changed, scheduling restart')
            currentRuntime.logTail = currentRuntime.logTail.slice(-120)
            logProject(project.id, 'theme changed, scheduling restart')
            scheduleActiveRestart(project.id, 'theme change')
            return false
          }

          const themeMeta = currentRuntime.options.themeRoots[0] ? await getThemeMeta(themeRaw, currentRuntime.options.themeRoots[0]) : undefined
          const newData: SlidevData = {
            ...loaded,
            themeMeta,
            config: parser.resolveConfig(loaded.headmatter, themeMeta, entry),
          }

          if (CONFIG_RESTART_FIELDS.some(field => !equal(newData.config[field], oldData.config[field]))) {
            currentRuntime.logTail.push('config changed, scheduling restart')
            currentRuntime.logTail = currentRuntime.logTail.slice(-120)
            logProject(project.id, 'config changed, scheduling restart')
            scheduleActiveRestart(project.id, 'config change')
            return false
          }

          if ((newData.features.katex && !oldData.features.katex) || (newData.features.monaco && !oldData.features.monaco)) {
            currentRuntime.logTail.push('feature set changed, scheduling restart')
            currentRuntime.logTail = currentRuntime.logTail.slice(-120)
            logProject(project.id, 'feature set changed, scheduling restart')
            scheduleActiveRestart(project.id, 'feature change')
            return false
          }

          return newData
        },
      },
    )

    runtime.server = slidevServer

    try {
      await slidevServer.listen()
      runtime.status = 'running'
      runtime.error = undefined
      runtime.logTail.push(`runtime listening on internal port ${port}`)
      runtime.logTail = runtime.logTail.slice(-120)
      logProject(project.id, `runtime listening on internal port ${port}`)
      logHub(`active runtime ready for ${project.id} at ${runtime.base}`)
    }
    catch (error) {
      state.runtimes.delete(id)
      await saveHubState()
      runtime.status = 'error'
      runtime.error = error instanceof Error ? error.message : 'Failed to activate project'
      runtime.logTail.push(`activation failed: ${runtime.error}`)
      runtime.logTail = runtime.logTail.slice(-120)
      logProject(project.id, `activation failed: ${runtime.error}`)
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
