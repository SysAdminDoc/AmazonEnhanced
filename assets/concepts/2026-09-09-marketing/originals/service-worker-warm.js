(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeWarmStart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WARM_START_ALARM = 'amze-warm-start';
  const WARM_START_PERIOD_MINUTES = 15;
  const WARM_START_DELAY_MINUTES = 1;

  function scheduleWarmStartAlarm(alarms) {
    if (!alarms || typeof alarms.create !== 'function') return Promise.resolve(false);
    try {
      const result = alarms.create(WARM_START_ALARM, {
        periodInMinutes: WARM_START_PERIOD_MINUTES,
        delayInMinutes: WARM_START_DELAY_MINUTES
      });
      return result && typeof result.then === 'function'
        ? result.then(() => true).catch(() => false)
        : Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function isWarmStartAlarm(alarm) {
    return !!alarm && alarm.name === WARM_START_ALARM;
  }

  return {
    WARM_START_ALARM,
    WARM_START_PERIOD_MINUTES,
    WARM_START_DELAY_MINUTES,
    scheduleWarmStartAlarm,
    isWarmStartAlarm
  };
});
