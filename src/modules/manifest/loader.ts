import fs from 'fs'
import crypto from 'crypto'
import { manifestSchema, type Manifest } from './schema'

export interface LoadManifestResult {
  manifest: Manifest
  hash: string
  remoteCapableFeatures: Manifest['features']
}

export function loadManifest(manifestPath: string): LoadManifestResult {
  let raw: string
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read manifest at '${manifestPath}': ${String(err)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse manifest JSON at '${manifestPath}': ${String(err)}`)
  }

  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    const details = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n')
    throw new Error(`Invalid manifest at '${manifestPath}':\n${details}`)
  }

  const hash = crypto.createHash('sha256').update(raw, 'utf-8').digest('hex')

  const remoteCapableFeatures = result.data.features.filter(
    (f) => f.deliveryMode === 'remoteCapable',
  )

  return { manifest: result.data, hash, remoteCapableFeatures }
}
