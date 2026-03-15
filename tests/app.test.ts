import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from '../src/app'
import type { FastifyInstance } from 'fastify'

describe('app factory', () => {
  let app: FastifyInstance

  afterEach(async () => {
    if (app) {
      await app.close()
    }
  })

  it('instantiates without error', async () => {
    app = await createApp({ logger: false })
    expect(app).toBeDefined()
  })

  it('handles inject request on bare app and returns a response', async () => {
    app = await createApp({ logger: false })
    await app.ready()
    const response = await app.inject({
      method: 'GET',
      url: '/',
    })
    // 404 is expected — no routes registered yet
    expect(response.statusCode).toBe(404)
  })

  it('closes cleanly', async () => {
    app = await createApp({ logger: false })
    await expect(app.close()).resolves.not.toThrow()
    // Prevent double-close in afterEach
    app = undefined as unknown as FastifyInstance
  })
})
