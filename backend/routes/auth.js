const express = require("express");
const bcrypt = require("bcrypt");
const { hashKeyForLookup, normalizeLicenseKey, generateOtp, safeEqual } = require("../lib/security");
const { HttpError, bad, str, mobile10, maskMobile, serialize } = require("../lib/util");

const SALT_ROUNDS = 10;
const MIN_PASSWORD = 8;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MIN = 60 * 1000;

/** Shop profile used on invoices — falls back to the details captured when the license was issued */
function shopProfile(lic) {
  return {
    name: lic.business || "",
    address: lic.location || "",
    phone: lic.mobile || "",
    email: lic.email || "",
    gstin: "",
    stateCode: "",
    invoicePrefix: "INV",
    terms: "",
    ...(lic.shop || {})
  };
}

function sessionPayload(ctx, lic) {
  return {
    user: {
      id: ctx.userId,
      name: ctx.name,
      username: ctx.username,
      role: ctx.role,
      permissions: ctx.permissions
    },
    license: { id: ctx.licenseDocId, business: lic.business || "", expiry: lic.expiry },
    shop: shopProfile(lic),
    displaySettings: { invoice: false, dashboard: false, inventory: false, staff: false, ...(lic.displaySettings || {}) }
  };
}

function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw bad(`Password must be at least ${MIN_PASSWORD} characters.`);
  if (pw.length > 128) throw bad("Password is too long.");
  return pw;
}

