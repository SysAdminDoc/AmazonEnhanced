const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WARM_START_ALARM,
  WARM_START_PERIOD_MINUTES,
  WARM_START_DELAY_MINUTES,
  isWarmStartAlarm,
  scheduleWarmStartAlarm
} = require('../service-worker-warm.js');

test('schedules a periodic MV3 warm-start alarm', async () => {
  const calls = [];
  const alarms = {
    create(name, options) {
      calls.push({ name, options });
    }
  };

  assert.equal(await scheduleWarmStartAlarm(alarms), true);
  assert.deepEqual(calls, [{
    name: WARM_START_ALARM,
    options: {
      periodInMinutes: WARM_START_PERIOD_MINUTES,
      delayInMinutes: WARM_START_DELAY_MINUTES
    }
  }]);
});

test('recognizes only the dedicated warm-start alarm', () => {
  assert.equal(isWarmStartAlarm({ name: WARM_START_ALARM }), true);
  assert.equal(isWarmStartAlarm({ name: 'amze-late-watch' }), false);
  assert.equal(isWarmStartAlarm(null), false);
});

test('handles unavailable or rejected alarm APIs without throwing', async () => {
  assert.equal(await scheduleWarmStartAlarm(null), false);
  assert.equal(await scheduleWarmStartAlarm({ create() { throw new Error('offline'); } }), false);
  assert.equal(await scheduleWarmStartAlarm({ create() { return Promise.reject(new Error('offline')); } }), false);
});
