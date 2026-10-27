const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { createApp } = require("../app");
const { createSecurity } = require("../lib/security");
const { financialYear } = require("../lib/billing");
const { todayIST } = require("../lib/util");
const { createFakeFirestore } = require("./fakeFirestore");

const sentSms = [];
const savedImages = new Map();
let server, base, db;

test.before(async () => {
  const fake = createFakeFirestore();
  db = fake.db;
  const app = createApp({
    db,
    deleteField: fake.deleteField,
    security: createSecurity({ encryptionSecret: "a".repeat(32), tokenSecret: "t".repeat(40) }),
    config: {
      corsOrigins: ["http://localhost:3000"],
      adminUsername: "admin",
      adminPasswordHash: bcrypt.hashSync("admin-pass-123", 4)
    },
    sendSms: async (phone, message) => sentSms.push({ phone, otp: message.match(/\d{6}/)[0] }),
    fetchGold24k: null,
    imageStore: {
      save: async (path, buffer) => { savedImages.set(path, buffer); return `https://images.test/${path}`; },
      remove: async (path) => { savedImages.delete(path); }
    }
  });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const nextYear = `${Number(todayIST().slice(0, 4)) + 1}-12-31`;
const fyShort = financialYear(todayIST()).slice(2);
const state = {};

test("global admin: login is enforced on the server", async () => {
  assert.equal((await call("GET", "/admin/licenses")).status, 401);
  assert.equal((await call("POST", "/admin/login", { body: { username: "admin", password: "admin123" } })).status, 401);
  const ok = await call("POST", "/admin/login", { body: { username: "admin", password: "admin-pass-123" } });
  assert.equal(ok.status, 200);
  state.adminToken = ok.body.token;
});

test("global admin: issue a license — key stored hashed + encrypted, never in plain text", async () => {
  const weak = await call("POST", "/admin/licenses", { token: state.adminToken, body: {
    name: "Lakshman", business: "Sri Gold", mobile: "9876543210", expiry: nextYear,
    superAdminUsername: "owner", superAdminPassword: "short"
  } });
  assert.equal(weak.status, 400);

  const res = await call("POST", "/admin/licenses", { token: state.adminToken, body: {
    name: "Lakshman", business: "Sri Gold", mobile: "9876543210", location: "Hyderabad", expiry: nextYear,
    superAdminUsername: "owner", superAdminPassword: "owner-pass-1"
  } });
  assert.equal(res.status, 200);
  assert.match(res.body.key, /^SW-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  state.key = res.body.key;
  state.licenseId = res.body.id;

  const stored = db._store.get(`licenses/${state.licenseId}`);
  assert.equal(stored.key, undefined);
  assert.ok(stored.keyHash && stored.keyEncrypted);
  assert.ok(!JSON.stringify(stored).includes(state.key));

  const list = await call("GET", "/admin/licenses", { token: state.adminToken });
  assert.equal(list.body[0].key, state.key);
  assert.equal(list.body[0].status, "active");
});

test("shop login: wrong password rejected, right one returns a token and shop profile", async () => {
  assert.equal((await call("POST", "/auth/login", { body: { licenseKey: state.key, username: "owner", password: "nope-nope" } })).status, 401);
  const res = await call("POST", "/auth/login", { body: { licenseKey: state.key.toLowerCase(), username: "owner", password: "owner-pass-1" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, "super_admin");
  assert.equal(res.body.shop.name, "Sri Gold");
  state.owner = res.body.token;
});

test("API rejects unauthenticated and forged requests", async () => {
  assert.equal((await call("GET", `/products?licenseDocId=${state.licenseId}&role=super_admin`)).status, 401);
  assert.equal((await call("GET", "/invoices", { token: "abc.def" })).status, 401);
  const [body] = state.owner.split(".");
  assert.equal((await call("GET", "/invoices", { token: `${body}.forgedsignature` })).status, 401);
  assert.equal((await call("GET", "/admin/licenses", { token: state.owner })).status, 401); // shop token ≠ admin token
});

test("settings: shop profile with GSTIN validation", async () => {
  const bad = await call("PUT", "/settings", { token: state.owner, body: { shop: { name: "Sri Gold", gstin: "22AAAAA0000A1Z5", stateCode: "36" } } });
  assert.equal(bad.status, 400); // GSTIN state 22 ≠ Telangana 36
  const ok = await call("PUT", "/settings", { token: state.owner, body: {
    shop: { name: "Sri Gold Jewellers", address: "Abids, Hyderabad", gstin: "36ABCDE1234F1Z5", stateCode: "36", invoicePrefix: "SG" },
    displaySettings: { invoice: true }
  } });
  assert.equal(ok.status, 200);
  const rates = await call("PUT", "/rates", { token: state.owner, body: { "24K": 7000, "22K": 6500, "18K": 5300 } });
  assert.equal(rates.status, 200);
});

test("gold rate: the provider's market rate reaches shops; a shop can override it and go back", async () => {
  assert.equal((await call("GET", "/rates", { token: state.owner })).body.source, "shop");
  assert.equal((await call("GET", "/rates/market", { token: state.owner })).body.available, false);
  assert.equal((await call("PUT", "/admin/gold-rate", { token: state.owner, body: { "24K": 7700, "22K": 7058 } })).status, 401);
  assert.equal((await call("PUT", "/admin/gold-rate", { token: state.adminToken, body: { "24K": 7700 } })).status, 400);

  const pub = await call("PUT", "/admin/gold-rate", { token: state.adminToken, body: { "24K": 7700, "22K": 7058, "18K": 5775 } });
  assert.equal(pub.status, 200);
  const admin = await call("GET", "/admin/gold-rate", { token: state.adminToken });
  assert.equal(admin.body.current["24K"], 7700);
  assert.equal(admin.body.history.length, 1);

  // newer market rate wins over the shop's earlier one
  let r = await call("GET", "/rates", { token: state.owner });
  assert.equal(r.body.source, "market");
  assert.equal(r.body["22K"], 7058);
  assert.equal((await call("GET", "/rates/market", { token: state.owner })).body["24K"], 7700);
  assert.equal((await call("GET", "/dashboard", { token: state.owner })).body.rates.source, "market");

  // the shop changes it for itself…
  await call("PUT", "/rates", { token: state.owner, body: { "24K": 7000, "22K": 6500, "18K": 5300 } });
  r = await call("GET", "/rates", { token: state.owner });
  assert.equal(r.body.source, "shop");
  assert.equal(r.body["22K"], 6500);
  // …and can go back to the market rate
  r = await call("DELETE", "/rates", { token: state.owner });
  assert.equal(r.body.source, "market");
  assert.equal((await call("GET", "/rates", { token: state.owner })).body["24K"], 7700);
});

test("branding: print layout is validated; the logo goes to the image store and shows in the session", async () => {
  assert.equal((await call("PUT", "/settings/print", { token: state.owner, body: { accentColor: "red" } })).status, 400);
  const saved = await call("PUT", "/settings/print", { token: state.owner, body: {
    accentColor: "#8B6914", fontSize: "large", logoPosition: "center", tagline: "BIS hallmarked", invoiceTitle: "tax invoice cum bill", showRates: false, fontSizeX: "x"
  } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.print.accentColor, "#8b6914");
  assert.equal(saved.body.print.invoiceTitle, "TAX INVOICE CUM BILL");
  assert.equal(saved.body.print.showRates, false);
  assert.equal(saved.body.print.showLogo, true);            // untouched settings keep their defaults
  assert.equal(saved.body.logoUploads, true);

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  assert.equal((await call("POST", "/settings/logo", { token: state.owner, body: { dataUrl: "data:image/png;base64," + Buffer.from("not an image").toString("base64") } })).status, 400);
  assert.equal((await call("POST", "/settings/logo", { token: state.owner, body: { dataUrl: "data:image/gif;base64,R0lGOD" } })).status, 400);
  const up = await call("POST", "/settings/logo", { token: state.owner, body: { dataUrl: "data:image/png;base64," + png.toString("base64") } });
  assert.equal(up.status, 200);
  assert.ok(up.body.logoUrl.startsWith(`https://images.test/logos/${state.licenseId}/logo-`) && up.body.logoUrl.endsWith(".png"));
  assert.equal(savedImages.size, 1);

  const me = await call("GET", "/auth/me", { token: state.owner });
  assert.equal(me.body.branding.logoUrl, up.body.logoUrl);
  assert.equal(me.body.branding.print.fontSize, "large");

  const again = await call("POST", "/settings/logo", { token: state.owner, body: { dataUrl: "data:image/png;base64," + png.toString("base64") } });
  assert.notEqual(again.body.logoUrl, up.body.logoUrl);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(savedImages.size, 1);                         // the old file is removed

  assert.equal((await call("DELETE", "/settings/logo", { token: state.owner })).body.logoUrl, "");
  assert.equal(savedImages.size, 0);
});

test("users: super admin creates a billing-only admin; permissions are enforced server-side", async () => {
  const res = await call("POST", "/users", { token: state.owner, body: {
    name: "Ravi", username: "ravi", password: "ravi-pass-1", mobile: "9123456780", permissions: { invoice: true }
  } });
  assert.equal(res.status, 200);
  state.raviId = res.body.id;
  const login = await call("POST", "/auth/login", { body: { licenseKey: state.key, username: "ravi", password: "ravi-pass-1" } });
  state.ravi = login.body.token;
  assert.equal((await call("GET", "/staff", { token: state.ravi })).status, 403);
  assert.equal((await call("GET", "/users", { token: state.ravi })).status, 403);
  assert.equal((await call("PUT", "/settings", { token: state.ravi, body: { shop: { name: "x" } } })).status, 403);
  assert.equal((await call("DELETE", `/users/${state.raviId}`, { token: state.ravi })).status, 403);
});

test("inventory: add piece, unique item code, billing lookup", async () => {
  const piece = { itemCode: "nk-001", description: "Necklace", purity: "22K", grossWt: 20.5, stoneWt: 0.5, wastagePct: 8, makingType: "per_gram", makingValue: 400, stoneCharges: 1500, huid: "AB12CD" };
  const res = await call("POST", "/products", { token: state.owner, body: piece });
  assert.equal(res.status, 200);
  state.productId = res.body.id;
  assert.equal((await call("POST", "/products", { token: state.owner, body: piece })).status, 400);
  const look = await call("GET", "/products/lookup/NK-001", { token: state.ravi });
  assert.equal(look.status, 200);
  assert.equal(look.body.netWt, 20);
});

test("barcodes: blank item code is generated, scan lookup finds in-stock and sold pieces", async () => {
  const piece = { description: "Barcode ring", purity: "22K", grossWt: 4, wastagePct: 8, makingType: "fixed", makingValue: 900 };
  const a = await call("POST", "/products", { token: state.owner, body: piece });
  const b = await call("POST", "/products", { token: state.owner, body: piece });
  assert.equal(a.status, 200);
  assert.match(a.body.itemCode, /^SS\d{5}$/);
  assert.notEqual(a.body.itemCode, b.body.itemCode);            // each label is unique
  // a code typed by hand is not reused by the generator
  const next = String(Number(b.body.itemCode.slice(2)) + 1).padStart(5, "0");
  await call("POST", "/products", { token: state.owner, body: { ...piece, itemCode: `SS${next}` } });
  const c = await call("POST", "/products", { token: state.owner, body: piece });
  assert.notEqual(c.body.itemCode, `SS${next}`);
  // scanner input is trimmed and case-insensitive
  const scan = await call("GET", `/products/by-code/${encodeURIComponent(" " + a.body.itemCode.toLowerCase() + " ")}`, { token: state.owner });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.itemCode, a.body.itemCode);
  assert.equal((await call("GET", "/products/by-code/NOPE-1", { token: state.owner })).status, 404);
  // billing staff without the inventory permission cannot use the inventory scan route
  assert.equal((await call("GET", `/products/by-code/${a.body.itemCode}`, { token: state.ravi })).status, 403);
  // and the billing lookup still fills the invoice row from the scanned code
  assert.equal((await call("GET", `/products/lookup/${a.body.itemCode}`, { token: state.ravi })).body.description, "Barcode ring");
});

test("invoice: totals computed on the server, consecutive numbers, stock marked sold", async () => {
  const body = {
    mode: "sale",
    rates: { "24K": 7000, "22K": 6500, "18K": 5300 },
    customer: { name: "Anitha", mobile: "9988776655" },
    items: [{ productId: state.productId, itemCode: "NK-001", description: "Necklace", purity: "22K", grossWt: 20.5, stoneWt: 0.5, wastagePct: 8, makingType: "per_gram", makingValue: 400, stoneCharges: 1500 }],
    oldGold: [{ description: "Old bangle", grossWt: 10, touch: 91.6 }],
    payments: [{ mode: "UPI", amount: 90277 }],
    summary: { payable: 1 } // client-sent totals must be ignored
  };
  const res = await call("POST", "/invoices", { token: state.ravi, body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.invoiceNumber, `SG/${fyShort}/0001`);
  assert.equal(res.body.summary.payable, 90277);
  assert.equal(res.body.summary.cgst, 2248.5);
  assert.equal(res.body.summary.balance, 0);
  assert.equal(res.body.shop.gstin, "36ABCDE1234F1Z5");
  state.invoiceId = res.body.id;

  const product = db._store.get(`licenses/${state.licenseId}/products/${state.productId}`);
  assert.equal(product.status, "sold");

  const again = await call("POST", "/invoices", { token: state.ravi, body });
  assert.equal(again.status, 409); // piece already sold

  const second = await call("POST", "/invoices", { token: state.owner, body: {
    mode: "job_work", rates: { "24K": 7000, "22K": 6500 },
    customer: { name: "Kiran" },
    items: [{ description: "Haram", purity: "22K", grossWt: 25, makingType: "per_gram", makingValue: 300 }],
    oldGold: [{ grossWt: 20, touch: 91.6 }],
    payments: [{ mode: "Cash", amount: 20000 }]
  } });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.invoiceNumber, `SG/${fyShort}/0002`);
  assert.equal(second.body.summary.payable, 40897);
  assert.equal(second.body.summary.balance, 20897);

  const customer = db._store.get(`licenses/${state.licenseId}/customers/9988776655`);
  assert.equal(customer.name, "Anitha");
});

test("invoice: compliance errors block saving (PAN above ₹2 lakh)", async () => {
  const res = await call("POST", "/invoices", { token: state.owner, body: {
    mode: "sale", rates: { "22K": 6500 }, customer: { name: "Big buyer" },
    items: [{ description: "Bridal set", purity: "22K", grossWt: 40 }]
  } });
  assert.equal(res.status, 400);
  assert.equal(res.body.details[0].code, "PAN_REQUIRED");
});

test("invoice list: admins see only their own bills; owner sees all", async () => {
  const mine = await call("GET", "/invoices", { token: state.ravi });
  assert.deepEqual(mine.body.invoices.map((i) => i.invoiceNumber), [`SG/${fyShort}/0001`]);
  const all = await call("GET", "/invoices", { token: state.owner });
  assert.equal(all.body.invoices.length, 2);
  assert.equal((await call("GET", `/invoices/${state.invoiceId}`, { token: state.ravi })).status, 200);
});

test("cancel: owner only, keeps the number, returns stock", async () => {
  assert.equal((await call("POST", `/invoices/${state.invoiceId}/cancel`, { token: state.ravi, body: { reason: "x" } })).status, 403);
  const res = await call("POST", `/invoices/${state.invoiceId}/cancel`, { token: state.owner, body: { reason: "Customer returned" } });
  assert.equal(res.status, 200);
  const product = db._store.get(`licenses/${state.licenseId}/products/${state.productId}`);
  assert.equal(product.status, "in_stock");

  const report = await call("GET", "/reports/sales", { token: state.owner });
  // the remaining bill is job work that hasn't been delivered yet, so it is not a finished sale (see jobwork.test.js)
  assert.equal(report.body.totals.count, 0);
  assert.equal(report.body.totals.pendingJobWork.count, 1);
  assert.equal(report.body.totals.cancelled, 1);
  assert.equal((await call("GET", "/reports/sales", { token: state.ravi })).status, 403);
});

test("secret invoice: stock item is permanently removed from Firebase, invoice log is not saved", async () => {
  // 1. Register a new item in inventory
  const addPiece = await call("POST", "/products", { token: state.owner, body: {
    itemCode: "SEC-RING-01", description: "Secret Gold Ring", purity: "22K",
    grossWt: 5.5, stoneWt: 0.5, wastagePct: 10, makingType: "per_gram", makingValue: 400
  } });
  assert.equal(addPiece.status, 200);
  const secretProdId = addPiece.body.id;
  assert.ok(db._store.get(`licenses/${state.licenseId}/products/${secretProdId}`));

  // Invoices count before
  const listBefore = await call("GET", "/invoices", { token: state.owner });
  const invoiceCountBefore = listBefore.body.invoices.length;

  // 2. Perform secret sale
  const saleRes = await call("POST", "/invoices/secret-sale", { token: state.owner, body: {
    mode: "sale", rates: { "22K": 6500 },
    customer: { name: "Cash Walk-in" },
    items: [{ productId: secretProdId, itemCode: "SEC-RING-01", description: "Secret Gold Ring", purity: "22K", grossWt: 5.5, stoneWt: 0.5, wastagePct: 10, makingType: "per_gram", makingValue: 400 }],
    payments: [{ mode: "Cash", amount: 30000 }]
  } });
  assert.equal(saleRes.status, 200, JSON.stringify(saleRes.body));
  assert.equal(saleRes.body.isSecret, true);
  assert.ok(saleRes.body.invoiceNumber.startsWith("EST-"));

  // 3. Product must be PERMANENTLY REMOVED (deleted) from database
  assert.equal(db._store.get(`licenses/${state.licenseId}/products/${secretProdId}`), undefined);

  // 4. Invoice log must NOT contain this invoice
  const listAfter = await call("GET", "/invoices", { token: state.owner });
  assert.equal(listAfter.body.invoices.length, invoiceCountBefore);
  assert.ok(!listAfter.body.invoices.some((i) => i.invoiceNumber === saleRes.body.invoiceNumber));

  // 5. Reports must NOT include this invoice
  const report = await call("GET", "/reports/sales", { token: state.owner });
  assert.ok(!report.body.invoices.some((i) => i.invoiceNumber === saleRes.body.invoiceNumber));
});

test("forgot password: OTP to registered mobile, attempt limit, old sessions revoked", async () => {
  const start = await call("POST", "/auth/forgot/start", { body: { licenseKey: state.key, username: "ravi" } });
  assert.equal(start.body.maskedMobile, "••••••6780");
  assert.ok(!JSON.stringify(start.body).includes("9123456780"));

  const sent = await call("POST", "/auth/forgot/send-otp", { body: { licenseKey: state.key, username: "ravi" } });
  assert.equal(sent.status, 200);
  const { otp, phone } = sentSms.at(-1);
  assert.equal(phone, "9123456780");

  const wrong = await call("POST", "/auth/forgot/verify-otp", { body: { sessionId: sent.body.sessionId, otp: otp === "111111" ? "222222" : "111111" } });
  assert.equal(wrong.status, 401);
  assert.equal((await call("POST", "/auth/forgot/reset", { body: { sessionId: sent.body.sessionId, newPassword: "new-pass-123" } })).status, 401);

  assert.equal((await call("POST", "/auth/forgot/verify-otp", { body: { sessionId: sent.body.sessionId, otp } })).status, 200);
  const reset = await call("POST", "/auth/forgot/reset", { body: { sessionId: sent.body.sessionId, newPassword: "new-pass-123" } });
  assert.equal(reset.status, 200);

  assert.equal((await call("GET", "/auth/me", { token: state.ravi })).status, 401); // old token revoked
  const login = await call("POST", "/auth/login", { body: { licenseKey: state.key, username: "ravi", password: "new-pass-123" } });
  assert.equal(login.status, 200);
  state.ravi = login.body.token;
});

test("mobile change: admin request approved by the shop owner", async () => {
  const req = await call("POST", "/auth/forgot/request-mobile-change", { body: { licenseKey: state.key, username: "ravi", newMobile: "9000000001" } });
  assert.equal(req.status, 200);
  assert.equal((await call("GET", `/auth/forgot/request-status/${req.body.requestId}`)).body.status, "pending");
  const pending = await call("GET", "/requests", { token: state.owner });
  assert.equal(pending.body.length, 1);
  assert.equal((await call("GET", "/admin/requests", { token: state.adminToken })).body.length, 0);
  await call("POST", `/requests/${req.body.requestId}/decision`, { token: state.owner, body: { action: "approved" } });
  assert.equal((await call("GET", `/auth/forgot/request-status/${req.body.requestId}`)).body.status, "approved");
  assert.equal(db._store.get(`licenses/${state.licenseId}/users/${state.raviId}`).mobile, "9000000001");
});

test("legacy records: plain-text license key and password are upgraded on login", async () => {
  await db.collection("licenses").doc("legacy").set({ key: "SW-OLD123", business: "Old Shop", active: true, expiry: nextYear });
  await db.collection("licenses").doc("legacy").collection("users").doc("u1").set({ username: "old", password: "plain-pass", role: "super_admin", name: "Old" });
  const res = await call("POST", "/auth/login", { body: { licenseKey: "sw-old123", username: "old", password: "plain-pass" } });
  assert.equal(res.status, 200);
  const lic = db._store.get("licenses/legacy");
  assert.equal(lic.key, undefined);
  assert.ok(lic.keyHash);
  assert.ok(db._store.get("licenses/legacy/users/u1").password.startsWith("$2"));
});

test("expired or deactivated licenses are blocked, including existing sessions", async () => {
  await call("POST", `/admin/licenses/${state.licenseId}/status`, { token: state.adminToken, body: { active: false } });
  assert.equal((await call("GET", "/auth/me", { token: state.owner })).status, 403);
  assert.equal((await call("POST", "/auth/login", { body: { licenseKey: state.key, username: "owner", password: "owner-pass-1" } })).status, 403);
  await call("POST", `/admin/licenses/${state.licenseId}/status`, { token: state.adminToken, body: { active: true } });
  assert.equal((await call("GET", "/auth/me", { token: state.owner })).status, 200);
});

test("login is rate limited", async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await call("POST", "/auth/login", { body: { licenseKey: state.key, username: "owner", password: `wrong-${i}` } });
  assert.equal(last.status, 429);
});

test("CORS: unknown browser origins are refused", async () => {
  const res = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(res.status, 403);
  const ok = await fetch(`${base}/health`, { headers: { origin: "http://localhost:3000" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
});
