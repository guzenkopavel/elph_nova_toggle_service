import { z } from 'zod'

const deliveryModeSchema = z.enum(['remoteCapable', 'manualOnly', 'debugOnly', 'localOnly'])
const sourcePriorityModeSchema = z.enum(['serverWins', 'localWins'])

const manifestFeatureSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  owner: z.string().optional(),
  deliveryMode: deliveryModeSchema,
  sourcePriorityMode: sourcePriorityModeSchema,
  defaultEntry: z.record(z.unknown()),
  payload: z
    .object({
      swiftTypeName: z.string().optional(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string().optional(),
        }),
      ),
    })
    .optional(),
  swiftKeyTypeName: z.string().optional(),
})

const manifestProductSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
})

const manifestSchema = z.object({
  manifestVersion: z.number(),
  product: manifestProductSchema,
  features: z.array(manifestFeatureSchema),
  groups: z.array(z.unknown()).optional(),
})

export type ManifestFeature = z.infer<typeof manifestFeatureSchema>
export type ManifestProduct = z.infer<typeof manifestProductSchema>
export type Manifest = z.infer<typeof manifestSchema>

export { manifestSchema, manifestFeatureSchema }
