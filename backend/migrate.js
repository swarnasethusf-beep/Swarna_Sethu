/**
 * 🔄 Migration script — safe to run more than once.
 *
 *  • License keys: adds keyHash + keyEncrypted and REMOVES the plain-text `key` field
 *  • Passwords: bcrypt-hashes any remaining plain-text passwords
 *  • Products: upgrades old inventory records (weight / makingCharges) to the new
 *    piece format (grossWt / netWt / purity / makingType / status)
 *
 * Run with: node migrate.js            (dry run — shows what would change)
 *           node migrate.js --apply    (writes the changes)
 */
require("dotenv").config();
const path = require("path");
const admin = require("firebase-admin");
const bcrypt = require("bcrypt");
const { createSecurity, hashKeyForLookup } = require("./lib/security");

const APPLY = process.argv.includes("--apply");
const security = createSecurity({
  encryptionSecret: process.env.ENCRYPTION_SECRET,
  tokenSecret: process.env.TOKEN_SECRET || "x".repeat(32) // tokens aren't used here
});
const serviceAccount = require(path.resolve(__dirname, process.env.FIREBASE_SERVICE_ACCOUNT || "serviceAccountKey.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function write(ref, data, label) {
  console.log(`  ${APPLY ? "✏️ " : "🔍 would"} ${label}`);
  if (APPLY) await ref.update(data);
}

async function migrate() {
  console.log(APPLY ? "🚀 Applying migration...\n" : "🔍 Dry run (use --apply to write changes)\n");
  const counts = { keys: 0, passwords: 0, products: 0 };

  const licensesSnap = await db.collection("licenses").get();
  for (const licenseDoc of licensesSnap.docs) {
    const data = licenseDoc.data();
    console.log(`📋 License ${licenseDoc.id} (${data.business || "?"})`);

    if (data.key) {
      const update = { key: FieldValue.delete() };
      if (!data.keyHash) update.keyHash = hashKeyForLookup(data.key);
      if (!data.keyEncrypted) update.keyEncrypted = security.encryptKey(String(data.key).trim().toUpperCase());
      await write(licenseDoc.ref, update, "license key → hashed + encrypted, plain text removed");
      counts.keys++;
    }

    const users = await licenseDoc.ref.collection("users").get();
    for (const u of users.docs) {
      const pw = u.data().password;
      if (pw && !String(pw).startsWith("$2")) {
        await write(u.ref, { password: await bcrypt.hash(pw, 10) }, `user @${u.data().username} password → bcrypt`);
        counts.passwords++;
      }
    }

    const products = await licenseDoc.ref.collection("products").get();
    for (const p of products.docs) {
      const d = p.data();
      if (d.status && d.grossWt != null) continue;
      const wt = Number(d.grossWt ?? d.weight) || 0;
      await write(p.ref, {
        itemCode: String(d.itemCode || p.id).toUpperCase(),
        purity: d.purity || "22K",
        hsn: d.hsn || "7113",
        huid: d.huid || "",
        pcs: d.pcs || 1,
        grossWt: wt,
        stoneWt: Number(d.stoneWt) || 0,
        netWt: Number(d.netWt ?? wt) || 0,
        wastagePct: Number(d.wastagePct) || 0,
        makingType: d.makingType || "fixed",
        makingValue: Number(d.makingValue ?? d.makingCharges) || 0,
        stoneCharges: Number(d.stoneCharges) || 0,
        status: d.status || "in_stock"
      }, `product ${d.itemCode || p.id} → new piece format`);
      counts.products++;
    }
  }

  console.log("\n─────────────────────────────────────");
  console.log(`${APPLY ? "✅ Done" : "🔍 Dry run"} — keys: ${counts.keys} | passwords: ${counts.passwords} | products: ${counts.products}`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
