/**
 * Every HTTP method exported by every API route, with the auth mode and rate
 * limit buckets it declares. Anything without a bucket is unmetered.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/user/Orbital/src/app/api";

function routeFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(full, out);
    else if (e.name === "route.ts") out.push(full);
  }
  return out;
}

/** Grab the balanced options object that follows `route(`. */
function optionsAfter(src, index) {
  const open = src.indexOf("{", index);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

const rows = [];
for (const file of routeFiles(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  const name = file.replace(`${ROOT}/`, "").replace("/route.ts", "");
  const re = /export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*(route\s*\(|)/g;
  let m;
  while ((m = re.exec(src))) {
    const method = m[1];
    const wrapped = Boolean(m[2]);
    if (!wrapped) {
      rows.push({ name, method, auth: "—", limits: "NOT WRAPPED", raw: true });
      continue;
    }
    const opts = optionsAfter(src, m.index + m[0].length - 1);
    const auth = (opts.match(/auth:\s*"([a-z]+)"/) ?? [])[1] ?? "—";
    const limits = (opts.match(/limits:\s*\[([^\]]*)\]/) ?? [])[1];
    rows.push({
      name,
      method,
      auth,
      limits: limits ? limits.replace(/["\s]/g, "") : "NONE",
    });
  }
}

rows.sort((a, b) => a.name.localeCompare(b.name) || a.method.localeCompare(b.method));
console.log(`${"ROUTE".padEnd(32)} ${"METHOD".padEnd(7)} ${"AUTH".padEnd(11)} LIMITS`);
console.log("-".repeat(86));
for (const r of rows) {
  const flag = r.limits === "NONE" || r.limits === "NOT WRAPPED" ? "  <<<" : "";
  console.log(`${r.name.padEnd(32)} ${r.method.padEnd(7)} ${r.auth.padEnd(11)} ${r.limits}${flag}`);
}
const unmetered = rows.filter((r) => r.limits === "NONE" || r.limits === "NOT WRAPPED");
console.log(`\n${rows.length} handlers, ${unmetered.length} without a rate limit`);
