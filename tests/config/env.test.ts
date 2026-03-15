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

  it('SSO_JWKS_TIMEOUT_MS defaults to 3000', () => {
    const env = parseEnv({})
    expect(env.SSO_JWKS_TIMEOUT_MS).toBe(3000)
  })

  it('SSO_JWKS_TIMEOUT_MS coerces from string', () => {
    const env = parseEnv({ SSO_JWKS_TIMEOUT_MS: '5000' })
    expect(env.SSO_JWKS_TIMEOUT_MS).toBe(5000)
  })

  it('SSO_JWKS_TIMEOUT_MS rejects zero', () => {
    expect(() => parseEnv({ SSO_JWKS_TIMEOUT_MS: '0' })).toThrow()
  })

  it('SSO_JWKS_TIMEOUT_MS rejects negative value', () => {
    expect(() => parseEnv({ SSO_JWKS_TIMEOUT_MS: '-1' })).toThrow()
  })

  describe('cross-field SSO validation in non-development environments', () => {
    it('allows SSO_JWKS_URI without issuer/audience in development', () => {
      expect(() =>
        parseEnv({
          NODE_ENV: 'development',
          SSO_JWKS_URI: 'https://sso.example.com/.well-known/jwks.json',
        }),
      ).not.toThrow()
    })

    it('allows SSO_JWKS_URI without issuer/audience in test', () => {
      expect(() =>
        parseEnv({
          NODE_ENV: 'test',
          SSO_JWKS_URI: 'https://sso.example.com/.well-known/jwks.json',
        }),
      ).not.toThrow()
    })

    it('rejects SSO_JWKS_URI without SSO_ISSUER in staging', () => {
      expect(() =>
        parseEnv({
          NODE_ENV: 'staging',
          SSO_JWKS_URI: 'https://sso.example.com/.well-known/jwks.json',
          SSO_AUDIENCE: 'feature-config-service',
        }),
      ).toThrow('SSO_ISSUER')
    })

    it('rejects SSO_JWKS_URI without SSO_AUDIENCE in staging', () => {
      expect(() =>
        parseEnv({
          NODE_ENV: 'staging',
          SSO_JWKS_URI: 'https://sso.example.com/.well-known/jwks.json',
          SSO_ISSUER: 'https://sso.example.com',
        }),
      ).toThrow('SSO_AUDIENCE')
    })

    it('rejects SSO_JWKS_URI without SSO_ISSUER in production', () => {
      expect(() =>
        parseEnv({
          NODE_ENV: 'production',
          SSO_JWKS_URI: 'https://sso.example.com/.well-known/jwks.json',
          SSO_AUDIENCE: 'feature-config-service',
        }),
      ).toThrow('SSO_ISSUER')
    })

    it('accepts SSO_JWKS_URI with both issuer and audience in production', () => {
      const env = parseEnv({
        NODE_ENV: 'production',
        SSO_JWKS_URI: 'https://sso.example.com/.well-known/jwks.json',
        SSO_ISSUER: 'https://sso.example.com',
        SSO_AUDIENCE: 'feature-config-service',
      })
      expect(env.SSO_JWKS_URI).toBe('https://sso.example.com/.well-known/jwks.json')
    })

    it('accepts absent SSO_JWKS_URI in production without requiring issuer/audience', () => {
      expect(() =>
        parseEnv({
          NODE_ENV: 'production',
        }),
      ).not.toThrow()
    })
  })
})
