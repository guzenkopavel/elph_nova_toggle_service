import type { FastifyRequest, FastifyReply } from 'fastify'
import { TokenInvalidError } from '../auth/token-verifier.js'
import type { TokenVerifier } from '../auth/token-verifier.js'

export const ROLE_VIEWER = 'feature-toggle-viewer'
export const ROLE_EDITOR = 'feature-toggle-editor'

export type AdminRole = typeof ROLE_VIEWER | typeof ROLE_EDITOR

// Cookie name and value used for static-password sessions (self-hosted deployments).
export const ADMIN_SESSION_COOKIE = 'adm_sess'
export const ADMIN_SESSION_VALUE = 'editor'

declare module 'fastify' {
  interface FastifyRequest {
    adminRole?: AdminRole
    adminSub?: string
  }
}

export function makeAdminAuthHook(verifier: TokenVerifier, requiredRole: AdminRole) {
  return async function adminAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Check cookie-based session first (set by POST /admin/login for static-password auth).
    const raw = request.cookies[ADMIN_SESSION_COOKIE]
    if (raw) {
      const unsigned = request.unsignCookie(raw)
      if (unsigned.valid && unsigned.value === ADMIN_SESSION_VALUE) {
        request.adminRole = ROLE_EDITOR
        request.adminSub = 'session'
        return
      }
    }

    const authHeader = request.headers.authorization

    let authResult: Awaited<ReturnType<TokenVerifier['verify']>>
    try {
      authResult = await verifier.verify(authHeader)
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        return void reply.code(401).send({ error: 'Unauthorized' })
      }
      request.log.error({ err }, 'Admin token verification infrastructure failure')
      return void reply.code(503).send({ error: 'Service temporarily unavailable' })
    }

    if (authResult.state === 'anonymous') {
      return void reply.code(401).send({ error: 'Unauthorized' })
    }

    const roles: string[] = authResult.roles ?? []

    const hasRole = requiredRole === ROLE_VIEWER
      ? (roles.includes(ROLE_VIEWER) || roles.includes(ROLE_EDITOR))
      : roles.includes(ROLE_EDITOR)

    if (!hasRole) {
      return void reply.code(403).send({ error: 'Forbidden' })
    }

    request.adminRole = roles.includes(ROLE_EDITOR) ? ROLE_EDITOR : ROLE_VIEWER
    request.adminSub = authResult.sub ?? 'unknown'
  }
}
