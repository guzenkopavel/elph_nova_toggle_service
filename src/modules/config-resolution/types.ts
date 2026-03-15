export type AuthState = 'anonymous' | 'authenticated'
export type Platform = 'all' | 'ios' | 'android' | 'web' | 'desktop'

export interface RequestContext {
  authState: AuthState
  platform: Platform
  appVersion: string
}

export interface ResolvedEntry {
  isEnabled: boolean
  name?: string
  description?: string
  [key: string]: unknown
}

export interface CompiledSnapshot {
  productId: number
  revision: number
  ttl: number
  features: Record<string, ResolvedEntry>
}
