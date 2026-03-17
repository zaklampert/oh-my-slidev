import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import { logHub } from './logs.js'
import type { RuntimeController } from './runtime.js'

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

function isSlidevVirtualModule(pathname: string, runtimePrefix: string) {
  return pathname === `${runtimePrefix}/@slidev`
    || pathname.startsWith(`${runtimePrefix}/@slidev/`)
}

function isRootSlidevVirtualModule(pathname: string) {
  return pathname === '/@slidev'
    || pathname.startsWith('/@slidev/')
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
  function isHashRouter(runtimeEntry: string) {
    try {
      return /\brouterMode:\s*hash\b/.test(readFileSync(runtimeEntry, 'utf8'))
    }
    catch {
      return false
    }
  }

  function getExternalHost(request: IncomingMessage, targetPort: number) {
    return request.headers['x-forwarded-host']?.toString().split(',')[0]?.trim()
      || request.headers.host
      || `localhost:${targetPort}`
  }

  function getForwardedHeaders(request: IncomingMessage, targetPort: number) {
    const host = getExternalHost(request, targetPort)
    const forwardedHost = request.headers['x-forwarded-host']?.toString().split(',')[0]?.trim() || host
    const forwardedProto = request.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim() || 'http'

    return {
      ...request.headers,
      host,
      'x-forwarded-host': forwardedHost,
      'x-forwarded-proto': forwardedProto,
      'x-forwarded-port': request.headers['x-forwarded-port']?.toString().split(',')[0]?.trim() || '',
    }
  }

  function shouldRewriteViteClient(targetPath: string, method: string) {
    return method === 'GET' && (targetPath === '/@vite/client' || targetPath.endsWith('/@vite/client'))
  }

  function shouldRewriteSlidevEnvModule(targetPath: string, method: string) {
    return method === 'GET' && targetPath.includes('/@slidev/client/env.ts')
  }

  function rewriteViteClient(body: Buffer, request: IncomingMessage, targetPort: number, runtimeBase: string) {
    const externalHost = getExternalHost(request, targetPort)
    const hostWithBase = `${externalHost}${runtimeBase}`
    const rewritten = body.toString('utf8')
      .replace(/const serverHost = ".*?";/, `const serverHost = "${hostWithBase}";`)
      .replace(/const directSocketHost = ".*?";/, `const directSocketHost = "${hostWithBase}";`)

    return Buffer.from(rewritten)
  }

  function rewriteSlidevEnvModule(body: Buffer, targetRuntime: { project: { entry: string } }) {
    const hashRoute = isHashRouter(targetRuntime.project.entry)
    const rewritten = body.toString('utf8')
      .replace(/\b__DEV__\b/g, 'true')
      .replace(/\b__SLIDEV_HASH_ROUTE__\b/g, hashRoute ? 'true' : 'false')

    return Buffer.from(rewritten)
  }

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

      const timer = {
        ...DEFAULT_TIMER_STATE,
        ...(payload.data.timer && typeof payload.data.timer === 'object' ? payload.data.timer : {}),
      }

      payload.data = {
        clicksTotal: 0,
        timer,
        ...payload.data,
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
    const canResolveFromReferer = isServerRefChannel(pathname)
      || isSlidevEditorEndpoint(pathname)
      || isRootSlidevVirtualModule(pathname)

    const targetRuntime = runtime.getRuntimeForPath(pathname)
      ?? (canResolveFromReferer ? getRuntimeFromReferer(request) : null)

    if (!targetRuntime)
      return null

    const runtimePrefix = `/${targetRuntime.project.slug}`
    let targetPath = pathname

    if (isServerRefWrite(pathname, runtimePrefix, method)) {
      targetPath = pathname.slice(runtimePrefix.length) || '/'
    }
    else if (isRootSlidevVirtualModule(pathname)) {
      targetPath = `${runtimePrefix}${pathname}`
    }
    else if (isSlidevVirtualModule(pathname, runtimePrefix)) {
      targetPath = pathname
    }

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
            ...getForwardedHeaders(request, targetPort),
            ...(body
              ? {
                  'content-length': String(body.length),
                }
              : {}),
          },
        },
        (proxyRes) => {
          if (shouldRewriteViteClient(target.path, method)) {
            const chunks: Buffer[] = []
            proxyRes.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
            proxyRes.on('end', () => {
              const rewrittenBody = rewriteViteClient(Buffer.concat(chunks), request, targetPort, target.runtime.base)
              response.writeHead(proxyRes.statusCode || 500, {
                ...proxyRes.headers,
                'content-length': String(rewrittenBody.length),
              })
              response.end(rewrittenBody)
            })
            return
          }

          if (shouldRewriteSlidevEnvModule(target.path, method)) {
            const chunks: Buffer[] = []
            proxyRes.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
            proxyRes.on('end', () => {
              const rewrittenBody = rewriteSlidevEnvModule(Buffer.concat(chunks), target.runtime)
              response.writeHead(proxyRes.statusCode || 500, {
                ...proxyRes.headers,
                'content-length': String(rewrittenBody.length),
              })
              response.end(rewrittenBody)
            })
            return
          }

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
      headers: getForwardedHeaders(request, target.runtime.port),
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
