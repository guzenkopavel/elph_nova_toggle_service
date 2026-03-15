import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose'

export interface AuthResult {
  state: 'anonymous' | 'authenticated'
  sub?: string
  roles?: string[]
}

// Distinct error classes so the route can map precisely:
// TokenInvalidError → 401
// InfraError → 5xx
export class TokenInvalidError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'TokenInvalidError'
  }
}

export class InfraError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'InfraError'
  }
}

export type JWKSKeyFetcher = ReturnType<typeof createRemoteJWKSet>

export interface TokenVerifierConfig {
  jwksUri?: string
  issuer?: string
  audience?: string
  jwksTimeoutMs?: number
  // Injectable for tests — allows passing an in-process key instead of remote JWKS
  keyFetcher?: JWKSKeyFetcher
}

export interface TokenVerifier {
  verify(authorizationHeader: string | undefined): Promise<AuthResult>
}

export function createTokenVerifier(config: TokenVerifierConfig): TokenVerifier {
  // Build the key fetcher once at startup (jose caches JWKS internally)
  let keyFetcher: JWKSKeyFetcher | undefined = config.keyFetcher

  if (!keyFetcher && config.jwksUri) {
    keyFetcher = createRemoteJWKSet(new URL(config.jwksUri), {
      timeoutDuration: config.jwksTimeoutMs ?? 3_000,
    })
  }

  return {
    async verify(authorizationHeader: string | undefined): Promise<AuthResult> {
      // Scenario 1: no Authorization header → anonymous
      if (!authorizationHeader) {
        return { state: 'anonymous' }
      }

      // Extract bearer token
      const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader)
      if (!match) {
        // Malformed Authorization header (not Bearer format)
        throw new TokenInvalidError('Malformed Authorization header: expected Bearer scheme')
      }
      const token = match[1]

      // Scenario: token present but JWKS not configured → infra failure
      if (!keyFetcher) {
        throw new InfraError('Token verification unavailable: SSO_JWKS_URI is not configured')
      }

      try {
        const { payload } = await jwtVerify(token, keyFetcher, {
          ...(config.issuer ? { issuer: config.issuer } : {}),
          ...(config.audience ? { audience: config.audience } : {}),
        })
        const roles = Array.isArray(payload['roles']) ? payload['roles'] as string[] : []
        return { state: 'authenticated', sub: payload.sub, roles }
      } catch (err) {
        // Discriminate token errors (→ 401) from infra errors (→ 5xx)
        if (isTokenInvalidError(err)) {
          throw new TokenInvalidError(
            err instanceof Error ? err.message : 'Token validation failed',
            err
          )
        }
        // Anything else (network, JWKS fetch, timeout) → infrastructure failure
        throw new InfraError(
          err instanceof Error ? err.message : 'Token verification infrastructure failure',
          err
        )
      }
    },
  }
}

function isTokenInvalidError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // jose error classes that indicate the TOKEN is bad (not infra)
  return (
    err instanceof joseErrors.JWTExpired ||
    err instanceof joseErrors.JWTInvalid ||
    err instanceof joseErrors.JWTClaimValidationFailed ||
    err instanceof joseErrors.JWSSignatureVerificationFailed ||
    err instanceof joseErrors.JWSInvalid ||
    err instanceof joseErrors.JOSENotSupported ||
    err instanceof joseErrors.JOSEAlgNotAllowed
  )
  // NOTE: JWKSNoMatchingKey → infra failure (not token error).
  // A missing key could be a key rotation race — 5xx lets the client retry.
  // JWKSTimeout, JWKSMultipleMatchingKeys → also infra failure.
}
