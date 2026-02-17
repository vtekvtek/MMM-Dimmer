/* MMM-Dimmer.js
 * Forked from MMM-AutoDimmer style logic, plus real backlight control.
 */

Module.register("MMM-Dimmer", {
  defaults: {
    schedules: [
      {
        days: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
        maxDim: 0.9,
        transitionDuration: 10 * 60 * 1000,
        transitionSteps: 20,
        brightTime: 700,
        dimTime: 2000,
        notificationTriggers: undefined
      }
    ],
    backlight: {
      enabled: true,
      device: "auto",      // "auto" or "intel_backlight" or another sysfs name
      maxBrightness: 100,  // percent at fully bright
      minBrightness: 5,    // percent at fully dim
      throttleMs: 750      // reduce write spam during transitions
    }
  },

  getDateTime: function() {
    var currentdate = new Date();
    var minute = currentdate.getMinutes();
    if (minute < 10) minute = "0" + minute;
    var second = currentdate.getSeconds();
    if (second < 10) second = "0" + second;

    return currentdate.getFullYear() + "/"
      + (currentdate.getMonth() + 1) + "/"
      + currentdate.getDate() + " "
      + currentdate.getHours() + ":"
      + minute + ":"
      + second;
  },

  getStartOfLog: function() {
    return this.getDateTime() + ": " + this.name + ": ";
  },

  getVar: function(variable, defaultVal) {
    if (typeof variable === "undefined") return defaultVal;
    return variable;
  },

  start: function() {
    var self = this;

    self.home = -1;
    self.overlay = null;
    self.initialRun = true;

    self.lastBrightnessPercent = null;
    self.lastBrightnessSentAt = 0;
    self.backlightReady = false;

    let mySchedules = new Array(0);
    now = new Date();

    self.config.schedules.forEach((configSchedule) => {
      var dimTime = self.getVar(configSchedule.dimTime, 2000);
      var brightTime = self.getVar(configSchedule.brightTime, 700);
      var maxDim = self.getVar(configSchedule.maxDim, 0.9);
      var transitionSteps = self.getVar(configSchedule.transitionSteps, 20);
      var transitionDuration = self.getVar(configSchedule.transitionDuration, 10 * 60 * 1000);
      var days = self.getVar(configSchedule.days, ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]);

      var timeToDim = new Date();
      timeToDim.setHours(Math.floor(dimTime / 100), Math.floor(dimTime % 100), 0, 0);

      var timeToBrighten = new Date();
      timeToBrighten.setHours(Math.floor(brightTime / 100), Math.floor(brightTime % 100), 0, 0);

      if (now.getTime() > timeToBrighten.getTime() && dimTime > brightTime) {
        timeToBrighten.setDate(now.getDate() + 1);
      }

      if (
        (now.getHours() < Math.floor(dimTime / 100) || (now.getHours() == Math.floor(dimTime / 100) && now.getMinutes() < Math.floor(dimTime % 100))) &&
        now.getTime() > timeToBrighten.getTime()
      ) {
        timeToDim.setDate(now.getDate() - 1);
      }

      opacityStep = maxDim / transitionSteps;

      let schedule = {
        "days": days,
        "dimTime": dimTime,
        "brightTime": brightTime,
        "timeToDim": timeToDim,
        "timeToBrighten": timeToBrighten,
        "maxDim": maxDim,
        "transitionSteps": transitionSteps,
        "transitionDuration": transitionDuration,
        "opacityStep": opacityStep,
        "notificationTriggers": configSchedule.notificationTriggers,
        "triggerSatisfied": undefined,
        "mode": "Dormant"
      };

      mySchedules.push(schedule);
    });

    self.mySchedule = mySchedules;

    self.sendSocketNotification("DIMMER_INIT", {
      backlight: self.config.backlight
    });
  },

  notificationReceived: function(notification, payload, sender) {
    var self = this;
    var somethingChanged = false;

    self.mySchedule.forEach((schedule) => {
      if (schedule.notificationTriggers !== undefined) {
        var origValue = schedule.triggerSatisfied;
        var triggerSatisfied = false;
        var nameSame = false;

        schedule.notificationTriggers.forEach((trigger) => {
          if (trigger.name == notification) {
            schedule.triggerSatisfied = undefined;
            nameSame = true;

            console.log(self.getStartOfLog() + "Trigger check. NotificationName: " + notification + " Notification Value: " + payload);

            if (trigger.value == payload) {
              console.log(self.getStartOfLog() + "Trigger satisfied.");
              schedule.triggerSatisfied = true;
              triggerSatisfied = true;
              if (origValue === undefined || origValue === false) {
                somethingChanged = true;
              }
            }
          }
        });

        if (!triggerSatisfied && nameSame === true) {
          schedule.triggerSatisfied = false;
          if (origValue === true) somethingChanged = true;
        }
      }
    });

    if (somethingChanged) self.updateDom();
  },

  socketNotificationReceived: function(notification, payload) {
    var self = this;

    if (notification === "DIMMER_BACKLIGHT_STATUS") {
      if (payload && payload.enabled) {
        self.backlightReady = true;
        console.log(self.getStartOfLog() + "Backlight enabled. Device: " + payload.device);
      } else {
        self.backlightReady = false;
        console.log(self.getStartOfLog() + "Backlight disabled. Reason: " + ((payload && payload.reason) || "unknown"));
      }
    }

    if (notification === "DIMMER_BACKLIGHT_ERROR") {
      console.log(self.getStartOfLog() + "Backlight error: " + ((payload && payload.error) || "unknown"));
    }
  },

  setNextDay: function(schedule) {
    var now = new Date();

    while (schedule.timeToBrighten.getTime() <= now.getTime()) {
      schedule.timeToBrighten.setDate(schedule.timeToBrighten.getDate() + 1);

      while (schedule.timeToDim.getTime() <= now.getTime()) {
        schedule.timeToDim.setDate(schedule.timeToDim.getDate() + 1);
      }
    }
  },

  setNextUpdate: function(newValue) {
    if ((newValue < this.nextUpdate || this.nextUpdate == 0) && newValue > 0) {
      this.nextUpdate = newValue;
    }
  },

  findNextDim: function() {
    var nextDimTime = -1;
    var now = new Date();
    var self = this;

    self.mySchedule.forEach((schedule) => {
      if (now > schedule.timeToBrighten.getTime()) {
        self.setNextDay(schedule);
      }

      var startToDim = schedule.timeToDim.getTime() - schedule.transitionDuration;

      if ((startToDim - now.getTime() < nextDimTime && startToDim - now.getTime() > 0 || nextDimTime === -1) && startToDim - now.getTime() > 0) {
        nextDimTime = startToDim - now.getTime();
      }
    });

    console.log(self.getStartOfLog() + "nextDimTime: " + nextDimTime);
    return nextDimTime;
  },

  findNextBright: function() {
    var nextBrightTime = -1;
    var now = new Date();
    var self = this;

    self.mySchedule.forEach((schedule) => {
      self.setNextDay(schedule);
      var startToBright = schedule.timeToBrighten.getTime() - schedule.transitionDuration;

      if ((startToBright - now.getTime() < nextBrightTime || nextBrightTime === -1) && startToBright - now.getTime() > 0) {
        nextBrightTime = startToBright - now.getTime();
      }
    });

    console.log(self.getStartOfLog() + "nextBrightTime: " + nextBrightTime);
    return nextBrightTime;
  },

  setOpacity: function(opacity) {
    if (this.opacity < opacity) {
      this.opacity = opacity;
    }
  },

  setBacklightFromOpacity: function() {
    var self = this;
    var bl = self.config.backlight || {};

    if (!bl.enabled || !self.backlightReady) return;

    var now = Date.now();
    var throttleMs = self.getVar(bl.throttleMs, 750);
    if (now - self.lastBrightnessSentAt < throttleMs) return;

    var minB = self.getVar(bl.minBrightness, 5);
    var maxB = self.getVar(bl.maxBrightness, 100);

    // opacity 0 => maxBrightness, opacity 1 => minBrightness
    var target = maxB - ((maxB - minB) * self.opacity);
    target = Math.round(Math.max(0, Math.min(100, target)));

    if (self.lastBrightnessPercent === null || Math.abs(self.lastBrightnessPercent - target) >= 1) {
      self.sendSocketNotification("DIMMER_SET_BRIGHTNESS", { percent: target });
      self.lastBrightnessPercent = target;
      self.lastBrightnessSentAt = now;
    }
  },

  setDim: function(schedule) {
    var self = this;
    console.log(self.getStartOfLog() + "Dim");

    var now = new Date();
    var startToBrighten = schedule.timeToBrighten.getTime() - schedule.transitionDuration;
    var startToDim = schedule.timeToDim.getTime() - schedule.transitionDuration;

    if (schedule.notificationTriggers !== undefined && schedule.triggerSatisfied === false) {
      console.log(self.getStartOfLog() + "Notification trigger not satisfied, skipping schedule.");
      schedule.mode = "Dormant";
      return;
    }

    if (self.opacity < schedule.maxDim) {
      if (schedule.dimTime == schedule.brightTime) {
        var tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        self.setNextUpdate(tomorrow.getTime() - now.getTime());
        schedule.mode = "Dim";
        self.setOpacity(schedule.maxDim);
      } else if (now.getTime() > schedule.timeToDim.getTime()) {
        self.setNextUpdate(startToBrighten - now.getTime());
        schedule.mode = "Dim";
        self.setOpacity(schedule.maxDim);
      } else if (schedule.transitionDuration > 0) {
        stepLength = schedule.transitionDuration / schedule.transitionSteps;
        millisPastStart = now.getTime() - startToDim;
        stepsIn = Math.floor(millisPastStart / stepLength);
        remainder = millisPastStart % stepLength;

        self.setNextUpdate(stepLength - remainder);
        self.setOpacity(schedule.opacityStep * stepsIn);
        schedule.mode = "Dimming";

        if (self.opacity > schedule.maxDim) self.setOpacity(schedule.maxDim);
      } else {
        self.setNextUpdate(startToBrighten - now.getTime());
        schedule.mode = "Dim";
        self.setOpacity(schedule.maxDim);
      }
    } else {
      self.setNextUpdate(startToBrighten - now.getTime());
      schedule.mode = "Dim";
      self.setOpacity(schedule.maxDim);
    }
  },

  setBright: function(schedule) {
    var self = this;
    var now = new Date();

    console.log(self.getStartOfLog() + "Bright");

    if (schedule === null) return;

    if (schedule.triggerSatisfied !== undefined && !schedule.triggerSatisfied) {
      console.log(self.getStartOfLog() + "Setting fully Bright");
      self.setOpacity(0);
      schedule.mode = "Dormant";
      return;
    } else if (schedule.transitionDuration > 0) {
      var startToBrighten = schedule.timeToBrighten.getTime() - schedule.transitionDuration;

      stepLength = schedule.transitionDuration / schedule.transitionSteps;
      millisPastStart = now - startToBrighten;
      stepsIn = Math.floor(millisPastStart / stepLength);
      remainder = millisPastStart % stepLength;

      self.setNextUpdate(stepLength - remainder);
      self.setOpacity((schedule.maxDim - (schedule.opacityStep * stepsIn)));
      schedule.mode = "Brightening";

      if (self.opacity <= 0 || millisPastStart >= schedule.transitionDuration || now.getTime() >= schedule.timeToBrighten.getTime()) {
        self.setOpacity(0);
        schedule.mode = "Dormant";
        self.setNextDay(schedule);
      }
    } else {
      self.setOpacity(0);
      schedule.mode = "Dormant";
      self.setNextDay(schedule);
    }
  },

  setOverlay: function() {
    var now = new Date();
    var self = this;

    if (self.overlay === null) {
      self.overlay = document.createElement("div");
      self.overlay.style.background = "#000";
      self.overlay.style.position = "fixed";
      self.overlay.style.top = "0px";
      self.overlay.style.left = "0px";
      self.overlay.style.right = "0px";
      self.overlay.style.bottom = "0px";
      self.overlay.style["z-index"] = 9999;
      self.overlay.style.opacity = 0.0;
      self.overlay.style.pointerEvents = "none";
    }

    self.opacity = 0;
    self.nextUpdate = 0;

    self.mySchedule.forEach((schedule) => {
      var startToBrighten = schedule.timeToBrighten.getTime() - schedule.transitionDuration;
      var brighten = schedule.timeToBrighten.getTime();
      var startToDim = schedule.timeToDim.getTime() - schedule.transitionDuration;

      var triggerSatisfied = false;

      if (schedule.notificationTriggers === undefined || schedule.triggerSatisfied === true) {
        schedule.mode = "Dormant";
        triggerSatisfied = true;
      }

      const weekday = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const today = weekday[now.getDay()];
      var yesterday = -2;
      if (now.getDay() <= 0) {
        yesterday = weekday[now.getDay() - 1];
      } else {
        yesterday = weekday[6];
      }

      if (schedule.days.includes(today) || (schedule.dimTime > schedule.brightTime && schedule.days.includes(yesterday))) {
        if (triggerSatisfied) {
          if (schedule.dimTime == schedule.brightTime) {
            console.log(self.getStartOfLog() + "Calling dim because dimTime = brightTime");
            self.setDim(schedule);
          } else if (now.getTime() >= startToDim && now.getTime() < startToBrighten) {
            console.log(self.getStartOfLog() + "Calling dim because it's time");
            self.setDim(schedule);
          } else if (now.getTime() > startToBrighten && now.getTime() < brighten) {
            console.log(self.getStartOfLog() + "Calling bright because it's brightening");
            self.setBright(schedule);
          } else {
            schedule.mode = "Dormant";
            self.setNextDay(schedule);
          }
        }
      } else {
        schedule.mode = "Dormant";
        self.setNextDay(schedule);
      }
    });

    self.setNextUpdate(self.findNextDim());
    self.setNextUpdate(self.findNextBright());

    if (Math.abs(self.overlay.style.opacity - self.opacity) > 0.001) {
      self.overlay.style.transition = "opacity " + self.nextUpdate + "ms linear";
      self.overlay.style.opacity = self.opacity;
    }

    console.log(self.getStartOfLog() + "Opacity: " + self.opacity);

    // real dimming
    self.setBacklightFromOpacity();
  },

  getDom: function() {
    var self = this;
    self.setOverlay();

    if (self.nextUpdate <= 0) self.nextUpdate = 3000;

    console.log(self.getStartOfLog() + "self.nextUpdate: " + self.nextUpdate);

    self.initialRun = false;

    setTimeout(function() { self.updateDom(); }, self.nextUpdate);

    return self.overlay;
  }
});
