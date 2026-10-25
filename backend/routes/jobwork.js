const express = require("express");
const { HttpError, bad, str, number, serialize, docOut } = require("../lib/util");
const { computeInvoice, computeOrder, PURITIES, PAYMENT_MODES, CASH_LIMIT, financialYear, formatInvoiceNumber } = require("../lib/billing");
const { closeWorkAfterDelivery, createWorkOrder, goldsmithUserFor } = require("../lib/work");
const { isoDate, todayIST } = require("../lib/util");
const { readCustomer, readSecretCustomer } = require("./invoices");
const { shopProfile } = require("./auth");

/**
 * 🔨 Job-work invoices: a customer brings gold, a goldsmith makes the piece, the customer pays
 * an advance now and the rest on pickup.
 *
 *   pending ──(goldsmith completes / "Mark ready")──▶ ready ──(Finalize & deliver)──▶ delivered
 *
 * The invoice keeps its number throughout. Final settlement recalculates it from the real
 * finished weights / extra gold and keeps the previous figures in `revisions`.
 */
const OPEN = ["pending", "ready"];

module.exports = function jobworkRoutes(deps) {
  const { db, mw, can } = deps;
  const router = express.Router();
  const invoicesOf = (ctx) => ctx.licenseRef.collection("invoices");
  const seesAll = (ctx) => ctx.role === "super_admin" || can(ctx, "reports");

  /** Open job work may be handled by any billing user (the customer can come back on another day); other bills only by their creator / reports users */
  const canTouch = (ctx, inv) => seesAll(ctx) || inv.createdBy === ctx.userId || OPEN.includes(inv.fulfilmentStatus);

  function ensureUsable(ctx, doc) {
    if (!doc.exists) throw new HttpError(404, "Invoice not found.");
    const inv = doc.data();
    if (!canTouch(ctx, inv)) throw new HttpError(404, "Invoice not found.");
    if (inv.status === "cancelled") throw new HttpError(409, "This invoice was cancelled.");
    if (!inv.summary) throw bad("This invoice was made with an older version of the app and can't be changed here.");
    return inv;
  }

  // ── PHASE 1: a customer brings gold for a new piece ──────────────────────────
  // A numbered, pending invoice with the customer's gold weighed, the advance taken and a job code
  // (JW00001…, different from stock codes SS00001…). No weights, wastage, making, stones or bill yet —
  // those come from the goldsmith and are entered at pickup (settle).
  router.post("/job-orders", mw.auth, mw.perm("invoice"), async (req, res) => {
    const ctx = req.ctx;
    const b = req.body;
    const isSecret = !!b.isSecret;
    const customer = isSecret ? readSecretCustomer(b.customer) : readCustomer(b.customer);
    const description = str(b.description, { required: true, field: "What to make", max: 140 });
    if (!PURITIES[b.purity]) throw bad("Choose the purity.");
    const dueDate = isoDate(b.dueDate, { field: "Due date" });
    if (dueDate && dueDate < todayIST()) throw bad("Due date can't be in the past.");
    const notes = str(b.notes, { max: 1000 });
    const assignedStaffId = str(b.assignedStaffId, { max: 64 });
    if ((b.oldGold || []).length > 20 || (b.payments || []).length > 10) throw bad("Too many lines.");
    const order = computeOrder({ description, purity: b.purity, oldGold: b.oldGold, payments: b.payments });
    const errors = order.issues.filter((i) => i.level === "error");
    if (errors.length) throw bad(errors[0].message, errors);

    const date = todayIST();
    const fy = financialYear(date);
    const invoiceRef = invoicesOf(ctx).doc();
    const invoiceCounter = ctx.licenseRef.collection("counters").doc(`invoice-${fy}`);
    const jobCounter = ctx.licenseRef.collection("counters").doc("job-code");
    const nowIso = new Date().toISOString();

    const created = await db.runTransaction(async (t) => {
      const licDoc = await t.get(ctx.licenseRef);
      const invC = await t.get(invoiceCounter);
      const jobC = await t.get(jobCounter);
      const staffDoc = assignedStaffId ? await t.get(ctx.licenseRef.collection("staff").doc(assignedStaffId)) : null;
      if (staffDoc && !staffDoc.exists) throw bad("Assigned staff member not found.");
      const shop = shopProfile(licDoc.data());
      const seq = ((invC.exists && invC.data().seq) || 0) + 1;
      const jobSeq = ((jobC.exists && jobC.data().seq) || 0) + 1;
      const jobCode = `JW${String(jobSeq).padStart(5, "0")}`;
      const shopState = shop.stateCode || "";
      const custState = customer.stateCode || shopState;
      const invoice = {
        invoiceNumber: formatInvoiceNumber(shop.invoicePrefix, fy, seq), seq, fy, date,
        status: "active", stage: "order", fulfilmentStatus: "pending", mode: "job_work",
        isSecret,
        shop,
        customer: { ...customer, stateCode: custState },
        intraState: !shopState || !custState || shopState === custState,
        rates: {},
        items: [{
          productId: null, itemCode: jobCode, description, hsn: "7113", huid: "", purity: b.purity, pcs: 1,
          grossWt: 0, stoneWt: 0, netWt: 0, wastagePct: 0, wastageGrams: "", wastageWt: 0, effectiveWt: 0, fineWt: 0, rate: 0,
          makingType: "per_gram", makingValue: 0, goldValue: 0, makingAmount: 0, wastageAmount: 0, stoneCharges: 0, lineTotal: 0
        }],
        oldGold: order.oldGold,
        payments: order.payments.map((p) => ({ ...p, at: nowIso, byName: ctx.name })),
        summary: order.summary,
        warnings: [],
        dueDate, notes,
        assignedStaffId: staffDoc ? staffDoc.id : "",
        assignedStaffName: staffDoc ? staffDoc.data().fullName : "",
        createdBy: ctx.userId, createdByName: ctx.name, createdAt: new Date()
      };
      t.set(invoiceCounter, { seq, fy });
      t.set(jobCounter, { seq: jobSeq });
      t.set(invoiceRef, invoice);
      if (customer.mobile) {
        t.set(ctx.licenseRef.collection("customers").doc(customer.mobile), {
          ...customer, stateCode: custState, lastInvoiceAt: new Date(), lastInvoiceNumber: invoice.invoiceNumber
        }, { merge: true });
      }
      return invoice;
    });

    // The goldsmith (if they have a login) gets the work order; best effort, never fails the order
    let workOrder = null;
    if (created.assignedStaffId) {
      try {
        if (await goldsmithUserFor(ctx.licenseRef, created.assignedStaffId)) {
          const s = created.summary;
          const out = await createWorkOrder({
            db, licenseRef: ctx.licenseRef, actor: { userId: ctx.userId, name: ctx.name },
            data: {
              staffId: created.assignedStaffId,
              title: `${description} (${b.purity})`.slice(0, 140),
              details: `Customer's gold received: ${s.oldGoldNetWt} g (${s.oldGoldFineWt} g fine).${notes ? ` ${notes}` : ""}`,
              itemCode: created.items[0].itemCode,
              reference: created.invoiceNumber, invoiceId: invoiceRef.id,
              issuedWt: s.oldGoldNetWt, dueDate,
              isSecret
            }
          });
          workOrder = { id: out.id, orderNo: out.order.orderNo };
          await invoiceRef.update({ workOrderId: out.id, workOrderNo: out.order.orderNo, workStatus: "assigned" });
        }
      } catch (err) {
        console.error("Work order for job order failed:", err.message);
      }
    }
    res.send(serialize({
      id: invoiceRef.id, ...created, workOrder,
      ...(workOrder ? { workOrderId: workOrder.id, workOrderNo: workOrder.orderNo, workStatus: "assigned" } : {})
    }));
  });

  // ── Mark the work ready (when there is no goldsmith login to do it) ─────────
  router.post("/invoices/:id/ready", mw.auth, mw.perm("invoice"), async (req, res) => {
    const ref = invoicesOf(req.ctx).doc(req.params.id);
    await db.runTransaction(async (t) => {
      const inv = ensureUsable(req.ctx, await t.get(ref));
      if (inv.fulfilmentStatus !== "pending") throw new HttpError(409, inv.fulfilmentStatus === "ready" ? "Already marked ready." : "This isn't pending job work.");
      t.update(ref, { fulfilmentStatus: "ready", readyAt: new Date(), readyByName: req.ctx.name });
    });
    res.send({ success: true });
  });

  // ── Receive a payment against the balance (any invoice with money due) ─────
  router.post("/invoices/:id/payments", mw.auth, mw.perm("invoice"), async (req, res) => {
    const mode = PAYMENT_MODES.includes(req.body.mode) ? req.body.mode : null;
    if (!mode) throw bad("Choose a payment mode.");
    const amount = number(req.body.amount, { min: 0, max: 1e9, field: "Amount" });
    if (!(amount > 0)) throw bad("Enter the amount received.");
    const reference = str(req.body.reference, { max: 80 });
    const ref = invoicesOf(req.ctx).doc(req.params.id);
    let out;
    await db.runTransaction(async (t) => {
      const inv = ensureUsable(req.ctx, await t.get(ref));
      const s = inv.summary;
      const payableP = Math.round(s.payable * 100);
      const paidP = Math.round(s.paid * 100);
      const addP = Math.round(amount * 100);
      const isOrder = inv.stage === "order";   // phase 1: no bill yet, so any amount is more advance
      if (!isOrder && payableP <= 0) throw bad("Nothing is due on this invoice.");
      if (!isOrder && paidP + addP > payableP) throw bad(`That is more than the balance due (₹${((payableP - paidP) / 100).toLocaleString("en-IN")}).`);
      const cashSoFar = (inv.payments || []).filter((p) => p.mode === "Cash").reduce((n, p) => n + p.amount, 0);
      if (mode === "Cash" && cashSoFar + amount >= CASH_LIMIT)
        throw bad(`Cash of ₹${CASH_LIMIT.toLocaleString("en-IN")} or more cannot be accepted (Sec 269ST).`);
      const payments = [...(inv.payments || []), { mode, amount: addP / 100, reference, at: new Date().toISOString(), byName: req.ctx.name }];
      const summary = { ...s, paid: (paidP + addP) / 100, balance: isOrder ? 0 : (payableP - paidP - addP) / 100 };
      t.update(ref, { payments, summary });
      out = { payments, summary };
    });
    res.send(serialize(out));
  });

  // ── Final settlement on pickup ───────────────────────────────────────────────
  router.post("/invoices/:id/settle", mw.auth, mw.perm("invoice"), async (req, res) => {
    const b = req.body;
    const ref = invoicesOf(req.ctx).doc(req.params.id);
    const reason = str(b.reason, { max: 300 }) || "Final settlement on delivery";
    let workOrderId = "";
    let finalInvoiceOut = null;

    await db.runTransaction(async (t) => {
      const inv = ensureUsable(req.ctx, await t.get(ref));
      if (inv.mode !== "job_work") throw bad("Only job-work invoices are settled on delivery.");
      if (!OPEN.includes(inv.fulfilmentStatus)) throw new HttpError(409, "This job work was already delivered.");
      workOrderId = inv.workOrderId || "";
      const isSecret = !!inv.isSecret || !!b.isSecret;

      // Items: stock pieces already on the bill must stay; new stock pieces belong on a new invoice
      const items = Array.isArray(b.items) ? b.items : [];
      const original = new Set((inv.items || []).map((i) => i.productId).filter(Boolean));
      const sent = new Set(items.map((i) => i && i.productId).filter(Boolean));
      for (const id of sent) if (!original.has(id)) throw bad("Stock items can't be added at delivery — make a new invoice for them.");
      for (const id of original) if (!sent.has(id)) throw bad("Stock items on the original bill can't be removed here.");

      // Only contact / tax details may be updated; name and mobile stay as billed
      const customer = isSecret
        ? readSecretCustomer({ ...inv.customer, ...b.customer })
        : readCustomer({
            ...inv.customer,
            address: b.customer?.address ?? inv.customer.address,
            stateCode: b.customer?.stateCode ?? inv.customer.stateCode,
            gstin: b.customer?.gstin ?? inv.customer.gstin,
            pan: b.customer?.pan ?? inv.customer.pan
          });
      const rates = b.rates && typeof b.rates === "object" ? b.rates : inv.rates;
      const oldGold = Array.isArray(b.oldGold) ? b.oldGold : inv.oldGold;
      const newPayments = Array.isArray(b.newPayments) ? b.newPayments.slice(0, 10) : [];
      if (items.length > 100 || oldGold.length > 50) throw bad("Too many lines on one invoice.");

      const result = computeInvoice({ mode: "job_work", rates, customer, items, oldGold, payments: [...(inv.payments || []), ...newPayments] }, inv.shop || {});
      const errors = result.issues.filter((i) => i.level === "error" && (!isSecret || i.code !== "PAN_REQUIRED"));
      if (errors.length) throw bad(errors[0].message, errors);

      const now = new Date();
      const oldN = (inv.payments || []).length;
      const payments = result.payments.map((p, i) => (i < oldN ? inv.payments[i] : { ...p, at: now.toISOString(), byName: req.ctx.name }));

      if (isSecret) {
        // PERMANENTLY REMOVE any stock items on this bill from Firebase
        for (const pid of original) {
          t.delete(req.ctx.licenseRef.collection("products").doc(pid));
        }
        // DELETE THE INVOICE RECORD from Firebase so it doesn't show in invoice logs or reports
        t.delete(ref);
        // DELETE THE WORK ORDER RECORD from Firebase so it doesn't show in work order logs
        if (workOrderId) {
          t.delete(req.ctx.licenseRef.collection("workOrders").doc(workOrderId));
        }

        finalInvoiceOut = {
          id: ref.id,
          ...inv,
          customer: { ...customer, stateCode: result.customerStateCode },
          intraState: result.intraState,
          rates: result.rates,
          items: result.items,
          oldGold: result.oldGold,
          payments,
          summary: result.summary,
          warnings: result.issues.filter((i) => i.level === "warning").map((i) => i.message),
          notes: str(b.notes ?? inv.notes, { max: 1000 }),
          stage: "final",
          fulfilmentStatus: "delivered",
          deliveredAt: now,
          deliveredByName: req.ctx.name,
          isSecret: true,
          unrecorded: true
        };
      } else {
        t.update(ref, {
          customer: { ...customer, stateCode: result.customerStateCode },
          intraState: result.intraState,
          rates: result.rates,
          items: result.items,
          oldGold: result.oldGold,
          payments,
          summary: result.summary,
          warnings: result.issues.filter((i) => i.level === "warning").map((i) => i.message),
          notes: str(b.notes ?? inv.notes, { max: 1000 }),
          stage: "final",
          fulfilmentStatus: "delivered",
          deliveredAt: now,
          deliveredByName: req.ctx.name,
          revisions: [...(inv.revisions || []), {
            at: now.toISOString(), byName: req.ctx.name, reason,
            before: { stage: inv.stage || "final", items: inv.items, oldGold: inv.oldGold, rates: inv.rates, summary: inv.summary }
          }]
        });
      }
    });

    if (finalInvoiceOut) {
      res.send(serialize(finalInvoiceOut));
    } else {
      try { await closeWorkAfterDelivery(req.ctx.licenseRef, workOrderId, req.ctx.name); } catch (e) { console.error("close work order failed:", e.message); }
      res.send(docOut(await ref.get()));
    }
  });

  return router;
};
