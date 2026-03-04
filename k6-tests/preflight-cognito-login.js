/*
  Preflight check: verify that Cognito-backed /api/auth/login works for the
  demo Admin/Moderator/Patient credentials referenced in the frontend LoginPage.

  Prints only status + boolean flags (no passwords, no tokens).
*/

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const loginPage = path.join(repoRoot, 'client', 'src', 'pages', 'LoginPage.tsx');
const baseUrl = String(process.env.BASE_URL || 'http://localhost:5001').replace(/\/+$/, '');

function findCredsInLoginPage(loginPagePath) {
  const text = fs.readFileSync(loginPagePath, 'utf8');
  const re = /handleQuickFill\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  const matches = [...text.matchAll(re)].map((m) => ({ email: m[1], password: m[2] }));

  const pick = (needle) => matches.find((m) => String(m.email).toLowerCase().includes(needle));

  return {
    admin: pick('admin@winsights.life'),
    moderator: pick('moderator@winsights.life'),
    patient: pick('sarah@winsights.life'),
  };
}

async function testLogin(name, cred) {
  if (!cred) throw new Error(`Missing ${name} credential in LoginPage quick-fill.`);

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: cred.email, password: cred.password }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const hasIdToken = Boolean(body && body.tokens && body.tokens.idToken);
  const hasChallenge = Boolean(body && body.challengeName);
  const err = body && (body.error || body.message);

  console.log(
    `${name}: status=${res.status} hasIdToken=${hasIdToken} hasChallenge=${hasChallenge} err=${err ? String(err).slice(0, 120) : ''}`
  );
}

async function main() {
  if (!fs.existsSync(loginPage)) {
    throw new Error(`Login page not found: ${loginPage}`);
  }

  const creds = findCredsInLoginPage(loginPage);

  console.log(`[preflight] BASE_URL=${baseUrl}`);
  await testLogin('patient', creds.patient);
  await testLogin('moderator', creds.moderator);
  await testLogin('admin', creds.admin);
}

main().catch((e) => {
  console.error('Preflight failed:', e.message);
  process.exitCode = 1;
});
