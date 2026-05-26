import { flattenHardwareConnections } from '../hardware/hardware-model.js';

const ROUTING_TOOLBOX = Object.freeze([
  {
    type: 'input',
    title: 'Input',
    meta: 'Line or file source',
    ports: [{ id: 'out_l', label: 'out L', kind: 'out' }, { id: 'out_r', label: 'out R', kind: 'out' }]
  },
  {
    type: 'mix',
    title: 'Mix Output',
    meta: 'Stereo bus',
    ports: [{ id: 'mix_l', label: 'mix_l', kind: 'out' }, { id: 'mix_r', label: 'mix_r', kind: 'out' }]
  },
  {
    type: 'dsp',
    title: 'DSP',
    meta: 'Sigma-style processor',
    ports: [
      { id: 'dsp_in_l', label: 'dsp_in_l', kind: 'in' },
      { id: 'dsp_in_r', label: 'dsp_in_r', kind: 'in' },
      { id: 'dsp_out_l', label: 'dsp_out_l', kind: 'out' },
      { id: 'dsp_out_r', label: 'dsp_out_r', kind: 'out' }
    ]
  },
  {
    type: 'filter',
    title: 'Filter',
    meta: 'HPF / PEQ / LPF',
    ports: [{ id: 'in', label: 'in', kind: 'in' }, { id: 'out', label: 'out', kind: 'out' }]
  },
  {
    type: 'amp',
    title: 'Amplifier',
    meta: 'Power amp channel',
    ports: [{ id: 'in', label: 'in', kind: 'in' }, { id: 'out', label: 'speaker out', kind: 'out' }]
  },
  {
    type: 'speaker',
    title: 'Speaker',
    meta: 'Room speaker',
    ports: [{ id: 'in', label: 'speaker in', kind: 'in' }]
  }
]);

export class AuralisatorAudioEngine {
  constructor({ appScene, controls = {}, statusEl } = {}) {
    this.appScene = appScene;
    this.controls = controls;
    this.statusEl = statusEl;
    this.ctx = null;
    this.master = null;
    this.sourceBus = null;
    this.mixSplitter = null;
    this.lineGain = null;
    this.fileGain = null;
    this.lineSource = null;
    this.lineStream = null;
    this.fileSource = null;
    this.audioElement = new Audio();
    this.audioElement.preload = 'metadata';
    this.audioElement.crossOrigin = 'anonymous';
    this.speakerRoutes = new Map();
    this.dspRoutes = new Map();
    this.fileObjectUrl = null;
    this.lineEnabled = false;
    this.routingNodeCounter = 1;
    this.routingNodes = null;
    this.selectedRoutingNodeId = null;
  }

  bind() {
    this.controls.startButton?.addEventListener('click', () => this.run(() => this.start()));
    this.controls.lineButton?.addEventListener('click', () => this.run(() => this.toggleLineInput()));
    this.controls.deviceSelect?.addEventListener('change', () => this.run(() => this.restartLineInputIfNeeded()));
    this.controls.fileInput?.addEventListener('change', event => this.run(() => this.loadFile(event.target.files?.[0])));
    this.controls.filePlayButton?.addEventListener('click', () => this.run(() => this.toggleFilePlayback()));
    this.controls.fileSeek?.addEventListener('input', () => this.seekFile());
    this.controls.lineGain?.addEventListener('input', () => this.updateSourceGains());
    this.controls.fileGain?.addEventListener('input', () => this.updateSourceGains());
    this.controls.sourceBlend?.addEventListener('input', () => this.updateSourceGains());
    this.controls.masterGain?.addEventListener('input', () => this.updateMasterGain());
    for (const input of [
      this.controls.dspInputGainL,
      this.controls.dspInputGainR,
      this.controls.dspHighpass,
      this.controls.dspPeqFrequency,
      this.controls.dspPeqGain,
      this.controls.dspPeqQ,
      this.controls.dspLowpass,
      this.controls.dspDelayL,
      this.controls.dspDelayR,
      this.controls.dspOutputGainL,
      this.controls.dspOutputGainR
    ]) {
      input?.addEventListener('input', () => this.updateDspFromControls());
    }

    this.audioElement.addEventListener('timeupdate', () => this.updateFileTimeUi());
    this.audioElement.addEventListener('loadedmetadata', () => this.updateFileTimeUi());
    this.audioElement.addEventListener('ended', () => this.updateTransportUi());

    this.renderSpeakerControls();
    this.renderHardwareGraph();
    this.updateStatus('Audio engine idle. Start audio before using line-in or file playback.');
  }

