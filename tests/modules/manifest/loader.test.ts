import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadManifest } from '../../../src/modules/manifest/loader'

const REAL_MANIFEST_PATH = path.join(
  __dirname,
  '../../../../elph-nova-ios/Project/IP_Phone/Core/FeatureFlags/Manifest/elph-nova-feature-manifest.json',
)

function writeTempManifest(content: string): string {
  const tmpPath = path.join(os.tmpdir(), `manifest-test-${Date.now()}-${Math.random()}.json`)
  fs.writeFileSync(tmpPath, content, 'utf-8')
  return tmpPath
}

describe('loadManifest', () => {
  it('loads the real manifest and returns 25 remoteCapable features', () => {
    const result = loadManifest(REAL_MANIFEST_PATH)
    expect(result.manifest.manifestVersion).toBe(1)
    expect(result.manifest.product.id).toBe('elph_nova')
    expect(result.remoteCapableFeatures).toHaveLength(25)
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('throws with "Failed to read manifest" for nonexistent path', () => {
    expect(() => loadManifest('/tmp/does-not-exist-xyz.json')).toThrow(
      'Failed to read manifest',
    )
  })

  it('throws with "Failed to parse manifest" for invalid JSON', () => {
    const tmpPath = writeTempManifest('not valid json {{{')
    try {
      expect(() => loadManifest(tmpPath)).toThrow('Failed to parse manifest JSON')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('throws with "Invalid manifest" for valid JSON but failing schema validation', () => {
    const tmpPath = writeTempManifest(
      JSON.stringify({ manifestVersion: 1, product: { id: 'x', name: 'X' } }),
    )
    try {
      expect(() => loadManifest(tmpPath)).toThrow('Invalid manifest')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('does not include manualOnly features in remoteCapableFeatures', () => {
    const { manifest, remoteCapableFeatures } = loadManifest(REAL_MANIFEST_PATH)
    const manualOnlyKeys = manifest.features
      .filter((f) => f.deliveryMode === 'manualOnly')
      .map((f) => f.key)
    expect(manualOnlyKeys.length).toBeGreaterThan(0)
    const remoteKeys = new Set(remoteCapableFeatures.map((f) => f.key))
    for (const key of manualOnlyKeys) {
      expect(remoteKeys.has(key)).toBe(false)
    }
  })

  it('does not include debugOnly features in remoteCapableFeatures', () => {
    const { manifest, remoteCapableFeatures } = loadManifest(REAL_MANIFEST_PATH)
    const debugOnlyKeys = manifest.features
      .filter((f) => f.deliveryMode === 'debugOnly')
      .map((f) => f.key)
    expect(debugOnlyKeys.length).toBeGreaterThan(0)
    const remoteKeys = new Set(remoteCapableFeatures.map((f) => f.key))
    for (const key of debugOnlyKeys) {
      expect(remoteKeys.has(key)).toBe(false)
    }
  })

  it('produces a deterministic hash for the same file content', () => {
    const raw = fs.readFileSync(REAL_MANIFEST_PATH, 'utf-8')
    const tmpPath = writeTempManifest(raw)
    try {
      const result1 = loadManifest(REAL_MANIFEST_PATH)
      const result2 = loadManifest(tmpPath)
      expect(result1.hash).toBe(result2.hash)
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})
