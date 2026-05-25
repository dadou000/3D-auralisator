import { createPreviewBake } from '../../acoustic/bake/preview-bake.js';
import { ProbeFieldSampler } from '../../acoustic/runtime/probe-field.js';

const MATERIAL_COLORS = Object.freeze({
  concrete: [0.55, 0.58, 0.62],
  brick: [0.7, 0.28, 0.22],
  glass: [0.4, 0.72, 0.95],
  absorber: [0.12, 0.16, 0.2]
});

export class BabylonAuralisatorRenderer {
  constructor({ canvas, statusEl, inspectorButton, probeButton, legacyLink } = {}) {
    this.canvas = canvas;
    this.statusEl = statusEl;
    this.inspectorButton = inspectorButton;
    this.probeButton = probeButton;
    this.legacyLink = legacyLink;
    this.engine = null;
    this.scene = null;
    this.appScene = null;
    this.probeMeshes = [];
    this.probesVisible = true;
    this.previewBake = null;
    this.sampler = null;
  }

  async init(appScene) {
    if (!window.BABYLON) {
      throw new Error('Babylon.js failed to load.');
    }

    this.appScene = appScene;
    this.engine = await this.createEngine();
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.025, 0.03, 0.04, 1);
    this.scene.collisionsEnabled = true;

    this.createCamera();
    this.createLights();
    this.createMaterials();
    this.createEnvironment();
    this.createSceneObjects(appScene);
    this.createPreviewProbeField(appScene);
    this.bindControls();

