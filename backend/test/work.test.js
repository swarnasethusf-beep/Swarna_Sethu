const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { createApp } = require("../app");
const { createSecurity, hashKeyForLookup } = require("../lib/security");
const { todayIST } = require("../lib/util");
const { createFakeFirestore } = require("./fakeFirestore");

const KEY = "SW-WORK-TEST-0001";
let server, base, db;
const t = {}; // tokens + ids

test.before(async () => {
  const fake = createFakeFirestore();
  db = fake.db;
  const security = createSecurity({ encryptionSecret: "a".repeat(32), tokenSecret: "t".repeat(40) });
  const lic = db.collection("licenses").doc("L1");
  await lic.set({
    keyHash: hashKeyForLookup(KEY), keyEncrypted: security.encryptKey(KEY), business: "Test Jewellers", name: "Owner", mobile: "9876543210",
    active: true, expiry: `${Number(todayIST().slice(0, 4)) + 1}-12-31`,
    shop: { name: "Test Jewellers", stateCode: "36", invoicePrefix: "T" }, rates: { "22K": 6500, "24K": 7000, date: todayIST() }
  });
  const hash = bcrypt.hashSync("password1", 4);
  await lic.collection("users").doc("owner").set({ name: "Owner", username: "owner", password: hash, mobile: "9876543210", role: "super_admin" });
  await lic.collection("users").doc("desk").set({ name: "Desk", username: "desk", password: hash, mobile: "9876500000", role: "admin", permissions: { invoice: true, workorders: true } });
  await lic.collection("users").doc("onlybarcode").set({ name: "Labeller", username: "labeller", password: hash, mobile: "9876500001", role: "admin", permissions: { barcode: true } });
  await lic.collection("users").doc("plain").set({ name: "Plain", username: "plain", password: hash, mobile: "9876500002", role: "admin", permissions: { staff: true } });
  const app = createApp({ db, deleteField: fake.deleteField, security, config: { corsOrigins: [], adminUsername: "", adminPasswordHash: "" }, sendSms: null, fetchGold24k: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const login = async (username, password = "password1") =>
  (await call("POST", "/auth/login", { body: { licenseKey: KEY, username, password } }));
const staffBody = (fullName, mobileNo) => ({ fullName, designation: "Goldsmith", department: "Workshop", mobileNo, address: "Hyd", gender: "Male" });

test("setup: owner logs in and creates two staff, one with a goldsmith login", async () => {
  t.owner = (await login("owner")).body.token;
  t.desk = (await login("desk")).body.token;
  t.labeller = (await login("labeller")).body.token;
  t.plain = (await login("plain")).body.token;

  t.staffA = (await call("POST", "/staff", { token: t.owner, body: staffBody("Venkatesh Achari", "9000011101") })).body.id;
  t.staffB = (await call("POST", "/staff", { token: t.owner, body: staffBody("Ramu Goud", "9000011102") })).body.id;
  t.staffC = (await call("POST", "/staff", { token: t.owner, body: staffBody("No Login Person", "9000011103") })).body.id;

  // only the owner can give a login; passwords must be strong enough; usernames are unique
  assert.equal((await call("POST", `/staff/${t.staffA}/login`, { token: t.plain, body: { username: "venkat", password: "gold-pass-1" } })).status, 403);
  assert.equal((await call("POST", `/staff/${t.staffA}/login`, { token: t.owner, body: { username: "venkat", password: "short" } })).status, 400);
  assert.equal((await call("POST", `/staff/${t.staffA}/login`, { token: t.owner, body: { username: "owner", password: "gold-pass-1" } })).status, 400);
  assert.equal((await call("POST", `/staff/${t.staffA}/login`, { token: t.owner, body: { username: "venkat", password: "gold-pass-1" } })).status, 200);
  assert.equal((await call("POST", `/staff/${t.staffA}/login`, { token: t.owner, body: { username: "venkat2", password: "gold-pass-1" } })).status, 400); // one login per person
  assert.equal((await call("POST", `/staff/${t.staffB}/login`, { token: t.owner, body: { username: "ramu", password: "gold-pass-2" } })).status, 200);

  const list = (await call("GET", "/staff", { token: t.owner })).body;
  const a = list.find((s) => s.id === t.staffA);
  assert.equal(a.hasLogin, true);
  assert.equal(a.loginUsername, "venkat");
  assert.equal(list.find((s) => s.id === t.staffC).hasLogin, false);
});

test("goldsmith login works, has no module permissions, and is locked out of everything else", async () => {
  const res = await login("venkat", "gold-pass-1");
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, "goldsmith");
  assert.ok(Object.values(res.body.user.permissions).every((v) => v === false));
  t.venkat = res.body.token;
  t.ramu = (await login("ramu", "gold-pass-2")).body.token;

  const forbidden = [
    ["GET", "/dashboard"], ["GET", "/rates"], ["GET", "/rates/live"], ["GET", "/settings"], ["PUT", "/settings"],
    ["GET", "/invoices"], ["POST", "/invoices"], ["GET", "/reports/sales"], ["GET", "/customers"],
    ["GET", "/products"], ["POST", "/products"], ["GET", "/products/by-code/X"], ["GET", "/products/lookup/X"],
    ["GET", "/staff"], ["GET", "/staff/options"], ["POST", "/staff"], ["GET", "/users"], ["POST", "/users"],
    ["GET", "/requests"], ["POST", "/work-orders"], ["PUT", "/rates"]
  ];
  for (const [method, path] of forbidden) {
    const r = await call(method, path, { token: t.venkat, body: {} });
    assert.equal(r.status, 403, `${method} ${path} should be 403 for a goldsmith, got ${r.status}`);
  }
  // …but their own screens work
  assert.equal((await call("GET", "/auth/me", { token: t.venkat })).status, 200);
  assert.equal((await call("GET", "/work-orders", { token: t.venkat })).status, 200);
  assert.equal((await call("GET", "/notifications", { token: t.venkat })).status, 200);
});

test("work order: assign → notify → start → complete → verify, with the right person told at each step", async () => {
  // permissions: billing-only and staff-only admins can't create; the desk with 'workorders' can
  const body = { staffId: t.staffA, title: "22K temple haram", details: "Polish and set stones", itemCode: "nk-9", issuedWt: 40.5, dueDate: todayIST(), priority: "urgent" };
  assert.equal((await call("POST", "/work-orders", { token: t.plain, body })).status, 403);
  assert.equal((await call("POST", "/work-orders", { token: t.owner, body: { ...body, title: "" } })).status, 400);
  assert.equal((await call("POST", "/work-orders", { token: t.owner, body: { ...body, staffId: "nope" } })).status, 400);
  assert.equal((await call("POST", "/work-orders", { token: t.owner, body: { ...body, dueDate: "2020-01-01" } })).status, 400);

  const made = await call("POST", "/work-orders", { token: t.desk, body });
  assert.equal(made.status, 200);
  assert.equal(made.body.orderNo, "WO-0001");
  assert.equal(made.body.notified, true);
  t.wo = made.body.id;

  // the goldsmith is notified; nobody else is
  const n = (await call("GET", "/notifications", { token: t.venkat })).body;
  assert.equal(n.unread, 1);
  assert.match(n.items[0].title, /URGENT/);
  assert.equal(n.items[0].workOrderId, t.wo);
  assert.equal((await call("GET", "/notifications", { token: t.ramu })).body.unread, 0);

  // another goldsmith can't see or touch it
  assert.equal((await call("GET", `/work-orders/${t.wo}`, { token: t.ramu })).status, 404);
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.ramu, body: { action: "start" } })).status, 404);
  assert.equal((await call("GET", "/work-orders", { token: t.ramu })).body.orders.length, 0);

  // goldsmith can't use office actions; office can't use goldsmith actions
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "close" } })).status, 403);
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.owner, body: { action: "start" } })).status, 403);
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "bogus" } })).status, 400);

  // start → owner and the creator (desk) are told
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "start" } })).status, 200);
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "start" } })).status, 409); // already started
  for (const who of [t.owner, t.desk]) {
    const o = (await call("GET", "/notifications", { token: who })).body;
    assert.ok(o.items.some((x) => /started work/.test(x.title)), "office told about the start");
  }

  // complete with the finished weight
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "complete", finishedWt: -1 } })).status, 400);
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "complete", finishedWt: 39.8, note: "Done, stones set" } })).status, 200);
  const ownerNotes = (await call("GET", "/notifications", { token: t.owner })).body;
  const done = ownerNotes.items.find((x) => /completed work/.test(x.title));
  assert.ok(done, "owner told the work is completed");
  assert.match(done.body, /issued 40\.5 g → finished 39\.8 g/);

  let list = (await call("GET", "/work-orders", { token: t.owner })).body;
  assert.equal(list.counts.completed, 1);
  assert.equal(list.orders[0].finishedWt, 39.8);
  assert.deepEqual(list.orders[0].history.map((h) => h.status), ["assigned", "in_progress", "completed"]);

  // owner sends it back (needs a note), goldsmith is told, then it is completed again and verified
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.owner, body: { action: "reopen" } })).status, 400);
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.owner, body: { action: "reopen", note: "One stone loose" } })).status, 200);
  assert.ok((await call("GET", "/notifications", { token: t.venkat })).body.items.some((x) => /Sent back/.test(x.title) && /One stone loose/.test(x.body)));
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "complete", finishedWt: 39.9 } })).status, 200);
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.owner, body: { action: "close" } })).status, 200);
  assert.ok((await call("GET", "/notifications", { token: t.venkat })).body.items.some((x) => /Verified/.test(x.title)));
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.owner, body: { action: "cancel" } })).status, 409); // closed orders can't be cancelled
});

