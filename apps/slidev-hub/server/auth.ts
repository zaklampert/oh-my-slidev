import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { Connect } from 'vite'
import { basicAuthEnabled, basicAuthPassword, basicAuthUsername } from './config.js'

const authRealm = 'slidev-hub'

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length)
    return false

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function parseBasicAuth(header: string | undefined) {
  if (!header?.startsWith('Basic '))
    return null

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const separatorIndex = decoded.indexOf(':')
    if (separatorIndex < 0)
      return null

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    }
  }
  catch {
    return null
  }
}

export function isApiAuthorized(request: IncomingMessage) {
  if (!basicAuthEnabled)
    return true

  const credentials = parseBasicAuth(request.headers.authorization)
  if (!credentials)
    return false

  return safeEqual(credentials.username, basicAuthUsername) && safeEqual(credentials.password, basicAuthPassword)
}

export function sendAuthChallenge(response: ServerResponse) {
  response.statusCode = 401
  response.setHeader('WWW-Authenticate', `Basic realm="${authRealm}", charset="UTF-8"`)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ error: 'Authentication required' }))
}

export function createApiAuthMiddleware(): Connect.NextHandleFunction {
  return (request, response, next) => {
    const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : ''

    if (!pathname.startsWith('/api/')) {
      next()
      return
    }

    if (pathname === '/api/health') {
      next()
      return
    }

    if (isApiAuthorized(request)) {
      next()
      return
    }

    sendAuthChallenge(response)
  }
}
