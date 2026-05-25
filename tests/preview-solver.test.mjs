import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAuralisatorScene } from '../src/app/default-scene.js';
import { createPreviewBake } from '../src/acoustic/bake/preview-bake.js';
import { solvePreviewAcousticField, segmentIntersectsAabb } from '../src/acoustic/solver/preview-solver.js';

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
  assert.ok(result.averageGain > 0);
});

test('segment/AABB intersection detects a wall crossing', () => {
  assert.equal(segmentIntersectsAabb([-1, 0, 0], [1, 0, 0], [-0.1, -1, -1], [0.1, 1, 1]), true);
  assert.equal(segmentIntersectsAabb([-1, 2, 0], [1, 2, 0], [-0.1, -1, -1], [0.1, 1, 1]), false);
});
