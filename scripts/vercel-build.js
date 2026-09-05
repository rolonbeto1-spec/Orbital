#!/usr/bin/env node
/**
 * Production build entry point (§44).
 *
 * WHAT CHANGED AND WHY
 *
 * The old version ran `prisma db push` during every production build. That is
 * fine for one trusted owner and dangerous for a public multi-tenant app:
 * `db push` reconciles the database to whatever the schema file says, without
 * a review step, without a migration history, and — when a change is
 * destructive — it will drop columns and the financial data in them to make
 * the shapes match. A schema edit merged on a Friday could silently delete a
 * column of real transactions.
 *
 * Now: production applies committed, reviewable migrations with
 * `prisma migrate deploy`. That command only ever applies migration files
 * that are already in the repository, it never invents a change, and it
 * refuses to run if the database has drifted from the recorded history.
 *
 * Generating a migration is a deliberate act a developer performs locally
 * (`npm run db:migrate -- --name what_changed`), and the resulting SQL is
 * reviewed in the pull request like any other code.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const run = (cmd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

const url = process.env.DATABASE_URL || "";
const migrationsDir = path.join(__dirname, "..", "prisma", "migrations");

if (url.startsWith("postgres")) {
  console.log("Postgres detected — deploying reviewed migrations…");

  run("node scripts/switch-db.js postgres");
  run("npx prisma generate");

  const hasMigrations =
    fs.existsSync(migrationsDir) &&
    fs
      .readdirSync(migrationsDir)
      .some((entry) => fs.statSync(path.join(migrationsDir, entry)).isDirectory());

  if (!hasMigrations) {
    // Refuse rather than falling back to `db push`. A production deploy with
    // no migration history is a configuration mistake, and quietly pushing
    // the schema is exactly the behaviour we removed.
    console.error(
      "\nNo migrations found in prisma/migrations.\n" +
        "Production deploys apply reviewed migrations; they do not push the\n" +
        "schema directly. Generate one locally with:\n\n" +
        "    npm run db:migrate -- --name initial_multi_tenant\n\n" +
        "commit it, and deploy again.\n",
    );
    process.exit(1);
  }

  // Applies only committed migrations. Fails loudly on drift rather than
  // reconciling by force.
  run("npx prisma migrate deploy");
} else {
  console.log("Local SQLite build — skipping database setup.");
}

run("npx next build");
