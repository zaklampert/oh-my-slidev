import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { getProjectLogPath, hubLogPath, logHub, readLogTail } from './logs.js'
import type { RegistryController } from './registry.js'
import type { RuntimeController } from './runtime.js'

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload))
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolveBody, rejectBody) => {
    const parts: Uint8Array[] = []
    request.on('data', chunk => parts.push(chunk))
    request.on('end', () => resolveBody(Buffer.concat(parts).toString('utf8')))
    request.on('error', rejectBody)
  })
}

export function createApiMiddleware(
  registry: RegistryController,
  runtime: RuntimeController,
): Connect.NextHandleFunction {
  const getActiveProjectIds = () => runtime.listActiveProjectIds()
  const getActiveProjectId = () => getActiveProjectIds()[0] ?? null

  async function handleApi(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    const { pathname } = url
    logHub(`${request.method || 'GET'} ${pathname}`)

    if (request.method === 'GET' && pathname === '/api/projects') {
      sendJson(response, 200, {
        activeProjectId: getActiveProjectId(),
        activeProjectIds: getActiveProjectIds(),
        projects: await registry.listProjects(),
      })
      return true
    }

    if (request.method === 'GET' && pathname === '/api/logs/hub') {
      sendJson(response, 200, {
        path: hubLogPath,
        lines: await readLogTail(hubLogPath, Number(url.searchParams.get('lines') || '200')),
      })
      return true
    }

    if (request.method === 'POST' && pathname === '/api/projects') {
      const body = JSON.parse(await readBody(request) || '{}') as { name?: string }
      if (!body.name?.trim())
        throw new Error('Project name is required')
      sendJson(response, 200, { project: await registry.createManagedProject(body.name.trim()) })
      return true
    }

    if (request.method === 'POST' && pathname === '/api/projects/import') {
      const body = JSON.parse(await readBody(request) || '{}') as { path?: string }
      if (!body.path?.trim())
        throw new Error('Project path is required')
      sendJson(response, 200, { project: await registry.importExistingProject(body.path.trim()) })
      return true
    }

    const activateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activate$/)
    if (request.method === 'POST' && activateMatch) {
      sendJson(response, 200, { project: await runtime.activateProject(activateMatch[1]) })
      return true
    }

    const startMatch = pathname.match(/^\/api\/projects\/([^/]+)\/start$/)
    if (request.method === 'POST' && startMatch) {
      sendJson(response, 200, { project: await runtime.activateProject(startMatch[1]) })
      return true
    }

    const deactivateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/deactivate$/)
    if (request.method === 'POST' && deactivateMatch) {
      const id = deactivateMatch[1]
      await runtime.stopProject(id, 'manual deactivate', true)
      const project = await registry.findProject(id)
      sendJson(response, 200, {
        project: {
          ...project,
          isActive: false,
          runtime: registry.getProjectRuntime(project),
        },
      })
      return true
    }

    const stopMatch = pathname.match(/^\/api\/projects\/([^/]+)\/stop$/)
    if (request.method === 'POST' && stopMatch) {
      const id = stopMatch[1]
      await runtime.stopProject(id, 'manual stop', true)
      const project = await registry.findProject(id)
      sendJson(response, 200, {
        project: {
          ...project,
          isActive: false,
          runtime: registry.getProjectRuntime(project),
        },
      })
      return true
    }

    const logMatch = pathname.match(/^\/api\/projects\/([^/]+)\/logs$/)
    if (request.method === 'GET' && logMatch) {
      const project = await registry.findProject(logMatch[1])
      sendJson(response, 200, {
        path: getProjectLogPath(project.id),
        lines: await readLogTail(getProjectLogPath(project.id), Number(url.searchParams.get('lines') || '200')),
      })
      return true
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Not found' })
      return true
    }

    return false
  }

  return (request, response, next) => {
    void (async () => {
      try {
        const handled = await handleApi(request, response)
        if (!handled)
          next()
      }
      catch (error) {
        logHub(`api error ${(request.method || 'GET')} ${request.url || '/'}: ${error instanceof Error ? error.message : 'unknown error'}`)
        sendJson(response, 500, { error: error instanceof Error ? error.message : 'Internal server error' })
      }
    })()
  }
}
