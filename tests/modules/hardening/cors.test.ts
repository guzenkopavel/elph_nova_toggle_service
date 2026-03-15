import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HardeningTestContext } from './helpers'
import { buildHardeningApp } from './helpers'

// ─── CORS tests ───────────────────────────────────────────────────────────────
//
// CORS is registered globally with a delegator that restricts it to /api/* paths.
// Admin routes (/admin/*) never receive CORS headers.

describe('CORS', () => {
  let ctx: HardeningTestContext

  beforeAll(async () => {
    ctx = await buildHardeningApp({
      env: {
        CORS_ALLOWED_ORIGINS: 'https://allowed.example.com',
        LOG_LEVEL: 'silent',
        TRUST_PROXY: false,
        RATE_LIMIT_PUBLIC_MAX: 300,
        RATE_LIMIT_ADMIN_MAX: 100,
      },
    })
  })

  afterAll(async () => {
    await ctx.close()
  })

  // CORS1: OPTIONS on public endpoint with allowed origin → CORS headers present
  it('CORS1: OPTIONS /api/v1/feature-config with allowed origin → Access-Control-Allow-Origin set', async () => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/feature-config',
      headers: {
        Origin: 'https://allowed.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })
    // OPTIONS preflight returns 204 with CORS headers
    expect([200, 204]).toContain(res.statusCode)
    expect(res.headers['access-control-allow-origin']).toBe('https://allowed.example.com')
  })

  // CORS2: OPTIONS on public endpoint with disallowed origin → no Access-Control-Allow-Origin
  it('CORS2: OPTIONS with disallowed origin → no Access-Control-Allow-Origin', async () => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/feature-config',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  // CORS3: OPTIONS without Origin header → no crash
  // @fastify/cors v8 strictPreflight returns 400 when Origin is absent on OPTIONS
  it('CORS3: OPTIONS without Origin header → no crash (200, 204, 400, or 404)', async () => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/feature-config',
      headers: {
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect([200, 204, 400, 404]).toContain(res.statusCode)
  })

  // CORS4: GET admin API with allowed Origin → no Access-Control-Allow-Origin
  it('CORS4: GET /admin/api/rules with allowed Origin → no CORS header on admin route', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/admin/api/rules',
      headers: {
        Authorization: 'Bearer viewer-token',
        Origin: 'https://allowed.example.com',
      },
    })
    // Admin route succeeds (viewer auth) but must NOT include CORS headers
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  // CORS5: GET /api/v1/feature-config with allowed origin → Access-Control-Allow-Origin present
  it('CORS5: GET /api/v1/feature-config with allowed origin → Access-Control-Allow-Origin present', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'ios',
        AppName: 'ElphNova',
        AppVersion: '1.0.0',
        Origin: 'https://allowed.example.com',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('https://allowed.example.com')
  })
})

// ─── CORS disabled when no origins configured ─────────────────────────────────

describe('CORS (no origins configured)', () => {
  let ctx: HardeningTestContext

  beforeAll(async () => {
    // No CORS_ALLOWED_ORIGINS — cors plugin is not registered
    ctx = await buildHardeningApp()
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('CORS6: no Access-Control-Allow-Origin when CORS not configured', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'ios',
        AppName: 'ElphNova',
        AppVersion: '1.0.0',
        Origin: 'https://allowed.example.com',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
