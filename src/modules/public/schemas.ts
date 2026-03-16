export const featureConfigHeaders = {
  type: 'object',
  properties: {
    platform: { type: 'string', enum: ['ios', 'android', 'web', 'desktop'] },
    appname: { type: 'string', minLength: 1 },
    appversion: { type: 'string', minLength: 1 },
    'x-api-version': { type: 'string', minLength: 1 },
    authorization: { type: 'string' },
  },
  required: [],
} as const

export const featureConfigResponse200 = {
  type: 'object',
  properties: {
    version: { type: 'integer' },
    ttl: { type: 'integer' },
    features: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          isEnabled: { type: 'boolean' },
          name: { type: 'string' },
          description: { type: 'string' },
          payload: { type: 'object', additionalProperties: true },
        },
        required: ['isEnabled'],
        additionalProperties: true,
      },
    },
  },
  required: ['version', 'ttl', 'features'],
} as const
