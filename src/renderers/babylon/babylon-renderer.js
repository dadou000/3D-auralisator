import {
  createManualProbe,
  createPreviewBake,
  PROBE_GRID_MODES,
  relinkProbeNeighbors
} from '../../acoustic/bake/preview-bake.js';
import { ProbeFieldSampler } from '../../acoustic/runtime/probe-field.js';

const MATERIAL_COLORS = Object.freeze({
  concrete: [0.55, 0.58, 0.62],
  brick: [0.7, 0.28, 0.22],
  glass: [0.4, 0.72, 0.95],
  absorber: [0.12, 0.16, 0.2]
});

export class BabylonAuralisatorRenderer {
  constructor({
    canvas,
    statusEl,
    inspectorButton,
    probeButton,
    legacyLink,
    probeControls = {}
  } = {}) {
    this.canvas = canvas;
    this.statusEl = statusEl;
    this.inspectorButton = inspectorButton;
    this.probeButton = probeButton;
    this.legacyLink = legacyLink;
    this.probeControls = probeControls;
    this.engine = null;
    this.scene = null;
    this.appScene = null;
    this.probeMeshes = [];
    this.probeById = new Map();
    this.probesVisible = true;
    this.previewBake = null;
    this.sampler = null;
    this.selectedProbe = null;
    this.manualProbeCounter = 1;
    this.gizmoManager = null;
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
    this.createProbeGizmo();
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
      manualProbe: makePbrMaterial(this.scene, 'mat_manual_probe', [1, 0.66, 0.2], 0.24, 0),
      selectedProbe: makePbrMaterial(this.scene, 'mat_selected_probe', [1, 0.96, 0.32], 0.18, 0),
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
      spacing: appScene.acoustic.previewProbeSpacing,
      gridMode: appScene.acoustic.probeGridMode,
      planeY: appScene.acoustic.previewProbePlaneY
    });
    this.rebuildSampler();
    this.renderProbeMeshes();
    this.updateProbeControls();
  }

  renderProbeMeshes() {
    this.detachSelectedProbe();
    for (const mesh of this.probeMeshes) {
      mesh.dispose();
    }
    this.probeMeshes = [];
    this.probeById.clear();

    for (const probe of this.previewBake.probes) {
      this.createProbeMesh(probe);
    }
  }

  createProbeMesh(probe) {
    const mesh = BABYLON.MeshBuilder.CreateSphere(`mesh_${probe.id}`, { diameter: 0.18, segments: 14 }, this.scene);
    mesh.position = BABYLON.Vector3.FromArray(probe.position);
    mesh.material = probe.manual ? this.materials.manualProbe : this.materials.probe;
    mesh.isVisible = this.probesVisible;
    mesh.isPickable = true;
    mesh.metadata = { type: 'probe', probe };
    this.probeMeshes.push(mesh);
    this.probeById.set(probe.id, mesh);
    return mesh;
  }

  createProbeGizmo() {
    this.gizmoManager = new BABYLON.GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.attachToMesh(null);

    const positionGizmo = this.gizmoManager.gizmos.positionGizmo;
    if (positionGizmo?.onDragEndObservable) {
      positionGizmo.onDragEndObservable.add(() => this.commitSelectedProbePosition());
    }
    if (positionGizmo?.onDragObservable) {
      positionGizmo.onDragObservable.add(() => this.syncSelectedProbeFromMesh());
    }
  }

  rebuildSampler() {
    relinkProbeNeighbors(this.previewBake.probes, this.appScene.acoustic.previewProbeSpacing * 1.1);
    const probeIds = this.previewBake.probes.map(probe => probe.id);
    this.previewBake.manifest.chunks[0].probeIds = probeIds;
    this.previewBake.cells[0].probeIds = probeIds;
    this.sampler = new ProbeFieldSampler({
      probes: this.previewBake.probes,
      zones: this.previewBake.manifest.zones,
      cells: this.previewBake.cells,
      maxProbeCount: 4
    });
  }

  rebuildProbeGridFromControls() {
    this.appScene.acoustic.probeGridMode = this.probeControls.gridMode?.value ?? PROBE_GRID_MODES.grid3d;
    this.appScene.acoustic.previewProbeSpacing = clampNumber(this.probeControls.spacing?.value, 0.5, 20, 4);
    this.appScene.acoustic.previewProbePlaneY = clampNumber(
      this.probeControls.planeY?.value,
      this.appScene.bounds.min[1],
      this.appScene.bounds.max[1],
      1.6
    );
    this.createPreviewProbeField(this.appScene);
    this.setStatus(`Rebuilt ${this.appScene.acoustic.probeGridMode.toUpperCase()} probe grid.`);
  }

  addManualProbe() {
    const target = this.camera?.target ?? new BABYLON.Vector3(0, this.appScene.acoustic.previewProbePlaneY, 0);
    const position = [
      clamp(target.x, this.appScene.bounds.min[0], this.appScene.bounds.max[0]),
      clamp(this.appScene.listener.position[1], this.appScene.bounds.min[1], this.appScene.bounds.max[1]),
      clamp(target.z, this.appScene.bounds.min[2], this.appScene.bounds.max[2])
    ];
    const probe = createManualProbe({
      id: `manual_probe_${String(this.manualProbeCounter).padStart(3, '0')}`,
      position,
      spacing: this.appScene.acoustic.previewProbeSpacing
    });
    this.manualProbeCounter += 1;
    this.previewBake.probes.push(probe);
    this.rebuildSampler();
    const mesh = this.createProbeMesh(probe);
    this.selectProbe(mesh);
    this.updateProbeControls();
    this.setStatus(`Added ${probe.id}.`);
  }

  deleteSelectedProbe() {
    if (!this.selectedProbe) {
      return;
    }
    const probe = this.selectedProbe.metadata.probe;
    this.previewBake.probes = this.previewBake.probes.filter(entry => entry.id !== probe.id);
    this.selectedProbe.dispose();
    this.probeMeshes = this.probeMeshes.filter(mesh => mesh !== this.selectedProbe);
    this.probeById.delete(probe.id);
    this.detachSelectedProbe();
    this.rebuildSampler();
    this.updateProbeControls();
    this.setStatus(`Deleted ${probe.id}.`);
  }

  selectProbe(mesh) {
    if (!mesh?.metadata || mesh.metadata.type !== 'probe') {
      return;
    }
    if (this.selectedProbe && this.selectedProbe.metadata?.probe) {
      this.selectedProbe.material = this.selectedProbe.metadata.probe.manual
        ? this.materials.manualProbe
        : this.materials.probe;
    }
    this.selectedProbe = mesh;
    this.selectedProbe.material = this.materials.selectedProbe;
    this.gizmoManager?.attachToMesh(mesh);
    this.updateProbeControls();
    this.setStatus(`${mesh.metadata.probe.id} selected. Move it with the gizmo or numeric fields.`);
  }

  detachSelectedProbe() {
    if (this.selectedProbe && !this.selectedProbe.isDisposed()) {
      this.selectedProbe.material = this.selectedProbe.metadata?.probe?.manual
        ? this.materials.manualProbe
        : this.materials.probe;
    }
    this.selectedProbe = null;
    this.gizmoManager?.attachToMesh(null);
  }

  commitSelectedProbePosition() {
    this.syncSelectedProbeFromMesh();
    this.rebuildSampler();
    this.setStatus(`${this.selectedProbe?.metadata?.probe?.id ?? 'Probe'} moved.`);
  }

  syncSelectedProbeFromMesh() {
    if (!this.selectedProbe?.metadata?.probe) {
      return;
    }
    const probe = this.selectedProbe.metadata.probe;
    probe.position = [
      round3(this.selectedProbe.position.x),
      round3(this.selectedProbe.position.y),
      round3(this.selectedProbe.position.z)
    ];
    this.updateProbeControls();
  }

  updateSelectedProbeFromInputs() {
    if (!this.selectedProbe?.metadata?.probe) {
      return;
    }
    const position = [
      clampNumber(this.probeControls.x?.value, this.appScene.bounds.min[0], this.appScene.bounds.max[0], 0),
      clampNumber(this.probeControls.y?.value, this.appScene.bounds.min[1], this.appScene.bounds.max[1], 1.6),
      clampNumber(this.probeControls.z?.value, this.appScene.bounds.min[2], this.appScene.bounds.max[2], 0)
    ];
    this.selectedProbe.position = BABYLON.Vector3.FromArray(position);
    this.commitSelectedProbePosition();
  }

  updateProbeControls() {
    const controls = this.probeControls;
    if (controls.gridMode) controls.gridMode.value = this.appScene.acoustic.probeGridMode;
    if (controls.spacing) controls.spacing.value = String(this.appScene.acoustic.previewProbeSpacing);
    if (controls.planeY) controls.planeY.value = String(this.appScene.acoustic.previewProbePlaneY);
    if (controls.stats) {
      const mode = this.appScene.acoustic.probeGridMode === PROBE_GRID_MODES.grid2d ? '2D' : '3D';
      controls.stats.textContent = `${this.previewBake?.probes.length ?? 0} probes / ${mode} grid / ${this.appScene.acoustic.previewProbeSpacing} m spacing`;
    }

    const probe = this.selectedProbe?.metadata?.probe ?? null;
    if (controls.selectedName) {
      controls.selectedName.textContent = probe ? `${probe.id}${probe.manual ? ' / manual' : ' / grid'}` : 'No probe selected';
    }
    for (const input of [controls.x, controls.y, controls.z]) {
      if (input) input.disabled = !probe;
    }
    if (controls.deleteButton) {
      controls.deleteButton.disabled = !probe;
    }
    if (probe) {
      controls.x.value = String(probe.position[0]);
      controls.y.value = String(probe.position[1]);
      controls.z.value = String(probe.position[2]);
    } else {
      if (controls.x) controls.x.value = '';
      if (controls.y) controls.y.value = '';
      if (controls.z) controls.z.value = '';
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
      if (!this.probesVisible) {
        this.detachSelectedProbe();
        this.updateProbeControls();
      }
      this.probeButton.setAttribute('aria-pressed', String(this.probesVisible));
    });

    this.probeControls.rebuildButton?.addEventListener('click', () => this.rebuildProbeGridFromControls());
    this.probeControls.addButton?.addEventListener('click', () => this.addManualProbe());
    this.probeControls.deleteButton?.addEventListener('click', () => this.deleteSelectedProbe());
    for (const input of [this.probeControls.x, this.probeControls.y, this.probeControls.z]) {
      input?.addEventListener('change', () => this.updateSelectedProbeFromInputs());
      input?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          this.updateSelectedProbeFromInputs();
        }
      });
    }
    this.probeControls.gridMode?.addEventListener('change', () => {
      this.appScene.acoustic.probeGridMode = this.probeControls.gridMode.value;
      this.updateProbeControls();
    });
    this.probeControls.spacing?.addEventListener('change', () => {
      this.appScene.acoustic.previewProbeSpacing = clampNumber(this.probeControls.spacing.value, 0.5, 20, 4);
      this.updateProbeControls();
    });
    this.probeControls.planeY?.addEventListener('change', () => {
      this.appScene.acoustic.previewProbePlaneY = clampNumber(
        this.probeControls.planeY.value,
        this.appScene.bounds.min[1],
        this.appScene.bounds.max[1],
        1.6
      );
      this.updateProbeControls();
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

    this.scene.onPointerObservable.add(pointerInfo => {
      if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERPICK) {
        return;
      }
      const mesh = pointerInfo.pickInfo?.pickedMesh;
      if (mesh?.metadata?.type === 'probe') {
        this.selectProbe(mesh);
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

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
