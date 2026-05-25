export function createDefaultHardwareGraph(speakers = []) {
  const leftSpeaker = speakers[0]?.id ?? null;
  const rightSpeaker = speakers[1]?.id ?? leftSpeaker;
  return {
    mixOutputs: [
      { id: 'mix_l', name: 'Mix Out L', channel: 'L' },
      { id: 'mix_r', name: 'Mix Out R', channel: 'R' }
    ],
    dsp: {
      id: 'dsp_main',
      name: 'Sigma-style DSP',
      inputs: [
        { id: 'dsp_in_l', name: 'Input L', source: 'mix_l', channel: 'L' },
        { id: 'dsp_in_r', name: 'Input R', source: 'mix_r', channel: 'R' }
      ],
      channels: [
        createDspChannel('L', 'dsp_in_l', 'dsp_out_l'),
        createDspChannel('R', 'dsp_in_r', 'dsp_out_r')
      ],
      outputs: [
        { id: 'dsp_out_l', name: 'DSP Out L', channel: 'L' },
        { id: 'dsp_out_r', name: 'DSP Out R', channel: 'R' }
      ]
    },
    amps: [
      {
        id: 'amp_main',
        name: 'Stereo Amp A',
        inputSensitivityVrms: 1.4,
        maxWattsPerChannel: 250,
        channels: [
          { id: 'amp_a_ch1', name: 'Amp A CH1', input: 'dsp_out_l', speakerId: leftSpeaker, gain: 0.9, muted: false },
          { id: 'amp_a_ch2', name: 'Amp A CH2', input: 'dsp_out_r', speakerId: rightSpeaker, gain: 0.9, muted: false }
        ]
      }
    ]
  };
}

export function summarizeHardwareGraph(graph) {
  return {
    mixOutputs: graph.mixOutputs.length,
    dspInputs: graph.dsp.inputs.length,
    dspOutputs: graph.dsp.outputs.length,
    amps: graph.amps.length,
    ampChannels: graph.amps.reduce((sum, amp) => sum + amp.channels.length, 0),
    connections: flattenHardwareConnections(graph).length
  };
}

export function flattenHardwareConnections(graph) {
  const connections = [];
  for (const input of graph.dsp.inputs) {
    connections.push({ from: input.source, to: input.id, type: 'mix-to-dsp' });
  }
  for (const channel of graph.dsp.channels) {
    connections.push({ from: channel.input, to: channel.output, type: 'dsp-chain' });
  }
  for (const amp of graph.amps) {
    for (const channel of amp.channels) {
      connections.push({ from: channel.input, to: channel.id, type: 'dsp-to-amp' });
      if (channel.speakerId) {
        connections.push({ from: channel.id, to: channel.speakerId, type: 'amp-to-speaker' });
      }
    }
  }
  return connections;
}

function createDspChannel(channel, input, output) {
  return {
    channel,
    input,
    output,
    blocks: {
      inputGain: { type: 'gain', gain: 1 },
      highpass: { type: 'highpass', enabled: true, frequency: 20, q: 0.707 },
      peq: { type: 'peaking', enabled: true, frequency: 1000, q: 1, gainDb: 0 },
      lowpass: { type: 'lowpass', enabled: true, frequency: 20000, q: 0.707 },
      delay: { type: 'delay', delayMs: 0, maxDelayMs: 250 },
      outputGain: { type: 'gain', gain: 1 }
    }
  };
}
