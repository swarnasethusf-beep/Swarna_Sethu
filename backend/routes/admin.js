const express = require("express");
const bcrypt = require("bcrypt");
const { hashKeyForLookup, generateLicenseKey, safeEqual } = require("../lib/security");
const { HttpError, bad, str, mobile10, isoDate, todayIST, docOut, serialize } = require("../lib/util");
const { validatePassword, SALT_ROUNDS } = require("./auth");

/**
 * 👑 Global admin (license issuer) — protected by ADMIN_USERNAME / ADMIN_PASSWORD_HASH.
 */
module.exports = function adminRoutes(deps) {
  const { db, security, config, rateLimit, mw, forgetLicense } = deps;
  const router = express.Router();
  const licenses = db.collection("licenses");

  router.post("/admin/login", async (req, res) => {
    await rateLimit(`admin-login:${req.ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
    if (!config.adminUsername || !config.adminPasswordHash)
      throw new HttpError(503, "Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in backend/.env.");
    const username = String(req.body.username || "");
    const password = String(req.body.password || "");
    const userOk = safeEqual(username, config.adminUsername);
    const passOk = await bcrypt.compare(password, config.adminPasswordHash); // always run: no timing hint
    if (!userOk || !passOk) throw new HttpError(401, "Invalid admin credentials.");
    res.send({ token: deps.issueAdminToken(username) });
  });

  router.use("/admin", (req, res, next) => (req.path === "/login" ? next() : mw.globalAdmin(req, res, next)));

  router.get("/admin/licenses", async (req, res) => {
    const snap = await licenses.get();
    const today = todayIST();
    const list = snap.docs.map((doc) => {
      const d = doc.data();
      return serialize({
        id: doc.id,
        key: d.keyEncrypted ? security.decryptKey(d.keyEncrypted) : d.key || null,
        name: d.name, business: d.business, mobile: d.mobile, email: d.email, location: d.location,
        expiry: d.expiry, active: d.active === true,
        status: d.active !== true ? "inactive" : d.expiry < today ? "expired" : "active",
        createdAt: d.createdAt, renewedAt: d.renewedAt || null
      });
    });
    list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.send(list);
  });

  router.post("/admin/licenses", async (req, res) => {
    const b = req.body;
    const name = str(b.name, { required: true, field: "Client name" });
    const business = str(b.business, { required: true, field: "Business name" });
    const mobile = mobile10(b.mobile, { required: true });
    const email = str(b.email, { max: 120 });
    const location = str(b.location, { max: 300 });
    const expiry = isoDate(b.expiry, { required: true, field: "Expiry date" });
    if (expiry < todayIST()) throw bad("Expiry date must be today or later.");
    const superAdminUsername = str(b.superAdminUsername, { required: true, field: "Super admin username", max: 60 });
    const superAdminPassword = validatePassword(b.superAdminPassword);

    // Generate a key that doesn't collide with an existing one
    let key;
    for (let i = 0; i < 5 && !key; i++) {
      const candidate = generateLicenseKey();
      const clash = await licenses.where("keyHash", "==", hashKeyForLookup(candidate)).limit(1).get();
      if (clash.empty) key = candidate;
    }
    if (!key) throw new HttpError(500, "Could not generate a unique license key. Try again.");

    const now = new Date();
    const licenseRef = await licenses.add({
      keyHash: hashKeyForLookup(key),
      keyEncrypted: security.encryptKey(key),
      name, business, mobile, email, location,
      active: true,
      expiry,
      shop: { name: business, address: location, phone: mobile, email, gstin: "", stateCode: "", invoicePrefix: "INV", terms: "" },
      createdAt: now
    });
    await licenseRef.collection("users").add({
      name,
      username: superAdminUsername,
      password: await bcrypt.hash(superAdminPassword, SALT_ROUNDS),
      mobile,
      role: "super_admin",
      permissions: { invoice: true, inventory: true, staff: true, reports: true },
      createdAt: now
    });
    res.send({ id: licenseRef.id, key }); // plain key returned once for display
  });

  router.post("/admin/licenses/:id/renew", async (req, res) => {
    const expiry = isoDate(req.body.expiry, { required: true, field: "New expiry date" });
    if (expiry < todayIST()) throw bad("New expiry date must be today or later.");
    const ref = licenses.doc(req.params.id);
    if (!(await ref.get()).exists) throw new HttpError(404, "License not found.");
    await ref.update({ expiry, active: true, renewedAt: new Date() });
    forgetLicense(req.params.id);
    res.send({ success: true });
  });

  router.post("/admin/licenses/:id/status", async (req, res) => {
    if (typeof req.body.active !== "boolean") throw bad("active must be true or false.");
    const ref = licenses.doc(req.params.id);
    if (!(await ref.get()).exists) throw new HttpError(404, "License not found.");
    await ref.update({ active: req.body.active });
    forgetLicense(req.params.id);
    res.send({ success: true });
  });

  // ── Super Admin mobile-change requests ──────────────────────────────────
  router.get("/admin/requests", async (req, res) => {
    const snap = await db.collection("mobileChangeRequests").where("scope", "==", "global").get();
    const list = snap.docs.map(docOut).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.send(list);
  });

  router.post("/admin/requests/:id/decision", async (req, res) => {
    const action = req.body.action;
    if (!["approved", "rejected"].includes(action)) throw bad("action must be 'approved' or 'rejected'.");
    const ref = db.collection("mobileChangeRequests").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().scope !== "global") throw new HttpError(404, "Request not found.");
    const r = doc.data();
    if (r.status !== "pending") throw bad(`Request was already ${r.status}.`);
    if (action === "approved") {
      const licenseRef = licenses.doc(r.licenseDocId);
      await licenseRef.collection("users").doc(r.requestedBy).update({ mobile: r.newMobile });
      await licenseRef.update({ mobile: r.newMobile });
    }
    await ref.update({ status: action, resolvedAt: new Date() });
    res.send({ success: true });
  });

  return router;
};
