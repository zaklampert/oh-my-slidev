import type { ActiveRuntime } from './types'

export interface HubState {
  runtimes: Map<string, ActiveRuntime>
}

export function createHubState(): HubState {
  return {
    runtimes: new Map(),
  }
}
