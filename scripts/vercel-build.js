#!/usr/bin/env node
// Build entry point that makes cloud deploys self-configuring.
//
// When DATABASE_URL points at Postgres (i.e. we're building on Vercel or any
// host with a hosted database), this flips the Prisma provider to postgresql,
// regenerates the client, and pushes the schema so the tables exist — then
// builds. With a local SQLite URL it just builds. Demo data is handled at
// runtime: the app seeds itself the first time it sees an empty database.

const { execSync } = require("child_process");

const run = (cmd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

const url = process.env.DATABASE_URL || "";
if (url.startsWith("postgres")) {
  console.log("Postgres detected — configuring hosted database…");
  run("node scripts/switch-db.js postgres");
  run("npx prisma generate");
  run("npx prisma db push --skip-generate");
} else {
  console.log("Local SQLite build — skipping database setup.");
}
run("npx next build");
