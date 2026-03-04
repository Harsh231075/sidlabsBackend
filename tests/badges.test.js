const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForBadges, awardBadge } = require('../src/utils/badges');
const { writeData } = require('../src/utils/dataStore');

test('awards first post badge', async () => {
  await writeData('badges.json', []);
  const earned = await checkForBadges('user-1', { postsCount: 1, commentsCount: 0, role: 'patient-user' });
  assert.ok(earned.find((b) => b.type === 'first-post'));
});

test('does not duplicate badges', async () => {
  await writeData('badges.json', []);
  await awardBadge('user-1', 'first-post');
  const earned = await checkForBadges('user-1', { postsCount: 2, commentsCount: 0, role: 'patient-user' });
  const firstPostBadges = earned.filter((b) => b.type === 'first-post');
  assert.equal(firstPostBadges.length, 0);
});
