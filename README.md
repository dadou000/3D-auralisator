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

## Development

New renderer and baked-acoustics work lives under `src` and is covered by Node tests:

```sh
npm test
```

See `docs/acoustic-bake-roadmap.md` for the step-by-step migration plan.

## Deploy on GitHub Pages

Publish this repository from the `main` branch using GitHub Pages with the source set to `/ (root)`.
