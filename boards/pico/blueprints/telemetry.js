// Telemetry blueprint — 4 plots routed from Pico telemetry stream.

registerBlueprint('telemetry', {
  name: 'Telemetry',
  layout: 'grid',
  views: [
    {
      type: 'plot',
      id: 'rpm',
      title: 'Motor RPM',
      series: [
        { label: 'L', color: '#4cc9f0' },
        { label: 'R', color: '#f72585' },
      ],
      routes: [
        { prefix: '$MOT', map: (parts) => [parseFloat(parts[1]), parseFloat(parts[2])] },
      ],
    },
    {
      type: 'plot',
      id: 'tof',
      title: 'ToF Distance',
      series: [
        {
          label: 'Distance',
          color: '#4ade80',
          format: (label, v) => (v == null ? `${label}: --` : `${v.toFixed(0)} mm`),
        },
      ],
      routes: [
        {
          prefix: '$TOF',
          map: (parts) => [parts[2] === '1' ? parseInt(parts[1], 10) : null],
        },
      ],
    },
    {
      type: 'plot',
      id: 'imu',
      title: 'IMU Orientation',
      series: [
        { label: 'H', color: '#f59e0b' },
        { label: 'P', color: '#4cc9f0' },
        { label: 'R', color: '#f72585' },
      ],
      routes: [
        {
          prefix: '$IMU',
          map: (parts) => [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])],
        },
      ],
    },
    {
      type: 'plot',
      id: 'loop',
      title: 'Loop Timing (µs)',
      series: [
        { label: 'Avg', color: '#8b5cf6', format: (label, v) => (v == null ? `${label}: --` : `${label}: ${v | 0}us`) },
        { label: 'Max', color: '#ef4444', format: (label, v) => (v == null ? `${label}: --` : `${label}: ${v | 0}us`) },
      ],
      routes: [
        { prefix: '$MOT', map: (parts) => [parseInt(parts[5], 10), parseInt(parts[6], 10)] },
      ],
    },
  ],
});
