const express = require("express");
const { HttpError, bad, str, mobile10, isoDate, todayIST, docOut, serialize } = require("../lib/util");
const { computeInvoice, financialYear, formatInvoiceNumber, STATES } = require("../lib/billing");
const { shopProfile } = require("./auth");

const MAX_RANGE_DAYS = 400;

function readCustomer(c = {}) {
  const stateCode = str(c.stateCode, { max: 2 });
  if (stateCode && !STATES.some((s) => s.code === stateCode)) throw bad("Select a valid customer state.");
  return {
    name: str(c.name, { required: true, field: "Customer name", max: 120 }),
    mobile: mobile10(c.mobile, { field: "Customer mobile" }),
    address: str(c.address, { max: 400 }),
    stateCode,
    gstin: str(c.gstin, { max: 15 }).toUpperCase(),
    pan: str(c.pan, { max: 10 }).toUpperCase()
  };
}

function dateRange(query) {
  const to = isoDate(query.to, { field: "To date" }) || todayIST();
  const from = isoDate(query.from, { field: "From date" }) ||
    todayIST(new Date(Date.parse(to) - 29 * 86400000));
  if (from > to) throw bad("From date must be before To date.");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_RANGE_DAYS) throw bad(`Date range can be at most ${MAX_RANGE_DAYS} days.`);
  return { from, to };
}

const round2 = (n) => Math.round(n * 100) / 100;
const sortNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.seq || 0) - (a.seq || 0);

