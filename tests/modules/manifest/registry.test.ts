import { describe, it, expect } from 'vitest'
import { ManifestRegistry } from '../../../src/modules/manifest/registry'
import type { ManifestFeature } from '../../../src/modules/manifest/schema'

function makeFeature(key: string, overrides: Partial<ManifestFeature> = {}): ManifestFeature {
  return {
    key,
    name: `Feature ${key}`,
    deliveryMode: 'remoteCapable',
    sourcePriorityMode: 'serverWins',
    defaultEntry: { isEnabled: true },
    ...overrides,
  }
}

describe('ManifestRegistry', () => {
  it('getAll returns all loaded features', () => {
    const registry = new ManifestRegistry()
    registry.load([makeFeature('chat'), makeFeature('calls')], 'abc123')
    expect(registry.getAll()).toHaveLength(2)
  })

  it('getByKey returns the correct definition for a present key', () => {
    const registry = new ManifestRegistry()
    registry.load([makeFeature('chat'), makeFeature('calls')], 'abc123')
    const def = registry.getByKey('chat')
    expect(def).toBeDefined()
    expect(def!.feature_key).toBe('chat')
    expect(def!.delivery_mode).toBe('remoteCapable')
    expect(def!.source_priority_mode).toBe('serverWins')
    expect(def!.default_entry_json).toBe(JSON.stringify({ isEnabled: true }))
  })

  it('getByKey returns undefined for an absent key', () => {
    const registry = new ManifestRegistry()
    registry.load([makeFeature('chat')], 'abc123')
    expect(registry.getByKey('nonexistent')).toBeUndefined()
  })

  it('hasKey returns true for present key and false for absent key', () => {
    const registry = new ManifestRegistry()
    registry.load([makeFeature('chat')], 'abc123')
    expect(registry.hasKey('chat')).toBe(true)
    expect(registry.hasKey('calls')).toBe(false)
  })

  it('readyCheck resolves when registry is loaded', async () => {
    const registry = new ManifestRegistry()
    registry.load([], 'abc123')
    await expect(registry.readyCheck()()).resolves.toBeUndefined()
  })

  it('readyCheck rejects with "not loaded" when registry was never loaded', async () => {
    const registry = new ManifestRegistry()
    await expect(registry.readyCheck()()).rejects.toThrow('not loaded')
  })

  it('second load call replaces the first', () => {
    const registry = new ManifestRegistry()
    registry.load([makeFeature('chat'), makeFeature('calls')], 'hash1')
    expect(registry.getAll()).toHaveLength(2)
    expect(registry.loadedHash).toBe('hash1')

    registry.load([makeFeature('widgets')], 'hash2')
    expect(registry.getAll()).toHaveLength(1)
    expect(registry.hasKey('chat')).toBe(false)
    expect(registry.hasKey('widgets')).toBe(true)
    expect(registry.loadedHash).toBe('hash2')
  })

  it('stores payload_schema_json when feature has payload', () => {
    const feature = makeFeature('chat.attachments', {
      payload: {
        swiftTypeName: 'ChatPayload',
        fields: [{ name: 'value', type: 'string' }],
      },
    })
    const registry = new ManifestRegistry()
    registry.load([feature], 'abc123')
    const def = registry.getByKey('chat.attachments')
    expect(def!.payload_schema_json).not.toBeNull()
    const parsed = JSON.parse(def!.payload_schema_json!)
    expect(parsed.swiftTypeName).toBe('ChatPayload')
  })

  it('stores null payload_schema_json when feature has no payload', () => {
    const registry = new ManifestRegistry()
    registry.load([makeFeature('chat')], 'abc123')
    const def = registry.getByKey('chat')
    expect(def!.payload_schema_json).toBeNull()
  })

  it('isLoaded is false before load and true after load', () => {
    const registry = new ManifestRegistry()
    expect(registry.isLoaded).toBe(false)
    registry.load([], 'hash')
    expect(registry.isLoaded).toBe(true)
  })

  it('loadedHash is null before load and the hash after load', () => {
    const registry = new ManifestRegistry()
    expect(registry.loadedHash).toBeNull()
    registry.load([], 'deadbeef')
    expect(registry.loadedHash).toBe('deadbeef')
  })
})
