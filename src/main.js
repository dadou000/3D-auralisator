import { createDefaultAuralisatorScene, summarizeScene } from './app/default-scene.js';
import { AuralisatorAudioEngine } from './audio/audio-engine.js';
import { BabylonAuralisatorRenderer } from './renderers/babylon/babylon-renderer.js?v=geom1';

const appScene = createDefaultAuralisatorScene();
const summary = summarizeScene(appScene);
initSideTabs();

const renderer = new BabylonAuralisatorRenderer({
  canvas: document.getElementById('renderCanvas'),
  statusEl: document.getElementById('statusText'),
  fpvButton: document.getElementById('fpvBtn'),
  fpvHud: document.getElementById('fpvHud'),
  inspectorButton: document.getElementById('inspectorBtn'),
  probeButton: document.getElementById('probeBtn'),
  legacyLink: document.getElementById('legacyLink'),
  onListenerChange: () => audioEngine.updateListenerTransform(),
  onSceneObjectChange: () => {
    audioEngine.updateSpeakerRoutes();
    audioEngine.updateListenerTransform();
  },
  objectControls: {
    importInput: document.getElementById('geometryImportInput'),
    importStatus: document.getElementById('geometryImportStatus'),
    selectedName: document.getElementById('selectedObjectName'),
    stats: document.getElementById('objectStats'),
    x: document.getElementById('objectX'),
    y: document.getElementById('objectY'),
    z: document.getElementById('objectZ'),
    deleteButton: document.getElementById('deleteObjectBtn')
  },
  solverControls: {
    runButton: document.getElementById('runPreviewSolverBtn'),
    stats: document.getElementById('solverStats')
  },
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
window.__auralisatorToggleFpv = () => renderer.toggleFpvMode();

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
    speakerGainContainer: document.getElementById('speakerGainContainer'),
    hardwareGraph: document.getElementById('hardwareGraph'),
    dspSummary: document.getElementById('dspSummary'),
    dspInputGainL: document.getElementById('dspInputGainL'),
    dspInputGainR: document.getElementById('dspInputGainR'),
    dspHighpass: document.getElementById('dspHighpass'),
    dspPeqFrequency: document.getElementById('dspPeqFrequency'),
    dspPeqGain: document.getElementById('dspPeqGain'),
    dspPeqQ: document.getElementById('dspPeqQ'),
    dspLowpass: document.getElementById('dspLowpass'),
    dspDelayL: document.getElementById('dspDelayL'),
    dspDelayR: document.getElementById('dspDelayR'),
    dspOutputGainL: document.getElementById('dspOutputGainL'),
    dspOutputGainR: document.getElementById('dspOutputGainR')
  }
});
audioEngine.bind();

renderer.init(appScene).catch(error => {
  console.error(error);
  document.getElementById('statusText').textContent = `Renderer failed: ${error.message}`;
});

function initSideTabs() {
  const buttons = [...document.querySelectorAll('[data-tab-target]')];
  const panels = [...document.querySelectorAll('[data-tab-panel]')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const target = button.dataset.tabTarget;
      for (const item of buttons) {
        item.setAttribute('aria-pressed', String(item === button));
      }
      for (const panel of panels) {
        panel.hidden = panel.dataset.tabPanel !== target;
      }
    });
  }
}