module.exports = function invoiceRoutes(deps) {
  const { db, mw, can } = deps;
  const router = express.Router();
  const invoicesOf = (ctx) => ctx.licenseRef.collection("invoices");
  const seesAll = (ctx) => ctx.role === "super_admin" || can(ctx, "reports");

  async function queryRange(ctx, from, to) {
    const snap = await invoicesOf(ctx).where("date", ">=", from).where("date", "<=", to).orderBy("date", "desc").get();
    return snap.docs.map(docOut);
  }

  // ── Create ──────────────────────────────────────────────────────────────
  router.post("/invoices", mw.auth, mw.perm("invoice"), async (req, res) => {
    const ctx = req.ctx;
    const b = req.body;
    const customer = readCustomer(b.customer);
    const assignedStaffId = str(b.assignedStaffId, { max: 64 });
    const notes = str(b.notes, { max: 1000 });
    if ((b.items || []).length > 100 || (b.oldGold || []).length > 50 || (b.payments || []).length > 20)
      throw bad("Too many lines on one invoice.");

    const date = todayIST(); // invoices are dated today so serial numbers stay chronological
    const fy = financialYear(date);
    const invoiceRef = invoicesOf(ctx).doc();
    const counterRef = ctx.licenseRef.collection("counters").doc(`invoice-${fy}`);

    const created = await db.runTransaction(async (t) => {
      // Reads first (Firestore transactions require reads before writes)
      const licDoc = await t.get(ctx.licenseRef);
      const shop = shopProfile(licDoc.data());
      const result = computeInvoice({ ...b, customer }, shop);
      const errors = result.issues.filter((i) => i.level === "error");
      if (errors.length) throw bad(errors[0].message, errors);

      const counterDoc = await t.get(counterRef);
      const staffDoc = assignedStaffId ? await t.get(ctx.licenseRef.collection("staff").doc(assignedStaffId)) : null;
      const productIds = [...new Set(result.items.map((i) => i.productId).filter(Boolean).map(String))];
      if (productIds.length !== result.items.filter((i) => i.productId).length) throw bad("The same stock item is on the bill twice.");
      const productDocs = [];
      for (const id of productIds) productDocs.push(await t.get(ctx.licenseRef.collection("products").doc(id)));

      for (const p of productDocs) {
        if (!p.exists) throw bad("An item on this bill no longer exists in inventory.");
        if ((p.data().status || "in_stock") !== "in_stock") throw new HttpError(409, `Item ${p.data().itemCode} is already sold.`);
      }
      if (staffDoc && !staffDoc.exists) throw bad("Assigned staff member not found.");

      const seq = ((counterDoc.exists && counterDoc.data().seq) || 0) + 1;
      const invoice = {
        invoiceNumber: formatInvoiceNumber(shop.invoicePrefix, fy, seq),
        seq,
        fy,
        date,
        status: "active",
        mode: result.mode,
        shop,
        customer: { ...customer, stateCode: result.customerStateCode },
        intraState: result.intraState,
        rates: result.rates,
        items: result.items,
        oldGold: result.oldGold,
        payments: result.payments,
        summary: result.summary,
        warnings: result.issues.filter((i) => i.level === "warning").map((i) => i.message),
        assignedStaffId: staffDoc ? staffDoc.id : "",
        assignedStaffName: staffDoc ? staffDoc.data().fullName : "",
        notes,
        createdBy: ctx.userId,
        createdByName: ctx.name,
        createdAt: new Date()
      };

      t.set(counterRef, { seq, fy });
      t.set(invoiceRef, invoice);
      for (const p of productDocs)
        t.update(p.ref, { status: "sold", soldInvoiceId: invoiceRef.id, soldInvoiceNumber: invoice.invoiceNumber, soldAt: new Date() });
      if (customer.mobile) {
        t.set(ctx.licenseRef.collection("customers").doc(customer.mobile), {
          ...customer,
          stateCode: result.customerStateCode,
          lastInvoiceAt: new Date(),
          lastInvoiceNumber: invoice.invoiceNumber
        }, { merge: true });
      }
      return invoice;
    });

    res.send(serialize({ id: invoiceRef.id, ...created }));
  });

  // ── List / view ─────────────────────────────────────────────────────────
  router.get("/invoices", mw.auth, mw.perm("invoice", "reports"), async (req, res) => {
    const { from, to } = dateRange(req.query);
    const q = str(req.query.q, { max: 60 }).toLowerCase();
    let list = await queryRange(req.ctx, from, to);
    if (!seesAll(req.ctx)) list = list.filter((i) => i.createdBy === req.ctx.userId);
    if (q) list = list.filter((i) =>
      `${i.invoiceNumber} ${i.customer?.name || i.customerName || ""} ${i.customer?.mobile || i.customerContact || ""}`.toLowerCase().includes(q));
    list.sort(sortNewest);
    res.send({
      from, to,
      invoices: list.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        date: i.date,
        mode: i.mode || "sale",
        status: i.status || "active",
        customerName: i.customer?.name || i.customerName || "",
        customerMobile: i.customer?.mobile || i.customerContact || "",
        payable: i.summary?.payable ?? i.totals?.grand ?? 0,
        balance: i.summary?.balance ?? 0,
        paymentModes: [...new Set((i.payments || []).map((p) => p.mode))].join(", ") || i.paymentMode || "",
        createdByName: i.createdByName || ""
      }))
    });
  });

  async function readInvoice(ctx, id) {
    const doc = await invoicesOf(ctx).doc(id).get();
    if (!doc.exists) throw new HttpError(404, "Invoice not found.");
    const inv = doc.data();
    if (!seesAll(ctx) && inv.createdBy !== ctx.userId) throw new HttpError(404, "Invoice not found.");
    return doc;
  }

  router.get("/invoices/:id", mw.auth, mw.perm("invoice", "reports"), async (req, res) => {
    res.send(docOut(await readInvoice(req.ctx, req.params.id)));
  });

  // ── Cancel (number is kept — GST requires no gaps) ──────────────────────
  router.post("/invoices/:id/cancel", mw.auth, mw.superAdmin, async (req, res) => {
    const reason = str(req.body.reason, { required: true, field: "Cancellation reason", max: 300 });
    const ref = invoicesOf(req.ctx).doc(req.params.id);
    await db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) throw new HttpError(404, "Invoice not found.");
      const inv = doc.data();
      if (inv.status === "cancelled") throw bad("Invoice is already cancelled.");
      const productRefs = (inv.items || []).filter((i) => i.productId)
        .map((i) => req.ctx.licenseRef.collection("products").doc(i.productId));
      const productDocs = [];
      for (const r of productRefs) productDocs.push(await t.get(r));
      t.update(ref, { status: "cancelled", cancelReason: reason, cancelledAt: new Date(), cancelledByName: req.ctx.name });
      for (const p of productDocs) {
        if (p.exists && p.data().soldInvoiceId === ref.id)
          t.update(p.ref, { status: "in_stock", soldInvoiceId: null, soldInvoiceNumber: null, soldAt: null });
      }
    });
    res.send({ success: true });
  });

  // ── Reports ─────────────────────────────────────────────────────────────
  router.get("/reports/sales", mw.auth, mw.perm("reports"), async (req, res) => {
    const { from, to } = dateRange(req.query);
    const all = await queryRange(req.ctx, from, to);
    const active = all.filter((i) => (i.status || "active") === "active" && i.summary);
    const add = (list, f) => round2(list.reduce((s, i) => s + (f(i) || 0), 0));

    const byDay = {};
    const byPayment = {};
    const byHsn = {};
    for (const i of active) {
      const d = (byDay[i.date] = byDay[i.date] || { date: i.date, count: 0, taxable: 0, tax: 0, payable: 0 });
      d.count += 1;
      d.taxable = round2(d.taxable + i.summary.taxable);
      d.tax = round2(d.tax + i.summary.tax);
      d.payable = round2(d.payable + i.summary.payable);
      for (const p of i.payments || []) byPayment[p.mode] = round2((byPayment[p.mode] || 0) + p.amount);
      for (const t of i.summary.taxLines || []) {
        const h = (byHsn[`${t.hsn}@${t.ratePct}`] = byHsn[`${t.hsn}@${t.ratePct}`] || { hsn: t.hsn, ratePct: t.ratePct, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
        for (const k of ["taxable", "cgst", "sgst", "igst"]) h[k] = round2(h[k] + t[k]);
      }
    }

    res.send({
      from, to,
      totals: {
        count: active.length,
        cancelled: all.length - active.length,
        sales: active.filter((i) => i.mode === "sale").length,
        jobWork: active.filter((i) => i.mode === "job_work").length,
        taxable: add(active, (i) => i.summary.taxable),
        cgst: add(active, (i) => i.summary.cgst),
        sgst: add(active, (i) => i.summary.sgst),
        igst: add(active, (i) => i.summary.igst),
        tax: add(active, (i) => i.summary.tax),
        credit: add(active, (i) => i.summary.credit),
        payable: add(active, (i) => i.summary.payable),
        paid: add(active, (i) => i.summary.paid),
        balance: add(active, (i) => i.summary.balance)
      },
      byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
      byPayment,
      byHsn: Object.values(byHsn),
      invoices: all.sort(sortNewest).map((i) => ({
        id: i.id, invoiceNumber: i.invoiceNumber, date: i.date, status: i.status || "active", mode: i.mode || "sale",
        customerName: i.customer?.name || i.customerName || "", customerGstin: i.customer?.gstin || "",
        taxable: i.summary?.taxable ?? 0, cgst: i.summary?.cgst ?? 0, sgst: i.summary?.sgst ?? 0, igst: i.summary?.igst ?? 0,
        credit: i.summary?.credit ?? 0, payable: i.summary?.payable ?? i.totals?.grand ?? 0
      }))
    });
  });

  return router;
};
