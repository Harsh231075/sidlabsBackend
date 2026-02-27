import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/+$/, '');

const ENABLE_WRITES = String(__ENV.K6_ENABLE_WRITES || '0') === '1';
const WRITE_RATIO = clamp01(Number(__ENV.K6_WRITE_RATIO || 0.05));
const ADMIN_RATIO = clamp01(Number(__ENV.K6_ADMIN_RATIO || 0.02));
const THINK_TIME_MS_MIN = Number(__ENV.K6_THINK_MS_MIN || 50);
const THINK_TIME_MS_MAX = Number(__ENV.K6_THINK_MS_MAX || 250);

const USER_ID = __ENV.K6_USER_ID || '';
const USERNAME = __ENV.K6_USERNAME || '';
const USER_ROLE = __ENV.K6_USER_ROLE || 'patient-user';
const USER_EMAIL = __ENV.K6_USER_EMAIL || 'loadtest@example.local';
const USER_NAME = __ENV.K6_USER_NAME || 'Load Test User';

const ADMIN_ID = __ENV.K6_ADMIN_ID || '';
const ADMIN_ROLE = __ENV.K6_ADMIN_ROLE || 'admin-user';
const ADMIN_EMAIL = __ENV.K6_ADMIN_EMAIL || 'admin-loadtest@example.local';
const ADMIN_NAME = __ENV.K6_ADMIN_NAME || 'Admin Load Test';

const JWT_SECRET = __ENV.JWT_SECRET || 'winsights-dev-secret';

// Cognito mode: supply valid Cognito ID token(s) OR login creds
const ID_TOKEN = __ENV.K6_ID_TOKEN || '';
const ADMIN_ID_TOKEN = __ENV.K6_ADMIN_ID_TOKEN || '';
const MOD_ID_TOKEN = __ENV.K6_MOD_ID_TOKEN || '';

const LOGIN_EMAIL = __ENV.K6_LOGIN_EMAIL || '';
const LOGIN_PASSWORD = __ENV.K6_LOGIN_PASSWORD || '';
const ADMIN_LOGIN_EMAIL = __ENV.K6_ADMIN_LOGIN_EMAIL || '';
const ADMIN_LOGIN_PASSWORD = __ENV.K6_ADMIN_LOGIN_PASSWORD || '';
const MOD_LOGIN_EMAIL = __ENV.K6_MOD_LOGIN_EMAIL || '';
const MOD_LOGIN_PASSWORD = __ENV.K6_MOD_LOGIN_PASSWORD || '';

const EMAIL_TEST_TO = __ENV.K6_EMAIL_TO || '';

const K6_PROFILE = String(__ENV.K6_PROFILE || 'full').toLowerCase();
const DEBUG_AUTH = String(__ENV.K6_DEBUG_AUTH || '0') === '1';

const SUMMARY_BASENAME = String(__ENV.K6_SUMMARY_BASENAME || 'k6-summary');

const STAGES = (() => {
  if (K6_PROFILE === 'smoke') {
    return [
      { duration: '2s', target: 1 },
      { duration: '8s', target: 1 },
      { duration: '2s', target: 0 },
    ];
  }

  // Fast dev loop: reaches useful load quickly and exits fast.
  if (K6_PROFILE === 'fast') {
    return [
      { duration: '5s', target: 50 },
      { duration: '10s', target: 200 },
      { duration: '15s', target: 200 },
      { duration: '5s', target: 0 },
    ];
  }

  // Burst to 2k quickly (for quick breakpoints). Expect failures if backend isn't tuned.
  if (K6_PROFILE === 'burst2k') {
    return [
      { duration: '10s', target: 2000 },
      { duration: '30s', target: 2000 },
      { duration: '10s', target: 0 },
    ];
  }

  if (K6_PROFILE === 'quick') {
    return [
      { duration: '30s', target: 50 },
      { duration: '30s', target: 200 },
      { duration: '45s', target: 500 },
      { duration: '60s', target: 1000 },
      { duration: '60s', target: 1500 },
      { duration: '60s', target: 2000 },
      { duration: '2m', target: 2000 },
      { duration: '30s', target: 0 },
    ];
  }

  // Capacity-finding profiles: same API mix, lower peak VUs.
  // Goal: quickly estimate "kitne users handle" before tuning for full 2k.
  if (K6_PROFILE === 'cap250') {
    return [
      { duration: '20s', target: 25 },
      { duration: '30s', target: 100 },
      { duration: '40s', target: 250 },
      { duration: '60s', target: 250 },
      { duration: '20s', target: 0 },
    ];
  }

  if (K6_PROFILE === 'cap500') {
    return [
      { duration: '20s', target: 50 },
      { duration: '30s', target: 200 },
      { duration: '40s', target: 500 },
      { duration: '60s', target: 500 },
      { duration: '20s', target: 0 },
    ];
  }

  if (K6_PROFILE === 'cap1000') {
    return [
      { duration: '25s', target: 50 },
      { duration: '35s', target: 200 },
      { duration: '45s', target: 500 },
      { duration: '45s', target: 1000 },
      { duration: '75s', target: 1000 },
      { duration: '25s', target: 0 },
    ];
  }

  if (K6_PROFILE === 'cap1500') {
    return [
      { duration: '25s', target: 50 },
      { duration: '35s', target: 200 },
      { duration: '45s', target: 500 },
      { duration: '45s', target: 1000 },
      { duration: '45s', target: 1500 },
      { duration: '90s', target: 1500 },
      { duration: '25s', target: 0 },
    ];
  }

  // default: full
  return [
    { duration: '2m', target: 25 },
    { duration: '3m', target: 100 },
    { duration: '4m', target: 250 },
    { duration: '5m', target: 500 },
    { duration: '6m', target: 1000 },
    { duration: '6m', target: 1500 },
    { duration: '6m', target: 2000 },
    { duration: '6m', target: 2000 },
    { duration: '2m', target: 0 },
  ];
})();

if (String(__ENV.K6_DEBUG || '0') === '1') {
  console.log(`[k6] profile=${K6_PROFILE} stages=${JSON.stringify(STAGES)}`);
}

