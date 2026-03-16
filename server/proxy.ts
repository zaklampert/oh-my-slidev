import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { logHub } from './logs'
import type { RuntimeController } from './runtime'

const DEFAULT_TIMER_STATE = {
  status: 'stopped',
  slides: {},
  startedAt: 0,
  pausedAt: 0,
} as const

function isServerRefChannel(pathname: string) {
  return pathname === '/@server-reactive'
    || pathname.startsWith('/@server-reactive/')
    || pathname === '/@server-ref'
    || pathname.startsWith('/@server-ref/')
}

function isSlidevEditorEndpoint(pathname: string) {
  return pathname === '/__open-in-editor'
    || pathname === '/__slidev'
    || pathname.startsWith('/__slidev/')
}

function isServerRefWrite(pathname: string, runtimePrefix: string, method: string) {
  return method !== 'GET'
    && method !== 'HEAD'
    && (
      pathname === `${runtimePrefix}/@server-reactive`
      || pathname.startsWith(`${runtimePrefix}/@server-reactive/`)
      || pathname === `${runtimePrefix}/@server-ref`
      || pathname.startsWith(`${runtimePrefix}/@server-ref/`)
    )
}

function isNavWrite(targetPath: string, method: string) {
  return method === 'POST'
    && (targetPath === '/@server-reactive/nav' || targetPath.startsWith('/@server-reactive/nav?'))
}

export function createProxyHandlers(runtime: RuntimeController) {
  async function readRequestBody(request: IncomingMessage) {
    const chunks: Buffer[] = []
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return Buffer.concat(chunks)
  }

  function normalizeNavPayload(body: Buffer) {
    if (!body.length)
      return body

    try {
      const payload = JSON.parse(body.toString('utf8')) as {
        data?: Record<string, any>
      }

      if (!payload.data || typeof payload.data !== 'object')
        return body

      payload.data = {
        clicksTotal: 0,
        timer: { ...DEFAULT_TIMER_STATE },
        ...payload.data,
        timer: {
          ...DEFAULT_TIMER_STATE,
          ...(payload.data.timer && typeof payload.data.timer === 'object' ? payload.data.timer : {}),
        },
      }

      return Buffer.from(JSON.stringify(payload))
    }
    catch {
      return body
    }
  }

  function getRuntimeFromReferer(request: IncomingMessage) {
    const referer = request.headers.referer
    if (!referer)
      return null

    try {
      const refererUrl = new URL(referer)
      return runtime.getRuntimeForPath(refererUrl.pathname)
    }
    catch {
      return null
    }
  }

  function resolveProxyTarget(request: IncomingMessage, pathname: string, search: string, method: string) {
    const canResolveFromReferer = isServerRefChannel(pathname) || isSlidevEditorEndpoint(pathname)

    const targetRuntime = runtime.getRuntimeForPath(pathname)
      ?? (canResolveFromReferer ? getRuntimeFromReferer(request) : null)

    if (!targetRuntime)
      return null

    const runtimePrefix = `/${targetRuntime.project.slug}`
    const targetPath = isServerRefWrite(pathname, runtimePrefix, method)
      ? pathname.slice(runtimePrefix.length) || '/'
      : pathname

    return {
      runtime: targetRuntime,
      path: `${targetPath}${search}`,
    }
  }

  function proxyHttpRequest(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    const method = request.method || 'GET'
    const target = resolveProxyTarget(request, url.pathname, url.search, method)
    if (!target) {
      next()
      return
    }

    const targetPort = target.runtime.port
    logHub(`proxy ${method} ${url.pathname} -> ${target.path} @ ${targetPort}`)
    void (async () => {
      const body = isNavWrite(target.path, method)
        ? normalizeNavPayload(await readRequestBody(request))
        : null

      const proxyReq = httpRequest(
        {
          hostname: 'localhost',
          port: targetPort,
          method,
          path: target.path,
          headers: {
            ...request.headers,
            ...(body
              ? {
                  'content-length': String(body.length),
                }
              : {}),
            host: `localhost:${targetPort}`,
          },
        },
        (proxyRes) => {
          response.writeHead(proxyRes.statusCode || 500, proxyRes.headers)
          proxyRes.pipe(response)
        },
      )

      proxyReq.on('error', (error) => {
        logHub(`proxy error for ${url.pathname}: ${error.message}`)
        response.statusCode = 502
        response.end(`Proxy error: ${error.message}`)
      })

      if (body)
        proxyReq.end(body)
      else
        request.pipe(proxyReq)
    })()
  }

  function handleProxyUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    const target = resolveProxyTarget(request, url.pathname, url.search, request.method || 'GET')
    if (!target)
      return false

    logHub(`proxy upgrade ${url.pathname} -> ${target.path} @ ${target.runtime.port}`)

    const proxyReq = httpRequest({
      hostname: 'localhost',
      port: target.runtime.port,
      path: target.path,
      headers: {
        ...request.headers,
        host: `localhost:${target.runtime.port}`,
      },
    })

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      let headers = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`
      for (const [key, value] of Object.entries(proxyRes.headers))
        headers += `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`
      headers += '\r\n'
      socket.write(headers)
      if (proxyHead.length)
        socket.write(proxyHead)
      if (head.length)
        proxySocket.write(head)
      proxySocket.pipe(socket).pipe(proxySocket)
    })

    proxyReq.on('error', () => {
      socket.destroy()
    })

    proxyReq.end()
    return true
  }

  return {
    proxyHttpRequest,
    handleProxyUpgrade,
  }
}