test("notifications: mark as read, and each user only ever sees their own", async () => {
  const before = (await call("GET", "/notifications", { token: t.venkat })).body;
  assert.ok(before.unread > 0);
  assert.equal((await call("POST", "/notifications/read", { token: t.venkat, body: { ids: [before.items[0].id] } })).status, 200);
  assert.equal((await call("GET", "/notifications", { token: t.venkat })).body.unread, before.unread - 1);
  await call("POST", "/notifications/read", { token: t.venkat, body: { all: true } });
  assert.equal((await call("GET", "/notifications", { token: t.venkat })).body.unread, 0);
  // reading someone else's notification id does nothing to them
  const ownerBefore = (await call("GET", "/notifications", { token: t.owner })).body.unread;
  await call("POST", "/notifications/read", { token: t.venkat, body: { ids: (await call("GET", "/notifications", { token: t.owner })).body.items.map((i) => i.id) } });
  assert.equal((await call("GET", "/notifications", { token: t.owner })).body.unread, ownerBefore);
  assert.equal((await call("GET", "/notifications")).status, 401);
});

test("cancel and overdue: office can cancel open work; overdue is flagged", async () => {
  const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const id = (await call("POST", "/work-orders", { token: t.owner, body: { staffId: t.staffB, title: "Chain repair" } })).body.id;
  // make it overdue directly (the API refuses past due dates on creation)
  await db.collection("licenses").doc("L1").collection("workOrders").doc(id).update({ dueDate: past });
  const list = (await call("GET", "/work-orders", { token: t.owner })).body;
  assert.equal(list.counts.overdue, 1);
  assert.equal((await call("GET", "/work-orders?status=overdue", { token: t.owner })).body.orders[0].orderNo, "WO-0002");
  assert.equal((await call("POST", `/work-orders/${id}/status`, { token: t.owner, body: { action: "cancel", note: "Customer cancelled" } })).status, 200);
  assert.ok((await call("GET", "/notifications", { token: t.ramu })).body.items.some((x) => /Cancelled/.test(x.title)));
  assert.equal((await call("GET", "/work-orders?status=overdue", { token: t.owner })).body.orders.length, 0);
});