    this.engine.runRenderLoop(() => {
      this.animateProbeField();
      this.scene.render();
    });
    window.addEventListener('resize', () => this.engine.resize());
    this.setStatus('Babylon renderer ready. Runtime is now oriented around baked acoustic data.');
  }

  async createEngine() {
    if (BABYLON.WebGPUEngine?.IsSupportedAsync) {
      const supported = await BABYLON.WebGPUEngine.IsSupportedAsync;
      if (supported) {
        const engine = new BABYLON.WebGPUEngine(this.canvas, {
          antialias: true,
          adaptToDeviceRatio: true
        });
        await engine.initAsync();
        this.backend = 'WebGPU';
        return engine;
      }
    }
    this.backend = 'WebGL';
    return new BABYLON.Engine(this.canvas, true, {
      antialias: true,
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: true,
      stencil: true
    });
  }

  createCamera() {
    const camera = new BABYLON.ArcRotateCamera(
      'main_camera',
      BABYLON.Tools.ToRadians(45),
      BABYLON.Tools.ToRadians(62),
      15,
      new BABYLON.Vector3(0, 2.2, 0),
      this.scene
    );
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 60;
    camera.wheelPrecision = 35;
    camera.panningSensibility = 80;
    camera.attachControl(this.canvas, true);
    this.camera = camera;
  }

  createLights() {
    const hemi = new BABYLON.HemisphericLight('sky_light', new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.8;
    hemi.groundColor = new BABYLON.Color3(0.08, 0.09, 0.1);

    const key = new BABYLON.DirectionalLight('key_light', new BABYLON.Vector3(-0.4, -0.8, -0.5), this.scene);
    key.position = new BABYLON.Vector3(8, 12, 8);
    key.intensity = 0.75;
  }

  createMaterials() {
    this.materials = {
      floor: makePbrMaterial(this.scene, 'mat_floor', [0.15, 0.18, 0.18], 0.95, 0),
      listener: makePbrMaterial(this.scene, 'mat_listener', [0.05, 0.8, 1], 0.35, 0),
      speaker: makePbrMaterial(this.scene, 'mat_speaker', [0.05, 0.06, 0.07], 0.55, 0),
      speakerCone: makePbrMaterial(this.scene, 'mat_speaker_cone', [0.95, 0.65, 0.18], 0.48, 0),
      probe: makePbrMaterial(this.scene, 'mat_probe', [0.1, 0.75, 1], 0.2, 0),
      zone: makePbrMaterial(this.scene, 'mat_zone', [0.12, 0.5, 0.85], 0.8, 0)
    };

    for (const [name, color] of Object.entries(MATERIAL_COLORS)) {
      const mat = makePbrMaterial(this.scene, `mat_wall_${name}`, color, 0.7, name === 'glass' ? 0 : 0);
      if (name === 'glass') {
        mat.alpha = 0.42;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      }
      this.materials[name] = mat;
    }
  }

  createEnvironment() {
    const floor = BABYLON.MeshBuilder.CreateGround('floor', { width: 28, height: 20, subdivisions: 24 }, this.scene);
    floor.material = this.materials.floor;
    floor.receiveShadows = true;

    const grid = new BABYLON.GridMaterial('mat_grid', this.scene);
    grid.majorUnitFrequency = 4;
    grid.minorUnitVisibility = 0.35;
    grid.gridRatio = 1;
    grid.backFaceCulling = false;
    grid.mainColor = new BABYLON.Color3(0.13, 0.16, 0.18);
    grid.lineColor = new BABYLON.Color3(0.22, 0.45, 0.48);
    grid.opacity = 0.45;
    floor.material = grid;
  }

  createSceneObjects(appScene) {
    for (const wall of appScene.walls) {
      this.createWall(wall);
    }
    for (const speaker of appScene.speakers) {
      this.createSpeaker(speaker);
    }
    this.createListener(appScene.listener);
    this.createZoneBounds(appScene.bounds);
  }

  createWall(wall) {
    const mesh = BABYLON.MeshBuilder.CreateBox(wall.id, {
      width: wall.size[0],
      height: wall.size[1],
      depth: wall.size[2]
    }, this.scene);
    mesh.position = BABYLON.Vector3.FromArray(wall.position);
    mesh.rotation = BABYLON.Vector3.FromArray(wall.rotation);
    mesh.material = this.materials[wall.material] ?? this.materials.concrete;
    mesh.metadata = { type: 'wall', source: wall };
    return mesh;
  }

  createSpeaker(speaker) {
    const root = new BABYLON.TransformNode(speaker.id, this.scene);
    root.position = BABYLON.Vector3.FromArray(speaker.position);

    const body = BABYLON.MeshBuilder.CreateBox(`${speaker.id}_body`, {
      width: 0.48,
      height: 0.86,
      depth: 0.38
    }, this.scene);
    body.parent = root;
    body.material = this.materials.speaker;

    const cone = BABYLON.MeshBuilder.CreateCylinder(`${speaker.id}_cone`, {
      diameterTop: 0.16,
      diameterBottom: 0.48,
      height: 0.34,
      tessellation: 48
    }, this.scene);
    cone.parent = root;
    cone.position.z = -0.25;
    cone.rotation.x = Math.PI / 2;
    cone.material = this.materials.speakerCone;

    const label = makeLabel(this.scene, speaker.name, new BABYLON.Vector3(0, 0.72, 0), root);
    label.color = '#dff6ff';

    root.metadata = { type: 'speaker', source: speaker };
    return root;
  }

  createListener(listener) {
    const root = new BABYLON.TransformNode(listener.id, this.scene);
    root.position = BABYLON.Vector3.FromArray(listener.position);

    const head = BABYLON.MeshBuilder.CreateSphere('listener_head', { diameter: 0.34, segments: 24 }, this.scene);
    head.parent = root;
    head.material = this.materials.listener;

    const nose = BABYLON.MeshBuilder.CreateCylinder('listener_nose', {
      diameterTop: 0,
      diameterBottom: 0.09,
      height: 0.22,
      tessellation: 16
    }, this.scene);
    nose.parent = root;
    nose.position.z = -0.22;
    nose.rotation.x = Math.PI / 2;
    nose.material = this.materials.speakerCone;

    makeLabel(this.scene, 'Listener', new BABYLON.Vector3(0, 0.45, 0), root);
    return root;
  }

  createZoneBounds(bounds) {
    const size = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2]
    ];
    const center = [
      bounds.min[0] + size[0] / 2,
      bounds.min[1] + size[1] / 2,
      bounds.min[2] + size[2] / 2
    ];
    const box = BABYLON.MeshBuilder.CreateBox('acoustic_zone_bounds', {
      width: size[0],
      height: size[1],
      depth: size[2]
    }, this.scene);
    box.position = BABYLON.Vector3.FromArray(center);
    const material = makePbrMaterial(this.scene, 'mat_zone_bounds', [0.08, 0.5, 0.85], 0.95, 0);
    material.alpha = 0.08;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    box.material = material;

    const edges = new BABYLON.EdgesRenderer(box);
    edges.edgesWidthScalerForOrthographic = 2;
    edges.edgesWidthScalerForPerspective = 4;
    box.enableEdgesRendering();
    box.edgesColor = new BABYLON.Color4(0.2, 0.78, 1, 0.75);
    box.isPickable = false;
  }

  createPreviewProbeField(appScene) {
    this.previewBake = createPreviewBake({
      sceneId: appScene.id,
      bounds: appScene.bounds,
      spacing: appScene.acoustic.previewProbeSpacing
    });
    this.sampler = new ProbeFieldSampler({
      probes: this.previewBake.probes,
      zones: this.previewBake.manifest.zones,
      cells: this.previewBake.cells,
      maxProbeCount: 4
    });

    const positions = this.previewBake.probes.map(probe => BABYLON.Vector3.FromArray(probe.position));
    const base = BABYLON.MeshBuilder.CreateSphere('probe_base', { diameter: 0.16, segments: 12 }, this.scene);
    base.material = this.materials.probe;
    base.isVisible = false;

    for (const position of positions) {
      const instance = base.createInstance(`probe_${this.probeMeshes.length}`);
      instance.position = position;
      instance.isPickable = false;
      this.probeMeshes.push(instance);
    }
  }

  animateProbeField() {
    const time = performance.now() * 0.001;
    for (let i = 0; i < this.probeMeshes.length; i += 1) {
      const mesh = this.probeMeshes[i];
      mesh.scaling.setAll(0.85 + Math.sin(time * 2 + i * 0.37) * 0.12);
    }
  }

  bindControls() {
    this.probeButton?.addEventListener('click', () => {
      this.probesVisible = !this.probesVisible;
      for (const mesh of this.probeMeshes) {
        mesh.isVisible = this.probesVisible;
      }
      this.probeButton.setAttribute('aria-pressed', String(this.probesVisible));
    });

    this.inspectorButton?.addEventListener('click', async () => {
      if (this.scene.debugLayer.isVisible()) {
        this.scene.debugLayer.hide();
        return;
      }
      await this.scene.debugLayer.show({ embedMode: true });
    });

    this.canvas.addEventListener('pointermove', () => {
      const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
      if (pick?.pickedMesh?.metadata?.source) {
        const source = pick.pickedMesh.metadata.source;
        this.setStatus(`${source.name ?? source.id} selected for renderer inspection.`);
      }
    });
  }

  setStatus(message) {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.textContent = `${message} Backend: ${this.backend ?? 'initializing'}.`;
  }
}

function makePbrMaterial(scene, name, color, roughness, metallic) {
  const mat = new BABYLON.PBRMaterial(name, scene);
  mat.albedoColor = new BABYLON.Color3(color[0], color[1], color[2]);
  mat.roughness = roughness;
  mat.metallic = metallic;
  return mat;
}

function makeLabel(scene, text, position, parent) {
  const plane = BABYLON.MeshBuilder.CreatePlane(`${parent.name}_label`, { width: 1.4, height: 0.32 }, scene);
  plane.parent = parent;
  plane.position = position;
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

  const texture = new BABYLON.DynamicTexture(`${parent.name}_label_tex`, { width: 512, height: 128 }, scene, false);
  texture.hasAlpha = true;
  texture.drawText(text, null, 82, '600 48px Segoe UI', '#e9f8ff', 'transparent', true);

  const mat = new BABYLON.StandardMaterial(`${parent.name}_label_mat`, scene);
  mat.diffuseTexture = texture;
  mat.emissiveColor = new BABYLON.Color3(0.9, 0.95, 1);
  mat.opacityTexture = texture;
  mat.disableLighting = true;
  plane.material = mat;
  plane.isPickable = false;
  return mat;
}
