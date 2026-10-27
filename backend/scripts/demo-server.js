/**
 * 🧪 Demo server — the real API running on an in-memory database with a sample
 * shop, so the apps can be tried without touching Firestore. Data is lost on exit.
 *
 *   npm run demo
 */
const bcrypt = require("bcrypt");
const { createApp } = require("../app");
const { createSecurity, hashKeyForLookup } = require("../lib/security");
const { todayIST } = require("../lib/util");
const { createFakeFirestore } = require("../test/fakeFirestore");

const DEMO_KEY = "SW-DEMO-2026-GOLD";
const PORT = Number(process.env.PORT) || 5000;

async function seed(db, security) {
  const lic = db.collection("licenses").doc("demo");
  const nextYear = `${Number(todayIST().slice(0, 4)) + 1}-12-31`;
  await lic.set({
    keyHash: hashKeyForLookup(DEMO_KEY),
    keyEncrypted: security.encryptKey(DEMO_KEY),
    name: "Lakshman Rao", business: "Sri Lakshmi Jewellers", mobile: "9876543210",
    email: "owner@example.com", location: "Abids, Hyderabad", active: true, expiry: nextYear,
    shop: {
      name: "Sri Lakshmi Jewellers", address: "12-3-45, Abids Road, Hyderabad 500001", phone: "9876543210",
      email: "owner@example.com", gstin: "36ABCDE1234F1Z5", stateCode: "36", invoicePrefix: "SLJ",
      terms: "Goods once sold can be exchanged within 7 days with the bill.\nSubject to Hyderabad jurisdiction."
    },
    displaySettings: { invoice: true, inventory: true, staff: true, dashboard: false },
    rates: { "24K": 7650, "22K": 7015, "18K": 5740, "14K": 4475, date: todayIST(), updatedAt: new Date(), updatedByName: "Lakshman Rao" },
    createdAt: new Date()
  });
  const market = { "24K": 7700, "22K": 7058, "18K": 5775, "14K": 4497, date: todayIST(), updatedAt: new Date(Date.now() - 60 * 60 * 1000), updatedByName: "Provider" };
  await db.collection("platform").doc("goldRate").set(market);
  await db.collection("goldRateHistory").doc(market.date).set(market);
  const hash = (pw) => bcrypt.hashSync(pw, 8);
  await lic.collection("users").doc("owner").set({
    name: "Lakshman Rao", username: "owner", password: hash("owner1234"), mobile: "9876543210",
    role: "super_admin", permissions: { invoice: true, inventory: true, staff: true, reports: true }, createdAt: new Date()
  });
  await lic.collection("users").doc("ravi").set({
    name: "Ravi Kumar", username: "ravi", password: hash("ravi12345"), mobile: "9123456780",
    role: "admin", permissions: { invoice: true, inventory: false, staff: false, reports: false }, createdAt: new Date()
  });
  const products = [
    ["NK-101", "Lakshmi haram necklace", 32.45, 1.2, 12, "per_gram", 450, 2500, "HU7K2P"],
    ["RG-205", "Gents ring with stone", 6.8, 0.6, 8, "per_gram", 380, 1200, "HU3M9Q"],
    ["BG-310", "Plain bangle pair", 24.0, 0, 6, "percent", 10, 0, "HU5T1R"],
    ["ER-412", "Jhumka earrings", 9.35, 0.4, 10, "fixed", 3200, 800, "HU8W4S"]
  ];
  for (const [itemCode, description, grossWt, stoneWt, wastagePct, makingType, makingValue, stoneCharges, huid] of products) {
    await lic.collection("products").add({
      itemCode, description, purity: "22K", hsn: "7113", huid, pcs: 1, grossWt, stoneWt,
      netWt: Math.round((grossWt - stoneWt) * 1000) / 1000, wastagePct, makingType, makingValue, stoneCharges,
      status: "in_stock", createdBy: "owner", createdByName: "Lakshman Rao", createdAt: new Date()
    });
  }
  await lic.collection("staff").add({
    fullName: "Venkatesh Achari", designation: "Goldsmith", department: "Workshop", mobileNo: "9000011111",
    gender: "Male", address: "Hyderabad", joiningDate: "2020-06-01", createdBy: "owner", createdByName: "Lakshman Rao", createdAt: new Date()
  });
}

(async () => {
  const fake = createFakeFirestore();
  const security = createSecurity({ encryptionSecret: "demo-encryption-secret-32-chars!", tokenSecret: "demo-token-secret-".repeat(3) });
  await seed(fake.db, security);
  const app = createApp({
    db: fake.db,
    deleteField: fake.deleteField,
    security,
    config: {
      corsOrigins: ["http://localhost:3000", "http://localhost:3001", "null"],
      adminUsername: "admin",
      adminPasswordHash: bcrypt.hashSync("admin-demo-123", 8)
    },
    sendSms: null, // OTPs print to this console
    fetchGold24k: null,
    // No Firebase Storage here: logos are kept as data URLs in memory so the feature can be tried
    imageStore: {
      save: async (path, buffer, contentType) => `data:${contentType};base64,${buffer.toString("base64")}`,
      remove: async () => {}
    }
  });
  app.listen(PORT, () => {
    console.log(`\n🧪 DEMO server (in-memory data) on http://localhost:${PORT}\n`);
    console.log(`  Shop app     license ${DEMO_KEY}   owner / owner1234   (or ravi / ravi12345 — billing only)`);
    console.log(`  Admin portal admin / admin-demo-123`);
    console.log(`  Stock codes  NK-101, RG-205, BG-310, ER-412\n`);
  });
})();
