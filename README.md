# MMM-Dimmer

A MagicMirror module that dims the screen using:
1) a fullscreen black overlay (opacity), and
2) real backlight control via `/sys/class/backlight` (prefers `intel_backlight`).


---


## Installation
Clone into your MagicMirror `modules` folder:

- `modules/MMM-Dimmer`

## Config example

{
  module: "MMM-Dimmer",
  position: "fullscreen_above",
  config: {
    schedules: [
      {
        brightTime: 530,
        dimTime: 1800,
        maxDim: 0.5
      }
    ],
    backlight: {
      enabled: true,
      device: "intel_backlight", // or "auto"
      minBrightness: 3,
      maxBrightness: 100,
      throttleMs: 750
    }
  }
}
