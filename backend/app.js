const express = require("express");
const cors = require("cors");
const { HttpError, todayIST, createRateLimiter } = require("./lib/util");
const { permissionsFor } = require("./lib/perms");

const SHOP_TOKEN_TTL = 12 * 60 * 60;  // 12 h
const ADMIN_TOKEN_TTL = 8 * 60 * 60;  // 8 h
const CONTEXT_CACHE_MS = 30 * 1000;

/**
 * Build the Express app. Everything external (Firestore, SMS, gold price API)
 * is injected so the app can run against an in-memory database in tests.
 *
 * deps = {
 *   db, security, deleteField,
 *   config: { corsOrigins[], adminUsername, adminPasswordHash },
 *   sendSms(phone, message) → Promise,  (null → dev mode: OTP printed to console)
 *   fetchGold24k() → Promise<number ₹/g> (null → live rates unavailable)
 *   imageStore: { save(path, buffer, contentType) → Promise<url>, remove(path) } (null → logo upload off)
 * }
 */
function createApp(deps) {
  const { db, security, config } = deps;
  const app = express();
  // On serverless, counters must live in Firestore: instances come and go and don't share memory
  const rateLimit = createRateLimiter(config.rateLimitStore === "firestore" ? db : null);

  app.disable("x-powered-by");
  // Behind a proxy (Vercel) req.ip is the proxy's address unless told to trust X-Forwarded-For;
  // without this every visitor would share one login-attempt bucket.
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(cors({
    origin(origin, cb) {
      // No Origin header = non-browser client (curl, Electron main). "null" = Electron file:// page.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new HttpError(403, `Origin ${origin} is not allowed`));
    }
  }));
  app.use(express.json({ limit: "1mb" }));

  // ── Session context (cached briefly; re-validated against Firestore) ────
  const contextCache = new Map();
  const forgetUser = (lic, uid) => contextCache.delete(`${lic}/${uid}`);
  const forgetLicense = (lic) => { for (const k of contextCache.keys()) if (k.startsWith(`${lic}/`)) contextCache.delete(k); };

  async function loadContext(payload) {
    const cacheKey = `${payload.lic}/${payload.sub}`;
    const hit = contextCache.get(cacheKey);
    let ctx;
    if (hit && hit.expires > Date.now()) {
      ctx = hit.ctx;
    } else {
      const licenseRef = db.collection("licenses").doc(payload.lic);
      const [licDoc, userDoc] = await Promise.all([
        licenseRef.get(),
        licenseRef.collection("users").doc(payload.sub).get()
      ]);
      if (!licDoc.exists || !userDoc.exists) throw new HttpError(401, "Session is no longer valid. Please log in again.");
      const lic = licDoc.data();
      const user = userDoc.data();
      ctx = {
        licenseDocId: licDoc.id,
        licenseRef,
        license: lic,
        userId: userDoc.id,
        role: user.role,
        name: user.name,
        username: user.username,
        permissions: permissionsFor(user.role, user.permissions),
        staffId: user.staffId || "",
        tokenVersion: user.tokenVersion || 0
      };
      contextCache.set(cacheKey, { ctx, expires: Date.now() + CONTEXT_CACHE_MS });
    }
    if ((payload.ver || 0) !== ctx.tokenVersion) throw new HttpError(401, "Session expired. Please log in again.");
    const licenseError = checkLicense(ctx.license);
    if (licenseError) throw new HttpError(403, licenseError);
    return ctx;
  }

  function bearer(req) {
    const h = req.headers.authorization || "";
    return h.startsWith("Bearer ") ? h.slice(7) : null;
  }

  // ── Middleware ──────────────────────────────────────────────────────────
  const auth = async (req, res, next) => {
    const payload = security.verifyToken(bearer(req));
    if (!payload || payload.typ !== "shop") throw new HttpError(401, "Please log in.");
    req.ctx = await loadContext(payload);
    next();
  };
  const can = (ctx, perm) => ctx.role === "super_admin" || !!ctx.permissions[perm];
  const perm = (...perms) => (req, res, next) => {
    if (!perms.some((p) => can(req.ctx, p))) throw new HttpError(403, "You don't have access to this module.");
    next();
  };
  // Shop staff (owner / admins) only — goldsmith logins are kept out of rates, dashboard, settings…
  const office = (req, res, next) => {
    if (!["super_admin", "admin"].includes(req.ctx.role)) throw new HttpError(403, "You don't have access to this.");
    next();
  };
  const superAdmin = (req, res, next) => {
    if (req.ctx.role !== "super_admin") throw new HttpError(403, "Only the shop owner (Super Admin) can do this.");
    next();
  };
  const globalAdmin = (req, res, next) => {
    const payload = security.verifyToken(bearer(req));
    if (!payload || payload.typ !== "admin") throw new HttpError(401, "Admin login required.");
    next();
  };

  const shared = {
    ...deps,
    rateLimit,
    mw: { auth, perm, office, superAdmin, globalAdmin },
    can,
    forgetUser,
    forgetLicense,
    checkLicense,
    issueShopToken: (lic, uid, ver) => security.signToken({ typ: "shop", lic, sub: uid, ver: ver || 0 }, SHOP_TOKEN_TTL),
    issueAdminToken: (username) => security.signToken({ typ: "admin", sub: username }, ADMIN_TOKEN_TTL)
  };

  app.get("/health", (req, res) => res.send({ ok: true }));
  app.use(require("./routes/auth")(shared));
  app.use(require("./routes/admin")(shared));
  app.use(require("./routes/shop")(shared));
  app.use(require("./routes/inventory")(shared));
  app.use(require("./routes/staff")(shared));
  app.use(require("./routes/invoices")(shared));
  app.use(require("./routes/jobwork")(shared));
  app.use(require("./routes/work")(shared));
  app.use(require("./routes/notifications")(shared));

  app.use((req, res) => res.status(404).send({ error: "Not found" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).send({ error: err.message, details: err.details });
    if (err.type === "entity.parse.failed") return res.status(400).send({ error: "Invalid JSON body" });
    console.error("Unhandled error:", err);
    res.status(500).send({ error: "Internal server error" });
  });

  return app;
}

/** Returns an error message if the license can't be used, else null */
function checkLicense(lic) {
  if (lic.active !== true) return "This license is inactive. Contact your provider.";
  if (!lic.expiry || lic.expiry < todayIST()) return "This license has expired. Contact your provider to renew.";
  return null;
}

module.exports = { createApp, checkLicense };
