export function createDefaultAuralisatorScene() {
  return {
    id: 'default-studio',
    units: 'meters',
    bounds: {
      min: [-12, 0, -8],
      max: [12, 6, 8]
    },
    listener: {
      id: 'listener',
      position: [0, 1.6, 2.5],
      yaw: 180,
      pitch: 0
    },
    speakers: [
      {
        id: 'speaker_l',
        name: 'Left',
        position: [-2.2, 1.4, -3.2],
        aim: [0.52, -0.05, 0.85],
        gainDb: 0,
        delayMs: 0,
        directivity: 0.35
      },
      {
        id: 'speaker_r',
        name: 'Right',
        position: [2.2, 1.4, -3.2],
        aim: [-0.52, -0.05, 0.85],
        gainDb: 0,
        delayMs: 0,
        directivity: 0.35
      }
    ],
    walls: [
      makeWall('front', 'Front wall', [0, 3, -5], [12, 6, 0.18], 'absorber'),
      makeWall('back', 'Back wall', [0, 3, 5], [12, 6, 0.18], 'brick'),
      makeWall('left', 'Left wall', [-6, 3, 0], [0.18, 6, 10], 'concrete'),
      makeWall('right', 'Right wall', [6, 3, 0], [0.18, 6, 10], 'glass'),
      makeWall('ceiling', 'Ceiling', [0, 6, 0], [12, 0.18, 10], 'absorber')
    ],
    rooms: [
      {
        id: 'room_main',
        name: 'Main room',
        wallIds: ['front', 'back', 'left', 'right', 'ceiling']
      }
    ],
    acoustic: {
      activeBakeId: null,
      previewProbeSpacing: 4,
      runtimeMode: 'baked-field'
    }
  };
}

export function summarizeScene(scene) {
  return {
    speakers: scene.speakers.length,
    walls: scene.walls.length,
    rooms: scene.rooms.length,
    bounds: scene.bounds
  };
}

function makeWall(id, name, position, size, material) {
  return {
    id,
    name,
    position,
    size,
    rotation: [0, 0, 0],
    material
  };
}
