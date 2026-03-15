import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, SignJWT, importJWK, exportJWK } from 'jose'
import type { KeyLike } from 'jose'
import {
  createTokenVerifier,
  TokenInvalidError,
  InfraError,
} from '../../../src/modules/auth/token-verifier'
import type { JWKSKeyFetcher } from '../../../src/modules/auth/token-verifier'

// ─── Key setup ───────────────────────────────────────────────────────────────

let privateKey: KeyLike
let publicKey: KeyLike
let inProcessKeyFetcher: JWKSKeyFetcher

beforeAll(async () => {
  const pair = await generateKeyPair('ES256')
  privateKey = pair.privateKey
  publicKey = pair.publicKey

  // Build a local key fetcher that resolves to the in-process public key.
  // jose's jwtVerify accepts a function with signature (protectedHeader, token) => CryptoKey.
  // We cast to JWKSKeyFetcher so the config accepts it.
  inProcessKeyFetcher = (async (_header: unknown, _input: unknown) => {
    return publicKey
  }) as unknown as JWKSKeyFetcher
})

async function makeToken(opts: {
  sub?: string
  issuer?: string
  audience?: string
  expiresIn?: number | string
  notBefore?: number | string
  payload?: Record<string, unknown>
}): Promise<string> {
  const builder = new SignJWT({ sub: opts.sub ?? 'user-123', ...(opts.payload ?? {}) })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()

  if (opts.issuer !== undefined) builder.setIssuer(opts.issuer)
  if (opts.audience !== undefined) builder.setAudience(opts.audience)

  if (opts.expiresIn !== undefined) {
    builder.setExpirationTime(opts.expiresIn as string | number)
  } else {
    builder.setExpirationTime('1h')
  }

  return builder.sign(privateKey)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createTokenVerifier', () => {
  it('TV-1: undefined authorizationHeader returns anonymous', async () => {
    const verifier = createTokenVerifier({ keyFetcher: inProcessKeyFetcher })
    const result = await verifier.verify(undefined)
    expect(result).toEqual({ state: 'anonymous' })
  })

  it('TV-2: valid JWT returns authenticated with sub', async () => {
    const token = await makeToken({ sub: 'user-123' })
    const verifier = createTokenVerifier({ keyFetcher: inProcessKeyFetcher })
    const result = await verifier.verify(`Bearer ${token}`)
    expect(result.state).toBe('authenticated')
    expect(result.sub).toBe('user-123')
  })

  it('TV-3: expired JWT throws TokenInvalidError', async () => {
    // expiresIn accepts a relative time string — use a past date via nbf trick:
    // set issued-at in the past and expiration in the past using numeric seconds
    const builder = new SignJWT({ sub: 'user-expired' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600) // issued 1 hour ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800) // expired 30 min ago

    const expiredToken = await builder.sign(privateKey)
    const verifier = createTokenVerifier({ keyFetcher: inProcessKeyFetcher })

    await expect(verifier.verify(`Bearer ${expiredToken}`)).rejects.toThrow(TokenInvalidError)
  })

  it('TV-4: malformed token string (not Base64) throws TokenInvalidError', async () => {
    const verifier = createTokenVerifier({ keyFetcher: inProcessKeyFetcher })
    await expect(verifier.verify('Bearer not.a.valid.jwt.!!!!')).rejects.toThrow(TokenInvalidError)
  })

  it('TV-5: token with wrong issuer throws TokenInvalidError', async () => {
    const token = await makeToken({ issuer: 'https://wrong.example.com' })
    const verifier = createTokenVerifier({
      keyFetcher: inProcessKeyFetcher,
      issuer: 'https://expected.example.com',
    })
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toThrow(TokenInvalidError)
  })

  it('TV-6: no keyFetcher and no jwksUri throws InfraError', async () => {
    const verifier = createTokenVerifier({})
    const token = await makeToken({})
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toThrow(InfraError)
  })

  it('TV-7: keyFetcher throws TypeError (simulated network failure) throws InfraError', async () => {
    const brokenFetcher = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as JWKSKeyFetcher

    const verifier = createTokenVerifier({ keyFetcher: brokenFetcher })
    const token = await makeToken({})
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toThrow(InfraError)
  })

  it('TV-8: keyFetcher throws JWKSTimeout throws InfraError', async () => {
    // Simulate what jose throws for JWKS timeouts by constructing an error
    // with the same name as JWKSTimeout. We cannot import the class directly
    // to instantiate it, so we simulate the error path through a custom throw.
    const timeoutError = new Error('Request timed out')
    timeoutError.name = 'JWKSTimeout'

    const timeoutFetcher = (async () => {
      throw timeoutError
    }) as unknown as JWKSKeyFetcher

    const verifier = createTokenVerifier({ keyFetcher: timeoutFetcher })
    const token = await makeToken({})
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toThrow(InfraError)
  })

  it('TV-9: malformed Authorization header (missing Bearer prefix) throws TokenInvalidError', async () => {
    const verifier = createTokenVerifier({ keyFetcher: inProcessKeyFetcher })
    await expect(verifier.verify('Basic dXNlcjpwYXNz')).rejects.toThrow(TokenInvalidError)
  })

  it('TV-10: jwksTimeoutMs is accepted in config and does not affect in-process keyFetcher path', async () => {
    // Confirms the config field threads through without error.
    // The timeout only applies when createRemoteJWKSet is used; inject keyFetcher bypasses it.
    const verifier = createTokenVerifier({ keyFetcher: inProcessKeyFetcher, jwksTimeoutMs: 5000 })
    const token = await makeToken({ sub: 'user-timeout-cfg' })
    const result = await verifier.verify(`Bearer ${token}`)
    expect(result.state).toBe('authenticated')
    expect(result.sub).toBe('user-timeout-cfg')
  })
})
