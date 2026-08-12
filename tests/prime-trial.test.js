const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrimeTrialText, isPrimeTrialDeclineText } = require('../prime-trial.js');

test('recognizes Prime trial copy but not ordinary Prime delivery copy', () => {
  assert.equal(isPrimeTrialText('Start your 30-day free trial of Prime'), true);
  assert.equal(isPrimeTrialText('Try Prime free for one month'), true);
  assert.equal(isPrimeTrialText('Get Prime delivery tomorrow'), false);
});

test('recognizes explicit Prime-trial decline choices', () => {
  assert.equal(isPrimeTrialDeclineText('No thanks'), true);
  assert.equal(isPrimeTrialDeclineText('Continue without Prime'), true);
  assert.equal(isPrimeTrialDeclineText('Start free trial'), false);
  assert.equal(isPrimeTrialDeclineText('Continue'), false);
});
