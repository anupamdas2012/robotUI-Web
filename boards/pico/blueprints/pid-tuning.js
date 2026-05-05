// PID Tuning blueprint — placeholder layout for the (not-yet-implemented)
// PID firmware. Once the Pico emits $PID,setpointL,actualL,errorL,...
// these plots populate. The PidControls view is fully functional today
// and will work once firmware accepts PID: commands.

registerBlueprint('pid-tuning', {
  name: 'PID Tuning',
  layout: 'grid',
  views: [
    {
      type: 'plot',
      id: 'pid_setpoint_actual',
      title: 'Setpoint vs Actual (RPM)',
      series: [
        { label: 'Setpoint', color: '#f59e0b' },
        { label: 'Actual',   color: '#4cc9f0' },
      ],
      // Placeholder routing from $MOT until $PID exists in firmware.
      routes: [
        { prefix: '$MOT', map: (parts) => [0, parseFloat(parts[1])] },
      ],
    },
    {
      type: 'plot',
      id: 'pid_error',
      title: 'Error',
      series: [{ label: 'Error', color: '#f72585' }],
      routes: [
        { prefix: '$MOT', map: (parts) => [0 - parseFloat(parts[1])] },
      ],
    },
    {
      type: 'pid-controls',
      id: 'pid_controls',
      title: 'PID Controls',
      config: { kP: 0.5, kI: 0.1, kD: 0.05, setpoint: 50 },
    },
  ],
});
