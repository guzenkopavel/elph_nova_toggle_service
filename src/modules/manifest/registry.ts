import type { ManifestFeature } from './schema'

export interface ManifestDefinition {
  feature_key: string
  name: string
  description: string | undefined
  owner: string | undefined
  delivery_mode: 'remoteCapable'
  source_priority_mode: string
  default_entry_json: string
  payload_schema_json: string | null
}

export class ManifestRegistry {
  private definitions = new Map<string, ManifestDefinition>()
  private _loadedHash: string | null = null

  get loadedHash(): string | null {
    return this._loadedHash
  }

  get isLoaded(): boolean {
    return this._loadedHash !== null
  }

  load(features: ManifestFeature[], hash: string): void {
    const map = new Map<string, ManifestDefinition>()
    for (const f of features) {
      map.set(f.key, {
        feature_key: f.key,
        name: f.name,
        description: f.description,
        owner: f.owner,
        delivery_mode: 'remoteCapable',
        source_priority_mode: f.sourcePriorityMode,
        default_entry_json: JSON.stringify(f.defaultEntry),
        payload_schema_json: f.payload ? JSON.stringify(f.payload) : null,
      })
    }
    this.definitions = map
    this._loadedHash = hash
  }

  getAll(): ManifestDefinition[] {
    return Array.from(this.definitions.values())
  }

  getByKey(key: string): ManifestDefinition | undefined {
    return this.definitions.get(key)
  }

  hasKey(key: string): boolean {
    return this.definitions.has(key)
  }

  readyCheck(): () => Promise<void> {
    return async () => {
      if (!this.isLoaded) {
        throw new Error(
          'ManifestRegistry: not loaded — run sync-manifest before starting the service',
        )
      }
    }
  }
}
