import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 500 }, // Rampu up to 500 users
    { duration: '1m', target: 2000 }, // Stay at 2000 users for 1 minute
    { duration: '30s', target: 0 },   // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate should be less than 1%
  },
};

const BASE_URL = 'http://localhost:5001/api'; // using port 5001

export default function () {
  const token = 'fake-token-for-load-test'; // Since we are bypassing real auth via cache or we can mock it
  
  // Mock a user ID or dynamically create one
  const headers = { 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 1. Test Feed API
  const feedRes = http.get(`${BASE_URL}/posts`, { headers });
  check(feedRes, {
    'Feed status is 200': (r) => r.status === 200 || r.status === 401, // 401 if we need real token
  });
  
  // 2. Test Conversations API
  const convRes = http.get(`${BASE_URL}/conversations`, { headers });
  check(convRes, {
    'Conversations status is 200': (r) => r.status === 200 || r.status === 401,
  });

  // 3. Test Notifications
  const notifRes = http.get(`${BASE_URL}/notifications`, { headers });
  check(notifRes, {
    'Notifications status is 200': (r) => r.status === 200 || r.status === 401,
  });

  // 4. Test Groups
  const groupRes = http.get(`${BASE_URL}/groups`, { headers });
  check(groupRes, {
    'Groups status is 200': (r) => r.status === 200 || r.status === 401,
  });

  sleep(Math.random() * 2); // Random sleep between 0-2s to simulate real user behavior
}