  async run(action) {
    try {
      await action();
    } catch (error) {
      this.updateStatus(error.message || 'Audio action failed.');
    }
  }

  async start() {
    await this.ensureContext();
    await this.ctx.resume();
    await this.refreshInputDevices();
    this.updateSourceGains();
    this.updateMasterGain();
    this.updateSpeakerRoutes();
    if (this.controls.startButton) {
      this.controls.startButton.textContent = 'Audio running';
      this.controls.startButton.disabled = true;
    }
    this.updateStatus('Audio engine running through Mix Out L/R -> DSP -> Amp -> Speakers.');
  }

  async ensureContext() {
    if (this.ctx) {
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio is not available in this browser.');
    }
    this.ctx = new AudioContextClass();
    this.master = this.ctx.createGain();
    this.sourceBus = this.ctx.createGain();
    this.lineGain = this.ctx.createGain();
    this.fileGain = this.ctx.createGain();
    this.mixSplitter = this.ctx.createChannelSplitter(2);

    this.lineGain.connect(this.sourceBus);
    this.fileGain.connect(this.sourceBus);
    this.sourceBus.connect(this.mixSplitter);
    this.master.connect(this.ctx.destination);
    this.createHardwareRoutes();
    this.updateListenerTransform();
  }

  createHardwareRoutes() {
    this.createDspRoutes();
    this.createSpeakerRoutes();
  }

  createDspRoutes() {
    for (const channel of this.appScene.hardware.dsp.channels) {
      const inputGain = this.ctx.createGain();
      const highpass = this.ctx.createBiquadFilter();
      const peq = this.ctx.createBiquadFilter();
      const lowpass = this.ctx.createBiquadFilter();
      const delay = this.ctx.createDelay(0.25);
      const outputGain = this.ctx.createGain();

      highpass.type = 'highpass';
      peq.type = 'peaking';
      lowpass.type = 'lowpass';

      inputGain.connect(highpass);
      highpass.connect(peq);
      peq.connect(lowpass);
      lowpass.connect(delay);
      delay.connect(outputGain);

      const splitterIndex = channel.channel === 'R' ? 1 : 0;
      this.mixSplitter.connect(inputGain, splitterIndex, 0);
      this.dspRoutes.set(channel.output, { channel, inputGain, highpass, peq, lowpass, delay, outputGain });
    }
    this.updateDspFromControls();
  }

  createSpeakerRoutes() {
    for (const amp of this.appScene.hardware.amps) {
      for (const ampChannel of amp.channels) {
        const speaker = this.appScene.speakers.find(entry => entry.id === ampChannel.speakerId);
        const dspRoute = this.dspRoutes.get(ampChannel.input);
        if (!speaker || !dspRoute) {
          continue;
        }
        const gain = this.ctx.createGain();
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 60;
        panner.rolloffFactor = 0.8;
        panner.coneInnerAngle = 90;
        panner.coneOuterAngle = 220;
        panner.coneOuterGain = 0.28;
        setAudioParam(panner.positionX, speaker.position[0]);
        setAudioParam(panner.positionY, speaker.position[1]);
        setAudioParam(panner.positionZ, speaker.position[2]);

        gain.gain.value = ampChannel.muted ? 0 : ampChannel.gain;
        dspRoute.outputGain.connect(gain);
        gain.connect(panner);
        panner.connect(this.master);
        this.speakerRoutes.set(speaker.id, { speaker, amp, ampChannel, gain, panner });
      }
    }
  }

  updateSpeakerRoutes() {
    this.updateListenerTransform();
    for (const route of this.speakerRoutes.values()) {
      const speaker = route.speaker;
      setAudioParam(route.panner.positionX, speaker.position[0]);
      setAudioParam(route.panner.positionY, speaker.position[1]);
      setAudioParam(route.panner.positionZ, speaker.position[2]);
      const control = this.controls.speakerGainContainer?.querySelector(`[data-amp-channel-gain="${route.ampChannel.id}"]`);
      if (control) {
        route.ampChannel.gain = Number(control.value);
        route.gain.gain.setTargetAtTime(route.ampChannel.muted ? 0 : route.ampChannel.gain, this.ctx.currentTime, 0.015);
      }
    }
  }

