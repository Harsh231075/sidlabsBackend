/*
  Runs the k6 stress test using Cognito-protected login credentials sourced from the frontend LoginPage.

  - No secrets are printed to stdout.
  - The k6 process receives env vars (K6_*), but they are not echoed.

  Usage (from server/):
    node k6-tests/run-cognito-protected-2k.js

  Optional overrides:
    BASE_URL=http://localhost:5001
    K6_PROFILE=quick|full
    K6_SUMMARY_BASENAME=k6-summary-cognito
    K6_FRONTEND_LOGIN_PAGE=../client/src/pages/LoginPage.tsx
*/

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findFirstExistingPath(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function safeBasename(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'k6-summary';
}

function findCredsInLoginPage(loginPagePath) {
  const text = fs.readFileSync(loginPagePath, 'utf8');

  // matches: handleQuickFill("email", "password")
  const re = /handleQuickFill\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  const matches = [...text.matchAll(re)];

  const creds = {
    admin: null,
    moderator: null,
    patient: null,
  };

  for (const m of matches) {
    const email = String(m[1] || '').trim();
    const password = String(m[2] || '');

    if (!email || !password) continue;

    if (email.toLowerCase().includes('admin@winsights.life')) {
      creds.admin = { email, password };
    } else if (email.toLowerCase().includes('moderator@winsights.life')) {
      creds.moderator = { email, password };
    } else if (email.toLowerCase().includes('sarah@winsights.life')) {
      creds.patient = { email, password };
    }
  }

  return creds;
}

function assertCred(name, c) {
  if (!c || !c.email || !c.password) {
    throw new Error(`Missing ${name} credentials in frontend login page quick-fill section.`);
  }
}

function main() {
  // Support both layouts:
  // 1) monorepo: <root>/server/k6-tests/run-cognito-protected-2k.js
  // 2) backend-only: <backend>/k6-tests/run-cognito-protected-2k.js
  const backendDir = path.resolve(__dirname, '..');
  const repoRootCandidate = path.resolve(backendDir, '..');

  const loginPagePath = (() => {
    if (process.env.K6_FRONTEND_LOGIN_PAGE) return path.resolve(process.env.K6_FRONTEND_LOGIN_PAGE);

    const candidates = [
      // monorepo default
      path.join(repoRootCandidate, 'client', 'src', 'pages', 'LoginPage.tsx'),
      // sometimes people copy client into backendDir
      path.join(backendDir, 'client', 'src', 'pages', 'LoginPage.tsx'),
    ];

    return findFirstExistingPath(candidates) || candidates[0];
  })();

  const baseUrl = String(process.env.BASE_URL || 'http://localhost:5001').replace(/\/+$/, '');
  const profile = String(process.env.K6_PROFILE || 'quick').toLowerCase();

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const summaryBase = safeBasename(process.env.K6_SUMMARY_BASENAME || `k6-summary-cognito-${ts}`);

  // Allow explicit credentials via environment variables for CI or remote runs.
  // Priority: explicit env vars -> K6_FRONTEND_LOGIN_PAGE parsing.
  let creds = {
    admin: null,
    moderator: null,
    patient: null,
  };

  if (process.env.K6_LOGIN_EMAIL && process.env.K6_LOGIN_PASSWORD) {
    creds.patient = { email: process.env.K6_LOGIN_EMAIL, password: process.env.K6_LOGIN_PASSWORD };
  }
  if (process.env.K6_ADMIN_LOGIN_EMAIL && process.env.K6_ADMIN_LOGIN_PASSWORD) {
    creds.admin = { email: process.env.K6_ADMIN_LOGIN_EMAIL, password: process.env.K6_ADMIN_LOGIN_PASSWORD };
  }
  if (process.env.K6_MOD_LOGIN_EMAIL && process.env.K6_MOD_LOGIN_PASSWORD) {
    creds.moderator = { email: process.env.K6_MOD_LOGIN_EMAIL, password: process.env.K6_MOD_LOGIN_PASSWORD };
  }

  // If any role is missing from env, try to parse the frontend login page for quick-fill creds.
  if (!creds.admin || !creds.moderator || !creds.patient) {
    if (!fs.existsSync(loginPagePath)) {
      throw new Error(`Login page not found: ${loginPagePath} and some K6_* credentials are missing in environment.`);
    }
    const parsed = findCredsInLoginPage(loginPagePath);
    creds.admin = creds.admin || parsed.admin;
    creds.moderator = creds.moderator || parsed.moderator;
    creds.patient = creds.patient || parsed.patient;
  }

  assertCred('admin', creds.admin);
  assertCred('moderator', creds.moderator);
  assertCred('patient', creds.patient);

  // Avoid printing passwords. Emails are not secret but keep output minimal.
  console.log(`[k6 runner] Using BASE_URL=${baseUrl}, K6_PROFILE=${profile}`);
  console.log(`[k6 runner] Using summary basename: ${summaryBase}`);

  const k6ScriptCandidates = [
    // safest: script sitting next to this runner
    path.join(__dirname, 'stress-all-apis-2k.js'),
    // backend-only layout
    path.join(backendDir, 'k6-tests', 'stress-all-apis-2k.js'),
    // monorepo layout
    path.join(repoRootCandidate, 'server', 'k6-tests', 'stress-all-apis-2k.js'),
  ];

  const k6Script = findFirstExistingPath(k6ScriptCandidates);
  if (!k6Script) {
    throw new Error(
      `k6 script not found. Tried:\n` +
      k6ScriptCandidates.map((p) => `- ${p}`).join('\n') +
      `\n\nFix: ensure 'stress-all-apis-2k.js' exists under your k6-tests folder (same folder as this runner), or clone the full repo including server/.`
    );
  }

  const env = {
    ...process.env,

    BASE_URL: baseUrl,
    K6_PROFILE: profile,
    K6_SUMMARY_BASENAME: summaryBase,

    // Patient token for normal flows
    K6_LOGIN_EMAIL: creds.patient.email,
    K6_LOGIN_PASSWORD: creds.patient.password,

    // Admin token for admin-only endpoints
    K6_ADMIN_LOGIN_EMAIL: creds.admin.email,
    K6_ADMIN_LOGIN_PASSWORD: creds.admin.password,

    // Moderator token so adminOrMod endpoints are truly exercised with both roles
    K6_MOD_LOGIN_EMAIL: creds.moderator.email,
    K6_MOD_LOGIN_PASSWORD: creds.moderator.password,
  };

  const k6Check = spawnSync('k6', ['version'], {
    stdio: 'ignore',
    env,
  });

  if (k6Check.error) {
    // Friendly message for EC2 where k6 might not be installed yet.
    console.error('[k6 runner] k6 executable not found on PATH. Install k6 and retry.');
    throw k6Check.error;
  }

  if (String(process.env.K6_DRY_RUN || '0') === '1') {
    console.log('[k6 runner] Dry run enabled (K6_DRY_RUN=1). Not executing k6.');
    console.log(`[k6 runner] Would run: k6 run ${k6Script}`);
    process.exitCode = 0;
    return;
  }

  const result = spawnSync('k6', ['run', k6Script], {
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

main();
