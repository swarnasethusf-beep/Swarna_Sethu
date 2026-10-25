const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { createApp } = require("../app");
const { createSecurity, hashKeyForLookup } = require("../lib/security");
const { todayIST } = require("../lib/util");
const { createFakeFirestore } = require("./fakeFirestore");

const KEY = "SW-JOB-TEST-0001";
let server, base, db;
const t = {};

test.before(async () => {
  const fake = createFakeFirestore();
  db = fake.db;
  const security = createSecurity({ encryptionSecret: "a".repeat(32), tokenSecret: "t".repeat(40) });
  const lic = db.collection("licenses").doc("L1");
  await lic.set({
    keyHash: hashKeyForLookup(KEY), keyEncrypted: security.encryptKey(KEY), business: "Test Jewellers", name: "Owner", mobile: "9876543210",
    active: true, expiry: `${Number(todayIST().slice(0, 4)) + 1}-12-31`,
    shop: { name: "Test Jewellers", stateCode: "36", invoicePrefix: "T" }
  });
  const hash = bcrypt.hashSync("password1", 4);
  await lic.collection("users").doc("owner").set({ name: "Owner", username: "owner", password: hash, mobile: "9876543210", role: "super_admin" });
  await lic.collection("users").doc("counter").set({ name: "Counter", username: "counter", password: hash, mobile: "9876500000", role: "admin", permissions: { invoice: true } });
  await lic.collection("users").doc("nobill").set({ name: "No Bill", username: "nobill", password: hash, mobile: "9876500001", role: "admin", permissions: { staff: true } });
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
const login = (username, password = "password1") => call("POST", "/auth/login", { body: { licenseKey: KEY, username, password } });
const RATES = { "24K": 7000, "22K": 6500, "18K": 5300 };

// The customer hands over 20 g of old gold (91.6 → 18.320 g fine) for a 25 g 22K haram, pays ₹10,000 advance
const order = (extra = {}) => ({
  mode: "job_work", rates: RATES,
  customer: { name: "Anitha Reddy", mobile: "9988776655", address: "Hyderabad", stateCode: "36" },
  items: [{ description: "Custom haram", purity: "22K", grossWt: 25, makingType: "per_gram", makingValue: 300 }],
  oldGold: [{ description: "Old chain", grossWt: 20, lessWt: 0, touch: 91.6 }],
  payments: [{ mode: "UPI", amount: 10000, reference: "UTR 1" }],
  ...extra
});

test("setup", async () => {
  t.owner = (await login("owner")).body.token;
  t.counter = (await login("counter")).body.token;
  t.nobill = (await login("nobill")).body.token;
  const s = await call("POST", "/staff", { token: t.owner, body: { fullName: "Venkatesh Achari", designation: "Goldsmith", department: "Workshop", mobileNo: "9000011101", address: "Hyd", loginUsername: "venkat", loginPassword: "gold-pass-1" } });
  assert.equal(s.status, 200);
  t.staff = s.body.id;
  t.venkat = (await login("venkat", "gold-pass-1")).body.token;
});

test("a new job-work bill is PENDING, linked to the goldsmith's work order, and not counted as a sale yet", async () => {
  const res = await call("POST", "/invoices", { token: t.counter, body: order({ assignedStaffId: t.staff }) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  t.inv = res.body.id;
  t.invNo = res.body.invoiceNumber;
  assert.equal(res.body.fulfilmentStatus, "pending");
  assert.equal(res.body.summary.payable, 40897);            // 4.58 g fine gold added + labour, GST 3% / 5%
  assert.equal(res.body.summary.paid, 10000);
  assert.equal(res.body.summary.balance, 30897);
  assert.ok(res.body.workOrder.orderNo);
  assert.equal(res.body.workOrderNo, res.body.workOrder.orderNo);   // the save response already carries the link (the screen shows it straight away)
  assert.equal(res.body.workStatus, "assigned");
  t.wo = res.body.workOrder.id;

  const found = (await call("GET", "/invoices?fulfilment=open", { token: t.counter })).body.invoices;
  assert.equal(found.length, 1);
  assert.equal(found[0].fulfilmentStatus, "pending");
  assert.equal(found[0].workOrderNo, res.body.workOrder.orderNo);
  // typing the invoice number (or part of it) finds it
  assert.equal((await call("GET", `/invoices?fulfilment=open&q=${encodeURIComponent(t.invNo.slice(-4))}`, { token: t.counter })).body.invoices.length, 1);
  assert.equal((await call("GET", "/invoices?fulfilment=open&q=nobody", { token: t.counter })).body.invoices.length, 0);
  assert.equal((await call("GET", "/invoices?fulfilment=ready", { token: t.counter })).body.invoices.length, 0);

  // dashboard + report show it as pending, not as revenue
  const dash = (await call("GET", "/dashboard", { token: t.owner })).body;
  assert.deepEqual([dash.jobWork.pending, dash.jobWork.ready, dash.jobWork.advance], [1, 0, 10000]);
  assert.equal(dash.invoices.monthTotal, 0);
  const rep = (await call("GET", "/reports/sales", { token: t.owner })).body.totals;
  assert.equal(rep.count, 0);
  assert.equal(rep.payable, 0);
  assert.deepEqual([rep.pendingJobWork.count, rep.pendingJobWork.advance], [1, 10000]);
});

test("goldsmith completes → invoice becomes READY and the owner is told to call the customer", async () => {
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "start" } })).status, 200);
  assert.equal((await call("GET", `/invoices/${t.inv}`, { token: t.owner })).body.workStatus, "in_progress");
  assert.equal((await call("GET", `/invoices/${t.inv}`, { token: t.owner })).body.fulfilmentStatus, "pending");

  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "complete", finishedWt: 24.9 } })).status, 200);
  assert.equal((await call("GET", `/invoices/${t.inv}`, { token: t.owner })).body.fulfilmentStatus, "ready");
  const note = (await call("GET", "/notifications", { token: t.owner })).body.items.find((n) => /Ready for pickup/.test(n.title));
  assert.ok(note, "owner gets a 'ready for pickup' notification");
  assert.match(note.title, /Anitha Reddy/);
  assert.match(note.body, /9988776655/);
  assert.match(note.body, new RegExp(t.invNo.replace(/[/]/g, "\\/")));
  assert.equal((await call("GET", "/invoices?fulfilment=ready", { token: t.counter })).body.invoices.length, 1);

  // owner sends it back → the invoice is pending again; goldsmith completes again
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.owner, body: { action: "reopen", note: "Clasp loose" } })).status, 200);
  assert.equal((await call("GET", `/invoices/${t.inv}`, { token: t.owner })).body.fulfilmentStatus, "pending");
  assert.equal((await call("POST", `/work-orders/${t.wo}/status`, { token: t.venkat, body: { action: "complete", finishedWt: 25 } })).status, 200);
  assert.equal((await call("GET", `/invoices/${t.inv}`, { token: t.owner })).body.fulfilmentStatus, "ready");
});

