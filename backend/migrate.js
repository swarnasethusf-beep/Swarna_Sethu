/**
 * 🔄 Migration Script — One-time run
 * Hashes all plain-text passwords with bcrypt
 * Encrypts all plain-text license keys with AES-256
 *
 * Run with: node migrate.js
 */

require("dotenv").config();
const admin = require("firebase-admin");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const SALT_ROUNDS = 10;
const ENC_KEY = process.env.ENCRYPTION_SECRET; // must be exactly 32 chars

if (!ENC_KEY || ENC_KEY.length !== 32) {
  console.error("❌ ENCRYPTION_SECRET must be exactly 32 characters. Check your .env file.");
  process.exit(1);
}

// ── AES-256-CBC Encrypt ─────────────────────────────────────
function encryptKey(plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENC_KEY), iv);
  let encrypted = cipher.update(plainText);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

// ── SHA-256 Hash (for fast Firestore lookup) ─────────────────
function hashKeyForLookup(plainText) {
  return crypto.createHash("sha256").update(plainText).digest("hex");
}

// ── Check if already bcrypt hashed ───────────────────────────
function isAlreadyHashed(str) {
  return typeof str === "string" && str.startsWith("$2b$");
}

// ── Check if already AES encrypted ───────────────────────────
function isAlreadyEncrypted(str) {
  // AES output format: "hexIV:hexCipher"
  return typeof str === "string" && str.includes(":") && str.length > 50;
}

// ── Main Migration ────────────────────────────────────────────
async function migrate() {
  console.log("🚀 Starting migration...\n");
  let licenseMigrated = 0;
  let usersMigrated = 0;

  const licensesSnap = await db.collection("licenses").get();
  console.log(`📋 Found ${licensesSnap.size} license(s)\n`);

  for (const licenseDoc of licensesSnap.docs) {
    const data = licenseDoc.data();
    const licenseId = licenseDoc.id;
    const updates = {};

    // ── Migrate License Key ──────────────────────────────────
    if (data.key && !isAlreadyEncrypted(data.key)) {
      updates.keyEncrypted = encryptKey(data.key);
      updates.keyHash      = hashKeyForLookup(data.key);
      // Keep original key field so admin display still works for now
      console.log(`  🔑 License [${licenseId}] key "${data.key}" → encrypted + hashed`);
      licenseMigrated++;
    } else if (data.key) {
      console.log(`  ⏭️  License [${licenseId}] key already encrypted — skipped`);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection("licenses").doc(licenseId).update(updates);
    }

    // ── Migrate Users Under This License ────────────────────
    const usersSnap = await db
      .collection("licenses").doc(licenseId)
      .collection("users").get();

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();

      if (userData.password && !isAlreadyHashed(userData.password)) {
        const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
        await db
          .collection("licenses").doc(licenseId)
          .collection("users").doc(userDoc.id)
          .update({ password: hashedPassword });

        console.log(`  👤 User @${userData.username} password → bcrypt hashed`);
        usersMigrated++;
      } else if (userData.password) {
        console.log(`  ⏭️  User @${userData.username} already hashed — skipped`);
      }
    }

    console.log("");
  }

  console.log("─────────────────────────────────────");
  console.log(`✅ Done! Licenses encrypted: ${licenseMigrated} | Users hashed: ${usersMigrated}`);
  console.log("─────────────────────────────────────");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
