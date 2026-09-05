#!/usr/bin/env node
/**
 * Secret scanner (§28, §63).
 *
 * A cheap, dependency-free check that runs in CI and locally: it looks for
 * credential-shaped strings in tracked files. It is NOT a replacement for
 * GitHub secret scanning or a real pre-commit hook — it is the fast gate that
 * catches the common mistake of pasting a key into a file while debugging.
 *
 * Exits non-zero on a finding, so a CI job fails rather than warning.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/** Patterns that indicate a REAL credential, not a placeholder. */
const PATTERNS = [
  { name: "Plaid access token", re: /access-(sandbox|development|production)-[0-9a-f]{8}-[0-9a-f]{4}/i },
  { name: "Plaid public token", re: /public-(sandbox|development|production)-[0-9a-f]{8}-[0-9a-f]{4}/i },
  { name: "Anthropic API key", re: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/ },
  { name: "Resend API key", re: /\bre_[A-Za-z0-9]{24,}/ },
  { name: "Database URL with password", re: /postgres(ql)?:\/\/[^\s:'"]+:[^\s@'"]{6,}@/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: "NEXT_PUBLIC_ secret",
    re: /NEXT_PUBLIC_[A-Z_]*(SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)/,
  },
];

/** Files that legitimately contain the shapes above, as documentation. */
const ALLOWLIST = [
  "scripts/scan-secrets.js", // this file
  "src/lib/security/redact.ts", // the redaction patterns
  "tests/", // fixtures use obviously-fake values
  ".env.example", // names only
  "SECURITY_REVIEW.md",
  "INCIDENT_RESPONSE.md",
  "SECURITY_THREAT_MODEL.md",
  "METTA_PRODUCTION_HANDOFF.md",
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "src/generated"]);

function trackedFiles() {
  try {
    return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let findings = 0;

for (const file of trackedFiles()) {
  if ([...SKIP_DIRS].some((dir) => file.startsWith(dir))) continue;
  if (ALLOWLIST.some((allowed) => file.startsWith(allowed))) continue;

  let content;
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024) continue; // skip very large files
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const { name, re } of PATTERNS) {
    const match = re.exec(content);
    if (!match) continue;
    const line = content.slice(0, match.index).split("\n").length;
    // Print the finding's location and kind — never the value itself.
    console.error(`SECRET? ${file}:${line} — looks like a ${name}`);
    findings++;
  }
}

// A committed .env is always a finding, whatever it contains.
for (const envFile of [".env", ".env.local", ".env.production"]) {
  if (trackedFiles().includes(envFile)) {
    console.error(`SECRET? ${envFile} is tracked by git — it must be ignored.`);
    findings++;
  }
}

if (findings > 0) {
  console.error(`\n${findings} potential secret(s) found. Rotate anything real, then remove it.`);
  process.exit(1);
}

console.log("Secret scan clean: no credential-shaped strings in tracked files.");
