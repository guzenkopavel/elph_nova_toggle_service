import { startE2EServer } from './server-helper'
import type { E2EServer } from './server-helper'
import type { FullConfig } from '@playwright/test'

let serverInstance: E2EServer | null = null

async function globalSetup(_config: FullConfig) {
  serverInstance = await startE2EServer()
  // Store the stop function so teardown can access it
  ;(globalThis as unknown as Record<string, unknown>).__e2eServer = serverInstance
}

export default globalSetup
