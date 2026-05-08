// Perception blueprint — what the robot senses about its surroundings.
// Currently a single camera view; will grow to include audio meters, depth
// (VL53L5CX), and other perceptual streams as they come online.
//
// Stream URL is read from CONFIG.cameraStreamUrl in config.js so the IP
// can change per WiFi network without editing this file. Override per-view
// by setting `config: { streamUrl: '...' }` on the spec below.

registerBlueprint('perception', {
  name: 'Perception',
  layout: 'grid',
  views: [
    {
      type: 'vision',
      id: 'camera_main',
      title: 'Camera',
      // config: { streamUrl: 'http://...' },   // override CONFIG.cameraStreamUrl
    },
  ],
});
