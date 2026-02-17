/* node_helper.js
 * Handles backlight writes via /sys/class/backlight
 */

const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}

function readInt(p) {
  return parseInt(fs.readFileSync(p, "utf8").trim(), 10);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = NodeHelper.create({
  start() {
    this.device = null;
    this.maxBrightness = null;
    this.lastWritten = null;
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "DIMMER_INIT") {
      this.initBacklight(payload);
      return;
    }

    if (notification === "DIMMER_SET_BRIGHTNESS") {
      this.setBrightnessPercent(payload);
      return;
    }
  },

  initBacklight(config) {
    const backlightCfg = (config && config.backlight) || {};
    const enabled = backlightCfg.enabled === true;

    if (!enabled) {
      this.sendSocketNotification("DIMMER_BACKLIGHT_STATUS", {
        enabled: false,
        reason: "Backlight control disabled in config"
      });
      return;
    }

    const preferred = backlightCfg.device || "auto";
    const dir = "/sys/class/backlight";

    if (!exists(dir)) {
      this.sendSocketNotification("DIMMER_BACKLIGHT_STATUS", {
        enabled: false,
        reason: "/sys/class/backlight not found"
      });
      return;
    }

    let devices = [];
    try {
      devices = fs.readdirSync(dir).filter(Boolean);
    } catch (e) {
      devices = [];
    }

    let chosen = null;

    if (preferred !== "auto") {
      if (devices.includes(preferred)) chosen = preferred;
    } else {
      if (devices.includes("intel_backlight")) chosen = "intel_backlight";
      else if (devices.length > 0) chosen = devices[0];
    }

    if (!chosen) {
      this.sendSocketNotification("DIMMER_BACKLIGHT_STATUS", {
        enabled: false,
        reason: "No backlight devices found"
      });
      return;
    }

    const base = path.join(dir, chosen);
    const maxPath = path.join(base, "max_brightness");
    const brightPath = path.join(base, "brightness");

    if (!exists(maxPath) || !exists(brightPath)) {
      this.sendSocketNotification("DIMMER_BACKLIGHT_STATUS", {
        enabled: false,
        reason: `Missing brightness files for ${chosen}`
      });
      return;
    }

    this.device = chosen;
    this.maxBrightness = readInt(maxPath);

    this.sendSocketNotification("DIMMER_BACKLIGHT_STATUS", {
      enabled: true,
      device: chosen,
      maxBrightness: this.maxBrightness,
      devices
    });
  },

  setBrightnessPercent(payload) {
    if (!this.device || !this.maxBrightness) return;

    const percent = clamp(Number(payload && payload.percent), 0, 100);

    if (this.lastWritten !== null && Math.abs(this.lastWritten - percent) < 1) return;

    const base = path.join("/sys/class/backlight", this.device);
    const brightPath = path.join(base, "brightness");

    const raw = Math.round((percent / 100) * this.maxBrightness);
    const rawClamped = clamp(raw, 0, this.maxBrightness);

    try {
      fs.writeFileSync(brightPath, String(rawClamped));
      this.lastWritten = percent;
    } catch (e) {
      this.sendSocketNotification("DIMMER_BACKLIGHT_ERROR", {
        device: this.device,
        error: e && e.message ? e.message : String(e)
      });
    }
  }
});
