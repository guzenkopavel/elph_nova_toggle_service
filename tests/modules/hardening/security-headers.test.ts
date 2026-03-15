import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { HardeningTestContext } from './helpers'
import { buildHardeningApp } from './helpers'

// ─── Security header tests ────────────────────────────────────────────────────
//
// Helmet is registered globally via fastify-plugin (breaks encapsulation),
// so headers are applied to ALL routes.

describe('Security headers (helmet)', () => {
  let ctx: HardeningTestContext

  beforeAll(async () => {
    ctx = await buildHardeningApp()
  })

  afterAll(async () => {
    await ctx.close()
  })

  // SH1: x-content-type-options: nosniff on public endpoint
  it('SH1: public endpoint has x-content-type-options: nosniff', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  // SH2: x-frame-options on public endpoint
  it('SH2: public endpoint has x-frame-options header', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
    })
    expect(res.statusCode).toBe(200)
    // helmet sets x-frame-options: SAMEORIGIN by default
    expect(res.headers['x-frame-options']).toBeDefined()
  })

  // SH3: x-content-type-options on admin API endpoint
  it('SH3: admin API endpoint has x-content-type-options: nosniff', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/admin/api/rules',
      headers: { Authorization: 'Bearer viewer-token' },
    })
    // Auth is required — 200 because buildHardeningApp uses viewerVerifier for admin
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  // SH4: referrer-policy header present on public endpoint
  it('SH4: public endpoint has referrer-policy header', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['referrer-policy']).toBeDefined()
  })

  // SH5: health endpoint also has security headers (helmet is global)
  it('SH5: health endpoint has x-content-type-options: nosniff', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health/live',
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})
