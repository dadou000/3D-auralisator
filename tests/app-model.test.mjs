import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAuralisatorScene, summarizeScene } from '../src/app/default-scene.js';
import { createPreviewBake } from '../src/acoustic/bake/preview-bake.js';

test('default app scene exposes renderer migration primitives', () => {
  const scene = createDefaultAuralisatorScene();
  const summary = summarizeScene(scene);

  assert.equal(scene.units, 'meters');
  assert.equal(summary.speakers, 2);
  assert.equal(summary.walls, 5);
  assert.equal(summary.rooms, 1);
  assert.equal(scene.acoustic.runtimeMode, 'baked-field');
});

test('default scene can generate a preview acoustic bake', () => {
  const scene = createDefaultAuralisatorScene();
  const bake = createPreviewBake({
    sceneId: scene.id,
    bounds: scene.bounds,
    spacing: scene.acoustic.previewProbeSpacing
  });

  assert.ok(bake.probes.length > 0);
  assert.equal(bake.manifest.sceneHash, scene.id);
  assert.equal(bake.cells[0].acousticRegionId, 'zone_main');
});
