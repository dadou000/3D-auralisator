import { BAKE_FORMAT_VERSION } from '../schema.js';

export function validateBakeManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return ['Manifest must be an object.'];
  }
  if (manifest.format !== '3d-auralisator-bake') {
    errors.push('Unsupported manifest format.');
  }
  if (manifest.version !== BAKE_FORMAT_VERSION) {
    errors.push(`Unsupported bake version: ${manifest.version}.`);
  }
  if (!Array.isArray(manifest.zones)) {
    errors.push('Manifest zones must be an array.');
  }
  if (!Array.isArray(manifest.chunks)) {
    errors.push('Manifest chunks must be an array.');
  }
  if (!Array.isArray(manifest.sources)) {
    errors.push('Manifest sources must be an array.');
  }
  if (!Number.isFinite(manifest.sampleRate) || manifest.sampleRate <= 0) {
    errors.push('Manifest sampleRate must be a positive number.');
  }
  return errors;
}

export function isBakeManifestUsable(manifest) {
  return validateBakeManifest(manifest).length === 0;
}
