import { createDefaultAuralisatorScene, summarizeScene } from './app/default-scene.js';
import { BabylonAuralisatorRenderer } from './renderers/babylon/babylon-renderer.js';

const appScene = createDefaultAuralisatorScene();
const summary = summarizeScene(appScene);

const renderer = new BabylonAuralisatorRenderer({
  canvas: document.getElementById('renderCanvas'),
  statusEl: document.getElementById('statusText'),
  inspectorButton: document.getElementById('inspectorBtn'),
  probeButton: document.getElementById('probeBtn'),
  legacyLink: document.getElementById('legacyLink')
});

document.getElementById('sceneStats').textContent = [
  `${summary.speakers} speakers`,
  `${summary.walls} acoustic surfaces`,
  `${summary.rooms} room`
].join(' / ');

renderer.init(appScene).catch(error => {
  console.error(error);
  document.getElementById('statusText').textContent = `Renderer failed: ${error.message}`;
});
