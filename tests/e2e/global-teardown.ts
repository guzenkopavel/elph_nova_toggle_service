import type { FullConfig } from '@playwright/test'
import type { E2EServer } from './server-helper'

async function globalTeardown(_config: FullConfig) {
  const server = (globalThis as unknown as Record<string, unknown>).__e2eServer as E2EServer | undefined
  if (server) {
    await server.stop()
  }
}

export default globalTeardown