export const server_error_rate = new Rate('server_error_rate');
export const client_error_rate = new Rate('client_error_rate');
export const ok_rate = new Rate('ok_rate');
export const cache_hit_rate = new Rate('cache_hit_rate');
export const skipped_missing_data = new Counter('skipped_missing_data');
export const skipped_no_token = new Counter('skipped_no_token');
export const skipped_writes_disabled = new Counter('skipped_writes_disabled');
export const skipped_admin_token_missing = new Counter('skipped_admin_token_missing');
export const skipped_admin_sampling = new Counter('skipped_admin_sampling');
export const auth_challenge_encountered = new Counter('auth_challenge_encountered');

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  discardResponseBodies: true,
  scenarios: {
    stress_2k_vus: {
      executor: 'ramping-vus',
      exec: 'default',
      startVUs: 0,
      gracefulRampDown: '30s',
      gracefulStop: '30s',
      stages: STAGES,
    },
  },
  thresholds: {
    server_error_rate: [{ threshold: 'rate<0.03', abortOnFail: true, delayAbortEval: '60s' }],
    'http_req_duration{kind:api}': ['p(95)<2500', 'p(99)<6000'],
    'http_req_duration{endpoint:GET /api/ping}': ['p(95)<800'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

function sanitizeMetricName(s) {
  return String(s)
    .toLowerCase()
    .replace(/^\s+|\s+$/g, '')
    .replace(/\?/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function endpointTagFromTemplate(ep) {
  const p = String(ep.path || '').split('?')[0];
  return `${String(ep.method || 'GET').toUpperCase()} ${p}`;
}

const ENDPOINTS = [
  { name: 'Root', method: 'GET', path: '/', auth: 'none', kind: 'api' },
  { name: 'Ping', method: 'GET', path: '/api/ping', auth: 'none', kind: 'api' },

  { name: 'Auth Register', method: 'POST', path: '/api/auth/register', auth: 'none', kind: 'api', write: true },
  { name: 'Auth Login', method: 'POST', path: '/api/auth/login', auth: 'none', kind: 'api', write: true },
  { name: 'Auth Login Challenge', method: 'POST', path: '/api/auth/login/challenge', auth: 'none', kind: 'api', write: true },
  { name: 'Auth Me', method: 'GET', path: '/api/auth/me', auth: 'user', kind: 'api' },
  { name: 'Auth User', method: 'GET', path: '/api/auth/user', auth: 'none', kind: 'api' },
  { name: 'Auth Logout', method: 'POST', path: '/api/auth/logout', auth: 'none', kind: 'api', write: true },

  { name: 'Search', method: 'GET', path: '/api/search', auth: 'optional', kind: 'api' },
  { name: 'Search Suggested', method: 'GET', path: '/api/search/suggested', auth: 'optional', kind: 'api' },

  { name: 'Profile by Username', method: 'GET', path: '/api/profile/:username', auth: 'optional', kind: 'api' },
  { name: 'Profile by Id', method: 'GET', path: '/api/profile/id/:userId', auth: 'optional', kind: 'api' },
  { name: 'Profile Posts', method: 'GET', path: '/api/profile/:username/posts', auth: 'optional', kind: 'api' },
  { name: 'Profile Likes', method: 'GET', path: '/api/profile/:username/likes', auth: 'optional', kind: 'api' },
  { name: 'Profile Comments', method: 'GET', path: '/api/profile/:username/comments', auth: 'optional', kind: 'api' },
  { name: 'Profile Followers', method: 'GET', path: '/api/profile/:username/followers', auth: 'optional', kind: 'api' },
  { name: 'Profile Following', method: 'GET', path: '/api/profile/:username/following', auth: 'optional', kind: 'api' },
  { name: 'Profile Update', method: 'PUT', path: '/api/profile', auth: 'user', kind: 'api', write: true },
  { name: 'Profile Follow', method: 'POST', path: '/api/profile/:username/follow', auth: 'user', kind: 'api', write: true },
  { name: 'Profile Unfollow', method: 'DELETE', path: '/api/profile/:username/follow', auth: 'user', kind: 'api', write: true },

  { name: 'Users List', method: 'GET', path: '/api/users', auth: 'adminOrMod', kind: 'api' },
  { name: 'Users Update Me', method: 'PUT', path: '/api/users/me', auth: 'user', kind: 'api', write: true },
  { name: 'Users Upload Avatar', method: 'POST', path: '/api/users/me/avatar', auth: 'user', kind: 'api', write: true },
  { name: 'Users Remove Avatar', method: 'DELETE', path: '/api/users/me/avatar', auth: 'user', kind: 'api', write: true },
  { name: 'Users Upload Cover', method: 'POST', path: '/api/users/me/cover', auth: 'user', kind: 'api', write: true },
  { name: 'Users Remove Cover', method: 'DELETE', path: '/api/users/me/cover', auth: 'user', kind: 'api', write: true },
  { name: 'Users Update Any', method: 'PUT', path: '/api/users/:userId', auth: 'user', kind: 'api', write: true },
  { name: 'Users Badges', method: 'GET', path: '/api/users/:userId/badges', auth: 'user', kind: 'api' },
  { name: 'Users Block', method: 'POST', path: '/api/users/:userId/block', auth: 'user', kind: 'api', write: true },
  { name: 'Users Unblock', method: 'POST', path: '/api/users/:userId/unblock', auth: 'user', kind: 'api', write: true },
  { name: 'Users Blocked List', method: 'GET', path: '/api/users/me/blocked', auth: 'user', kind: 'api' },

  { name: 'Friends Request by Username', method: 'POST', path: '/api/friends/request/:username', auth: 'user', kind: 'api', write: true },
  { name: 'Friends Request by Id', method: 'POST', path: '/api/friends/request/id/:userId', auth: 'user', kind: 'api', write: true },
  { name: 'Friends Accept', method: 'PUT', path: '/api/friends/request/:requestId/accept', auth: 'user', kind: 'api', write: true },
  { name: 'Friends Reject', method: 'PUT', path: '/api/friends/request/:requestId/reject', auth: 'user', kind: 'api', write: true },
  { name: 'Friends Cancel', method: 'DELETE', path: '/api/friends/request/:requestId', auth: 'user', kind: 'api', write: true },
  { name: 'Friends Requests', method: 'GET', path: '/api/friends/requests', auth: 'user', kind: 'api' },
  { name: 'Friends List', method: 'GET', path: '/api/friends/list', auth: 'user', kind: 'api' },

  { name: 'Groups List', method: 'GET', path: '/api/groups', auth: 'user', kind: 'api' },
  { name: 'Groups Create', method: 'POST', path: '/api/groups', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Groups Get', method: 'GET', path: '/api/groups/:groupId', auth: 'user', kind: 'api' },
  { name: 'Groups Update', method: 'PUT', path: '/api/groups/:groupId', auth: 'user', kind: 'api', write: true },
  { name: 'Groups Join', method: 'POST', path: '/api/groups/:groupId/join', auth: 'user', kind: 'api', write: true },
  { name: 'Groups Leave', method: 'POST', path: '/api/groups/:groupId/leave', auth: 'user', kind: 'api', write: true },

  { name: 'Posts List', method: 'GET', path: '/api/posts', auth: 'user', kind: 'api' },
  { name: 'Posts Feed Stats', method: 'GET', path: '/api/posts/feed-stats', auth: 'user', kind: 'api' },
  { name: 'Posts Reported', method: 'GET', path: '/api/posts/reported', auth: 'adminOrMod', kind: 'api' },
  { name: 'Posts Create', method: 'POST', path: '/api/posts', auth: 'user', kind: 'api', write: true },
  { name: 'Posts Like', method: 'POST', path: '/api/posts/:postId/like', auth: 'user', kind: 'api', write: true },
  { name: 'Posts Report', method: 'POST', path: '/api/posts/:postId/report', auth: 'user', kind: 'api', write: true },
  { name: 'Posts Remove', method: 'POST', path: '/api/posts/:postId/remove', auth: 'user', kind: 'api', write: true },
  { name: 'Posts Update', method: 'PUT', path: '/api/posts/:postId', auth: 'user', kind: 'api', write: true },
  { name: 'Posts Review', method: 'PUT', path: '/api/posts/:postId/review', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Posts Comments List', method: 'GET', path: '/api/posts/:postId/comments', auth: 'user', kind: 'api' },
  { name: 'Posts Comment Create', method: 'POST', path: '/api/posts/:postId/comments', auth: 'user', kind: 'api', write: true },

  { name: 'Forums Threads List', method: 'GET', path: '/api/forums/:forumGroupId/threads', auth: 'user', kind: 'api' },
  { name: 'Forums Thread Create', method: 'POST', path: '/api/forums/:forumGroupId/threads', auth: 'user', kind: 'api', write: true },
  { name: 'Forums Thread Get', method: 'GET', path: '/api/forums/threads/:threadId', auth: 'user', kind: 'api' },
  { name: 'Forums Reply', method: 'POST', path: '/api/forums/threads/:threadId/reply', auth: 'user', kind: 'api', write: true },
  { name: 'Forums Remove Thread', method: 'POST', path: '/api/forums/threads/:threadId/remove', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Forums Edit Post', method: 'PUT', path: '/api/forums/posts/:forumPostId', auth: 'user', kind: 'api', write: true },
  { name: 'Forums Delete Post', method: 'DELETE', path: '/api/forums/posts/:forumPostId', auth: 'user', kind: 'api', write: true },

  { name: 'Disease Pages Create', method: 'POST', path: '/api/disease-pages', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Disease Pages List', method: 'GET', path: '/api/disease-pages', auth: 'optional', kind: 'api' },
  { name: 'Disease Page Get', method: 'GET', path: '/api/disease-pages/:slug', auth: 'optional', kind: 'api' },
  { name: 'Disease Page Follow', method: 'POST', path: '/api/disease-pages/:slug/follow', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Unfollow', method: 'DELETE', path: '/api/disease-pages/:slug/follow', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Posts', method: 'GET', path: '/api/disease-pages/:slug/posts', auth: 'user', kind: 'api' },
  { name: 'Disease Page Posts All', method: 'GET', path: '/api/disease-pages/:slug/posts/all', auth: 'user', kind: 'api' },
  { name: 'Disease Page Post Create', method: 'POST', path: '/api/disease-pages/:slug/posts', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Post Like', method: 'POST', path: '/api/disease-pages/:slug/posts/:diseasePostId/like', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Post Remove', method: 'DELETE', path: '/api/disease-pages/:slug/posts/:diseasePostId', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Post Review', method: 'PUT', path: '/api/disease-pages/:slug/posts/:diseasePostId/review', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Disease Page Feature', method: 'POST', path: '/api/disease-pages/:slug/feature-post', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Unfeature', method: 'DELETE', path: '/api/disease-pages/:slug/feature-post/:diseasePostId', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Add Resource', method: 'POST', path: '/api/disease-pages/:slug/resources', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Remove Resource', method: 'DELETE', path: '/api/disease-pages/:slug/resources/:resourceId', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Update', method: 'PUT', path: '/api/disease-pages/:slug', auth: 'user', kind: 'api', write: true },
  { name: 'Disease Page Delete', method: 'DELETE', path: '/api/disease-pages/:slug', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Disease Page Create Event', method: 'POST', path: '/api/disease-pages/:slug/events', auth: 'user', kind: 'api', write: true },

  { name: 'Notifications List', method: 'GET', path: '/api/notifications?limit=50', auth: 'user', kind: 'api' },
  { name: 'Notifications Unread Count', method: 'GET', path: '/api/notifications/unread-count', auth: 'user', kind: 'api' },
  { name: 'Notifications Mark Read', method: 'PUT', path: '/api/notifications/:notificationId/read', auth: 'user', kind: 'api', write: true },
  { name: 'Notifications Read All', method: 'PUT', path: '/api/notifications/read-all', auth: 'user', kind: 'api', write: true },
  { name: 'Notifications Delete', method: 'DELETE', path: '/api/notifications/:notificationId', auth: 'user', kind: 'api', write: true },
  { name: 'Notifications Preferences Get', method: 'GET', path: '/api/notifications/preferences', auth: 'user', kind: 'api' },
  { name: 'Notifications Preferences Update', method: 'PUT', path: '/api/notifications/preferences', auth: 'user', kind: 'api', write: true },

  { name: 'Events List', method: 'GET', path: '/api/events', auth: 'user', kind: 'api' },
  { name: 'Events Get', method: 'GET', path: '/api/events/:eventId', auth: 'user', kind: 'api' },
  { name: 'Events Create', method: 'POST', path: '/api/events', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Events Update', method: 'PUT', path: '/api/events/:eventId', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Events Delete', method: 'DELETE', path: '/api/events/:eventId', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Events Register', method: 'POST', path: '/api/events/:eventId/register', auth: 'user', kind: 'api', write: true },
  { name: 'Events Unregister', method: 'DELETE', path: '/api/events/:eventId/register', auth: 'user', kind: 'api', write: true },

  { name: 'Gamification User Stats', method: 'GET', path: '/api/gamification/users/:userId/stats', auth: 'user', kind: 'api' },
  { name: 'Gamification Me Stats', method: 'GET', path: '/api/gamification/me/stats', auth: 'user', kind: 'api' },
  { name: 'Gamification Leaderboard', method: 'GET', path: '/api/gamification/leaderboard', auth: 'user', kind: 'api' },
  { name: 'Gamification Award Tokens', method: 'POST', path: '/api/gamification/award-tokens', auth: 'adminOrMod', kind: 'api', write: true },

  { name: 'Moderation Queue', method: 'GET', path: '/api/moderation/queue', auth: 'adminOrMod', kind: 'api' },
  { name: 'Moderation Approve', method: 'POST', path: '/api/moderation/:moderationType/:moderationId/approve', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Moderation Reject', method: 'POST', path: '/api/moderation/:moderationType/:moderationId/reject', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Moderation Request Edit', method: 'POST', path: '/api/moderation/:moderationType/:moderationId/request-edit', auth: 'adminOrMod', kind: 'api', write: true },

  { name: 'Conversations List', method: 'GET', path: '/api/conversations', auth: 'user', kind: 'api' },
  { name: 'Conversations Start by Email', method: 'POST', path: '/api/conversations/start', auth: 'user', kind: 'api', write: true },
  { name: 'Conversations Create Group', method: 'POST', path: '/api/conversations/group', auth: 'user', kind: 'api', write: true },
  { name: 'Conversations Send Message', method: 'POST', path: '/api/conversations/:convId/messages', auth: 'user', kind: 'api', write: true },
  { name: 'Conversations Get', method: 'GET', path: '/api/conversations/:convId', auth: 'user', kind: 'api' },
  { name: 'Conversations Start by UserId', method: 'POST', path: '/api/conversations/:userId', auth: 'user', kind: 'api', write: true },

  { name: 'Admin Stats', method: 'GET', path: '/api/admin/stats', auth: 'admin', kind: 'api' },
  { name: 'Admin Users', method: 'GET', path: '/api/admin/users', auth: 'adminOrMod', kind: 'api' },
  { name: 'Admin Update User', method: 'PUT', path: '/api/admin/users/:userId', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Update User Role', method: 'PUT', path: '/api/admin/users/:userId/role', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Suspend', method: 'POST', path: '/api/admin/users/:userId/suspend', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Unsuspend', method: 'POST', path: '/api/admin/users/:userId/unsuspend', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Update Suspend', method: 'PUT', path: '/api/admin/users/:userId/suspend', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Mod Posts', method: 'GET', path: '/api/admin/moderation/posts', auth: 'adminOrMod', kind: 'api' },
  { name: 'Admin Approve Post', method: 'POST', path: '/api/admin/moderation/posts/:postId/approve', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Admin Reject Post', method: 'POST', path: '/api/admin/moderation/posts/:postId/reject', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Admin Mod Comments', method: 'GET', path: '/api/admin/moderation/comments', auth: 'adminOrMod', kind: 'api' },
  { name: 'Admin Approve Comment', method: 'POST', path: '/api/admin/moderation/comments/:commentId/approve', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Admin Reject Comment', method: 'POST', path: '/api/admin/moderation/comments/:commentId/reject', auth: 'adminOrMod', kind: 'api', write: true },
  { name: 'Admin Analytics', method: 'GET', path: '/api/admin/analytics', auth: 'admin', kind: 'api' },
  { name: 'Admin Logs', method: 'GET', path: '/api/admin/logs', auth: 'admin', kind: 'api' },
  { name: 'Admin Log Stats', method: 'GET', path: '/api/admin/logs/stats', auth: 'admin', kind: 'api' },
  { name: 'Admin Delete Log', method: 'DELETE', path: '/api/admin/logs/:logId', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Delete Logs Range', method: 'POST', path: '/api/admin/logs/delete-range', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Email Health', method: 'GET', path: '/api/admin/email/health', auth: 'admin', kind: 'api' },
  { name: 'Admin Email Test', method: 'POST', path: '/api/admin/email/test', auth: 'admin', kind: 'api', write: true },
  { name: 'Admin Delete Group', method: 'DELETE', path: '/api/admin/groups/:groupId', auth: 'admin', kind: 'api', write: true },
];

// Per-endpoint metrics (shows up in JSON/HTML summary without needing k6 submetrics).
// We keep endpoint tags low-cardinality by using template paths (no resolved usernames/ids).
const ENDPOINT_TAGS = Array.from(new Set(ENDPOINTS.map(endpointTagFromTemplate)));

const endpointDurations = {};
const endpointRequests = {};
const endpointServerErrors = {};
const endpointClientErrors = {};
const endpointOk = {};

for (const tag of ENDPOINT_TAGS) {
  const slug = sanitizeMetricName(tag);
  endpointDurations[tag] = new Trend(`ep_dur__${slug}`, true);
  endpointRequests[tag] = new Counter(`ep_req__${slug}`);
  endpointServerErrors[tag] = new Counter(`ep_serr__${slug}`);
  endpointClientErrors[tag] = new Counter(`ep_cerr__${slug}`);
  endpointOk[tag] = new Counter(`ep_ok__${slug}`);
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axuYc8AAAAASUVORK5CYII=';

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function b64urlFromBase64(b64) {
  return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64encodeString(str) {
  return encoding.b64encode(String(str));
}

function jwtSignHS256(payloadObj, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = b64urlFromBase64(b64encodeString(JSON.stringify(header)));
  const payloadB64 = b64urlFromBase64(b64encodeString(JSON.stringify(payloadObj)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = crypto.hmac('sha256', secret, signingInput, 'base64');
  const sigB64Url = b64urlFromBase64(sigB64);
  return `${signingInput}.${sigB64Url}`;
}

function url(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

function jitterSleep() {
  const min = Math.max(0, THINK_TIME_MS_MIN);
  const max = Math.max(min, THINK_TIME_MS_MAX);
  const ms = min + Math.random() * (max - min);
  sleep(ms / 1000);
}

function safeJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

function tagify(method, resolvedPath) {
  const normalized = String(resolvedPath)
    .replace(/[0-9a-fA-F]{8,}/g, ':id')
    .replace(/\/\d+/g, '/:n');
  return `${method.toUpperCase()} ${normalized}`;
}

function recordRates(res) {
  if (!res) {
    server_error_rate.add(1);
    client_error_rate.add(0);
    ok_rate.add(0);
    return;
  }

  const status = res.status || 0;
  const isTransportError = status === 0;

  if (isTransportError || status >= 500) {
    server_error_rate.add(1);
    client_error_rate.add(0);
    ok_rate.add(0);
    return;
  }

  if (status >= 400) {
    server_error_rate.add(0);
    client_error_rate.add(1);
    ok_rate.add(0);
    return;
  }

  server_error_rate.add(0);
  client_error_rate.add(0);
  ok_rate.add(1);
}

function recordEndpointMetrics(res, tags) {
  const endpoint = tags && tags.endpoint ? String(tags.endpoint) : '';
  const durationTrend = endpoint ? endpointDurations[endpoint] : null;
  const reqCounter = endpoint ? endpointRequests[endpoint] : null;
  const okCounter = endpoint ? endpointOk[endpoint] : null;
  const serrCounter = endpoint ? endpointServerErrors[endpoint] : null;
  const cerrCounter = endpoint ? endpointClientErrors[endpoint] : null;

  if (reqCounter) reqCounter.add(1);

  if (!res) {
    if (serrCounter) serrCounter.add(1);
    return;
  }

  const status = res.status || 0;
  const isTransportError = status === 0;

  if (durationTrend && res.timings && typeof res.timings.duration === 'number') {
    durationTrend.add(res.timings.duration);
  }

  if (isTransportError || status >= 500) {
    if (serrCounter) serrCounter.add(1);
    return;
  }
  if (status >= 400) {
    if (cerrCounter) cerrCounter.add(1);
    return;
  }
  if (okCounter) okCounter.add(1);
}

function request(method, path, { headers = {}, tags = {}, body = null, timeout = '30s', responseType = null } = {}) {
  const fullUrl = url(path);
  const params = {
    headers,
    tags,
    timeout,
    redirects: 3,
  };

  // When options.discardResponseBodies=true, set responseType:'text' on requests
  // where we need to parse JSON (e.g., login, setup discovery).
  if (responseType) params.responseType = responseType;

  let res;
  if (method === 'GET') res = http.get(fullUrl, params);
  else if (method === 'POST') res = http.post(fullUrl, body, params);
  else if (method === 'PUT') res = http.put(fullUrl, body, params);
  else if (method === 'PATCH') res = http.patch(fullUrl, body, params);
  else if (method === 'DELETE') res = http.del(fullUrl, body, params);
  else fail(`Unsupported method: ${method}`);

  recordRates(res);
  recordEndpointMetrics(res, tags);

  // Track cache effectiveness if server includes X-Cache header.
  // (Only meaningful once responseCache middleware is enabled.)
  const xCache = res?.headers?.['X-Cache'] || res?.headers?.['x-cache'] || '';
  if (xCache) {
    cache_hit_rate.add(String(xCache).toUpperCase() === 'HIT', tags);
  }
  return res;
}

function requestJson(method, path, opts = {}) {
  return request(method, path, { ...opts, responseType: 'text' });
}

function shouldDoWrite() {
  if (!ENABLE_WRITES) return false;
  return Math.random() < WRITE_RATIO;
}

function shouldDoAdmin() {
  return Math.random() < ADMIN_RATIO;
}

function pickOne(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function replaceAllString(str, find, replacement) {
  return String(str).split(String(find)).join(String(replacement));
}

function resolvePath(template, ctx) {
  let p = template;

  if (p.includes(':username')) {
    const uname = ctx.username || (pickOne(ctx.suggestedUsers)?.username ?? null) || USERNAME || null;
    if (!uname) return null;
    p = replaceAllString(p, ':username', encodeURIComponent(String(uname)));
  }

  if (p.includes(':userId')) {
    const uid = ctx.userId || USER_ID || (pickOne(ctx.suggestedUsers)?.id ?? null);
    if (!uid) return null;
    p = replaceAllString(p, ':userId', encodeURIComponent(String(uid)));
  }

  if (p.includes(':groupId')) {
    const gid = pickOne(ctx.groupIds);
    if (!gid) return null;
    p = replaceAllString(p, ':groupId', encodeURIComponent(String(gid)));
  }

  if (p.includes(':forumGroupId')) {
    const fg = ctx.forumGroupId || pickOne(ctx.groupIds) || 'global';
    p = replaceAllString(p, ':forumGroupId', encodeURIComponent(String(fg)));
  }

  if (p.includes(':postId')) {
    const pid = pickOne(ctx.postIds);
    if (!pid) return null;
    p = replaceAllString(p, ':postId', encodeURIComponent(String(pid)));
  }

  if (p.includes(':threadId')) {
    const tid = pickOne(ctx.threadIds);
    if (!tid) return null;
    p = replaceAllString(p, ':threadId', encodeURIComponent(String(tid)));
  }

  if (p.includes(':forumPostId')) {
    const fpid = pickOne(ctx.forumPostIds);
    if (!fpid) return null;
    p = replaceAllString(p, ':forumPostId', encodeURIComponent(String(fpid)));
  }

  if (p.includes(':convId')) {
    const cid = pickOne(ctx.convIds);
    if (!cid) return null;
    p = replaceAllString(p, ':convId', encodeURIComponent(String(cid)));
  }

  if (p.includes(':slug')) {
    const slug = pickOne(ctx.diseaseSlugs);
    if (!slug) return null;
    p = replaceAllString(p, ':slug', encodeURIComponent(String(slug)));
  }

  if (p.includes(':diseasePostId')) {
    const slug = pickOne(ctx.diseaseSlugs);
    if (!slug) return null;
    const postIds = ctx.diseasePostIdsBySlug?.[slug] || [];
    const dp = pickOne(postIds);
    if (!dp) return null;
    p = replaceAllString(p, ':diseasePostId', encodeURIComponent(String(dp)));
  }

  if (p.includes(':resourceId')) {
    const slug = pickOne(ctx.diseaseSlugs);
    if (!slug) return null;
    const resIds = ctx.resourceIdsBySlug?.[slug] || [];
    const rid = pickOne(resIds);
    if (!rid) return null;
    p = replaceAllString(p, ':resourceId', encodeURIComponent(String(rid)));
  }

  if (p.includes(':notificationId')) {
    const nid = pickOne(ctx.notificationIds);
    if (!nid) return null;
    p = replaceAllString(p, ':notificationId', encodeURIComponent(String(nid)));
  }

  if (p.includes(':eventId')) {
    const eid = pickOne(ctx.eventIds);
    if (!eid) return null;
    p = replaceAllString(p, ':eventId', encodeURIComponent(String(eid)));
  }

  if (p.includes(':requestId')) {
    const rid = pickOne(ctx.friendRequestIds);
    if (!rid) return null;
    p = replaceAllString(p, ':requestId', encodeURIComponent(String(rid)));
  }

  if (p.includes(':logId')) {
    const lid = pickOne(ctx.logIds);
    if (!lid) return null;
    p = replaceAllString(p, ':logId', encodeURIComponent(String(lid)));
  }

  if (p.includes(':commentId')) {
    const cid = pickOne(ctx.commentIds);
    if (!cid) return null;
    p = replaceAllString(p, ':commentId', encodeURIComponent(String(cid)));
  }

  if (p.includes(':moderationType') || p.includes(':moderationId')) {
    const type = pickOne(['post', 'comment']);
    const mid = pickOne(ctx.moderationIds?.[type] || []);
    if (!mid) return null;
    p = replaceAllString(p, ':moderationType', encodeURIComponent(String(type)));
    p = replaceAllString(p, ':moderationId', encodeURIComponent(String(mid)));
  }

  return p;
}

function buildHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function maybeLoginAndGetIdToken(label, email, password) {
  if (!email || !password) {
    if (DEBUG_AUTH) console.log(`[k6 auth] login(${label}): skipped (missing email/password)`);
    return '';
  }
  const res = requestJson('POST', '/api/auth/login', {
    headers: buildHeaders(null),
    body: JSON.stringify({ email, password }),
    tags: { kind: 'api', endpoint: 'POST /api/auth/login' },
  });

  const data = safeJson(res);
  const hasChallenge = Boolean(data?.challengeName);
  const hasIdToken = Boolean(data?.tokens?.idToken);
  const err = data?.error || data?.message || '';

  if (DEBUG_AUTH) {
    console.log(
      `[k6 auth] login(${label}): status=${res && res.status ? res.status : 0} hasIdToken=${hasIdToken} hasChallenge=${hasChallenge} err=${String(err).slice(0, 120)}`
    );
  }

  if (data?.challengeName) {
    auth_challenge_encountered.add(1);
    return '';
  }
  return data?.tokens?.idToken || '';
}

function determineTokens() {
  let userToken = ID_TOKEN || '';
  let adminToken = ADMIN_ID_TOKEN || '';
  let modToken = MOD_ID_TOKEN || '';

  if (!userToken && LOGIN_EMAIL && LOGIN_PASSWORD) {
    userToken = maybeLoginAndGetIdToken('user', LOGIN_EMAIL, LOGIN_PASSWORD);
  }
  if (!adminToken && ADMIN_LOGIN_EMAIL && ADMIN_LOGIN_PASSWORD) {
    adminToken = maybeLoginAndGetIdToken('admin', ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASSWORD);
  }
  if (!modToken && MOD_LOGIN_EMAIL && MOD_LOGIN_PASSWORD) {
    modToken = maybeLoginAndGetIdToken('moderator', MOD_LOGIN_EMAIL, MOD_LOGIN_PASSWORD);
  }

  if (!userToken && (USER_ID || __ENV.K6_USER_ID)) {
    const nowSec = Math.floor(Date.now() / 1000);
    userToken = jwtSignHS256(
      {
        id: USER_ID,
        role: USER_ROLE,
        email: USER_EMAIL,
        name: USER_NAME,
        iat: nowSec,
        exp: nowSec + 7 * 24 * 3600,
      },
      JWT_SECRET
    );
  }

  if (!adminToken && (ADMIN_ID || __ENV.K6_ADMIN_ID)) {
    const nowSec = Math.floor(Date.now() / 1000);
    adminToken = jwtSignHS256(
      {
        id: ADMIN_ID,
        role: ADMIN_ROLE,
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        iat: nowSec,
        exp: nowSec + 7 * 24 * 3600,
      },
      JWT_SECRET
    );
  }

  return { userToken, adminToken, modToken };
}

export function setup() {
  const { userToken, adminToken, modToken } = determineTokens();

  if (DEBUG_AUTH) {
    console.log(
      `[k6 env] K6_LOGIN_EMAIL=${LOGIN_EMAIL ? 'set' : 'missing'} K6_LOGIN_PASSWORD=${LOGIN_PASSWORD ? 'set' : 'missing'} ` +
      `K6_ADMIN_LOGIN_EMAIL=${ADMIN_LOGIN_EMAIL ? 'set' : 'missing'} K6_ADMIN_LOGIN_PASSWORD=${ADMIN_LOGIN_PASSWORD ? 'set' : 'missing'} ` +
      `K6_MOD_LOGIN_EMAIL=${MOD_LOGIN_EMAIL ? 'set' : 'missing'} K6_MOD_LOGIN_PASSWORD=${MOD_LOGIN_PASSWORD ? 'set' : 'missing'}`
    );
    console.log(
      `[k6 auth] userToken=${userToken ? 'set' : 'missing'}(len=${userToken ? String(userToken).length : 0}) ` +
      `adminToken=${adminToken ? 'set' : 'missing'}(len=${adminToken ? String(adminToken).length : 0}) ` +
      `modToken=${modToken ? 'set' : 'missing'}(len=${modToken ? String(modToken).length : 0})`
    );
  }

  const ctx = {
    userToken,
    adminToken,
    modToken,
    userId: USER_ID || null,
    username: USERNAME || null,
    groupIds: [],
    postIds: [],
    threadIds: [],
    forumPostIds: [],
    convIds: [],
    diseaseSlugs: [],
    diseasePostIdsBySlug: {},
    resourceIdsBySlug: {},
    notificationIds: [],
    eventIds: [],
    suggestedUsers: [],
    friendRequestIds: [],
    logIds: [],
    commentIds: [],
    moderationIds: { post: [], comment: [] },
  };

  request('GET', '/', { headers: buildHeaders(null), tags: { kind: 'api', endpoint: 'GET /' } });
  request('GET', '/api/ping', { headers: buildHeaders(null), tags: { kind: 'api', endpoint: 'GET /api/ping' } });

  {
    const headers = buildHeaders(userToken || null);
    const res = requestJson('GET', '/api/search/suggested?limit=10', {
      headers,
      tags: { kind: 'api', endpoint: 'GET /api/search/suggested' },
    });
    const data = safeJson(res);
    const users = data?.users || [];
    if (Array.isArray(users)) ctx.suggestedUsers = users.filter(Boolean);
    const u = pickOne(ctx.suggestedUsers);
    if (!ctx.username && u?.username) ctx.username = u.username;
    if (!ctx.userId && u?.id) ctx.userId = u.id;
    if (u?.friendRequestId) ctx.friendRequestIds.push(u.friendRequestId);
  }

  {
    const res = requestJson('GET', '/api/disease-pages', {
      headers: buildHeaders(userToken || null),
      tags: { kind: 'api', endpoint: 'GET /api/disease-pages' },
    });
    const data = safeJson(res);
    const pages = data?.pages || data?.diseasePages || data || [];
    const slugs = [];

    if (Array.isArray(pages)) {
      for (const p of pages) {
        if (p?.slug) slugs.push(p.slug);
      }
    } else if (Array.isArray(data?.items)) {
      for (const p of data.items) {
        if (p?.slug) slugs.push(p.slug);
      }
    }

    ctx.diseaseSlugs = slugs.slice(0, 25);
  }

  if (userToken) {
    {
      const res = requestJson('GET', '/api/groups', {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/groups' },
      });
      const data = safeJson(res);
      const groups = data?.groups || data || [];
      if (Array.isArray(groups)) {
        for (const g of groups) {
          const id = g?.id || g?._id;
          if (id) ctx.groupIds.push(String(id));
        }
      }
      ctx.groupIds = uniq(ctx.groupIds).slice(0, 50);
    }

    {
      const res = requestJson('GET', '/api/posts?limit=50', {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/posts' },
      });
      const data = safeJson(res);
      const items = data?.items || data?.posts || data || [];
      if (Array.isArray(items)) {
        for (const it of items) {
          const p = it?.post || it;
          const id = p?.id || p?._id;
          if (id) ctx.postIds.push(String(id));
        }
      }
      ctx.postIds = uniq(ctx.postIds).slice(0, 100);
    }

    {
      const res = requestJson('GET', '/api/notifications', {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/notifications' },
      });
      const data = safeJson(res);
      const notifs = data?.notifications || data || [];
      if (Array.isArray(notifs)) {
        for (const n of notifs) {
          const id = n?.id || n?._id;
          if (id) ctx.notificationIds.push(String(id));
        }
      }
      ctx.notificationIds = uniq(ctx.notificationIds).slice(0, 50);
    }

    {
      const res = requestJson('GET', '/api/events', {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/events' },
      });
      const data = safeJson(res);
      const events = data?.events || data || [];
      if (Array.isArray(events)) {
        for (const e of events) {
          const id = e?.id || e?._id;
          if (id) ctx.eventIds.push(String(id));
        }
      }
      ctx.eventIds = uniq(ctx.eventIds).slice(0, 50);
    }

    {
      const res = requestJson('GET', '/api/conversations', {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/conversations' },
      });
      const data = safeJson(res);
      const convs = data?.conversations || data || [];
      if (Array.isArray(convs)) {
        for (const c of convs) {
          const id = c?.id || c?._id;
          if (id) ctx.convIds.push(String(id));
        }
      }
      ctx.convIds = uniq(ctx.convIds).slice(0, 50);
    }

    {
      const fg = (ctx.groupIds && ctx.groupIds.length > 0 ? ctx.groupIds[0] : 'global') || 'global';
      ctx.forumGroupId = fg;

      const res = requestJson('GET', `/api/forums/${encodeURIComponent(String(fg))}/threads`, {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/forums/:groupId/threads' },
      });
      const data = safeJson(res);
      const threads = data?.threads || data || [];
      if (Array.isArray(threads)) {
        for (const t of threads) {
          const id = t?.id || t?._id;
          if (id) ctx.threadIds.push(String(id));
        }
      }
      ctx.threadIds = uniq(ctx.threadIds).slice(0, 50);
    }

    for (const slug of ctx.diseaseSlugs.slice(0, 5)) {
      const res = requestJson('GET', `/api/disease-pages/${encodeURIComponent(String(slug))}`, {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/disease-pages/:slug' },
      });
      const data = safeJson(res);
      const resources = data?.resources || data?.page?.resources || [];
      if (Array.isArray(resources)) {
        ctx.resourceIdsBySlug[slug] = resources
          .map((r) => String(r?.id || r?._id || ''))
          .filter(Boolean)
          .slice(0, 25);
      } else {
        ctx.resourceIdsBySlug[slug] = [];
      }

      const resPosts = requestJson('GET', `/api/disease-pages/${encodeURIComponent(String(slug))}/posts`, {
        headers: buildHeaders(userToken),
        tags: { kind: 'api', endpoint: 'GET /api/disease-pages/:slug/posts' },
      });
      const postsData = safeJson(resPosts);
      const posts = postsData?.posts || postsData?.items || postsData || [];
      const ids = [];
      if (Array.isArray(posts)) {
        for (const p of posts) {
          const id = p?.id || p?._id || p?.post?.id || p?.post?._id;
          if (id) ids.push(String(id));
        }
      }
      ctx.diseasePostIdsBySlug[slug] = uniq(ids).slice(0, 50);
    }
  }

  if (adminToken) {
    {
      const res = requestJson('GET', '/api/admin/logs', {
        headers: buildHeaders(adminToken),
        tags: { kind: 'api', endpoint: 'GET /api/admin/logs' },
      });
      const data = safeJson(res);
      const logs = data?.logs || data?.items || data || [];
      if (Array.isArray(logs)) {
        for (const l of logs) {
          const id = l?.id || l?._id;
          if (id) ctx.logIds.push(String(id));
        }
      }
      ctx.logIds = uniq(ctx.logIds).slice(0, 50);
    }

    {
      const res = requestJson('GET', '/api/moderation/queue', {
        headers: buildHeaders(adminToken),
        tags: { kind: 'api', endpoint: 'GET /api/moderation/queue' },
      });
      const data = safeJson(res);
      const items = data?.items || data?.queue || data || [];
      if (Array.isArray(items)) {
        for (const it of items) {
          const type = it?.type;
          const id = it?.id || it?._id || it?.contentId;
          if (type && id && (type === 'post' || type === 'comment')) {
            ctx.moderationIds[type].push(String(id));
          }
        }
      }
      ctx.moderationIds.post = uniq(ctx.moderationIds.post).slice(0, 50);
      ctx.moderationIds.comment = uniq(ctx.moderationIds.comment).slice(0, 50);
    }
  }

  return ctx;
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function buildBodyFor(ep, ctx) {
  const nowIso = new Date().toISOString();
  const rnd = Math.floor(Math.random() * 1e9);

  if (ep.method === 'GET' || ep.method === 'DELETE') return null;

  if (ep.path === '/api/auth/register') {
    return JSON.stringify({
      cognitoSub: `k6-${rnd}`,
      name: `k6-user-${rnd}`,
      email: `k6.user.${rnd}@example.local`,
      roleType: 'patient',
      disease: '',
      caregiverRelationship: '',
      location: 'k6',
      bio: 'k6 load test',
    });
  }

  if (ep.path === '/api/auth/login') {
    return JSON.stringify({
      email: LOGIN_EMAIL || `k6.user.${rnd}@example.local`,
      password: LOGIN_PASSWORD || 'invalid-password',
    });
  }

  if (ep.path === '/api/auth/login/challenge') {
    return JSON.stringify({
      username: LOGIN_EMAIL || `k6.user.${rnd}@example.local`,
      session: 'dummy-session',
      newPassword: `NewPass!${rnd}`,
    });
  }

  if (ep.path === '/api/auth/logout') return JSON.stringify({});

  if (ep.path === '/api/profile') {
    return JSON.stringify({
      bio: `k6 bio update ${nowIso}`,
      location: 'k6',
      healthInterests: ['load-test'],
    });
  }

  if (ep.path === '/api/users/me') {
    return JSON.stringify({
      name: USER_NAME,
      location: 'k6',
      bio: `k6 users/me update ${nowIso}`,
    });
  }

  if (ep.path === '/api/users/me/avatar' || ep.path === '/api/users/me/cover') {
    return JSON.stringify({
      image: `data:image/png;base64,${TINY_PNG_BASE64}`,
    });
  }

  if (ep.path === '/api/users/:userId') {
    return JSON.stringify({
      bio: `k6 update user ${nowIso}`,
      location: 'k6',
    });
  }

  if (ep.path === '/api/groups') {
    return JSON.stringify({
      name: `k6-group-${rnd}`,
      description: 'k6 load test group',
      privacy: 'public',
      diseaseTag: 'k6',
    });
  }

  if (ep.path === '/api/groups/:groupId') {
    return JSON.stringify({ description: `k6 updated ${nowIso}` });
  }

  if (ep.path === '/api/posts') {
    return JSON.stringify({
      content: `k6 post ${rnd} @ ${nowIso}`,
      userConfirmedModeration: true,
      groupId: null,
    });
  }

  if (ep.path.endsWith('/comments')) {
    return JSON.stringify({ content: `k6 comment ${rnd}` });
  }

  if (ep.path === '/api/posts/:postId') {
    return JSON.stringify({ content: `k6 updated content ${rnd}` });
  }

  if (ep.path === '/api/posts/:postId/review') {
    return JSON.stringify({ status: 'approved', notes: `k6 review ${nowIso}` });
  }

  if (ep.path === '/api/forums/:forumGroupId/threads') {
    return JSON.stringify({ title: `k6 thread ${rnd}`, content: `k6 thread content ${nowIso}` });
  }

  if (ep.path === '/api/forums/threads/:threadId/reply') {
    return JSON.stringify({ content: `k6 reply ${rnd}` });
  }

  if (ep.path === '/api/forums/posts/:forumPostId') {
    return JSON.stringify({ content: `k6 edit forum post ${rnd}` });
  }

  if (ep.path === '/api/disease-pages') {
    return JSON.stringify({ name: `k6 disease page ${rnd}`, slug: `k6-${rnd}`, description: 'k6 load test disease page' });
  }

  if (ep.path.includes('/api/disease-pages/:slug/posts') && ep.method === 'POST') {
    return JSON.stringify({ content: `k6 disease page post ${rnd}`, userConfirmedModeration: true });
  }

  if (ep.path.includes('/api/disease-pages/:slug/resources')) {
    return JSON.stringify({ title: `k6 resource ${rnd}`, url: 'https://example.com/', description: 'k6 resource' });
  }

  if (ep.path === '/api/disease-pages/:slug') {
    return JSON.stringify({ description: `k6 updated disease page ${nowIso}` });
  }

  if (ep.path === '/api/disease-pages/:slug/events') {
    return JSON.stringify({
      title: `k6 event ${rnd}`,
      description: 'k6 event',
      location: 'k6',
      startDate: nowIso,
      endDate: nowIso,
    });
  }

  if (ep.path === '/api/notifications/read-all') return JSON.stringify({});

  if (ep.path === '/api/notifications/preferences') {
    return JSON.stringify({ emailNotifications: false, pushNotifications: false });
  }

  if (ep.path === '/api/events') {
    return JSON.stringify({
      title: `k6 event ${rnd}`,
      description: 'k6 load test event',
      location: 'k6',
      startDate: nowIso,
      endDate: nowIso,
    });
  }

  if (ep.path === '/api/events/:eventId') return JSON.stringify({ title: `k6 updated event ${rnd}` });

  if (ep.path === '/api/gamification/award-tokens') {
    return JSON.stringify({ userId: ctx.userId || USER_ID || ADMIN_ID, tokens: 1, reason: 'k6' });
  }

  if (ep.path === '/api/moderation/:moderationType/:moderationId/request-edit') return JSON.stringify({ message: 'k6 request edit' });
  if (ep.path === '/api/moderation/:moderationType/:moderationId/approve' || ep.path === '/api/moderation/:moderationType/:moderationId/reject') {
    return JSON.stringify({ notes: 'k6 moderation' });
  }

  if (ep.path === '/api/conversations/start') {
    const target = pickOne(ctx.suggestedUsers)?.email || USER_EMAIL;
    return JSON.stringify({ email: target });
  }

  if (ep.path === '/api/conversations/group') {
    const ids = (ctx.suggestedUsers || []).slice(0, 3).map((u) => u?.id).filter(Boolean);
    return JSON.stringify({
      name: `k6 group conv ${rnd}`,
      participantIds: uniq([ctx.userId || USER_ID, ...ids]).slice(0, 5),
    });
  }

  if (ep.path === '/api/conversations/:convId/messages') return JSON.stringify({ content: `k6 message ${rnd}` });

  if (ep.path === '/api/admin/users/:userId') return JSON.stringify({ bio: `k6 admin update ${nowIso}`, suspended: false });
  if (ep.path === '/api/admin/users/:userId/role') return JSON.stringify({ role: 'patient-user', roleType: 'patient' });
  if (ep.path.includes('/api/admin/users/:userId/suspend')) return JSON.stringify({ suspended: true, reason: 'k6' });
  if (ep.path === '/api/admin/logs/delete-range') {
    return JSON.stringify({
      startDate: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      endDate: nowIso,
    });
  }
  if (ep.path === '/api/admin/email/test') return JSON.stringify({ to: EMAIL_TEST_TO || '' });

  return JSON.stringify({});
}

function buildPathWithQuery(ep, resolvedPath) {
  if (ep.path === '/api/search') {
    const q = pickOne(['a', 'e', 'i', 'o', 'u', 'test', 'user', 'group', 'k6']) || 'test';
    const type = pickOne(['users', 'groups', '']) || '';
    const qs = [];
    qs.push(`q=${encodeURIComponent(q)}`);
    if (type) qs.push(`type=${encodeURIComponent(type)}`);
    return `${resolvedPath}?${qs.join('&')}`;
  }

  if (ep.path === '/api/search/suggested') return `${resolvedPath}?limit=5`;
  if (ep.path === '/api/posts' && ep.method === 'GET') return `${resolvedPath}?limit=20&smartFeed=true`;
  return resolvedPath;
}

function pickToken(ep, ctx) {
  if (ep.auth === 'none') return '';
  if (ep.auth === 'optional') return ctx.userToken || '';
  if (ep.auth === 'user') return ctx.userToken || '';
  if (ep.auth === 'admin') return ctx.adminToken || '';
  if (ep.auth === 'adminOrMod') return pickAdminOrModToken(ctx);
  return ctx.userToken || '';
}

function pickAdminOrModToken(ctx) {
  const adminToken = ctx?.adminToken || '';
  const modToken = ctx?.modToken || '';
  if (adminToken && modToken) return Math.random() < 0.5 ? modToken : adminToken;
  return adminToken || modToken || '';
}

function maybeSkipForAuth(ep, ctx) {
  if (ep.auth === 'user' && !ctx.userToken) {
    skipped_no_token.add(1);
    return true;
  }
  if (ep.auth === 'admin' && !ctx.adminToken) {
    skipped_admin_token_missing.add(1);
    return true;
  }
  if (ep.auth === 'adminOrMod' && !(ctx.adminToken || ctx.modToken)) {
    skipped_admin_token_missing.add(1);
    return true;
  }
  return false;
}

function maybeSkipForWrites(ep) {
  if (!ep.write) return false;
  if (!ENABLE_WRITES) {
    skipped_writes_disabled.add(1);
    return true;
  }
  if (!shouldDoWrite()) {
    skipped_writes_disabled.add(1);
    return true;
  }
  return false;
}

export function stressJourney(ctx) {
  const idx = (Number(__VU) * 100000 + Number(__ITER)) % ENDPOINTS.length;
  const ep = ENDPOINTS[idx];

  group('common_flow', () => {
    const token = ctx.userToken || '';
    if (!token) {
      skipped_no_token.add(1);
      return;
    }
    const headers = buildHeaders(token);
    const batch = [
      ['GET', url('/api/ping'), null, { tags: { kind: 'api', endpoint: 'GET /api/ping' }, headers }],
      ['GET', url('/api/posts?limit=10&smartFeed=true'), null, { tags: { kind: 'api', endpoint: 'GET /api/posts' }, headers }],
      ['GET', url('/api/notifications/unread-count'), null, { tags: { kind: 'api', endpoint: 'GET /api/notifications/unread-count' }, headers }],
      ['GET', url('/api/search/suggested?limit=3'), null, { tags: { kind: 'api', endpoint: 'GET /api/search/suggested' }, headers }],
    ];

    const resps = http.batch(batch);
    for (let i = 0; i < resps.length; i += 1) {
      const r = resps[i];
      const t = batch[i] && batch[i][3] && batch[i][3].tags ? batch[i][3].tags : {};
      recordRates(r);
      recordEndpointMetrics(r, t);
    }
  });

  group('endpoint_catalog', () => {
    if ((ep.auth === 'admin' || ep.auth === 'adminOrMod') && !shouldDoAdmin()) {
      skipped_admin_sampling.add(1);
      return;
    }

    if (maybeSkipForAuth(ep, ctx)) return;
    if (maybeSkipForWrites(ep)) return;

    const resolved = resolvePath(ep.path, ctx);
    if (!resolved) {
      skipped_missing_data.add(1);
      return;
    }

    const finalPath = buildPathWithQuery(ep, resolved);
    const token = pickToken(ep, ctx);
    const headers = buildHeaders(token);

    const endpointTag = endpointTagFromTemplate(ep);
    const tags = { kind: ep.kind || 'api', endpoint: endpointTag, api: ep.name };

    const body = buildBodyFor(ep, ctx);

    const res = request(ep.method, finalPath, {
      headers,
      tags,
      body,
    });

    if (ep.path === '/api/ping' && ep.method === 'GET') {
      check(res, { 'ping status is 200': (r) => r && r.status === 200 });
    }
  });

  jitterSleep();
}

export default function (ctx) {
  return stressJourney(ctx);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatThresholds(data) {
  // k6 provides evaluated threshold results under data.metrics[metricName].thresholds
  const metrics = data?.metrics || {};
  const lines = [];

  const metricNames = Object.keys(metrics)
    .filter((name) => metrics?.[name]?.thresholds && Object.keys(metrics[name].thresholds).length > 0)
    .sort();

  for (const metricName of metricNames) {
    const mThresholds = metrics[metricName].thresholds || {};
    const exprs = Object.keys(mThresholds);
    let metricOk = true;

    for (const expr of exprs) {
      const thOk = mThresholds?.[expr]?.ok;
      if (thOk === false) metricOk = false;
    }

    lines.push(`${metricName}: ${metricOk ? 'OK' : 'FAIL'}`);
    for (const expr of exprs.sort()) {
      const thOk = mThresholds?.[expr]?.ok;
      const okLabel = thOk === true ? 'OK' : thOk === false ? 'FAIL' : 'UNKNOWN';
      lines.push(`  - ${expr}: ${okLabel}`);
    }
  }

  return lines.join('\n');
}

function breakingPointSummary(data) {
  const configured = options?.thresholds || {};
  const metrics = data?.metrics || {};

  const failures = [];
  const abortFailures = [];

  const abortOnFailFor = (metricName, expr) => {
    const thList = configured?.[metricName];
    const list = Array.isArray(thList) ? thList : thList ? [thList] : [];
    for (const item of list) {
      if (!item || typeof item === 'string') continue;
      if (item.threshold === expr && item.abortOnFail) return true;
    }
    return false;
  };

  for (const [metricName, m] of Object.entries(metrics)) {
    const mThresholds = m?.thresholds || {};
    for (const [expr, thObj] of Object.entries(mThresholds)) {
      if (!thObj || thObj.ok !== false) continue;
      const abortOnFail = abortOnFailFor(metricName, expr);
      const row = { metric: metricName, threshold: expr, abortOnFail };
      failures.push(row);
      if (abortOnFail) abortFailures.push(row);
    }
  }

  if (abortFailures.length > 0) {
    return `Test aborted by threshold(s): ${abortFailures.map((x) => `${x.metric} (${x.threshold})`).join(', ')}.`;
  }

  if (failures.length > 0) {
    return `Threshold(s) failed (non-abort): ${failures.map((x) => `${x.metric} (${x.threshold})`).join(', ')}.`;
  }

  return 'All thresholds passed.';
}

function pickMetric(data, name) {
  return data?.metrics?.[name] || null;
}

function metricLine(m, label) {
  if (!m) return `${label}: (missing)`;
  const v = m.values || {};
  const parts = [];
  if ('rate' in v) parts.push(`rate=${Number(v.rate).toFixed(4)}`);
  if ('avg' in v) parts.push(`avg=${Number(v.avg).toFixed(2)}ms`);
  if ('p(90)' in v) parts.push(`p90=${Number(v['p(90)']).toFixed(2)}ms`);
  if ('p(95)' in v) parts.push(`p95=${Number(v['p(95)']).toFixed(2)}ms`);
  if ('p(99)' in v) parts.push(`p99=${Number(v['p(99)']).toFixed(2)}ms`);
  if ('count' in v) parts.push(`count=${v.count}`);
  return `${label}: ${parts.join(' | ')}`;
}

export function handleSummary(data) {
  const httpReqDuration = pickMetric(data, 'http_req_duration');
  const httpReqFailed = pickMetric(data, 'http_req_failed');

  const customServer = pickMetric(data, 'server_error_rate');
  const customClient = pickMetric(data, 'client_error_rate');
  const customOk = pickMetric(data, 'ok_rate');
  const customCacheHit = pickMetric(data, 'cache_hit_rate');

  const peakTarget = (() => {
    try {
      return Math.max(0, ...(STAGES || []).map((s) => Number(s?.target) || 0));
    } catch {
      return 0;
    }
  })();

  const textReport = [
    '=== Winsights Social k6 Stress Report ===',
    `Base URL: ${BASE_URL}`,
    `Peak VUs target: ${peakTarget}`,
    '',
    breakingPointSummary(data),
    '',
    metricLine(httpReqDuration, 'http_req_duration'),
    metricLine(httpReqFailed, 'http_req_failed (5xx/transport only)'),
    metricLine(customServer, 'server_error_rate (5xx/transport)'),
    metricLine(customClient, 'client_error_rate (4xx)'),
    metricLine(customOk, 'ok_rate (2xx/3xx)'),
    metricLine(customCacheHit, 'cache_hit_rate (from X-Cache header)'),
    '',
    'Thresholds:',
    formatThresholds(data),
    '',
    'Artifacts:',
    `  - ${SUMMARY_BASENAME}.json`,
    `  - ${SUMMARY_BASENAME}.html`,
    '',
    'Top slow endpoints (p95):',
    ...(() => {
      const rows = [];
      for (const tag of ENDPOINT_TAGS) {
        const slug = sanitizeMetricName(tag);
        const metricName = `ep_dur__${slug}`;
        const m = data?.metrics?.[metricName];
        const v = m?.values || {};
        const p95 = v['p(95)'];
        const count = v.count;
        if (p95 == null || count == null) continue;
        rows.push({ tag, p95, count, p99: v['p(99)'], avg: v.avg });
      }
      rows.sort((a, b) => b.p95 - a.p95);
      return rows.slice(0, 15).map((r) => `  - ${r.tag}: p95=${Number(r.p95).toFixed(1)}ms p99=${Number(r.p99 || 0).toFixed(1)}ms avg=${Number(r.avg || 0).toFixed(1)}ms count=${r.count}`);
    })(),
    '',
    'Top error endpoints (server errors):',
    ...(() => {
      const rows = [];
      for (const tag of ENDPOINT_TAGS) {
        const slug = sanitizeMetricName(tag);
        const req = data?.metrics?.[`ep_req__${slug}`]?.values?.count || 0;
        const serr = data?.metrics?.[`ep_serr__${slug}`]?.values?.count || 0;
        if (!req) continue;
        rows.push({ tag, req, serr, rate: serr / req });
      }
      rows.sort((a, b) => b.rate - a.rate);
      return rows.slice(0, 15).map((r) => `  - ${r.tag}: server_error_rate=${(r.rate * 100).toFixed(2)}% (${r.serr}/${r.req})`);
    })(),
  ].join('\n');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>k6 Stress Report</title>
  <style>
    body { font-family: -apple-system, system-ui, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color: #111; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    .meta { color: #444; margin-bottom: 16px; }
    pre { background: #0b1020; color: #e7eaf3; padding: 14px; border-radius: 10px; overflow: auto; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 12px; max-width: 960px; }
    .card { border: 1px solid #e6e6e6; border-radius: 12px; padding: 14px; }
    .k { color: #555; }
  </style>
</head>
<body>
  <h1>Winsights Social – k6 Stress Report</h1>
  <div class="meta">
    <div><span class="k">Base URL:</span> ${escapeHtml(BASE_URL)}</div>
    <div><span class="k">Peak VUs target:</span> ${escapeHtml(String(peakTarget))}</div>
    <div><span class="k">Breaking point:</span> ${escapeHtml(breakingPointSummary(data))}</div>
  </div>

  <div class="grid">
    <div class="card"><pre>${escapeHtml(textReport)}</pre></div>
  </div>
</body>
</html>`;

  const out = {};
  out.stdout = textReport;
  out[`${SUMMARY_BASENAME}.json`] = JSON.stringify(data, null, 2);
  out[`${SUMMARY_BASENAME}.html`] = html;
  return out;
}
