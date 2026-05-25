import { createDefaultAuralisatorScene, summarizeScene } from './app/default-scene.js';
import { AuralisatorAudioEngine } from './audio/audio-engine.js';
import { BabylonAuralisatorRenderer } from './renderers/babylon/babylon-renderer.js';

const appScene = createDefaultAuralisatorScene();
const summary = summarizeScene(appScene);

const renderer = new BabylonAuralisatorRenderer({
  canvas: document.getElementById('renderCanvas'),
  statusEl: document.getElementById('statusText'),
  inspectorButton: document.getElementById('inspectorBtn'),
  probeButton: document.getElementById('probeBtn'),
  legacyLink: document.getElementById('legacyLink'),
  probeControls: {
    gridMode: document.getElementById('probeGridMode'),
    spacing: document.getElementById('probeSpacing'),
    planeY: document.getElementById('probePlaneY'),
    rebuildButton: document.getElementById('rebuildProbesBtn'),
    addButton: document.getElementById('addProbeBtn'),
    deleteButton: document.getElementById('deleteProbeBtn'),
    selectedName: document.getElementById('selectedProbeName'),
    stats: document.getElementById('probeStats'),
    x: document.getElementById('probeX'),
    y: document.getElementById('probeY'),
    z: document.getElementById('probeZ')
  }
});

document.getElementById('sceneStats').textContent = [
  `${summary.speakers} speakers`,
  `${summary.walls} acoustic surfaces`,
  `${summary.rooms} room`
].join(' / ');

const audioEngine = new AuralisatorAudioEngine({
  appScene,
  statusEl: document.getElementById('audioStatus'),
  controls: {
    startButton: document.getElementById('audioStartBtn'),
    lineButton: document.getElementById('lineInputBtn'),
    deviceSelect: document.getElementById('lineDeviceSelect'),
    lineGain: document.getElementById('lineGain'),
    lineGainValue: document.getElementById('lineGainValue'),
    fileInput: document.getElementById('audioFileInput'),
    fileName: document.getElementById('audioFileName'),
    filePlayButton: document.getElementById('filePlayBtn'),
    fileSeek: document.getElementById('fileSeek'),
    fileTime: document.getElementById('fileTime'),
    fileGain: document.getElementById('fileGain'),
    fileGainValue: document.getElementById('fileGainValue'),
    sourceBlend: document.getElementById('sourceBlend'),
    masterGain: document.getElementById('masterGain'),
    masterGainValue: document.getElementById('masterGainValue'),
    speakerGainContainer: document.getElementById('speakerGainContainer')
  }
});
audioEngine.bind();

renderer.init(appScene).catch(error => {
  console.error(error);
  document.getElementById('statusText').textContent = `Renderer failed: ${error.message}`;
});
