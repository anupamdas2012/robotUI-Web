// Dashboard appearance config. Edit values here and reload to apply.
//
// Three orthogonal axes — mix freely.
//
// theme:    palette only (surface colors + chart series).
//           'original' | 'tetvision' | 'tetlight' | 'mocha' | 'gruvbox' |
//           'nord' | 'forest' | 'azure' | 'apple'
//
// chrome:   panel typography + ornament. Independent from palette, so you
//           can pair e.g. 'apple' colors with TET corner brackets + ALL-CAPS
//           titles.
//           'none' (default rounded-card material look)
//           'tet'  (Oblivion HUD: corner brackets, hairline borders, ALL-CAPS
//                  monospace, READOUT.PASS suffix, hatched paused state)
//
// gradient: chart-canvas background fill.
//           'none' | 'wash' | 'spotlight' | 'diagonal' | 'dual' | 'hatch'
//           'hatch' is the diagonal alarm-stripe overlay (great with chrome=tet
//           but works under any palette via the --tet-alarm-rgb token).
//
// uiAnimations: master switch for all UI animations (gradient rise, dialog
//               pop-in, etc.). Set false to make everything snap into place.
//
// cameraStreamUrl: MJPEG stream from the robot's ESP32 brain. Used by the
//               Vision blueprint. The ESP32 prints its IP to serial on boot;
//               update this when the WiFi network (or static-IP slot) changes.

const CONFIG = {
  theme:           'tetvision',
  chrome:          'tet',
  gradient:        'hatch',
  uiAnimations:    true,
  cameraStreamUrl: 'http://192.168.1.220:81/stream',
};
