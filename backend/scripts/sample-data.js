/**
 * 🧪 Sample inventory, staff and bills for trying the app on a real license.
 *
 *   node scripts/sample-data.js add    <license key or license doc id>
 *   node scripts/sample-data.js remove <license key or license doc id>
 *
 * Everything is created through the real API (same validation, bill maths, invoice
 * numbering, stock marking) and recorded in licenses/{id}/meta/sampleData so that
 * `remove` deletes exactly what was added. Item codes start with "SMP-".
 * The shop's saved rates are not changed — bills use them (with defaults for any missing purity).
 */
require("dotenv").config({ quiet: true });
const path = require("path");
const admin = require("firebase-admin");
const { createApp } = require("../app");
const { createSecurity, hashKeyForLookup } = require("../lib/security");
const { computeInvoice } = require("../lib/billing");

const [, , command, target] = process.argv;
if (!["add", "remove"].includes(command) || !target) {
  console.error("Usage: node scripts/sample-data.js add|remove <license key or license doc id>");
  process.exit(1);
}

const security = createSecurity({ encryptionSecret: process.env.ENCRYPTION_SECRET, tokenSecret: process.env.TOKEN_SECRET });
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, "..", process.env.FIREBASE_SERVICE_ACCOUNT || "serviceAccountKey.json"))) });
const db = admin.firestore();

const DEFAULT_RATES = { "24K": 7650, "22K": 7015, "18K": 5740, "14K": 4475 };

const PRODUCTS = [
  // code, description, purity, gross, stone, VA%, making type, making value, stone ₹, HUID
  ["SMP-NK01", "Temple necklace with kemp stones", "22K", 38.62, 2.1, 12, "per_gram", 550, 4500, "SA1K7Q"],
  ["SMP-NK02", "Lightweight chain necklace", "22K", 15.4, 0, 8, "per_gram", 400, 0, "SA2M4R"],
  ["SMP-HR01", "Lakshmi kasu haram", "22K", 62.3, 3.4, 14, "per_gram", 600, 8500, "SA3P9T"],
  ["SMP-BG01", "Plain bangles (pair)", "22K", 24.0, 0, 6, "percent", 10, 0, "SA4C2W"],
  ["SMP-BG02", "Stone-studded bangle", "22K", 18.75, 1.25, 10, "per_gram", 500, 3200, "SA5D8X"],
  ["SMP-RG01", "Ladies ruby ring", "22K", 4.35, 0.3, 10, "fixed", 1800, 1500, "SA6F3Y"],
  ["SMP-RG02", "Gents signet ring", "22K", 7.8, 0, 8, "per_gram", 450, 0, "SA7G6Z"],
  ["SMP-ER01", "Jhumka earrings", "22K", 9.6, 0.5, 12, "fixed", 3500, 900, "SA8H1A"],
  ["SMP-ER02", "Diamond-look studs", "18K", 3.2, 0.4, 10, "fixed", 2200, 2800, "SA9J5B"],
  ["SMP-CH01", "Rope chain 20 inch", "22K", 20.0, 0, 7, "per_gram", 350, 0, "SB1K2C"],
  ["SMP-PD01", "Mango pendant", "22K", 6.45, 0.5, 12, "per_gram", 500, 1200, "SB2L7D"],
  ["SMP-BR01", "Kids bracelet", "22K", 5.1, 0, 8, "per_gram", 420, 0, "SB3M4E"]
];

const STAFF = [
  { fullName: "Venkatesh Achari", designation: "Senior Goldsmith", department: "Workshop", mobileNo: "9000011101", gender: "Male", address: "Hyderabad", joiningDate: "2019-04-01" },
  { fullName: "Padma Latha", designation: "Sales Executive", department: "Showroom", mobileNo: "9000011102", gender: "Female", address: "Hyderabad", joiningDate: "2022-07-15" }
];

async function findLicense(t) {
  const byId = await db.collection("licenses").doc(t).get();
  if (byId.exists) return byId;
  const snap = await db.collection("licenses").where("keyHash", "==", hashKeyForLookup(t)).limit(1).get();
  if (!snap.empty) return snap.docs[0];
  throw new Error(`License not found: ${t}`);
}

