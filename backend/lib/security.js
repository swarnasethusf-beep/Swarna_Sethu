const crypto = require("crypto");

/**
 * 🔐 Security helpers — license-key encryption, lookup hashes, signed session
 * tokens and cryptographically secure key / OTP generation.
 */
function createSecurity({ encryptionSecret, tokenSecret }) {
  if (!encryptionSecret || encryptionSecret.length !== 32)
    throw new Error("ENCRYPTION_SECRET must be exactly 32 characters.");
  if (!tokenSecret || tokenSecret.length < 32)
    throw new Error("TOKEN_SECRET must be at least 32 characters.");
  const encKey = Buffer.from(encryptionSecret);

  // AES-256-CBC — license keys are stored encrypted so the global admin can re-display them
  function encryptKey(plainText) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", encKey, iv);
    const enc = Buffer.concat([cipher.update(plainText), cipher.final()]);
    return iv.toString("hex") + ":" + enc.toString("hex");
  }

  function decryptKey(cipherText) {
    try {
      const [ivHex, encHex] = String(cipherText).split(":");
      const decipher = crypto.createDecipheriv("aes-256-cbc", encKey, Buffer.from(ivHex, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString();
    } catch {
      return null;
    }
  }

  // ── Signed session tokens (HMAC-SHA256, JWT-like) ───────────────────────
  const b64 = (buf) => Buffer.from(buf).toString("base64url");
  const sign = (data) => crypto.createHmac("sha256", tokenSecret).update(data).digest("base64url");

  function signToken(payload, ttlSeconds) {
    const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
    return `${body}.${sign(body)}`;
  }

  function verifyToken(token) {
    if (typeof token !== "string" || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    const expected = sign(body);
    if (!sig || sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      if (!payload.exp || payload.exp < Date.now() / 1000) return null;
      return payload;
    } catch {
      return null;
    }
  }

  return { encryptKey, decryptKey, signToken, verifyToken };
}

/** SHA-256 of a normalized license key — deterministic, used for Firestore lookup */
function hashKeyForLookup(plainText) {
  return crypto.createHash("sha256").update(normalizeLicenseKey(plainText)).digest("hex");
}

function normalizeLicenseKey(key) {
  return String(key || "").trim().toUpperCase();
}

// No 0/O/1/I to avoid misreading keys over the phone
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateLicenseKey() {
  const group = () => Array.from({ length: 4 }, () => KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]).join("");
  return `SW-${group()}-${group()}-${group()}`;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/** Constant-time string comparison */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { createSecurity, hashKeyForLookup, normalizeLicenseKey, generateLicenseKey, generateOtp, safeEqual };
