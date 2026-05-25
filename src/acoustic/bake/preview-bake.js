import { createEmptyBakeManifest } from '../schema.js';

export function createPreviewBake({ sceneId = 'current-scene', bounds, spacing = 4 } = {}) {
  const bakeBounds = bounds ?? {
    min: [-10, 0.5, -10],
    max: [10, 2, 10]
  };
  const zone = {
    id: 'zone_main',
    type: 'room',
    bounds: bakeBounds,
    portals: [],
    wallIds: []
  };
  const probes = generateGridProbes(bakeBounds, spacing, zone.id);
  return {
    manifest: createEmptyBakeManifest({
      sceneHash: sceneId,
      zones: [zone],
      chunks: [{
        id: 'chunk_main',
        bounds: bakeBounds,
        probeIds: probes.map(probe => probe.id),
        zoneIds: [zone.id],
        payloads: {}
      }],
      sources: []
    }),
    probes,
    cells: [{
      id: 'cell_main',
      bounds: bakeBounds,
      acousticRegionId: zone.id,
      probeIds: probes.map(probe => probe.id)
    }]
  };
}

export function generateGridProbes(bounds, spacing, acousticRegionId) {
  const probes = [];
  let index = 0;
  for (let x = bounds.min[0]; x <= bounds.max[0]; x += spacing) {
    for (let y = bounds.min[1]; y <= bounds.max[1]; y += spacing) {
      for (let z = bounds.min[2]; z <= bounds.max[2]; z += spacing) {
        probes.push({
          id: `probe_${String(index).padStart(5, '0')}`,
          position: [round3(x), round3(y), round3(z)],
          validRadius: spacing * 1.75,
          neighbors: [],
          acousticRegionId,
          roomId: acousticRegionId,
          portalId: null,
          acousticGradient: [0, 0, 0]
        });
        index += 1;
      }
    }
  }
  linkNearestNeighbors(probes, spacing * 1.1);
  return probes;
}

function linkNearestNeighbors(probes, maxDistance) {
  const maxDistanceSq = maxDistance * maxDistance;
  for (const probe of probes) {
    probe.neighbors = probes
      .filter(other => other !== probe && distanceSq(probe.position, other.position) <= maxDistanceSq)
      .map(other => other.id);
  }
}

function distanceSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
