const crypto = require("crypto");

/**
 * 🧰 Shared request helpers: errors, validation, serialization, rate limiting.
 */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const bad = (message, details) => new HttpError(400, message, details);

/** Trimmed string, max length enforced. `required` throws a 400 when empty. */
function str(value, { max = 200, required = false, field = "Field" } = {}) {
  const s = value == null ? "" : String(value).trim();
  if (required && !s) throw bad(`${field} is required.`);
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters).`);
  return s;
}

function number(value, { min = 0, max = 1e9, field = "Value" } = {}) {
  if (value === "" || value == null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${field} must be a number between ${min} and ${max}.`);
  return n;
}

function mobile10(value, { required = false, field = "Mobile number" } = {}) {
  const digits = String(value || "").replace(/\D/g, "").slice(-10);
  if (!digits && !required) return "";
  if (!/^[6-9]\d{9}$/.test(digits)) throw bad(`${field} must be a valid 10-digit Indian mobile number.`);
  return digits;
}

function isoDate(value, { field = "Date", required = false } = {}) {
  const s = String(value || "").trim();
  if (!s && !required) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${field} must be a valid date (YYYY-MM-DD).`);
  return s;
}

function maskMobile(m) {
  const s = String(m || "");
  return s.length <= 4 ? s : "•".repeat(s.length - 4) + s.slice(-4);
}

/** Today's date in India (YYYY-MM-DD), independent of the server's timezone */
function todayIST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** Convert Firestore Timestamps / Dates to ISO strings so responses are plain JSON */
function serialize(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

const docOut = (doc) => serialize({ id: doc.id, ...doc.data() });

/**
 * Fixed-window rate limiter.
 *  • No `db`: counters live in this process's memory (fine for one long-running server).
 *  • With `db`: counters live in Firestore (`rateLimits` collection), so the limit holds across
 *    serverless instances. Each doc carries `expiresAt` — enable a Firestore TTL policy on that
 *    field to have old counters deleted automatically.
 * Returns an async function that throws HttpError(429) once `limit` is exceeded.
 */
function createRateLimiter(db = null) {
  const hits = new Map();

  function blocked(resetAt, now) {
    const mins = Math.ceil((resetAt - now) / 60000);
    return new HttpError(429, `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }

  function memoryHit(key, { limit, windowMs }) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 10000) for (const [k, e] of hits) if (e.resetAt <= now) hits.delete(k);
    if (entry.count > limit) throw blocked(entry.resetAt, now);
  }

  async function firestoreHit(key, { limit, windowMs }) {
    const ref = db.collection("rateLimits").doc(crypto.createHash("sha256").update(key).digest("hex"));
    const now = Date.now();
    const state = await db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      const cur = doc.exists ? doc.data() : null;
      const fresh = !cur || cur.resetAt <= now;
      const next = { count: fresh ? 1 : cur.count + 1, resetAt: fresh ? now + windowMs : cur.resetAt };
      t.set(ref, { ...next, expiresAt: new Date(next.resetAt) });
      return next;
    });
    if (state.count > limit) throw blocked(state.resetAt, now);
  }

  return async (key, opts) => (db ? firestoreHit(key, opts) : memoryHit(key, opts));
}

module.exports = { HttpError, bad, str, number, mobile10, isoDate, maskMobile, todayIST, serialize, docOut, createRateLimiter };