  updateDspFromControls() {
    const hardwareDsp = this.appScene.hardware.dsp;
    for (const route of this.dspRoutes.values()) {
      const isRight = route.channel.channel === 'R';
      const blocks = route.channel.blocks;
      blocks.inputGain.gain = Number((isRight ? this.controls.dspInputGainR : this.controls.dspInputGainL)?.value ?? 1);
      blocks.highpass.frequency = Number(this.controls.dspHighpass?.value ?? 20);
      blocks.peq.frequency = Number(this.controls.dspPeqFrequency?.value ?? 1000);
      blocks.peq.gainDb = Number(this.controls.dspPeqGain?.value ?? 0);
      blocks.peq.q = Number(this.controls.dspPeqQ?.value ?? 1);
      blocks.lowpass.frequency = Number(this.controls.dspLowpass?.value ?? 20000);
      blocks.delay.delayMs = Number((isRight ? this.controls.dspDelayR : this.controls.dspDelayL)?.value ?? 0);
      blocks.outputGain.gain = Number((isRight ? this.controls.dspOutputGainR : this.controls.dspOutputGainL)?.value ?? 1);

      route.inputGain.gain.setTargetAtTime(blocks.inputGain.gain, this.ctx.currentTime, 0.015);
      route.highpass.frequency.setTargetAtTime(blocks.highpass.frequency, this.ctx.currentTime, 0.015);
      route.highpass.Q.setTargetAtTime(blocks.highpass.q, this.ctx.currentTime, 0.015);
      route.peq.frequency.setTargetAtTime(blocks.peq.frequency, this.ctx.currentTime, 0.015);
      route.peq.gain.setTargetAtTime(blocks.peq.gainDb, this.ctx.currentTime, 0.015);
      route.peq.Q.setTargetAtTime(blocks.peq.q, this.ctx.currentTime, 0.015);
      route.lowpass.frequency.setTargetAtTime(blocks.lowpass.frequency, this.ctx.currentTime, 0.015);
      route.lowpass.Q.setTargetAtTime(blocks.lowpass.q, this.ctx.currentTime, 0.015);
      route.delay.delayTime.setTargetAtTime(blocks.delay.delayMs / 1000, this.ctx.currentTime, 0.015);
      route.outputGain.gain.setTargetAtTime(blocks.outputGain.gain, this.ctx.currentTime, 0.015);
    }

    if (this.controls.dspSummary) {
      this.controls.dspSummary.textContent = `${hardwareDsp.name}: Mix Out L/R -> DSP -> Amp -> Speakers`;
    }
  }

