# GPU Binaural 3D Auralisator

This simple software lets you build speakers and listen to them in a 3D space.

## Run locally

Serve the folder with any static file server and open `index.html`.

```sh
python -m http.server 8080 --bind 127.0.0.1
```

On Windows, double-click `launch-3d-auralisator.bat` to start the local server and open the app.

The main app now uses the Babylon renderer migration shell. The old Three.js single-file app is preserved as `legacy-three.html`.

The Babylon shell includes a probe editor for switching between 2D/3D preview grids, rebuilding spacing, adding manual probes, moving selected probes, and deleting custom points.

It also includes a first live audio input layer: browser line-in capture, local audio file playback with seeking, line/file mixing, master gain, and per-speaker routing to the current speaker positions.

The signal chain is now modeled as hardware in its own Routing tab: Mix Out L/R feeds a SigmaStudio-style DSP block, DSP outputs feed stereo amp channels, and amp channels feed the current speakers.

FPV mode lets the listener walk the room with WASD and mouse look while the Web Audio listener follows the camera.

## Development

New renderer and baked-acoustics work lives under `src` and is covered by Node tests:

```sh
npm test
```

See `docs/acoustic-bake-roadmap.md` for the step-by-step migration plan.

## Deploy on GitHub Pages

Publish this repository from the `main` branch using GitHub Pages with the source set to `/ (root)`.
