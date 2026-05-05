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
        { label: 'L', color: 'cyan' },
        { label: 'R', color: 'pink' },
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
          color: 'green',
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
        { label: 'H', color: 'amber' },
        { label: 'P', color: 'cyan' },
        { label: 'R', color: 'pink' },
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
        { label: 'Avg', color: 'purple', format: (label, v) => (v == null ? `${label}: --` : `${label}: ${v | 0}us`) },
        { label: 'Max', color: 'red',    format: (label, v) => (v == null ? `${label}: --` : `${label}: ${v | 0}us`) },
      ],
      routes: [
        { prefix: '$MOT', map: (parts) => [parseInt(parts[5], 10), parseInt(parts[6], 10)] },
      ],
    },
  ],
});