  updateListenerTransform() {
    if (!this.ctx?.listener) {
      return;
    }
    const listener = this.appScene.listener;
    const yaw = degToRad(listener.yaw ?? 0);
    const pitch = degToRad(listener.pitch ?? 0);
    const forward = [
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ];
    const up = [0, 1, 0];
    setAudioParam(this.ctx.listener.positionX, listener.position[0]);
    setAudioParam(this.ctx.listener.positionY, listener.position[1]);
    setAudioParam(this.ctx.listener.positionZ, listener.position[2]);
    if (this.ctx.listener.forwardX) {
      setAudioParam(this.ctx.listener.forwardX, forward[0]);
      setAudioParam(this.ctx.listener.forwardY, forward[1]);
      setAudioParam(this.ctx.listener.forwardZ, forward[2]);
      setAudioParam(this.ctx.listener.upX, up[0]);
      setAudioParam(this.ctx.listener.upY, up[1]);
      setAudioParam(this.ctx.listener.upZ, up[2]);
    } else if (this.ctx.listener.setOrientation) {
      this.ctx.listener.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  async refreshInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices || !this.controls.deviceSelect) {
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    const selected = this.controls.deviceSelect.value;
    this.controls.deviceSelect.replaceChildren(new Option('Default input', ''));
    for (const device of audioInputs) {
      this.controls.deviceSelect.append(new Option(device.label || `Input ${this.controls.deviceSelect.length}`, device.deviceId));
    }
    if ([...this.controls.deviceSelect.options].some(option => option.value === selected)) {
      this.controls.deviceSelect.value = selected;
    }
  }

  async toggleLineInput() {
    await this.start();
    if (this.lineEnabled) {
      this.stopLineInput();
      return;
    }
    await this.enableLineInput();
  }

  async restartLineInputIfNeeded() {
    if (!this.lineEnabled) {
      return;
    }
    this.stopLineInput({ silent: true });
    await this.enableLineInput();
  }

  async enableLineInput() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Line-in capture is not available in this browser.');
    }
    const deviceId = this.controls.deviceSelect?.value;
    const constraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    };
    this.lineStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.lineSource = this.ctx.createMediaStreamSource(this.lineStream);
    this.lineSource.connect(this.lineGain);
    this.lineEnabled = true;
    if (this.controls.lineButton) {
      this.controls.lineButton.textContent = 'Stop line-in';
    }
    await this.refreshInputDevices();
    this.updateStatus('Line-in enabled and routed through the DSP hardware chain.');
  }

  stopLineInput({ silent = false } = {}) {
    this.lineSource?.disconnect();
    this.lineSource = null;
    for (const track of this.lineStream?.getTracks() ?? []) {
      track.stop();
    }
    this.lineStream = null;
    this.lineEnabled = false;
    if (this.controls.lineButton) {
      this.controls.lineButton.textContent = 'Enable line-in';
    }
    if (!silent) {
      this.updateStatus('Line-in stopped.');
    }
  }

  async loadFile(file) {
    if (!file) {
      return;
    }
    await this.start();
    if (this.fileObjectUrl) {
      URL.revokeObjectURL(this.fileObjectUrl);
    }
    this.fileObjectUrl = URL.createObjectURL(file);
    this.audioElement.src = this.fileObjectUrl;
    this.audioElement.load();
    if (!this.fileSource) {
      this.fileSource = this.ctx.createMediaElementSource(this.audioElement);
      this.fileSource.connect(this.fileGain);
    }
    if (this.controls.fileName) {
      this.controls.fileName.textContent = file.name;
    }
    this.updateTransportUi();
    this.updateStatus(`Loaded ${file.name}.`);
  }

  async toggleFilePlayback() {
    await this.start();
    if (!this.audioElement.src) {
      this.updateStatus('Load a local audio file before playback.');
      return;
    }
    if (this.audioElement.paused) {
      await this.audioElement.play();
    } else {
      this.audioElement.pause();
    }
    this.updateTransportUi();
  }

  seekFile() {
    if (!Number.isFinite(this.audioElement.duration) || !this.controls.fileSeek) {
      return;
    }
    this.audioElement.currentTime = (Number(this.controls.fileSeek.value) / 1000) * this.audioElement.duration;
    this.updateFileTimeUi();
  }

  updateSourceGains() {
    if (!this.ctx) {
      return;
    }
    const blend = Number(this.controls.sourceBlend?.value ?? 0);
    const lineBlend = blend <= 0 ? 1 : 1 - blend;
    const fileBlend = blend >= 0 ? 1 : 1 + blend;
    const line = Number(this.controls.lineGain?.value ?? 0.8) * lineBlend;
    const file = Number(this.controls.fileGain?.value ?? 0.8) * fileBlend;
    this.lineGain.gain.setTargetAtTime(line, this.ctx.currentTime, 0.015);
    this.fileGain.gain.setTargetAtTime(file, this.ctx.currentTime, 0.015);
    if (this.controls.lineGainValue) this.controls.lineGainValue.textContent = line.toFixed(2);
    if (this.controls.fileGainValue) this.controls.fileGainValue.textContent = file.toFixed(2);
  }

  updateMasterGain() {
    if (!this.ctx) {
      return;
    }
    const value = Number(this.controls.masterGain?.value ?? 0.8);
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
    if (this.controls.masterGainValue) {
      this.controls.masterGainValue.textContent = value.toFixed(2);
    }
  }

  renderSpeakerControls() {
    const container = this.controls.speakerGainContainer;
    if (!container) {
      return;
    }
    container.replaceChildren();
    for (const speaker of this.appScene.speakers) {
      const label = document.createElement('label');
      label.className = 'field speaker-gain';
      const route = findAmpChannelForSpeaker(this.appScene.hardware, speaker.id);
      label.textContent = route ? `${route.amp.name} ${route.channel.name} -> ${speaker.name}` : speaker.name;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1.5';
      input.step = '0.01';
      input.value = String(route?.channel.gain ?? 0.9);
      input.dataset.speakerGain = speaker.id;
      if (route) {
        input.dataset.ampChannelGain = route.channel.id;
      }
      input.addEventListener('input', () => this.updateSpeakerRoutes());
      label.append(input);
      container.append(label);
    }
  }

  renderHardwareGraph() {
    if (!this.controls.hardwareGraph) {
      return;
    }
    const graph = this.appScene.hardware;
    this.controls.hardwareGraph.replaceChildren();
    if (!this.routingNodes) {
      this.routingNodes = createInitialRoutingNodes(graph, this.appScene.speakers);
      this.selectedRoutingNodeId = graph.dsp.id;
    }

    const workspace = document.createElement('div');
    workspace.className = 'routing-workspace';
    const toolbox = this.createRoutingToolbox();
    const surface = document.createElement('div');
    surface.className = 'routing-surface';
    surface.addEventListener('dragover', event => event.preventDefault());
    surface.addEventListener('drop', event => {
      event.preventDefault();
      const type = event.dataTransfer?.getData('application/x-auralisator-node');
      if (!type) return;
      const rect = surface.getBoundingClientRect();
      this.addRoutingNode(type, event.clientX - rect.left, event.clientY - rect.top);
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('routing-wires');
    surface.append(svg);
    for (const node of this.routingNodes) {
      surface.append(this.createRoutingNodeCard(node, surface));
    }

    const inspector = this.createRoutingInspector();
    workspace.append(toolbox, surface, inspector);
    this.controls.hardwareGraph.append(workspace);
    requestAnimationFrame(() => this.renderRoutingWires(surface, svg));
    if (this.controls.dspSummary) {
      this.controls.dspSummary.textContent = `${graph.dsp.name}: drag modules from the toolbox, select DSP/filter nodes to edit processing.`;
    }
  }

  createRoutingToolbox() {
    const toolbox = document.createElement('aside');
    toolbox.className = 'routing-toolbox';
    const title = document.createElement('h4');
    title.textContent = 'Toolbox';
    toolbox.append(title);
    for (const item of ROUTING_TOOLBOX) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toolbox-item';
      button.draggable = true;
      button.dataset.nodeType = item.type;
      button.innerHTML = `<span class="object-icon ${item.type}"></span><strong>${item.title}</strong><small>${item.meta}</small>`;
      button.onclick = event => {
        event.preventDefault();
        this.addRoutingNode(item.type);
      };
      button.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.addRoutingNode(item.type);
        }
      };
      button.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('application/x-auralisator-node', item.type);
      });
      toolbox.append(button);
    }
    return toolbox;
  }

  createRoutingNodeCard(node, surface) {
    const card = document.createElement('article');
    card.className = `routing-node routing-node-${node.type}`;
    card.dataset.nodeId = node.id;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    if (node.id === this.selectedRoutingNodeId) {
      card.classList.add('selected');
    }
    card.innerHTML = `
      <div class="routing-node-face">
        <span class="object-icon ${node.type}"></span>
        <div><strong>${node.title}</strong><small>${node.meta}</small></div>
      </div>
      <div class="routing-node-body">${renderNodeBody(node)}</div>
      <div class="routing-node-ports">
        ${node.ports.map(port => `<span class="node-port ${port.kind}" data-port="${port.id}">${port.label}</span>`).join('')}
      </div>
    `;
    card.addEventListener('click', event => {
      event.stopPropagation();
      this.selectedRoutingNodeId = node.id;
      this.renderHardwareGraph();
    });
    card.addEventListener('pointerdown', event => this.beginRoutingDrag(event, node, card, surface));
    return card;
  }

  beginRoutingDrag(event, node, card, surface) {
    if (event.button !== 0) return;
    const rect = surface.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = node.x;
    const originalY = node.y;
    card.setPointerCapture?.(event.pointerId);
    const move = moveEvent => {
      node.x = clampNumber(originalX + moveEvent.clientX - startX, 12, rect.width - 190, originalX);
      node.y = clampNumber(originalY + moveEvent.clientY - startY, 12, rect.height - 130, originalY);
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
      const svg = surface.querySelector('.routing-wires');
      this.renderRoutingWires(surface, svg);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  }

  addRoutingNode(type, x = 56, y = 56) {
    const template = ROUTING_TOOLBOX.find(item => item.type === type) ?? ROUTING_TOOLBOX[0];
    const id = `${type}_${String(this.routingNodeCounter).padStart(2, '0')}`;
    this.routingNodeCounter += 1;
    this.routingNodes.push({
      id,
      type,
      title: template.title,
      meta: template.meta,
      x: Math.round(x),
      y: Math.round(y),
      ports: template.ports.map(port => ({ ...port, id: `${id}_${port.id}` }))
    });
    this.selectedRoutingNodeId = id;
    this.renderHardwareGraph();
  }

  createRoutingInspector() {
    const node = this.routingNodes.find(entry => entry.id === this.selectedRoutingNodeId) ?? this.routingNodes[0];
    const inspector = document.createElement('aside');
    inspector.className = 'routing-inspector';
    const heading = document.createElement('h4');
    heading.textContent = node ? node.title : 'Inspector';
    inspector.append(heading);
    if (!node) {
      return inspector;
    }
    const meta = document.createElement('p');
    meta.textContent = node.meta;
    inspector.append(meta);
    if (node.type === 'dsp' || node.type === 'filter') {
      const hint = document.createElement('div');
      hint.className = 'routing-inspector-note';
      hint.textContent = 'DSP controls below edit the active hardware chain: input gain, HPF, PEQ, LPF, delay, and output gain.';
      inspector.append(hint);
    }
    const ports = document.createElement('div');
    ports.className = 'routing-inspector-ports';
    for (const port of node.ports) {
      const item = document.createElement('span');
      item.textContent = `${port.kind.toUpperCase()} ${port.label}`;
      ports.append(item);
    }
    inspector.append(ports);
    return inspector;
  }

  renderRoutingWires(surface, svg) {
    if (!surface || !svg) return;
    svg.replaceChildren();
    const surfaceRect = surface.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${surfaceRect.width} ${surfaceRect.height}`);
    for (const connection of flattenHardwareConnections(this.appScene.hardware)) {
      const from = findRoutingPort(surface, connection.from, 'out');
      const to = findRoutingPort(surface, connection.to, 'in');
      if (!from || !to) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const a = centerRelativeTo(from, surfaceRect);
      const b = centerRelativeTo(to, surfaceRect);
      const mid = Math.max(60, Math.abs(b.x - a.x) * 0.45);
      path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + mid} ${a.y}, ${b.x - mid} ${b.y}, ${b.x} ${b.y}`);
      path.setAttribute('class', `routing-wire ${connection.type}`);
      svg.append(path);
    }
  }

  updateFileTimeUi() {
    const duration = Number.isFinite(this.audioElement.duration) ? this.audioElement.duration : 0;
    const current = this.audioElement.currentTime || 0;
    if (this.controls.fileSeek && duration > 0) {
      this.controls.fileSeek.value = String(Math.round((current / duration) * 1000));
    }
    if (this.controls.fileTime) {
      this.controls.fileTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    }
    this.updateTransportUi();
  }

  updateTransportUi() {
    if (this.controls.filePlayButton) {
      this.controls.filePlayButton.textContent = this.audioElement.paused ? 'Play file' : 'Pause file';
    }
  }

  updateStatus(message) {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function setAudioParam(param, value) {
  if (param?.setTargetAtTime) {
    param.setTargetAtTime(value, param.context?.currentTime ?? 0, 0.015);
  }
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function degToRad(degrees) {
  return degrees * Math.PI / 180;
}

function findAmpChannelForSpeaker(graph, speakerId) {
  for (const amp of graph.amps) {
    for (const channel of amp.channels) {
      if (channel.speakerId === speakerId) {
        return { amp, channel };
      }
    }
  }
  return null;
}

function createInitialRoutingNodes(graph, speakers) {
  const nodes = [
    {
      id: 'sources',
      type: 'input',
      title: 'Computer Inputs',
      meta: 'Line-in + local player',
      x: 40,
      y: 70,
      ports: [{ id: 'source_l', label: 'L', kind: 'out' }, { id: 'source_r', label: 'R', kind: 'out' }]
    },
    {
      id: 'mix_bus',
      type: 'mix',
      title: 'Mix Out L/R',
      meta: 'real stereo mix bus',
      x: 290,
      y: 80,
      ports: graph.mixOutputs.map(output => ({ id: output.id, label: output.id, kind: 'out' }))
    },
    {
      id: graph.dsp.id,
      type: 'dsp',
      title: graph.dsp.name,
      meta: 'click to edit filters',
      x: 560,
      y: 60,
      ports: [
        ...graph.dsp.inputs.map(input => ({ id: input.id, label: input.id, kind: 'in' })),
        ...graph.dsp.outputs.map(output => ({ id: output.id, label: output.id, kind: 'out' }))
      ]
    }
  ];

  let y = 72;
  for (const amp of graph.amps) {
    for (const channel of amp.channels) {
      nodes.push({
        id: channel.id,
        type: 'amp',
        title: channel.name,
        meta: `${amp.name} / ${amp.maxWattsPerChannel} W`,
        x: 860,
        y,
        ports: [
          { id: channel.id, label: channel.input, kind: 'in' },
          { id: channel.id, label: channel.id, kind: 'out' }
        ]
      });
      y += 180;
    }
  }

  y = 72;
  for (const speaker of speakers) {
    nodes.push({
      id: speaker.id,
      type: 'speaker',
      title: speaker.name,
      meta: speaker.id,
      x: 1120,
      y,
      ports: [{ id: speaker.id, label: speaker.id, kind: 'in' }]
    });
    y += 180;
  }
  return nodes;
}

function renderNodeBody(node) {
  if (node.type === 'dsp') {
    return '<div class="rack-strip"><span>IN</span><span>HPF</span><span>PEQ</span><span>LPF</span><span>DLY</span><span>OUT</span></div>';
  }
  if (node.type === 'amp') {
    return '<div class="amp-face"><i></i><i></i><b></b></div>';
  }
  if (node.type === 'speaker') {
    return '<div class="speaker-face"><i></i><b></b></div>';
  }
  if (node.type === 'filter') {
    return '<div class="filter-face"><span></span><span></span><span></span></div>';
  }
  return '<div class="meter-face"><span></span><span></span></div>';
}

function findRoutingPort(surface, portId, preferredKind) {
  const exact = surface.querySelector(`[data-port="${CSS.escape(portId)}"].${preferredKind}`);
  if (exact) return exact;
  return surface.querySelector(`[data-port="${CSS.escape(portId)}"]`);
}

function centerRelativeTo(element, containerRect) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - containerRect.left + rect.width / 2,
    y: rect.top - containerRect.top + rect.height / 2
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function createNodeColumn(title, nodes) {
  const column = document.createElement('section');
  column.className = 'node-column';
  const heading = document.createElement('h4');
  heading.textContent = title;
  column.append(heading);
  for (const node of nodes) {
    column.append(createNodeCard(node));
  }
  return column;
}

function createNodeCard(node) {
  const card = document.createElement('article');
  card.className = 'node-card';
  card.dataset.nodeId = node.id;

  const header = document.createElement('div');
  header.className = 'node-card-header';
  const title = document.createElement('strong');
  title.textContent = node.title;
  const meta = document.createElement('span');
  meta.textContent = node.meta;
  header.append(title, meta);
  card.append(header);

  if (node.blocks?.length) {
    const blocks = document.createElement('div');
    blocks.className = 'node-block-stack';
    for (const block of node.blocks) {
      const item = document.createElement('span');
      item.textContent = block;
      blocks.append(item);
    }
    card.append(blocks);
  }

  const ports = document.createElement('div');
  ports.className = 'node-ports';
  for (const port of node.ports) {
    const item = document.createElement('span');
    item.className = `node-port ${port.kind}`;
    item.textContent = port.label;
    ports.append(item);
  }
  card.append(ports);
  return card;
}
