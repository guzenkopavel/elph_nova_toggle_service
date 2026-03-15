import { describe, it, expect, afterEach } from 'vitest'
import type { HardeningTestContext } from './helpers'
import { buildHardeningApp } from './helpers'

// ─── Rate limit tests ─────────────────────────────────────────────────────────
//
// These tests use very low limits (max 3 for public, max 2 for admin) to trigger
// 429 responses without making hundreds of requests.
//
// Fastify inject() uses '127.0.0.1' as the remote address.
// All requests within one test share that key, so the bucket fills as expected.

describe('Rate limiting', () => {
  let ctx: HardeningTestContext | undefined

  afterEach(async () => {
    if (ctx) {
      await ctx.close()
      ctx = undefined
    }
  })

  // RL1: first N public requests within limit → 200
  it('RL1: first 3 public requests → 200', async () => {
    ctx = await buildHardeningApp({
      rateLimits: { enabled: true, publicMax: 3, publicWindow: 60_000, adminMax: 100, adminWindow: 60_000 },
    })

    for (let i = 0; i < 3; i++) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
      })
      expect(res.statusCode).toBe(200)
    }
  })

  // RL2: 4th public request exceeds limit → 429 with retry-after
  it('RL2: 4th public request → 429 with retry-after header', async () => {
    ctx = await buildHardeningApp({
      rateLimits: { enabled: true, publicMax: 3, publicWindow: 60_000, adminMax: 100, adminWindow: 60_000 },
    })

    // Exhaust public limit
    for (let i = 0; i < 3; i++) {
      await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
      })
    }

    // 4th request should be rate limited
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
    })
    expect(res.statusCode).toBe(429)
    // Retry-After header should be present
    const retryAfter = res.headers['retry-after'] ?? res.headers['x-ratelimit-reset']
    expect(retryAfter).toBeDefined()
  })

  // RL3: first 2 admin requests → 200, 3rd → 429
  it('RL3: first 2 admin requests → 200, 3rd → 429', async () => {
    ctx = await buildHardeningApp({
      rateLimits: { enabled: true, publicMax: 100, publicWindow: 60_000, adminMax: 2, adminWindow: 60_000 },
    })

    for (let i = 0; i < 2; i++) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
    }

    // 3rd admin request should be rate limited
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/admin/api/rules',
      headers: { Authorization: 'Bearer viewer-token' },
    })
    expect(res.statusCode).toBe(429)
  })

  // RL4: public limit and admin limit are separate — exhausting one does not affect the other
  it('RL4: exhausting public limit does not affect admin (separate rate limit keys)', async () => {
    ctx = await buildHardeningApp({
      rateLimits: { enabled: true, publicMax: 2, publicWindow: 60_000, adminMax: 10, adminWindow: 60_000 },
    })

    // Exhaust public limit
    for (let i = 0; i < 2; i++) {
      await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
      })
    }

    // Next public request → 429
    const publicLimited = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: { Platform: 'ios', AppName: 'ElphNova', AppVersion: '1.0.0' },
    })
    expect(publicLimited.statusCode).toBe(429)

    // Admin should still succeed (different rate limit key via route config timeWindow/max)
    const adminRes = await ctx.app.inject({
      method: 'GET',
      url: '/admin/api/rules',
      headers: { Authorization: 'Bearer viewer-token' },
    })
    expect(adminRes.statusCode).toBe(200)
  })
})