test("invoice with a goldsmith that has a login creates a work order automatically", async () => {
  const bill = (assignedStaffId) => ({
    mode: "job_work", rates: { "22K": 6500, "24K": 7000 },
    customer: { name: "Anitha", mobile: "9988776655", address: "Hyd" },
    items: [{ description: "Custom long haram", purity: "22K", grossWt: 25, makingType: "per_gram", makingValue: 300 }],
    oldGold: [{ description: "Old chain", grossWt: 20, lessWt: 0, touch: 91.6 }],
    payments: [], assignedStaffId
  });
  const withLogin = await call("POST", "/invoices", { token: t.owner, body: bill(t.staffA) });
  assert.equal(withLogin.status, 200, JSON.stringify(withLogin.body));
  assert.ok(withLogin.body.workOrder?.orderNo);
  const orders = (await call("GET", "/work-orders", { token: t.venkat })).body.orders;
  const auto = orders.find((o) => o.id === withLogin.body.workOrder.id);
  assert.equal(auto.reference, withLogin.body.invoiceNumber);
  assert.equal(auto.issuedWt, 20);                       // the customer's gold handed to the goldsmith
  assert.match(auto.title, /Custom long haram/);
  assert.match((await call("GET", "/notifications", { token: t.venkat })).body.items[0].title, /New work/);
  // a staff member without a login is just recorded on the bill — no work order
  const noLogin = await call("POST", "/invoices", { token: t.owner, body: bill(t.staffC) });
  assert.equal(noLogin.status, 200);
  assert.equal(noLogin.body.workOrder, null);
});

test("barcode permission: can create pieces and scan, but not edit stock or bill", async () => {
  const made = await call("POST", "/products", { token: t.labeller, body: { description: "Label ring", purity: "22K", grossWt: 3 } });
  assert.equal(made.status, 200);
  assert.match(made.body.itemCode, /^SS\d{5}$/);
  assert.equal((await call("GET", `/products/by-code/${made.body.itemCode}`, { token: t.labeller })).status, 200);
  assert.equal((await call("GET", "/products", { token: t.labeller })).status, 200);
  assert.equal((await call("PUT", `/products/${made.body.id}`, { token: t.labeller, body: { itemCode: made.body.itemCode, description: "x", grossWt: 3 } })).status, 403);
  assert.equal((await call("DELETE", `/products/${made.body.id}`, { token: t.labeller })).status, 403);
  assert.equal((await call("POST", "/invoices", { token: t.labeller, body: {} })).status, 403);
  // a user without barcode or inventory can't
  assert.equal((await call("GET", "/products", { token: t.plain })).status, 403);
});

