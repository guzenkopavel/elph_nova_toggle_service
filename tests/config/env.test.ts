import { describe, it, expect } from 'vitest'
import { parseEnv } from '../../src/config/env'

describe('parseEnv', () => {
  it('parses with all defaults when only required fields provided', () => {
    const env = parseEnv({})
    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBe(3000)
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.DATABASE_URL).toBe('sqlite:./data/feature-config.db')
  })

  it('coerces PORT from string to number', () => {
    const env = parseEnv({ PORT: '8080' })
    expect(env.PORT).toBe(8080)
  })

  it('throws on invalid PORT type', () => {
    expect(() => parseEnv({ PORT: 'not-a-number' })).toThrow()
  })

  it('throws on invalid NODE_ENV value', () => {
    expect(() => parseEnv({ NODE_ENV: 'unknown' })).toThrow()
  })

  it('throws on invalid LOG_LEVEL value', () => {
    expect(() => parseEnv({ LOG_LEVEL: 'verbose' })).toThrow()
  })

  it('rejects DEV_ADMIN_PASSWORD in production', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'production', DEV_ADMIN_PASSWORD: 'secret123' }),
    ).toThrow('DEV_ADMIN_PASSWORD')
  })

  it('parses optional SSO vars when provided', () => {
    const env = parseEnv({
      SSO_JWKS_URI: 'https://sso.example.com/.well-known/jwks.json',
      SSO_ISSUER: 'https://sso.example.com',
      SSO_AUDIENCE: 'feature-config-service',
    })
    expect(env.SSO_JWKS_URI).toBe('https://sso.example.com/.well-known/jwks.json')
    expect(env.SSO_ISSUER).toBe('https://sso.example.com')
  })

  it('accepts absent optional vars', () => {
    const env = parseEnv({})
    expect(env.SSO_JWKS_URI).toBeUndefined()
    expect(env.ADMIN_SESSION_SECRET).toBeUndefined()
  })
})
