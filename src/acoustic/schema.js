export const BAKE_FORMAT_VERSION = 1;

export const FREQUENCY_RANGES = Object.freeze({
  bass: Object.freeze({ minHz: 20, maxHz: 200, representation: 'complex-pressure' }),
  lowMid: Object.freeze({ minHz: 200, maxHz: 1000, representation: 'hybrid-directional-phase' }),
  high: Object.freeze({ minHz: 1000, maxHz: 20000, representation: 'geometric-events-late-ir' })
});

export const BAKE_QUALITY_PRESETS = Object.freeze({
  preview: Object.freeze({
    label: 'Preview',
    maxReflectionOrder: 1,
    targetProbeErrorDb: 9,
    validationSamplesPerCell: 0,
    lateIrSeconds: 0.75
  }),
  draft: Object.freeze({
    label: 'Draft',
    maxReflectionOrder: 2,
    targetProbeErrorDb: 5,
    validationSamplesPerCell: 1,
    lateIrSeconds: 1.5
  }),
  final: Object.freeze({
    label: 'Final',
    maxReflectionOrder: 5,
    targetProbeErrorDb: 2,
    validationSamplesPerCell: 4,
    lateIrSeconds: 4
  }),
  extreme: Object.freeze({
    label: 'Extreme',
    maxReflectionOrder: 8,
    targetProbeErrorDb: 1,
    validationSamplesPerCell: 12,
    lateIrSeconds: 8
  }),
  validation: Object.freeze({
    label: 'Validation',
    maxReflectionOrder: 8,
    targetProbeErrorDb: 1,
    validationSamplesPerCell: 32,
    lateIrSeconds: 8
  })
});

export const RESPONSE_COMPONENTS = Object.freeze({
  direct: 'direct',
  early: 'early',
  late: 'late',
  lowFrequency: 'lowFrequency'
});

/**
 * @typedef {Object} AcousticZone
 * @property {string} id
 * @property {string} type room, corridor, portal, doorway, occlusion, exterior
 * @property {{min:[number, number, number], max:[number, number, number]}} bounds
 * @property {string[]} portals
 * @property {string[]} wallIds
 */

/**
 * @typedef {Object} Probe
 * @property {string} id
 * @property {[number, number, number]} position
 * @property {number} validRadius
 * @property {string[]} neighbors
 * @property {string} acousticRegionId
 * @property {string|null} roomId
 * @property {string|null} portalId
 * @property {[number, number, number]} acousticGradient
 */

/**
 * @typedef {Object} ProbeResponse
 * @property {Object} direct
 * @property {Object[]} early
 * @property {Object} late
 * @property {Object} lowFrequency
 * @property {Object} metrics
 */

/**
 * @typedef {Object} SourceBake
 * @property {string} sourceId
 * @property {[number, number, number]} sourcePosition
 * @property {Object} directivity
 * @property {Object} spectrum
 * @property {Record<string, ProbeResponse>} probeResponses
 * @property {Object} compression
 */

/**
 * @typedef {Object} AcousticChunk
 * @property {string} id
 * @property {{min:[number, number, number], max:[number, number, number]}} bounds
 * @property {string[]} probeIds
 * @property {string[]} zoneIds
 * @property {Record<string, string>} payloads
 */

export function createEmptyBakeManifest(overrides = {}) {
  return {
    format: '3d-auralisator-bake',
    version: BAKE_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    units: 'meters',
    sampleRate: 48000,
    speedOfSound: 343,
    frequencyRanges: FREQUENCY_RANGES,
    sceneHash: null,
    zones: [],
    chunks: [],
    sources: [],
    ...overrides
  };
}
