const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForPHI, sanitizeInput } = require('../src/utils/moderation');

test('blocks phone numbers', () => {
  const result = checkForPHI('Call me at 555-123-4567');
  assert.ok(result.blocked);
});

test('sanitizes HTML', () => {
  const text = sanitizeInput('<script>alert(1)</script>Hello');
  assert.equal(text, 'Hello');
});
