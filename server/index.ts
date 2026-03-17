import type { Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ViteDevServer } from 'vite'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import vue from '@vitejs/plugin-vue'
import connect from 'connect'
import sirv from 'sirv'
import { createServer as createViteServer } from 'vite'
import { createApiMiddleware } from './api.js'
import { ensureDataLayout, hubPort, logsRoot, managedProjectsRoot, packageRoot, statePath } from './config.js'
import { logHub } from './logs.js'
import { createProxyHandlers } from './proxy.js'
import { createRegistryController } from './registry.js'
import { createRuntimeController } from './runtime.js'
import { createHubState } from './state.js'
import type { HubStateFile } from './types.js'

const state = createHubState()
let hubViteServer: ViteDevServer | null = null

async function loadHubState(): Promise<HubStateFile> {
  await ensureDataLayout()
  try {
    const raw = await readFile(statePath, 'utf8')
    return JSON.parse(raw) as HubStateFile
  }
  catch {
    return {
      activeProjectId: null,
      activeProjectIds: [],
    }
  }
}

async function saveHubState() {
  const activeProjectIds = [...state.runtimes.keys()]
  await writeFile(statePath, `${JSON.stringify({
    activeProjectId: activeProjectIds[0] ?? null,
    activeProjectIds,
  }, null, 2)}\n`)
}

const registry = createRegistryController(state)
const runtime = createRuntimeController(state, registry, saveHubState)
const proxy = createProxyHandlers(runtime)

function isProduction() {
  return process.env.NODE_ENV === 'production'
}

async function createProductionServer() {
  const app = connect()
  app.use(createApiMiddleware(registry, runtime))
  app.use(proxy.proxyHttpRequest)
  app.use(sirv(`${packageRoot}/dist/client`, { dev: false, single: true }))
  return createServer(app)
}

async function createDevelopmentServer() {
  const app = connect()
  const vite = await createViteServer({
    configFile: false,
    root: packageRoot,
    appType: 'spa',
    plugins: [vue()],
    optimizeDeps: {
      exclude: ['vue'],
      force: true,
    },
    resolve: {
      alias: {
        '@': `${packageRoot}/src`,
        vue: 'vue/dist/vue.esm-bundler.js',
      },
    },
    server: {
      middlewareMode: true,
      hmr: {
        port: hubPort + 1,
        clientPort: hubPort + 1,
      },
    },
  })

  hubViteServer = vite
  app.use(createApiMiddleware(registry, runtime))
  app.use(proxy.proxyHttpRequest)
  app.use(vite.middlewares)

  return createServer(app)
}

async function closeHub() {
  await Promise.all(runtime.listActiveProjectIds().map(id => runtime.stopProject(id, 'hub shutdown', false)))
  await hubViteServer?.close()
}

async function restoreActiveRuntime() {
  const savedState = await loadHubState()
  const activeProjectIds = savedState.activeProjectIds?.length
    ? savedState.activeProjectIds
    : savedState.activeProjectId
      ? [savedState.activeProjectId]
      : []

  if (!activeProjectIds.length)
    return

  for (const projectId of activeProjectIds) {
    try {
      await runtime.activateProject(projectId, 'restore from saved state')
    }
    catch (error) {
      logHub(`failed to restore active runtime ${projectId}: ${error instanceof Error ? error.message : 'unknown error'}`)
      await saveHubState()
    }
  }
}

await ensureDataLayout()
await restoreActiveRuntime()

const server: HttpServer = isProduction()
  ? await createProductionServer()
  : await createDevelopmentServer()

server.on('upgrade', (request, socket, head) => {
  if (proxy.handleProxyUpgrade(request, socket, head))
    return
  socket.destroy()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void closeHub().finally(() => process.exit(0))
  })
}

server.listen(hubPort, () => {
  const origin = `http://localhost:${hubPort}`
  logHub(`${isProduction() ? 'production' : 'development'} server listening on ${origin}`)
  console.log(`Slidev Hub listening on ${origin}`)
  console.log(`State: ${statePath}`)
  console.log(`Managed projects: ${managedProjectsRoot}`)
  console.log(`Logs: ${logsRoot}`)
})

if (!isProduction()) {
  const address = server.address() as AddressInfo | null
  if (address)
    console.log(`  ➜  Local:   http://localhost:${address.port}/`)
}
