#!/usr/bin/env node
/**
 * Secret scanner for the FULL GIT HISTORY (§13 of the follow-up brief; §28).
 *
 * scripts/scan-secrets.js checks the working tree. That is the wrong question
 * for a credential: deleting a secret from HEAD does not delete it from the
 * repository, and anyone who has ever cloned still has it. This walks every
 * blob that has ever existed in every ref and looks for credential shapes.
 *
 * It NEVER prints a matched value — only the pattern name, the path and the
 * blob id, so that a report or a CI log can name a leak without repeating it.
 *
 * Usage: node scripts/scan-secrets-history.js [repo-path]
 *
 * A finding means the credential must be ROTATED. Rewriting history is not a
 * substitute: assume anything ever pushed has been read.
 */
const { execSync } = require("child_process");

const PATTERNS = [
  ["Plaid access token", /access-(sandbox|development|production)-[0-9a-f]{8}-[0-9a-f]{4}/i],
  ["Plaid public token", /public-(sandbox|development|production)-[0-9a-f]{8}-[0-9a-f]{4}/i],
  ["Plaid client id/secret assignment", /PLAID_(CLIENT_ID|SECRET)[ \t]*=[ \t]*["']?[A-Za-z0-9]{16,}/],
  ["Anthropic API key", /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/],
  ["OpenAI API key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["Resend API key", /\bre_[A-Za-z0-9]{24,}/],
  ["Database URL with password", /postgres(ql)?:\/\/[^\s:'"]+:[^\s@'"]{6,}@/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Private key block", /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Better Auth secret assignment", /BETTER_AUTH_SECRET[ \t]*=[ \t]*["']?[A-Za-z0-9+/=_-]{24,}/],
  ["Encryption key assignment", /ENCRYPTION_KEY_V\d[ \t]*=[ \t]*["']?[A-Za-z0-9+/=]{40,}/],
  ["App password assignment", /APP_PASSWORD[ \t]*=[ \t]*["']?[^\s"']{8,}/],
];

// Obvious placeholders that must not be reported as real credentials.
const PLACEHOLDER = /^[A-Z_<>]+$|:PASSWORD@|USER:|your-key-here|your_key_here|example|changeme|placeholder|xxx+|<[a-z-]+>|\.\.\.|redacted|CANARY|canary|test-only|dummy|fake|sample/i;

const repo = process.argv[2] || ".";
const run = (cmd) => execSync(cmd, { cwd: repo, maxBuffer: 1024 * 1024 * 512 }).toString();

// Every blob ever recorded, with the commit and path it appeared at.
const objects = run("git rev-list --objects --all").split("\n");
const commitsSeen = run("git rev-list --all").trim().split("\n").length;

let scanned = 0;
const findings = [];
for (const line of objects) {
  const space = line.indexOf(" ");
  if (space < 0) continue;
  const sha = line.slice(0, space);
  const path = line.slice(space + 1);
  if (!path || /^(node_modules|\.next|package-lock\.json)/.test(path)) continue;
  if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|zip|db)$/i.test(path)) continue;

  let content;
  try {
    content = execSync(`git cat-file -p ${sha}`, { cwd: repo, maxBuffer: 1024 * 1024 * 64 }).toString();
  } catch { continue; }
  scanned++;
  for (const [name, re] of PATTERNS) {
    const m = content.match(re);
    if (!m) continue;
    const placeholder = PLACEHOLDER.test(m[0]);
    findings.push({ name, path, sha: sha.slice(0, 10), placeholder });
  }
}

console.log(`repository: ${repo}`);
console.log(`commits in history: ${commitsSeen}`);
console.log(`blobs scanned: ${scanned}`);
const real = findings.filter((f) => !f.placeholder);
const ph = findings.filter((f) => f.placeholder);
console.log(`\nplaceholder-shaped matches (not credentials): ${ph.length}`);
for (const f of ph.slice(0, 20)) console.log(`   ${f.name} @ ${f.path} (${f.sha})`);
console.log(`\nPOSSIBLE REAL CREDENTIALS: ${real.length}`);
for (const f of real) console.log(`   !! ${f.name} @ ${f.path} (blob ${f.sha})`);
if (real.length === 0) console.log("   none");
