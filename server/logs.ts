import { appendFile, readFile } from 'node:fs/promises'
import { hubLogPath, ensureDataLayout, projectsLogsRoot, timestamp } from './config.js'

let writeQueue = Promise.resolve()

function formatLogLine(scope: string, message: string) {
  return `[${timestamp()}] [${scope}] ${message}\n`
}

function queueWrite(path: string, line: string) {
  writeQueue = writeQueue
    .then(async () => {
      await ensureDataLayout()
      await appendFile(path, line)
    })
    .catch(() => {})
}

export function getProjectLogPath(projectId: string) {
  return `${projectsLogsRoot}/${projectId}.log`
}

export function logHub(message: string) {
  queueWrite(hubLogPath, formatLogLine('hub', message))
}

export function logProject(projectId: string, message: string) {
  queueWrite(getProjectLogPath(projectId), formatLogLine(`project:${projectId}`, message))
}

export async function readLogTail(path: string, lines = 200) {
  try {
    const content = await readFile(path, 'utf8')
    return content.split(/\r?\n/).filter(Boolean).slice(-lines)
  }
  catch {
    return []
  }
}

export { hubLogPath }
