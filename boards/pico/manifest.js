// Pico 2 Rover board manifest — single source of truth for the wire
// protocol, expected components, default blueprints, and source config.
// The dashboard reads this; the firmware (pico2motor/) implements it.
// Keep them in sync — see pico2motor/CLAUDE.md "Serial Protocol" section.

registerBoardManifest({
  id: 'pico-rover',
  name: 'Pico 2 Rover',
  mcu: 'RP2350',

  // How the dashboard talks to this board.
  source: {
    type: 'web-serial',
    baudRate: 115200,
    // (vid:0x2E8A is Raspberry Pi if we ever want to filter the picker)
  },

  // Wire protocol declaration. Field names map to positional parts in the
  // CSV stream — index 0 is the prefix, fields[i] is parts[i+1].
  messages: {
    $STA: { fields: ['imuConn', 'tofConn', 'clfConn'] },
    $MOT: {
      fields: ['rpmL', 'rpmR', 'angleL', 'angleR', 'loopAvgUs', 'loopMaxUs'],
    },
    $IMU: {
      fields: ['heading', 'pitch', 'roll', 'calSys', 'calGyro', 'calAccel', 'calMag'],
    },
    $TOF: { fields: ['distMM', 'valid'] },
    $CLF: { fields: ['rawL', 'rawC', 'rawR', 'detected'] },
  },

  // Hardware components — drives the topbar status pills. `from` declares
  // how the dashboard knows the component's state:
  //   { msg, alwaysOn: true }       — green whenever any line arrives
  //   { msg, field: '<fieldName>' } — read from msg's field; '1' = on
  components: [
    { id: 'motors', name: 'Motors', from: { msg: '$STA', alwaysOn: true } },
    { id: 'imu',    name: 'IMU',    from: { msg: '$STA', field: 'imuConn' } },
    { id: 'tof',    name: 'ToF',    from: { msg: '$STA', field: 'tofConn' } },
  ],

  // Blueprints this board ships with (registered by their own files).
  blueprints: ['telemetry', 'pid-tuning', 'perception'],

  // Commands the firmware accepts — exposed for future auto-built command UI.
  commands: {
    MOVE: { args: ['leftPwm:int', 'rightPwm:int'] },
    STOP: { args: [] },
    PING: { args: [] },
    PID: { args: ['kP:float', 'kI:float', 'kD:float', 'setpoint:float'] },
  },
});
