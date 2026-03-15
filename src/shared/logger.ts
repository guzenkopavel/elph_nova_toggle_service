import pino from 'pino'
import type { Env } from '../config/env'

export function createLogger(env: Pick<Env, 'LOG_LEVEL'>) {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
  })
}

export type Logger = ReturnType<typeof createLogger>