async function startApi() {
  const app = createApp({
    db, security, deleteField: () => admin.firestore.FieldValue.delete(),
    config: { corsOrigins: [], adminUsername: "", adminPasswordHash: "" },
    sendSms: null, fetchGold24k: null
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function add(licDoc) {
  const lic = licDoc.ref;
  const metaRef = lic.collection("meta").doc("sampleData");
  if ((await metaRef.get()).exists) throw new Error("Sample data is already present. Run `remove` first.");

  const owners = await lic.collection("users").where("role", "==", "super_admin").limit(1).get();
  if (owners.empty) throw new Error("This license has no Super Admin user.");
  const owner = owners.docs[0];
  const token = security.signToken({ typ: "shop", lic: licDoc.id, sub: owner.id, ver: owner.data().tokenVersion || 0 }, 3600);

  const { server, base } = await startApi();
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${data.error}${data.details ? " — " + JSON.stringify(data.details) : ""}`);
    return data;
  };

  const manifest = { createdAt: new Date(), products: [], staff: [], invoices: [], customers: [] };
  try {
    const shop = (await call("GET", "/settings")).shop;
    const saved = await call("GET", "/rates");
    const rates = Object.fromEntries(Object.keys(DEFAULT_RATES).map((k) => [k, Number(saved[k]) || DEFAULT_RATES[k]]));
    console.log("Rates used:", rates);

    // ── Inventory ──────────────────────────────────────────────────────────
    const products = {};
    for (const [itemCode, description, purity, grossWt, stoneWt, wastagePct, makingType, makingValue, stoneCharges, huid] of PRODUCTS) {
      const body = { itemCode, description, purity, grossWt, stoneWt, wastagePct, makingType, makingValue, stoneCharges, huid, hsn: "7113", pcs: 1 };
      const { id } = await call("POST", "/products", body);
      products[itemCode] = { id, ...body };
      manifest.products.push(id);
    }
    console.log(`✔ ${PRODUCTS.length} stock items (SMP-…)`);

    // ── Staff ──────────────────────────────────────────────────────────────
    const staffIds = [];
    for (const s of STAFF) {
      const { id } = await call("POST", "/staff", { ...s, communicationSms: true });
      staffIds.push(id); manifest.staff.push(id);
    }
    console.log(`✔ ${STAFF.length} staff`);

    // ── Bills ──────────────────────────────────────────────────────────────
    const stock = (code) => ({ productId: products[code].id, ...products[code] });
    // Work out the exact amount payable so "paid in full" bills balance to zero
    const payable = (bill) => computeInvoice({ ...bill, rates }, shop).summary.payable;
    const customersBefore = new Set((await lic.collection("customers").get()).docs.map((d) => d.id));

    const bills = [];
    {
      const b = { mode: "sale", customer: { name: "Lakshmi Prasanna", mobile: "9000000101", address: "Kukatpally, Hyderabad", pan: "BQRPP4521K" },
        items: [stock("SMP-NK02"), stock("SMP-ER01")], notes: "Festival purchase." };
      b.payments = [{ mode: "UPI", amount: payable(b), reference: "UTR 4102 7788 2201" }];
      bills.push(["Sale, paid by UPI", b]);
    }
    {
      const b = { mode: "sale", customer: { name: "Srinivas Rao", mobile: "9000000102", address: "Dilsukhnagar, Hyderabad", pan: "CKSPR7712M" },
        items: [stock("SMP-BG01")], oldGold: [{ description: "Old bangles (2)", grossWt: 14.2, lessWt: 0.2, touch: 91.6 }] };
      const total = payable(b);
      b.payments = [{ mode: "Cash", amount: 50000 }, { mode: "Card", amount: total - 50000, reference: "SBI ****7731" }];
      bills.push(["Sale with old gold exchange, cash + card", b]);
    }
    {
      const b = { mode: "sale", customer: { name: "Sri Balaji Jewels", mobile: "9000000103", address: "Commercial Street, Bengaluru", stateCode: "29", gstin: "29AABCU9603R1ZM", pan: "AABCU9603R" },
        items: [stock("SMP-RG02"), stock("SMP-CH01")], notes: "B2B order — inter-state supply." };
      b.payments = [{ mode: "Bank Transfer", amount: payable(b), reference: "NEFT HDFC0001234" }];
      bills.push(["Inter-state B2B sale (IGST)", b]);
    }
    {
      const b = { mode: "job_work", customer: { name: "Kavitha Reddy", mobile: "9000000104", address: "Kothapet, Hyderabad", pan: "DLRPK3390N" },
        items: [{ description: "Custom kasulaperu (made to order)", purity: "22K", grossWt: 45, wastagePct: 10, makingType: "per_gram", makingValue: 450 }],
        oldGold: [{ description: "Customer's old jewellery", grossWt: 42.5, lessWt: 0.5, touch: 91.6 }],
        payments: [{ mode: "Cash", amount: 20000 }], assignedStaffId: staffIds[0],
        notes: "Delivery in 10 days. Balance on delivery." };
      bills.push(["Job work from customer's gold, balance due", b]);
    }
    {
      const b = { mode: "sale", customer: { name: "Mahesh Kumar", mobile: "9000000105", address: "Secunderabad", pan: "EMKPK8841P" },
        items: [stock("SMP-RG01"), stock("SMP-PD01")],
        payments: [{ mode: "Advance", amount: 10000, reference: "Advance receipt #12" }], assignedStaffId: staffIds[1] };
      bills.push(["Sale with advance, balance due", b]);
    }
    {
      const b = { mode: "sale", customer: { name: "Ramesh Gupta", mobile: "9000000106", address: "Ameerpet, Hyderabad", pan: "FNGPG2207Q" },
        items: [stock("SMP-BG02")] };
      b.payments = [{ mode: "UPI", amount: payable(b) }];
      bills.push(["Sale that gets cancelled (item returns to stock)", b]);
    }

    for (const [label, b] of bills) {
      const inv = await call("POST", "/invoices", { ...b, rates });
      manifest.invoices.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, seq: inv.seq, fy: inv.fy });
      if (b.customer.mobile && !customersBefore.has(b.customer.mobile)) manifest.customers.push(b.customer.mobile);
      console.log(`✔ ${inv.invoiceNumber}  ${label}  — payable ₹${inv.summary.payable.toLocaleString("en-IN")}, balance ₹${inv.summary.balance.toLocaleString("en-IN")}`);
      if (label.includes("cancelled")) {
        await call("POST", `/invoices/${inv.id}/cancel`, { reason: "Sample: customer changed their mind" });
        console.log(`  ↳ cancelled ${inv.invoiceNumber}`);
      }
    }
  } finally {
    // Record whatever was created, even on failure, so `remove` can clean it up
    await metaRef.set(manifest);
    server.close();
  }
  console.log("\nDone. Remove later with: node scripts/sample-data.js remove", target);
}

async function remove(licDoc) {
  const lic = licDoc.ref;
  const metaRef = lic.collection("meta").doc("sampleData");
  const meta = await metaRef.get();
  if (!meta.exists) throw new Error("No sample data recorded for this license.");
  const m = meta.data();
  const batch = db.batch();
  m.invoices.forEach((i) => batch.delete(lic.collection("invoices").doc(i.id)));
  m.products.forEach((id) => batch.delete(lic.collection("products").doc(id)));
  m.staff.forEach((id) => batch.delete(lic.collection("staff").doc(id)));
  m.customers.forEach((mobile) => batch.delete(lic.collection("customers").doc(mobile)));
  batch.delete(metaRef);
  await batch.commit();

  // Rewind the invoice counter to the highest remaining real invoice, so real numbering continues without gaps
  for (const fy of [...new Set(m.invoices.map((i) => i.fy))]) {
    const remaining = await lic.collection("invoices").where("fy", "==", fy).get();
    const maxSeq = remaining.docs.reduce((mx, d) => Math.max(mx, d.data().seq || 0), 0);
    const counter = lic.collection("counters").doc(`invoice-${fy}`);
    if (maxSeq === 0) await counter.delete();
    else await counter.set({ seq: maxSeq, fy });
    console.log(`Invoice counter ${fy}: next number continues after #${maxSeq}`);
  }
  console.log(`✔ Removed ${m.invoices.length} bills, ${m.products.length} stock items, ${m.staff.length} staff, ${m.customers.length} customers.`);
}

(async () => {
  const licDoc = await findLicense(target);
  console.log(`License: ${licDoc.data().business} (${licDoc.id})\n`);
  await (command === "add" ? add(licDoc) : remove(licDoc));
  process.exit(0);
})().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