test("receive a payment against the balance: validated, cash-limited, recorded", async () => {
  const pay = (body, token = t.counter) => call("POST", `/invoices/${t.inv}/payments`, { token, body });
  assert.equal((await pay({ mode: "UPI", amount: 0 })).status, 400);
  assert.equal((await pay({ mode: "Bogus", amount: 100 })).status, 400);
  assert.equal((await pay({ mode: "UPI", amount: 99999 })).status, 400);      // more than the balance
  assert.equal((await pay({ mode: "UPI", amount: 500 }, t.venkat)).status, 403);  // goldsmith can't take money
  assert.equal((await pay({ mode: "UPI", amount: 500 }, t.nobill)).status, 403);  // needs the invoice permission
  const ok = await pay({ mode: "Cash", amount: 5000, reference: "Receipt 7" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.summary.paid, 15000);
  assert.equal(ok.body.summary.balance, 25897);
  assert.equal(ok.body.payments.length, 2);
  assert.equal(ok.body.payments[1].byName, "Counter");
});

test("FINAL SETTLEMENT: extra gold changes the bill, the advance carries over, the invoice closes with the same number", async () => {
  const inv = (await call("GET", `/invoices/${t.inv}`, { token: t.counter })).body;
  // the finished piece came out heavier: 27 g instead of 25 g → more fine gold added by the shop
  const items = inv.items.map((i) => ({ ...i, grossWt: 27 }));
  const body = { items, oldGold: inv.oldGold, rates: inv.rates, customer: { pan: "ABCDE1234F" }, notes: "Delivered", reason: "Finished weight 27 g" };

  // balance must still be payable: 54,736 total − 15,000 already received = 39,736 to collect
  assert.equal((await call("POST", `/invoices/${t.inv}/settle`, { token: t.venkat, body })).status, 403);
  assert.equal((await call("POST", `/invoices/${t.inv}/settle`, { token: t.counter, body: { ...body, newPayments: [{ mode: "UPI", amount: 60000 }] } })).status, 400);   // overpaid
  const done = await call("POST", `/invoices/${t.inv}/settle`, { token: t.counter, body: { ...body, newPayments: [{ mode: "UPI", amount: 39736, reference: "UTR 2" }] } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.invoiceNumber, t.invNo);                         // same number
  assert.equal(done.body.fulfilmentStatus, "delivered");
  assert.equal(done.body.summary.addedFineWt, 6.412);                     // 27 g × 0.916 − 18.320 g from the customer
  assert.equal(done.body.summary.payable, 54736);
  assert.equal(done.body.summary.paid, 54736);
  assert.equal(done.body.summary.balance, 0);
  assert.equal(done.body.payments.length, 3);                             // UPI advance + cash + final UPI
  assert.equal(done.body.customer.pan, "ABCDE1234F");
  assert.equal(done.body.customer.name, "Anitha Reddy");                  // name / mobile can't be changed here
  // the previous figures are kept
  assert.equal(done.body.revisions.length, 1);
  assert.equal(done.body.revisions[0].before.summary.payable, 40897);
  assert.equal(done.body.revisions[0].byName, "Counter");
  assert.equal(done.body.revisions[0].reason, "Finished weight 27 g");

  // can't be settled twice; no longer in the pending list; the work order is closed
  assert.equal((await call("POST", `/invoices/${t.inv}/settle`, { token: t.counter, body })).status, 409);
  assert.equal((await call("GET", "/invoices?fulfilment=open", { token: t.counter })).body.invoices.length, 0);
  assert.equal((await call("GET", `/work-orders/${t.wo}`, { token: t.owner })).body.status, "closed");

  // now it is a finished sale: it counts in the dashboard and in the GST report
  const rep = (await call("GET", "/reports/sales", { token: t.owner })).body;
  assert.equal(rep.totals.count, 1);
  assert.equal(rep.totals.payable, 54736);
  assert.equal(rep.totals.pendingJobWork.count, 0);
  assert.equal(rep.byHsn.length, 2);                                       // 7108 fine gold @3% and 9988 job work @5%
  assert.equal((await call("GET", "/dashboard", { token: t.owner })).body.invoices.monthTotal, 54736);
});

test("settlement protects the bill: compliance rules apply and stock pieces stay", async () => {
  const bill = await call("POST", "/invoices", { token: t.owner, body: order({ customer: { name: "Big Order", mobile: "9988776600", address: "x", stateCode: "36" }, payments: [] }) });
  const inv = bill.body;
  const settle = (extra) => call("POST", `/invoices/${inv.id}/settle`, { token: t.owner, body: { items: inv.items, oldGold: inv.oldGold, rates: inv.rates, ...extra } });
  // a bigger piece pushes the bill over ₹2 lakh → PAN becomes mandatory
  const big = inv.items.map((i) => ({ ...i, grossWt: 200 }));
  assert.equal((await settle({ items: big })).status, 400);
  assert.equal((await settle({ items: big, customer: { pan: "ABCDE1234F" } })).status, 200);
  // a plain bill with no work order: "mark ready" by hand, and it can't be done twice
  const manual = await call("POST", "/invoices", { token: t.owner, body: order({ customer: { name: "Manual", mobile: "9988776611", address: "x", stateCode: "36" } }) });
  assert.equal((await call("POST", `/invoices/${manual.body.id}/ready`, { token: t.counter })).status, 200);
  assert.equal((await call("POST", `/invoices/${manual.body.id}/ready`, { token: t.counter })).status, 409);
  assert.equal((await call("GET", `/invoices/${manual.body.id}`, { token: t.owner })).body.fulfilmentStatus, "ready");
  assert.equal((await call("POST", `/invoices/${manual.body.id}/settle`, { token: t.counter, body: { items: [{ description: "x", productId: "not-on-the-bill", grossWt: 5, purity: "22K" }], oldGold: [] } })).status, 400);
});

test("cancelling a pending job-work bill cancels the goldsmith's open work order", async () => {
  const bill = await call("POST", "/invoices", { token: t.owner, body: order({ customer: { name: "Cancel Me", mobile: "9988776622", address: "x", stateCode: "36" }, assignedStaffId: t.staff }) });
  assert.equal((await call("POST", `/invoices/${bill.body.id}/cancel`, { token: t.owner, body: { reason: "Customer changed mind" } })).status, 200);
  assert.equal((await call("GET", `/work-orders/${bill.body.workOrder.id}`, { token: t.owner })).body.status, "cancelled");
  assert.ok((await call("GET", "/notifications", { token: t.venkat })).body.items.some((n) => /Cancelled/.test(n.title) && n.workOrderId === bill.body.workOrder.id));
  assert.equal((await call("GET", "/invoices?fulfilment=open", { token: t.owner })).body.invoices.some((i) => i.id === bill.body.id), false);
  assert.equal((await call("POST", `/invoices/${bill.body.id}/payments`, { token: t.owner, body: { mode: "UPI", amount: 1 } })).status, 409);
});

test("ordinary sales are unaffected: no pending state, payments can still be collected later", async () => {
  const sale = await call("POST", "/invoices", { token: t.owner, body: {
    mode: "sale", rates: RATES, customer: { name: "Walk-in", mobile: "9988776633", address: "x", stateCode: "36" },
    items: [{ description: "Ring", purity: "22K", grossWt: 4, makingType: "fixed", makingValue: 500 }], payments: [{ mode: "UPI", amount: 10000 }]
  } });
  assert.equal(sale.status, 200);
  assert.equal(sale.body.fulfilmentStatus, null);
  assert.equal((await call("POST", `/invoices/${sale.body.id}/ready`, { token: t.owner })).status, 409);
  const rest = await call("POST", `/invoices/${sale.body.id}/payments`, { token: t.owner, body: { mode: "Cash", amount: sale.body.summary.balance } });
  assert.equal(rest.status, 200);
  assert.equal(rest.body.summary.balance, 0);
  assert.equal((await call("POST", `/invoices/${sale.body.id}/payments`, { token: t.owner, body: { mode: "Cash", amount: 1 } })).status, 400); // nothing left to pay
});

test("older job-work bills (made before this feature) still count as finished sales", async () => {
  const legacyRef = db.collection("licenses").doc("L1").collection("invoices").doc("legacy1");
  await legacyRef.set({
    invoiceNumber: "OLD/1", seq: 999, fy: "2026-27", date: todayIST(), status: "active", mode: "job_work", createdBy: "owner", createdByName: "Owner",
    customer: { name: "Old Customer" }, payments: [], items: [], oldGold: [],
    summary: { payable: 1000, paid: 1000, balance: 0, taxable: 970, tax: 30, cgst: 15, sgst: 15, igst: 0, credit: 0, taxLines: [] }
  });
  const rep = (await call("GET", "/reports/sales", { token: t.owner })).body.totals;
  assert.ok(rep.payable >= 54736 + 1000);                                   // the legacy bill is included
  assert.equal((await call("GET", "/invoices?fulfilment=open", { token: t.owner })).body.invoices.some((i) => i.id === "legacy1"), false);
});

// ───────────────────────── Two-phase job work: ORDER first, bill after the work is done ─────────────────────────
const orderBody = (extra = {}) => ({
  customer: { name: "Kiran Kumar", mobile: "9988776644", address: "Hyd", stateCode: "36" },
  description: "Gold bracelet", purity: "22K",
  oldGold: [{ description: "Old chain", grossWt: 11.8, lessWt: 2.3, touch: 91.6 }],   // 9.5 g net → 8.702 g fine
  payments: [{ mode: "UPI", amount: 5000, reference: "UTR 9" }],
  ...extra
});

test("PHASE 1: a job order takes the customer's gold and an advance — an auto job code, no bill, no weights", async () => {
  const res = await call("POST", "/job-orders", { token: t.counter, body: orderBody({ assignedStaffId: t.staff }) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  t.order = res.body;
  assert.equal(res.body.stage, "order");
  assert.equal(res.body.fulfilmentStatus, "pending");
  assert.ok(res.body.invoiceNumber);                                           // a numbered invoice, as the shop wants
  assert.match(res.body.items[0].itemCode, /^JW\d{5}$/);                       // job codes start with J; stock codes with S
  assert.equal(res.body.items[0].description, "Gold bracelet");
  assert.equal(res.body.items[0].purity, "22K");
  assert.equal(res.body.items[0].huid, "");                                    // HUID only after the piece is finished
  assert.equal(res.body.summary.oldGoldNetWt, 9.5);
  assert.equal(res.body.summary.oldGoldFineWt, 8.702);
  assert.equal(res.body.summary.paid, 5000);
  assert.equal(res.body.summary.payable, 0);                                   // no bill amount yet
  assert.equal(res.body.oldGold[0].value, 0);                                  // his gold is never priced
  assert.equal(res.body.payments[0].byName, "Counter");

  // a second order gets the next code, and a stock piece keeps the SS prefix
  const second = await call("POST", "/job-orders", { token: t.counter, body: orderBody({ customer: { name: "Second", mobile: "9988776655" }, description: "Ring" }) });
  assert.equal(Number(second.body.items[0].itemCode.slice(2)), Number(res.body.items[0].itemCode.slice(2)) + 1);
  const stock = await call("POST", "/products", { token: t.owner, body: { description: "Stock ring", purity: "22K", grossWt: 3 } });
  assert.match(stock.body.itemCode, /^SS\d{5}$/);

  // the goldsmith's work order carries the description and the customer's gold weight — no customer or money details
  const wo = (await call("GET", `/work-orders/${res.body.workOrder.id}`, { token: t.venkat })).body;
  assert.match(wo.title, /Gold bracelet/);
  assert.equal(wo.issuedWt, 9.5);
  assert.equal(wo.itemCode, res.body.items[0].itemCode);
  assert.doesNotMatch(JSON.stringify(wo), /Kiran|9988776644/);

  // it is listed as an order, not a sale
  const listed = (await call("GET", "/invoices?fulfilment=open", { token: t.counter })).body.invoices.find((i) => i.id === res.body.id);
  assert.equal(listed.stage, "order");
});

test("a job order is validated: what to make, purity, cash limit, due date", async () => {
  const post = (extra) => call("POST", "/job-orders", { token: t.counter, body: orderBody(extra) });
  assert.equal((await post({ description: "" })).status, 400);
  assert.equal((await post({ purity: "99K" })).status, 400);
  assert.equal((await post({ payments: [{ mode: "Cash", amount: 250000 }] })).status, 400);        // Sec 269ST
  assert.equal((await post({ dueDate: "2020-01-01" })).status, 400);
  assert.equal((await post({ customer: { name: "", mobile: "9988776644" } })).status, 400);
  assert.equal((await post({ oldGold: [{ grossWt: 5, touch: 0 }] })).status, 400);                 // purity of his gold is needed
  assert.equal((await call("POST", "/job-orders", { token: t.venkat, body: orderBody() })).status, 403);   // goldsmith can't take orders
  assert.equal((await post({ oldGold: [], payments: [] })).status, 200);                           // no gold, no advance is fine
});

test("PHASE 2: the goldsmith reports finished weight AND wastage; the owner is told with both", async () => {
  const wo = t.order.workOrder.id;
  await call("POST", `/work-orders/${wo}/status`, { token: t.venkat, body: { action: "start" } });
  assert.equal((await call("POST", `/work-orders/${wo}/status`, { token: t.venkat, body: { action: "complete", finishedWt: 12.4, wastageWt: -1 } })).status, 400);
  assert.equal((await call("POST", `/work-orders/${wo}/status`, { token: t.venkat, body: { action: "complete", finishedWt: 12.4, wastageWt: 0.8, note: "Done" } })).status, 200);
  const inv = (await call("GET", `/invoices/${t.order.id}`, { token: t.owner })).body;
  assert.equal(inv.fulfilmentStatus, "ready");
  assert.equal(inv.workFinishedWt, 12.4);
  assert.equal(inv.workWastageWt, 0.8);
  const note = (await call("GET", "/notifications", { token: t.owner })).body.items.find((n) => /Ready for pickup — Kiran/.test(n.title));
  assert.match(note.body, /wastage 0\.8 g/);
  assert.match(note.body, /finished 12\.4 g/);
});

test("more advance can be added to an order (there is no bill yet to stay under)", async () => {
  const more = await call("POST", `/invoices/${t.order.id}/payments`, { token: t.counter, body: { mode: "Cash", amount: 3000 } });
  assert.equal(more.status, 200, JSON.stringify(more.body));
  assert.equal(more.body.summary.paid, 8000);
  assert.equal(more.body.summary.balance, 0);
  assert.equal((await call("POST", `/invoices/${t.order.id}/payments`, { token: t.counter, body: { mode: "Cash", amount: 250000 } })).status, 400);
});

test("PHASE 2 settlement: finished weight + wastage + HUID + making + stones → the bill; his gold is not charged; advance carried over", async () => {
  const inv = (await call("GET", `/invoices/${t.order.id}`, { token: t.counter })).body;
  const item = { ...inv.items[0], huid: "AB12CD", grossWt: inv.workFinishedWt, stoneWt: 0, wastageGrams: inv.workWastageWt, makingType: "per_gram", makingValue: 300, stoneCharges: 500 };
  const rates = { "24K": 7000, "22K": 6500 };
  // 12.4 g net: fine 11.358 − his 8.702 = 2.656 g added × 7,000 = 18,592 (+3%) ; wastage 0.8 g × 6,500 = 5,200 ; making 3,720 ; stones 500 → labour 9,420 (+5%)
  const done = await call("POST", `/invoices/${t.order.id}/settle`, { token: t.counter, body: { items: [item], oldGold: inv.oldGold, rates, newPayments: [{ mode: "UPI", amount: 21041, reference: "UTR final" }] } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.stage, "final");
  assert.equal(done.body.fulfilmentStatus, "delivered");
  assert.equal(done.body.invoiceNumber, t.order.invoiceNumber);              // same number as the order receipt
  assert.equal(done.body.items[0].huid, "AB12CD");
  assert.equal(done.body.items[0].wastageAmount, 5200);
  assert.equal(done.body.summary.addedFineWt, 2.656);                        // only this gold is charged
  assert.equal(done.body.summary.oldGoldValue, 0);
  assert.equal(done.body.summary.credit, 0);
  assert.equal(done.body.summary.payable, 29041);                            // 18,592 + 557.76 + 9,420 + 471 = 29,040.76
  assert.equal(done.body.summary.paid, 29041);                               // 5,000 + 3,000 advance + 21,041 now
  assert.equal(done.body.summary.balance, 0);
  assert.equal(done.body.payments.length, 3);
  assert.equal(done.body.revisions[0].before.stage, "order");
  assert.equal((await call("GET", `/work-orders/${t.order.workOrder.id}`, { token: t.owner })).body.status, "closed");
});

test("UNRECORDED JOB WORK: Phase 1 shows in active list; Phase 2 settlement deletes invoice and work order from Firebase", async () => {
  // Phase 1: create unrecorded job order
  const orderRes = await call("POST", "/job-orders", { token: t.counter, body: orderBody({ assignedStaffId: t.staff, isSecret: true }) });
  assert.equal(orderRes.status, 200);
  assert.equal(orderRes.body.isSecret, true);
  const secretOrderId = orderRes.body.id;
  const secretWoId = orderRes.body.workOrder.id;

  // Phase 1: record exists and is visible while in progress
  const foundOrder = await call("GET", `/invoices/${secretOrderId}`, { token: t.counter });
  assert.equal(foundOrder.status, 200);
  assert.equal(foundOrder.body.isSecret, true);
  assert.equal(foundOrder.body.fulfilmentStatus, "pending");

  const foundWo = await call("GET", `/work-orders/${secretWoId}`, { token: t.owner });
  assert.equal(foundWo.status, 200);
  assert.equal(foundWo.body.status, "assigned");

  // Phase 2: Final settlement on delivery
  const item = { ...foundOrder.body.items[0], huid: "JW99ZZ", grossWt: 10, stoneWt: 0, wastageGrams: 0.5, makingType: "per_gram", makingValue: 200 };
  const settleRes = await call("POST", `/invoices/${secretOrderId}/settle`, {
    token: t.counter,
    body: { items: [item], oldGold: foundOrder.body.oldGold, rates: { "24K": 7000, "22K": 6500 }, newPayments: [{ mode: "Cash", amount: 1000 }] }
  });
  assert.equal(settleRes.status, 200);
  assert.equal(settleRes.body.isSecret, true);
  assert.equal(settleRes.body.fulfilmentStatus, "delivered");

  // AFTER Phase 2: Invoice MUST NOT SHOW / must be deleted from Firebase
  assert.equal((await call("GET", `/invoices/${secretOrderId}`, { token: t.counter })).status, 404);
  const allInvoices = await call("GET", "/invoices", { token: t.owner });
  assert.ok(!allInvoices.body.invoices.some((i) => i.id === secretOrderId));

  // AFTER Phase 2: Work order MUST NOT SHOW / must be deleted from Firebase
  assert.equal((await call("GET", `/work-orders/${secretWoId}`, { token: t.owner })).status, 404);
});
