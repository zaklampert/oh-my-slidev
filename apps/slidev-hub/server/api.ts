import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import type { HubAgentController, SendMessageInput } from './agent.js'
import { publicBaseUrl } from './config.js'
import { getProjectLogPath, hubLogPath, logHub, readLogTail } from './logs.js'
import type { RegistryController } from './registry.js'
import type { RuntimeController } from './runtime.js'

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload))
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function sendHtml(response: ServerResponse, status: number, html: string) {
  response.statusCode = status
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(html)
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolveBody, rejectBody) => {
    const parts: Uint8Array[] = []
    request.on('data', chunk => parts.push(chunk))
    request.on('end', () => resolveBody(Buffer.concat(parts).toString('utf8')))
    request.on('error', rejectBody)
  })
}

function getExternalBaseUrl(request: IncomingMessage) {
  if (publicBaseUrl)
    return publicBaseUrl

  const proto = request.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim()
    || 'http'
  const host = request.headers['x-forwarded-host']?.toString().split(',')[0]?.trim()
    || request.headers.host

  return host ? `${proto}://${host}` : ''
}

export function createApiMiddleware(
  registry: RegistryController,
  runtime: RuntimeController,
  agent: HubAgentController,
): Connect.NextHandleFunction {
  const getActiveProjectIds = () => runtime.listActiveProjectIds()
  const getActiveProjectId = () => getActiveProjectIds()[0] ?? null

  async function handleApi(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    const { pathname } = url
    const externalBaseUrl = getExternalBaseUrl(request)
    logHub(`${request.method || 'GET'} ${pathname}`)

    if (request.method === 'GET' && pathname === '/api/auth/check') {
      sendJson(response, 200, { ok: true })
      return true
    }

    if (request.method === 'GET' && pathname === '/api/auth/prompt') {
      const returnTo = url.searchParams.get('returnTo') || '/'
      sendHtml(response, 200, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0;url=${escapeHtml(returnTo)}">
    <title>slidev-hub auth</title>
  </head>
  <body>
    <script>window.location.replace(${JSON.stringify(returnTo)})</script>
  </body>
</html>`)
      return true
    }

    if (request.method === 'GET' && pathname === '/api/projects') {
      sendJson(response, 200, {
        activeProjectId: getActiveProjectId(),
        activeProjectIds: getActiveProjectIds(),
        projects: await registry.listProjects(externalBaseUrl),
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
      sendJson(response, 200, { project: await registry.createManagedProject(body.name.trim(), externalBaseUrl) })
      return true
    }

    if (request.method === 'POST' && pathname === '/api/projects/import') {
      const body = JSON.parse(await readBody(request) || '{}') as { path?: string }
      if (!body.path?.trim())
        throw new Error('Project path is required')
      sendJson(response, 200, { project: await registry.importExistingProject(body.path.trim(), externalBaseUrl) })
      return true
    }

    if (request.method === 'POST' && pathname === '/api/agent/projects/attach') {
      const body = JSON.parse(await readBody(request) || '{}') as { projectId?: string }
      if (!body.projectId?.trim())
        throw new Error('Project ID is required')
      sendJson(response, 200, { project: await agent.attachProject(body.projectId.trim()) })
      return true
    }

    const agentProjectMatch = pathname.match(/^\/api\/agent\/projects\/([^/]+)$/)
    if (request.method === 'GET' && agentProjectMatch) {
      sendJson(response, 200, { project: await agent.getProject(agentProjectMatch[1]) })
      return true
    }

    const agentThreadMatch = pathname.match(/^\/api\/agent\/projects\/([^/]+)\/thread$/)
    if (request.method === 'GET' && agentThreadMatch) {
      sendJson(response, 200, { thread: await agent.getThread(agentThreadMatch[1]) })
      return true
    }

    const agentChangesMatch = pathname.match(/^\/api\/agent\/projects\/([^/]+)\/changes$/)
    if (request.method === 'GET' && agentChangesMatch) {
      sendJson(response, 200, { changes: await agent.listChanges(agentChangesMatch[1]) })
      return true
    }

    const agentStatusMatch = pathname.match(/^\/api\/agent\/projects\/([^/]+)\/status$/)
    if (request.method === 'GET' && agentStatusMatch) {
      sendJson(response, 200, { status: await agent.getStatus(agentStatusMatch[1]) })
      return true
    }

    const agentMessageMatch = pathname.match(/^\/api\/agent\/projects\/([^/]+)\/messages$/)
    if (request.method === 'POST' && agentMessageMatch) {
      const body = JSON.parse(await readBody(request) || '{}') as SendMessageInput
      if (!body.text?.trim())
        throw new Error('Message text is required')
      sendJson(response, 200, {
        thread: await agent.sendMessage(agentMessageMatch[1], {
          ...body,
          text: body.text.trim(),
        }),
      })
      return true
    }

    const agentEventsMatch = pathname.match(/^\/api\/agent\/projects\/([^/]+)\/events$/)
    if (request.method === 'GET' && agentEventsMatch) {
      agent.stream(agentEventsMatch[1], response)
      return true
    }

    const activateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activate$/)
    if (request.method === 'POST' && activateMatch) {
      const project = await runtime.activateProject(activateMatch[1])
      sendJson(response, 200, {
        project: {
          ...project,
          runtime: registry.getProjectRuntime(project, externalBaseUrl),
        },
      })
      return true
    }

    const startMatch = pathname.match(/^\/api\/projects\/([^/]+)\/start$/)
    if (request.method === 'POST' && startMatch) {
      const project = await runtime.activateProject(startMatch[1])
      sendJson(response, 200, {
        project: {
          ...project,
          runtime: registry.getProjectRuntime(project, externalBaseUrl),
        },
      })
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
          runtime: registry.getProjectRuntime(project, externalBaseUrl),
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
          runtime: registry.getProjectRuntime(project, externalBaseUrl),
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