module.exports = function authRoutes(deps) {
  const { db, security, rateLimit, deleteField, mw, checkLicense, forgetUser } = deps;
  const router = express.Router();
  const licenses = db.collection("licenses");

  /** Find a license by key. Old plain-text records are upgraded to hash + encryption on first use. */
  async function findLicense(rawKey) {
    const key = normalizeLicenseKey(rawKey);
    if (!key) return null;
    const snap = await licenses.where("keyHash", "==", hashKeyForLookup(key)).limit(1).get();
    if (!snap.empty) return snap.docs[0];

    const legacy = await licenses.where("key", "==", key).limit(1).get();
    if (legacy.empty) return null;
    const doc = legacy.docs[0];
    await doc.ref.update({ keyHash: hashKeyForLookup(key), keyEncrypted: security.encryptKey(key), key: deleteField() });
    return doc.ref.get();
  }

  async function findUser(licenseDoc, username) {
    const snap = await licenseDoc.ref.collection("users").where("username", "==", username).limit(1).get();
    return snap.empty ? null : snap.docs[0];
  }

  async function findAccount(body) {
    const licenseKey = str(body.licenseKey, { required: true, field: "License key", max: 40 });
    const username = str(body.username, { required: true, field: "Username", max: 60 });
    const licDoc = await findLicense(licenseKey);
    const userDoc = licDoc && (await findUser(licDoc, username));
    if (!userDoc) throw new HttpError(404, "License key or username not found.");
    return { licDoc, userDoc };
  }

  async function checkPassword(userDoc, password) {
    const stored = userDoc.data().password || "";
    if (stored.startsWith("$2")) return bcrypt.compare(password, stored);
    // Legacy plain-text password: compare, then upgrade to bcrypt
    if (!stored || !safeEqual(stored, password)) return false;
    await userDoc.ref.update({ password: await bcrypt.hash(password, SALT_ROUNDS) });
    return true;
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  router.post("/auth/login", async (req, res) => {
    const licenseKey = str(req.body.licenseKey, { required: true, field: "License key", max: 40 });
    const username = str(req.body.username, { required: true, field: "Username", max: 60 });
    const password = String(req.body.password || "");
    if (!password) throw bad("Password is required.");
    await rateLimit(`login-ip:${req.ip}`, { limit: 30, windowMs: 15 * MIN });
    await rateLimit(`login:${normalizeLicenseKey(licenseKey)}:${username}`, { limit: 8, windowMs: 15 * MIN });

    const invalid = new HttpError(401, "Invalid license key, username or password.");
    const licDoc = await findLicense(licenseKey);
    if (!licDoc) throw invalid;
    const userDoc = await findUser(licDoc, username);
    if (!userDoc || !(await checkPassword(userDoc, password))) throw invalid;

    const lic = licDoc.data();
    const licenseError = checkLicense(lic);
    if (licenseError) throw new HttpError(403, licenseError);

    const user = userDoc.data();
    const token = deps.issueShopToken(licDoc.id, userDoc.id, user.tokenVersion || 0);
    const ctx = {
      licenseDocId: licDoc.id, userId: userDoc.id, name: user.name, username: user.username, role: user.role,
      permissions: user.role === "super_admin"
        ? { invoice: true, inventory: true, staff: true, reports: true }
        : { invoice: false, inventory: false, staff: false, reports: false, ...(user.permissions || {}) }
    };
    res.send({ token, ...sessionPayload(ctx, lic) });
  });

  router.get("/auth/me", mw.auth, async (req, res) => {
    const lic = (await req.ctx.licenseRef.get()).data();
    res.send(serialize(sessionPayload(req.ctx, lic)));
  });

  router.post("/auth/change-password", mw.auth, async (req, res) => {
    const newPassword = validatePassword(req.body.newPassword);
    const userRef = req.ctx.licenseRef.collection("users").doc(req.ctx.userId);
    const userDoc = await userRef.get();
    await rateLimit(`chpw:${req.ctx.userId}`, { limit: 5, windowMs: 15 * MIN });
    if (!(await checkPassword(userDoc, String(req.body.currentPassword || ""))))
      throw bad("Current password is incorrect."); // 400, not 401: the session itself is still valid
    const tokenVersion = (userDoc.data().tokenVersion || 0) + 1;
    await userRef.update({ password: await bcrypt.hash(newPassword, SALT_ROUNDS), tokenVersion });
    forgetUser(req.ctx.licenseDocId, req.ctx.userId);
    res.send({ success: true, token: deps.issueShopToken(req.ctx.licenseDocId, req.ctx.userId, tokenVersion) });
  });

  // ── Forgot password (OTP) ─────────────────────────────────────────────────
  // 1. Look up the account and show the masked mobile (never the full number)
  router.post("/auth/forgot/start", async (req, res) => {
    await rateLimit(`forgot-ip:${req.ip}`, { limit: 20, windowMs: 15 * MIN });
    const { licDoc, userDoc } = await findAccount(req.body);
    const user = userDoc.data();
    const mobile = user.mobile || (user.role === "super_admin" ? licDoc.data().mobile : "");
    res.send({ hasMobile: !!mobile, maskedMobile: mobile ? maskMobile(mobile) : "", role: user.role });
  });

  // 2. Send OTP to the registered mobile
  router.post("/auth/forgot/send-otp", async (req, res) => {
    await rateLimit(`forgot-ip:${req.ip}`, { limit: 20, windowMs: 15 * MIN });
    const { licDoc, userDoc } = await findAccount(req.body);
    await rateLimit(`otp:${userDoc.id}`, { limit: 3, windowMs: 15 * MIN });
    const user = userDoc.data();
    const mobile = user.mobile || (user.role === "super_admin" ? licDoc.data().mobile : "");
    if (!mobile) throw bad("No mobile number is registered for this account.");
    const phone = mobile10(mobile, { required: true });

    const otp = generateOtp();
    const sessionRef = await db.collection("otpSessions").add({
      licenseDocId: licDoc.id,
      userId: userDoc.id,
      otpHash: await bcrypt.hash(otp, SALT_ROUNDS),
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      verified: false,
      createdAt: new Date()
    });

    const message = `Your OTP for Swarna Sethu is ${otp}. Valid for 10 minutes. Do not share it with anyone.`;
    if (deps.sendSms) {
      await deps.sendSms(phone, message);
    } else {
      // Dev mode only (no SMS provider configured) — never runs when FAST2SMS_API_KEY is set
      console.log(`\n📱 [DEV MODE — no SMS provider] OTP for ${maskMobile(phone)}: ${otp}\n`);
    }
    res.send({ sessionId: sessionRef.id, maskedMobile: maskMobile(phone), devMode: !deps.sendSms });
  });

  // 3. Verify OTP (max 5 attempts per session)
  router.post("/auth/forgot/verify-otp", async (req, res) => {
    const sessionId = str(req.body.sessionId, { required: true, field: "Session", max: 64 });
    const otp = str(req.body.otp, { required: true, field: "OTP", max: 6 });
    const ref = db.collection("otpSessions").doc(sessionId);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpError(400, "OTP session not found. Please request a new OTP.");
    const s = doc.data();
    if (s.verified) throw bad("OTP already used.");
    if (Date.now() > s.expiresAt) throw bad("OTP expired. Please request a new one.");
    if (s.attempts >= MAX_OTP_ATTEMPTS) throw bad("Too many wrong attempts. Please request a new OTP.");

    if (!(await bcrypt.compare(otp, s.otpHash))) {
      await ref.update({ attempts: s.attempts + 1 });
      const left = MAX_OTP_ATTEMPTS - s.attempts - 1;
      throw new HttpError(401, left > 0 ? `Incorrect OTP. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Please request a new OTP.");
    }
    await ref.update({ verified: true, resetExpiresAt: Date.now() + RESET_TTL_MS });
    res.send({ success: true });
  });

  // 4. Set new credentials (only with a verified OTP session)
  router.post("/auth/forgot/reset", async (req, res) => {
    const sessionId = str(req.body.sessionId, { required: true, field: "Session", max: 64 });
    const newPassword = validatePassword(req.body.newPassword);
    const newUsername = str(req.body.newUsername, { max: 60 });

    const sessionRef = db.collection("otpSessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();
    const s = sessionDoc.exists ? sessionDoc.data() : null;
    if (!s || !s.verified || Date.now() > s.resetExpiresAt)
      throw new HttpError(401, "OTP verification required. Please start again.");

    const licenseRef = licenses.doc(s.licenseDocId);
    const userRef = licenseRef.collection("users").doc(s.userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new HttpError(404, "User not found.");
    const user = userDoc.data();

    const update = {
      password: await bcrypt.hash(newPassword, SALT_ROUNDS),
      tokenVersion: (user.tokenVersion || 0) + 1 // log out existing sessions
    };
    if (newUsername && newUsername !== user.username) {
      const taken = await licenseRef.collection("users").where("username", "==", newUsername).limit(1).get();
      if (!taken.empty) throw bad("Username already taken.");
      update.username = newUsername;
    }
    await userRef.update(update);
    await sessionRef.delete();
    forgetUser(s.licenseDocId, s.userId);
    res.send({ success: true, username: update.username || user.username });
  });

  // ── Mobile change requests (when the user lost access to their number) ───
  router.post("/auth/forgot/request-mobile-change", async (req, res) => {
    await rateLimit(`mobreq-ip:${req.ip}`, { limit: 5, windowMs: 60 * MIN });
    const { licDoc, userDoc } = await findAccount(req.body);
    const newMobile = mobile10(req.body.newMobile, { required: true, field: "New mobile number" });
    const user = userDoc.data();
    const ref = await db.collection("mobileChangeRequests").add({
      // Admin requests are approved by the shop's Super Admin; Super Admin requests by the global admin
      scope: user.role === "super_admin" ? "global" : "license",
      licenseDocId: licDoc.id,
      shopName: licDoc.data().business || "",
      requestedBy: userDoc.id,
      requestedByName: user.name || user.username,
      requestedByUsername: user.username,
      role: user.role,
      newMobile,
      status: "pending",
      createdAt: new Date()
    });
    res.send({ requestId: ref.id });
  });

  router.get("/auth/forgot/request-status/:id", async (req, res) => {
    const doc = await db.collection("mobileChangeRequests").doc(String(req.params.id)).get();
    if (!doc.exists) throw new HttpError(404, "Request not found.");
    res.send({ status: doc.data().status });
  });

  return router;
};

module.exports.shopProfile = shopProfile;
module.exports.validatePassword = validatePassword;
module.exports.SALT_ROUNDS = SALT_ROUNDS;
