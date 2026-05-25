# Acoustic Bake Roadmap

## Goal

Move 3D Auralisator from live acoustic approximation toward an offline-baked acoustic field. Bake time, disk size, and RAM can be large. Runtime must remain stable and mostly behave like a sampler.

## Runtime Target

Runtime should do:

- load bake manifests, probe graphs, chunks, and source payloads
- locate the listener acoustic cell
- select only valid probes inside the current acoustic region
- interpolate or crossfade probe responses
- render cheap direct delay/gain with baked occlusion and diffraction correction
- render sparse early reflections
- convolve compressed late directional IRs
- decode to binaural, stereo, surround, or Ambisonics

Runtime should avoid:

- live ray tracing
- live diffraction solving
- wave propagation
- RT60 estimation
- BVH traversal for acoustic propagation

## Bake Target

The bake system should produce multiple representations instead of one giant stereo IR:

- 20-200 Hz: complex pressure/modal field
- 200 Hz-1 kHz: hybrid directional energy, occlusion, diffraction, and phase where useful
- 1-20 kHz: high-count geometric path tracing with sparse early events and compressed late IRs

## Milestones

1. Foundation
   - Add bake schema, manifest validator, preview probe generator, and runtime probe sampler.
   - Keep the current app behavior unchanged.

2. UI Integration
   - Add an Acoustic Bake panel.
   - Add Preview Bake, Load Bake, Clear Bake, and probe/debug overlays.

3. Runtime Playback
   - Add runtime cell lookup.
   - Add valid probe interpolation.
   - Add crossfaded late convolution.
   - Add direct path correction from baked data.

4. Preview Baker
   - Generate acoustic zones from rooms.
   - Generate coarse probes.
   - Bake direct path and first-order reflections.
   - Export and reload a `.auralbake` package.

5. Adaptive Baker
   - Compare neighboring probe responses.
   - Subdivide high-error areas.
   - Prevent interpolation across walls by using rooms, portals, and occlusion regions.

6. Production Baker
   - Add high-count path tracing, diffraction/scattering approximations, low-frequency pressure fields, directional late IRs, compression, and validation passes.

## Open Decisions

- Browser-only bake or local worker/server bake.
- Primary output format: binaural, stereo, surround, Ambisonics, or all.
- Mesh import requirements.
- Runtime RAM target.
- Bake package location: file, IndexedDB, local folder, server, or GitHub-hosted assets.
