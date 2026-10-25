/**
 * 🏗️ Builds the production Express app from environment variables.
 * Shared by server.js (long-running server) and api/index.js (Vercel serverless function).
 * Throws an Error with a readable message when the configuration is incomplete.
 */
const path = require("path");
const admin = require("firebase-admin");
const axios = require("axios");
const { createApp } = require("../app");
const { createSecurity } = require("./security");
const { HttpError } = require("./util");

const BACKEND_DIR = path.resolve(__dirname, "..");

/**
 * Firebase credentials, in order of preference:
 *  1. FIREBASE_SERVICE_ACCOUNT_JSON — the JSON itself, or its base64 (use this on Vercel)
 *  2. FIREBASE_SERVICE_ACCOUNT      — path to the JSON file (default serviceAccountKey.json)
 */
function loadServiceAccount(env) {
  const raw = (env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (raw) {
    try {
      const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      const account = JSON.parse(text);
      if (typeof account.private_key === "string") account.private_key = account.private_key.replace(/\\n/g, "\n");
      return account;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON (paste the JSON file's contents, or its base64).");
    }
  }
  const keyPath = path.resolve(BACKEND_DIR, env.FIREBASE_SERVICE_ACCOUNT || "serviceAccountKey.json");
  try {
    return require(keyPath);
  } catch {
    throw new Error(`Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT_JSON, or put the key file at ${keyPath}.`);
  }
}

function createRuntime(env = process.env) {
  const security = createSecurity({ encryptionSecret: env.ENCRYPTION_SECRET, tokenSecret: env.TOKEN_SECRET });

  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount(env)) });
  const db = admin.firestore();

  // SMS (Fast2SMS). Without a key the server runs in dev mode and prints OTPs to the console.
  const smsKey = env.FAST2SMS_API_KEY;
  const sendSms = smsKey
    ? async (phone, message) => {
        try {
          const res = await axios.get("https://www.fast2sms.com/dev/bulkV2", {
            params: { authorization: smsKey, route: "q", message, flash: 0, numbers: phone },
            headers: { "cache-control": "no-cache" },
            timeout: 15000
          });
          if (!res.data?.return) throw new Error(JSON.stringify(res.data?.message || res.data));
        } catch (err) {
          console.error("❌ Fast2SMS error:", err.response ? JSON.stringify(err.response.data) : err.message);
          throw new HttpError(502, "Could not send the OTP SMS right now. Please try again later.");
        }
      }
    : null;
  if (!sendSms) console.warn("⚠️  FAST2SMS_API_KEY not set — OTPs will be printed to the server log (dev mode).");

  // Live gold price (GoldAPI). Optional.
  const goldKey = env.GOLDAPI_KEY;
  const fetchGold24k = goldKey
    ? async () => {
        const res = await axios.get("https://www.goldapi.io/api/XAU/INR", { headers: { "x-access-token": goldKey }, timeout: 10000 });
        const perGram = res.data.price_gram_24k || res.data.price / 31.1035;
        if (!Number.isFinite(perGram) || perGram <= 0) throw new Error("Unexpected GoldAPI response");
        return perGram;
      }
    : null;

  const config = {
    corsOrigins: (env.CORS_ORIGINS || "http://localhost:3000,http://localhost:3001,null")
      .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
    adminUsername: env.ADMIN_USERNAME || "",
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || "",
    // Vercel: requests come through a proxy and instances don't share memory
    trustProxy: env.VERCEL ? 1 : false,
    rateLimitStore: env.VERCEL ? "firestore" : "memory"
  };
  if (!config.adminUsername || !config.adminPasswordHash)
    console.warn("⚠️  ADMIN_USERNAME / ADMIN_PASSWORD_HASH not set — the license admin portal login is disabled.");

  const app = createApp({ db, security, config, sendSms, fetchGold24k, deleteField: () => admin.firestore.FieldValue.delete() });
  return { app, config };
}

module.exports = { createRuntime, loadServiceAccount };
