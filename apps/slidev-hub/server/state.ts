import type { ActiveRuntime } from './types.js'

export interface HubState {
  runtimes: Map<string, ActiveRuntime>
}

export function createHubState(): HubState {
  return {
    runtimes: new Map(),
  }
}