test("login management: password reset signs the goldsmith out; removing the login revokes access", async () => {
  // reset password (owner only) → old sessions stop working, new password works
  assert.equal((await call("POST", `/staff/${t.staffA}/login/password`, { token: t.plain, body: { password: "new-pass-123" } })).status, 403);
  assert.equal((await call("POST", `/staff/${t.staffA}/login/password`, { token: t.owner, body: { password: "short" } })).status, 400);
  assert.equal((await call("POST", `/staff/${t.staffA}/login/password`, { token: t.owner, body: { password: "new-pass-123" } })).status, 200);
  assert.equal((await call("GET", "/work-orders", { token: t.venkat })).status, 401);
  assert.equal((await login("venkat", "gold-pass-1")).status, 401);
  const again = await login("venkat", "new-pass-123");
  assert.equal(again.status, 200);
  // removing the login (or the staff member) ends access immediately
  assert.equal((await call("DELETE", `/staff/${t.staffA}/login`, { token: t.owner })).status, 200);
  assert.equal((await call("GET", "/work-orders", { token: again.body.token })).status, 401);
  assert.equal((await login("venkat", "new-pass-123")).status, 401);
  assert.equal((await call("DELETE", `/staff/${t.staffA}/login`, { token: t.owner })).status, 404);
  // deleting a staff member also deletes their login
  assert.equal((await call("DELETE", `/staff/${t.staffB}`, { token: t.owner })).status, 200);
  assert.equal((await login("ramu", "gold-pass-2")).status, 401);
});

test("admin screens: the new permissions can be granted per admin", async () => {
  const made = await call("POST", "/users", { token: t.owner, body: { name: "New Admin", username: "newadmin", password: "password-9", mobile: "9876511111", permissions: { barcode: true, workorders: true, bogus: true } } });
  assert.equal(made.status, 200);
  const users = (await call("GET", "/users", { token: t.owner })).body;
  const u = users.find((x) => x.id === made.body.id);
  assert.equal(u.permissions.barcode, true);
  assert.equal(u.permissions.workorders, true);
  assert.equal(u.permissions.bogus, undefined);               // unknown keys are dropped
  assert.equal(u.permissions.invoice, false);
});

test("creating a staff member can create their login in the same step", async () => {
  const staffCount = async () => (await call("GET", "/staff", { token: t.owner })).body.length;
  const before = await staffCount();
  const body = (extra) => ({ ...staffBody("Mohan Soni", "9000011199"), ...extra });

  // a bad username or password creates NOTHING — no half-created staff record
  for (const bad of [{ loginUsername: "ab", loginPassword: "gold-pass-9" }, { loginUsername: "mohan", loginPassword: "short" }, { loginUsername: "owner", loginPassword: "gold-pass-9" }]) {
    assert.equal((await call("POST", "/staff", { token: t.owner, body: body(bad) })).status, 400);
  }
  assert.equal(await staffCount(), before);

  // only the owner can create logins — an admin with the Staff permission can still add plain staff
  assert.equal((await call("POST", "/staff", { token: t.plain, body: body({ loginUsername: "mohan", loginPassword: "gold-pass-9" }) })).status, 403);
  assert.equal(await staffCount(), before);
  assert.equal((await call("POST", "/staff", { token: t.plain, body: body({ fullName: "Plain Staff" }) })).status, 200);

  // owner: staff + login in one call; they can sign in straight away and see only their work
  const made = await call("POST", "/staff", { token: t.owner, body: body({ loginUsername: "mohan", loginPassword: "gold-pass-9" }) });
  assert.equal(made.status, 200);
  assert.equal(made.body.loginUsername, "mohan");
  const signedIn = await login("mohan", "gold-pass-9");
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.role, "goldsmith");
  assert.equal((await call("GET", "/dashboard", { token: signedIn.body.token })).status, 403);
  assert.equal((await call("GET", "/staff", { token: t.owner })).body.find((s) => s.id === made.body.id).hasLogin, true);

  // no login fields → plain staff, no login
  const plainStaff = await call("POST", "/staff", { token: t.owner, body: body({ fullName: "No Login Needed", mobileNo: "9000011188" }) });
  assert.equal(plainStaff.body.loginUsername, "");
  assert.equal((await call("GET", "/staff", { token: t.owner })).body.find((s) => s.id === plainStaff.body.id).hasLogin, false);
});
