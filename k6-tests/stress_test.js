import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import encoding from 'k6/encoding';
import crypto from 'k6/crypto';

// ==============================================================================
// CONFIGURATION & METRICS
// ==============================================================================

// Custom Metrics for detailed analysis
const errorRate = new Rate('error_rate');
const postsResponseTime = new Trend('response_time_posts');
const notifResponseTime = new Trend('response_time_notifications');
const meResponseTime = new Trend('response_time_me');

/*
 * STRESS TEST CONFIGURATION
 * Goal: Ramp up to 2000 concurrent users to find breaking point
 * Target: http://localhost:5001
 */
export const options = {
    stages: [
        { duration: '30s', target: 200 },    // Warm-up: 0 to 200 users
        { duration: '1m', target: 500 },     // Low Load: Ramp to 500 users
        { duration: '1m', target: 1000 },    // Medium Load: Ramp to 1000 users
        { duration: '2m', target: 1500 },    // High Load: Ramp to 1500 users
        { duration: '2m', target: 2000 },    // Stress Test: Ramp to 2000 users
        { duration: '1m', target: 2000 },    // Breaking Point: Hold at 2000 users
        { duration: '1m', target: 0 },       // Cool-down
    ],
    thresholds: {
        // Global thresholds
        'http_req_duration': ['p(95)<2000'], // 95% of requests should be under 2s (relaxed for stress test)
        'error_rate': ['rate<0.05'],         // Allow up to 5% failures before failing the test (stress test tolerance)

        // Specific API thresholds
        'response_time_posts': ['p(95)<3000'], // Posts API might be slower under load
    },
};

const BASE_URL = 'http://localhost:5001/api';
// Default secret key from server/src/utils/auth.js (fallback)
// IMPORTANT: If your server uses a different JWT_SECRET in .env, update it here.
const JWT_SECRET = 'winsights-dev-secret';

// ==============================================================================
// AUTHENTICATION HELPER (Bypass Login)
// ==============================================================================

/**
 * Signs a JWT using HMAC SHA256 (HS256) compatible with server's local auth.
 * NOTE: Ensure your server is running with AUTH_PROVIDER=local or accepts local tokens.
 */
function sign(data, key) {
    let hasher = crypto.createHMAC('sha256', key);
    hasher.update(data);
    // Base64Url encoding: + -> -, / -> _, remove =
    return hasher.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generates a valid local JWT token for a mock user.
 */
function generateToken() {
    const header = JSON.stringify({ alg: 'HS256', typ: 'JWT' });

    // Mock User Payload - mimicking a typical patient user structure
    const payload = JSON.stringify({
        id: '65cb8845e2a2c16c4f001234', // Random valid Mongo ObjectId
        role: 'patient-user',          // Required role for most endpoints
        email: 'stress-tester@example.com',
        name: 'Stress Test User',
        iat: Math.floor(Date.now() / 1000),      // Issued at
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // Expires in 24h
    });

    const b64Header = encoding.b64encode(header, 'url');
    const b64Payload = encoding.b64encode(payload, 'url');
    const signature = sign(`${b64Header}.${b64Payload}`, JWT_SECRET);

    return `${b64Header}.${b64Payload}.${signature}`;
}

// Generate token once per VU (Virtual User) to reuse
const token = generateToken();

// ==============================================================================
// TEST SCENARIO
// ==============================================================================

export default function () {
    const params = {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        tags: { name: 'MainFlow' },
    };

    group('API Endpoints', function () {
        // 1. GET /auth/me - Lightweight auth check
        // Purpose: Verify authentication and basic server responsiveness
        let resMe = http.get(`${BASE_URL}/auth/me`, params);
        meResponseTime.add(resMe.timings.duration);
        check(resMe, {
            'Me status 200': (r) => r.status === 200
        }) || errorRate.add(1);

        // 2. GET /posts - Heavy Database Read (Smart Feed)
        // Purpose: Stress test database query performance and data aggregation
        let resPosts = http.get(`${BASE_URL}/posts`, params);
        postsResponseTime.add(resPosts.timings.duration);
        check(resPosts, {
            'Posts status 200': (r) => r.status === 200
        }) || errorRate.add(1);

        // 3. GET /notifications - User specific data
        // Purpose: Test user-specific index lookups (often unoptimized)
        let resNotif = http.get(`${BASE_URL}/notifications`, params);
        notifResponseTime.add(resNotif.timings.duration);
        check(resNotif, {
            'Notifications status 200': (r) => r.status === 200
        }) || errorRate.add(1);
    });

    // Random "think time" between actions (1s - 3s)
    // This simulates realistic user behavior rather than just DDOSing the server
    sleep(Math.random() * 2 + 1);
}
