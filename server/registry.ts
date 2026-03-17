import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { ensureDataLayout, managedProjectsRoot, registryPath, slugify, starterSlides } from './config.js'
import { getProjectLogPath, logHub, logProject } from './logs.js'
import type { HubState } from './state.js'
import type { ProjectRecord, ProjectRuntimeView, ProjectView, RegistryFile } from './types.js'

function guessRoutePrefix(entryPath: string) {
  try {
    const content = readFileSync(entryPath, 'utf8')
    return /\brouterMode:\s*hash\b/.test(content) ? '/#/' : '/'
  }
  catch {
    return '/'
  }
}

async function loadRegistry(): Promise<RegistryFile> {
  await ensureDataLayout()
  return JSON.parse(await readFile(registryPath, 'utf8')) as RegistryFile
}

async function saveRegistry(registry: RegistryFile) {
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
}

async function ensureUniqueDir(baseSlug: string) {
  let slug = baseSlug
  let index = 1

  while (existsSync(resolve(managedProjectsRoot, slug))) {
    slug = `${baseSlug}-${index}`
    index += 1
  }

  return slug
}

export interface RegistryController {
  listProjects(externalBaseUrl?: string): Promise<ProjectView[]>
  createManagedProject(name: string, externalBaseUrl?: string): Promise<ProjectView>
  importExistingProject(projectPath: string, externalBaseUrl?: string): Promise<ProjectView>
  findProject(id: string): Promise<ProjectRecord>
  updateProjectTimestamp(id: string): Promise<void>
  getProjectRuntime(project: ProjectRecord, externalBaseUrl?: string): ProjectRuntimeView
}

export function createRegistryController(
  state: HubState,
): RegistryController {
  function getExternalBaseUrl(project: ProjectRecord, externalBaseUrl?: string) {
    const origin = (externalBaseUrl || '').replace(/\/+$/, '')
    if (!origin)
      return undefined
    return `${origin}/${project.slug}/`
  }

  function getProjectRuntime(project: ProjectRecord, externalBaseUrl?: string): ProjectRuntimeView {
    const runtime = state.runtimes.get(project.id)
    if (!runtime) {
      return {
        status: 'stopped',
        logPath: getProjectLogPath(project.id),
        logTail: [],
      }
    }

    const routePrefix = guessRoutePrefix(project.entry)
    const externalBase = getExternalBaseUrl(project, externalBaseUrl)

    return {
      status: runtime.status,
      pid: runtime.pid,
      port: runtime.port,
      lastStartedAt: runtime.lastStartedAt,
      error: runtime.error,
      logPath: runtime.logPath,
      logTail: runtime.logTail,
      url: externalBase,
      presenterUrl: externalBase ? `${externalBase}${routePrefix === '/#/' ? '#/' : ''}presenter/` : undefined,
      overviewUrl: externalBase ? `${externalBase}${routePrefix === '/#/' ? '#/' : ''}overview/` : undefined,
    }
  }

  async function listProjects(externalBaseUrl?: string) {
    const registry = await loadRegistry()
    return registry.projects
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(project => ({
        ...project,
        isActive: state.runtimes.has(project.id),
        runtime: getProjectRuntime(project, externalBaseUrl),
      }))
  }

  async function createManagedProject(name: string, externalBaseUrl?: string) {
    const registry = await loadRegistry()
    const slug = await ensureUniqueDir(slugify(name))
    const dir = resolve(managedProjectsRoot, slug)
    const entry = resolve(dir, 'slides.md')
    const now = new Date().toISOString()

    await mkdir(dir, { recursive: true })
    await writeFile(entry, starterSlides(name))
    await writeFile(resolve(dir, 'README.md'), `# ${name}\n\nManaged by Slidev Hub.\n`)

    const project: ProjectRecord = {
      id: `${slug}-${Date.now()}`,
      name,
      slug,
      dir,
      entry,
      createdAt: now,
      updatedAt: now,
      source: 'managed',
    }

    registry.projects.push(project)
    await saveRegistry(registry)
    logHub(`created managed project ${project.id} at ${project.dir}`)
    logProject(project.id, `project created at ${project.dir}`)

    return {
      ...project,
      isActive: false,
      runtime: getProjectRuntime(project, externalBaseUrl),
    }
  }

  async function importExistingProject(projectPath: string, externalBaseUrl?: string) {
    const registry = await loadRegistry()
    const dir = resolve(projectPath.trim())
    const entry = resolve(dir, 'slides.md')

    if (!existsSync(dir))
      throw new Error(`Directory does not exist: ${dir}`)

    if (!existsSync(entry))
      throw new Error(`Expected slides.md in ${dir}`)

    const duplicate = registry.projects.find(project => project.dir === dir)
    if (duplicate) {
      return {
        ...duplicate,
        isActive: state.runtimes.has(duplicate.id),
        runtime: getProjectRuntime(duplicate, externalBaseUrl),
      }
    }

    const now = new Date().toISOString()
    const project: ProjectRecord = {
      id: `${slugify(basename(dir))}-${Date.now()}`,
      name: basename(dir),
      slug: slugify(basename(dir)),
      dir,
      entry,
      createdAt: now,
      updatedAt: now,
      source: 'external',
    }

    registry.projects.push(project)
    await saveRegistry(registry)
    logHub(`registered external project ${project.id} from ${project.dir}`)
    logProject(project.id, `project registered from ${project.dir}`)

    return {
      ...project,
      isActive: false,
      runtime: getProjectRuntime(project, externalBaseUrl),
    }
  }

  async function findProject(id: string) {
    const registry = await loadRegistry()
    const project = registry.projects.find(entry => entry.id === id)
    if (!project)
      throw new Error(`Unknown project: ${id}`)
    return project
  }

  async function updateProjectTimestamp(id: string) {
    const registry = await loadRegistry()
    const project = registry.projects.find(entry => entry.id === id)
    if (!project)
      return
    project.updatedAt = new Date().toISOString()
    await saveRegistry(registry)
  }

  return {
    listProjects,
    createManagedProject,
    importExistingProject,
    findProject,
    updateProjectTimestamp,
    getProjectRuntime,
  }
}
