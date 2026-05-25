import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAuralisatorScene } from '../src/app/default-scene.js';
import { createPreviewBake } from '../src/acoustic/bake/preview-bake.js';
import {
  LOW_FREQUENCY_BINS,
  SOLVER_FREQUENCY_BANDS,
  solvePreviewAcousticField,
  segmentIntersectsAabb
} from '../src/acoustic/solver/preview-solver.js';

test('preview solver generates speaker-probe responses', () => {
  const scene = createDefaultAuralisatorScene();
  const bake = createPreviewBake({
    sceneId: scene.id,
    bounds: { min: [-2, 1.6, -2], max: [2, 1.6, 2] },
    spacing: 4,
    gridMode: '2d',
    planeY: 1.6
  });
  const result = solvePreviewAcousticField(scene, bake.probes);

  assert.equal(result.speakers, 2);
  assert.equal(result.probes, 4);
  assert.equal(result.responses.length, 8);
  assert.equal(result.solver, 'preview-baked-field-v1');
  assert.equal(result.sourceBakes.length, 2);
  assert.equal(result.frequencyBands.length, SOLVER_FREQUENCY_BANDS.length);
  assert.equal(result.lowFrequencyBins.length, LOW_FREQUENCY_BINS.length);
  assert.ok(result.averageGain > 0);
});

test('preview solver emits bake-shaped probe response components', () => {
  const scene = createDefaultAuralisatorScene();
  const bake = createPreviewBake({
    sceneId: scene.id,
    bounds: { min: [-2, 1.6, -2], max: [2, 1.6, 2] },
    spacing: 4,
    gridMode: '2d',
    planeY: 1.6
  });
  const result = solvePreviewAcousticField(scene, bake.probes);
  const sourceBake = result.sourceBakes[0];
  const response = sourceBake.probeResponses[bake.probes[0].id];

  assert.equal(sourceBake.sourceId, 'speaker_l');
  assert.ok(response.direct.delayMs > 0);
  assert.equal(Object.keys(response.direct.gainPerBand).length, SOLVER_FREQUENCY_BANDS.length);
  assert.ok(response.early.length > 0);
  assert.equal(response.lowFrequency.bins.length, LOW_FREQUENCY_BINS.length);
  assert.equal(response.late.encoding, 'foa');
  assert.ok(response.metrics.edc.length > 0);
  assert.ok(sourceBake.earlyReflectionDatabase.length >= response.early.length);
});

test('segment/AABB intersection detects a wall crossing', () => {
  assert.equal(segmentIntersectsAabb([-1, 0, 0], [1, 0, 0], [-0.1, -1, -1], [0.1, 1, 1]), true);
  assert.equal(segmentIntersectsAabb([-1, 2, 0], [1, 2, 0], [-0.1, -1, -1], [0.1, 1, 1]), false);
});
