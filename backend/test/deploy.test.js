const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const bcrypt = require("bcrypt");
const { createApp } = require("../app");
const { createSecurity } = require("../lib/security");
const { createRateLimiter } = require("../lib/util");
const { loadServiceAccount } = require("../lib/runtime");
const { createFakeFirestore } = require("./fakeFirestore");

const security = createSecurity({ encryptionSecret: "a".repeat(32), tokenSecret: "t".repeat(40) });
const config = (extra) => ({ corsOrigins: [], adminUsername: "admin", adminPasswordHash: bcrypt.hashSync("right-password-1", 4), ...extra });

async function serve(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const adminLogin = (base, password, ip) =>
  fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
    body: JSON.stringify({ username: "admin", password })
  });

test("Firestore-backed limiter blocks after the limit, is shared between instances, and resets after the window", async () => {
  const { db } = createFakeFirestore();
  const a = createRateLimiter(db);
  const b = createRateLimiter(db); // a different "serverless instance" sharing only the database
  const opts = { limit: 3, windowMs: 60_000 };
  await a("k", opts); await b("k", opts); await a("k", opts);
  await assert.rejects(() => b("k", opts), (err) => err.status === 429);
  await assert.doesNotReject(() => a("another-key", opts));

  const doc = [...db._store.entries()].find(([p]) => p.startsWith("rateLimits/"));
  assert.ok(doc[1].expiresAt instanceof Date, "expiresAt is stored so a Firestore TTL policy can clean up");

  for (const [p, d] of db._store) if (p.startsWith("rateLimits/")) db._store.set(p, { ...d, resetAt: Date.now() - 1 });
  await assert.doesNotReject(() => a("k", opts));
});

test("in-memory limiter still works without a database", async () => {
  const limit = createRateLimiter();
  await limit("k", { limit: 1, windowMs: 60_000 });
  await assert.rejects(() => limit("k", { limit: 1, windowMs: 60_000 }), (err) => err.status === 429);
});

test("behind a proxy, each visitor gets their own login-attempt bucket (trust proxy)", async () => {
  const { db, deleteField } = createFakeFirestore();
  const { server, base } = await serve(createApp({ db, deleteField, security, sendSms: null, fetchGold24k: null, config: config({ trustProxy: 1, rateLimitStore: "firestore" }) }));
  try {
    // one attacker (203.0.113.9) exhausts their 10 attempts…
    let last;
    for (let i = 0; i < 11; i++) last = await adminLogin(base, "wrong", "203.0.113.9");
    assert.equal(last.status, 429);
    // …but a different visitor is not locked out and can log in
    const ok = await adminLogin(base, "right-password-1", "198.51.100.7");
    assert.equal(ok.status, 200);
    // the attacker stays blocked even with the right password
    assert.equal((await adminLogin(base, "right-password-1", "203.0.113.9")).status, 429);
  } finally { server.close(); }
});

test("service account: accepts raw JSON or base64, fixes escaped newlines, explains what is missing", () => {
  const sa = { project_id: "p", client_email: "x@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n" };
  const fromJson = loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(sa) });
  assert.equal(fromJson.project_id, "p");
  assert.ok(fromJson.private_key.includes("\nABC\n"));
  const fromB64 = loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify(sa)).toString("base64") });
  assert.equal(fromB64.client_email, sa.client_email);
  assert.throws(() => loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: "not json" }), /not valid JSON/);
  assert.throws(() => loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT: "does-not-exist.json" }), /not found/);
});

test("Vercel entry (api/index.js): exports a request handler and fails safely when unconfigured", async () => {
  // Run in a clean child process with no secrets and no .env, as a fresh Vercel deployment with missing variables would
  const script = `
    const http = require("http");
    const handler = require(${JSON.stringify(path.join(__dirname, "..", "api", "index.js"))});
    const server = http.createServer(handler).listen(0, "127.0.0.1", async () => {
      const res = await fetch("http://127.0.0.1:" + server.address().port + "/anything");
      console.log(JSON.stringify({ type: typeof handler, status: res.status, body: await res.json() }));
      server.close();
    });`;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  const out = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", cwd: path.join(__dirname, "..", "..") });
  const result = JSON.parse(out.stdout.trim().split("\n").pop());
  assert.equal(result.type, "function");
  assert.equal(result.status, 503);
  assert.match(result.body.error, /not configured correctly/);
  assert.ok(!JSON.stringify(result.body).includes("ENCRYPTION_SECRET must"), "details stay in the logs, not in the response");
});

test("env values pasted with quotes still work (e.g. ADMIN_PASSWORD_HASH from a .env file)", () => {
  const { cleanEnvValue } = require("../lib/runtime");
  const hash = bcrypt.hashSync("pw-123456", 4);
  for (const pasted of [hash, `'${hash}'`, `"${hash}"`, `  '${hash}'  `])
    assert.ok(bcrypt.compareSync("pw-123456", cleanEnvValue(pasted)), pasted.slice(0, 8));
  assert.equal(cleanEnvValue(undefined), "");
  assert.equal(cleanEnvValue("'unbalanced"), "'unbalanced");
});
