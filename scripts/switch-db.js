#!/usr/bin/env node
// Flip the Prisma datasource between sqlite (local) and postgresql (deployed).
// Usage: node scripts/switch-db.js postgres|sqlite

const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!["postgres", "postgresql", "sqlite"].includes(target)) {
  console.error("Usage: node scripts/switch-db.js postgres|sqlite");
  process.exit(1);
}
const provider = target === "sqlite" ? "sqlite" : "postgresql";

const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");
const updated = schema.replace(
  /provider = "(sqlite|postgresql)"/,
  `provider = "${provider}"`,
);
if (updated === schema && !schema.includes(`provider = "${provider}"`)) {
  console.error("Could not find the datasource provider line in schema.prisma");
  process.exit(1);
}
fs.writeFileSync(schemaPath, updated);
console.log(`✔ prisma/schema.prisma now uses ${provider}`);
if (provider === "postgresql") {
  console.log("  Next: set DATABASE_URL to your Postgres URL, then run: npm run db:deploy");
} else {
  console.log('  Back to local SQLite. DATABASE_URL should be "file:./dev.db".');
}
