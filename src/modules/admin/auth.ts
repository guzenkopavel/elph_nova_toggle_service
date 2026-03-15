import type { FastifyRequest, FastifyReply } from 'fastify'
import { TokenInvalidError } from '../auth/token-verifier.js'
import type { TokenVerifier } from '../auth/token-verifier.js'

export const ROLE_VIEWER = 'feature-toggle-viewer'
export const ROLE_EDITOR = 'feature-toggle-editor'

export type AdminRole = typeof ROLE_VIEWER | typeof ROLE_EDITOR

declare module 'fastify' {
  interface FastifyRequest {
    adminRole?: AdminRole
    adminSub?: string
  }
}

export function makeAdminAuthHook(verifier: TokenVerifier, requiredRole: AdminRole) {
  return async function adminAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
