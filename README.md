# GPU Binaural 3D Auralisator

This simple software lets you build speakers and listen to them in a 3D space.

## Run locally

Open `index.html` in a browser, or serve the folder with any static file server.

## Development

The current public app is still the static `index.html` build. New baked-acoustics work lives under `src/acoustic` and is covered by Node tests:

```sh
npm test
```

See `docs/acoustic-bake-roadmap.md` for the step-by-step migration plan.

## Deploy on GitHub Pages

Publish this repository from the `main` branch using GitHub Pages with the source set to `/ (root)`.
