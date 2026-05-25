import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createManualProbe,
  createPreviewBake,
  PROBE_GRID_MODES,
  relinkProbeNeighbors
} from '../src/acoustic/bake/preview-bake.js';
import { createEmptyBakeManifest } from '../src/acoustic/schema.js';
import { isBakeManifestUsable, validateBakeManifest } from '../src/acoustic/storage/manifest.js';
import { ProbeFieldSampler, interpolateScalar } from '../src/acoustic/runtime/probe-field.js';

test('creates a valid preview bake manifest', () => {
  const bake = createPreviewBake({
    sceneId: 'test-scene',
    bounds: { min: [0, 0, 0], max: [4, 0, 4] },
    spacing: 4
  });

  assert.equal(validateBakeManifest(bake.manifest).length, 0);
  assert.equal(bake.probes.length, 4);
  assert.equal(bake.cells.length, 1);
});

test('creates 2D probe grids at a controlled height', () => {
  const bake = createPreviewBake({
    sceneId: 'test-scene',
    bounds: { min: [0, 0, 0], max: [4, 4, 4] },
    spacing: 4,
    gridMode: PROBE_GRID_MODES.grid2d,
    planeY: 1.6
  });

  assert.equal(bake.probes.length, 4);
  assert.deepEqual([...new Set(bake.probes.map(probe => probe.position[1]))], [1.6]);
  assert.equal(bake.manifest.probeLayout.gridMode, '2d');
});

test('manual probes participate in neighbor relinking', () => {
  const manual = createManualProbe({
    id: 'manual_001',
    position: [2, 1.6, 2],
    spacing: 4
  });
  const probes = [
    { id: 'probe_000', position: [0, 1.6, 0], neighbors: [] },
    manual
  ];

  relinkProbeNeighbors(probes, 4);
  assert.equal(manual.manual, true);
  assert.deepEqual(probes[0].neighbors, ['manual_001']);
});

test('probe sampler interpolates only within a requested acoustic region', () => {
  const sampler = new ProbeFieldSampler({
    maxProbeCount: 4,
    cells: [{
      id: 'a',
      acousticRegionId: 'room_a',
      bounds: { min: [0, 0, 0], max: [10, 3, 10] },
      probeIds: ['a0', 'a1']
    }],
    probes: [
      { id: 'a0', position: [0, 1, 0], validRadius: 20, acousticRegionId: 'room_a', value: 10 },
      { id: 'a1', position: [10, 1, 0], validRadius: 20, acousticRegionId: 'room_a', value: 20 },
      { id: 'b0', position: [5, 1, 0], validRadius: 20, acousticRegionId: 'room_b', value: 1000 }
    ]
  });

  const result = sampler.locate([5, 1, 0], { acousticRegionId: 'room_a' });
  assert.equal(result.probes.length, 2);
  assert.equal(interpolateScalar(result.probes, probe => probe.value), 15);
});

test('manifest validator rejects incompatible manifests', () => {
  assert.equal(isBakeManifestUsable(createEmptyBakeManifest()), true);
  assert.deepEqual(validateBakeManifest({ format: 'other' }), [
    'Unsupported manifest format.',
    'Unsupported bake version: undefined.',
    'Manifest zones must be an array.',
    'Manifest chunks must be an array.',
    'Manifest sources must be an array.',
    'Manifest sampleRate must be a positive number.'
  ]);
});
