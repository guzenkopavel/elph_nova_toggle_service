import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from '../src/app'
import { ManifestRegistry } from '../src/modules/manifest/registry'
import type { FastifyInstance } from 'fastify'

describe('health routes', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    const instance = app
    app = undefined
    if (instance) {
      await instance.close()
    }
  })

  describe('GET /health/live', () => {
    it('returns 200 with status ok', async () => {
      app = await createApp({ logger: false })
      await app.ready()
      const response = await app.inject({ method: 'GET', url: '/health/live' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok' })
    })

    it('returns 200 regardless of any ready check state', async () => {
      const failingCheck = async () => { throw new Error('DB is down') }
      app = await createApp({ logger: false, readyChecks: [failingCheck] })
      await app.ready()
      const response = await app.inject({ method: 'GET', url: '/health/live' })
      // live is always 200 — it never depends on checks
      expect(response.statusCode).toBe(200)
    })
  })

  describe('GET /health/ready', () => {
    it('returns 200 when no checks are registered (scaffold)', async () => {
      // NOTE: This is a scaffold test. When Tasks 4-5 add DB/manifest checks,
      // this test must be updated to wire in those checks.
      app = await createApp({ logger: false })
      await app.ready()
      const response = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok' })
    })

    it('returns 503 when a ready check fails', async () => {
      const failingCheck = async () => { throw new Error('DB is down') }
      app = await createApp({ logger: false, readyChecks: [failingCheck] })
      await app.ready()
      const response = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(response.statusCode).toBe(503)
      const body = response.json()
      expect(body.status).toBe('error')
      expect(body.errors).toHaveLength(1)
    })

    it('returns 200 when all ready checks pass', async () => {
      const passingCheck = async () => { /* no-op */ }
      app = await createApp({ logger: false, readyChecks: [passingCheck] })
      await app.ready()
      const response = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(response.statusCode).toBe(200)
    })

    it('returns 503 when manifest registry not loaded', async () => {
      const registry = new ManifestRegistry() // not loaded
      app = await createApp({ logger: false, manifestRegistry: registry })
      await app.ready()
      const response = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(response.statusCode).toBe(503)
      const body = response.json()
      expect(body.status).toBe('error')
      expect(body.errors[0]).toContain('not loaded')
    })

    it('returns 200 when manifest registry is loaded', async () => {
      const registry = new ManifestRegistry()
      registry.load([], 'abc123') // empty but "loaded"
      app = await createApp({ logger: false, manifestRegistry: registry })
      await app.ready()
      const response = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(response.statusCode).toBe(200)
    })
  })
})
