const express = require("express");
const { HttpError, bad, str, number, isoDate, todayIST, docOut } = require("../lib/util");
const { createWorkOrder, syncInvoiceWithWork } = require("../lib/work");
const { notify, ownerIds } = require("../lib/notify");

/**
 * 🔨 Work orders — gold work handed to a goldsmith and tracked to completion.
 *
 *   assigned ──start──▶ in_progress ──complete──▶ completed ──close──▶ closed
 *       │                    ▲   └────────────────────┘ reopen (sent back for rework)
 *       └──── cancel (office) ─────▶ cancelled
 *
 * Goldsmiths act only on their own orders; office users need the "workorders" permission.
 * Every step notifies the other side.
 */
const STATUS_LABEL = {
  assigned: "Assigned", in_progress: "In progress", completed: "Completed — awaiting check", closed: "Closed", cancelled: "Cancelled"
};

module.exports = function workRoutes(deps) {
  const { db, mw, can } = deps;
  const router = express.Router();
  const orders = (ctx) => ctx.licenseRef.collection("workOrders");
  const isGoldsmith = (ctx) => ctx.role === "goldsmith";
  const office = (ctx) => can(ctx, "workorders");
  const mustBeInvolved = (req, res, next) => {
    if (isGoldsmith(req.ctx) || office(req.ctx)) return next();
    throw new HttpError(403, "You don't have access to work orders.");
  };

  async function load(ctx, id) {
    const doc = await orders(ctx).doc(String(id)).get();
    if (!doc.exists) throw new HttpError(404, "Work order not found.");
    if (isGoldsmith(ctx) && doc.data().assignedUserId !== ctx.userId) throw new HttpError(404, "Work order not found.");
    return doc;
  }

  // ── Create (office) ─────────────────────────────────────────────────────
  router.post("/work-orders", mw.auth, mw.perm("workorders"), async (req, res) => {
    const b = req.body;
    const dueDate = isoDate(b.dueDate, { field: "Due date" });
    const data = {
      staffId: str(b.staffId, { required: true, field: "Goldsmith", max: 64 }),
      title: str(b.title, { required: true, field: "Work description", max: 140 }),
      details: str(b.details, { max: 1000 }),
      itemCode: str(b.itemCode, { max: 30 }).toUpperCase(),
      reference: str(b.reference, { max: 60 }),
      issuedWt: number(b.issuedWt, { min: 0, max: 100000, field: "Gold issued" }),
      dueDate,
      priority: b.priority === "urgent" ? "urgent" : "normal"
    };
    if (dueDate && dueDate < todayIST()) throw bad("Due date can't be in the past.");
    const out = await createWorkOrder({ db, licenseRef: req.ctx.licenseRef, actor: { userId: req.ctx.userId, name: req.ctx.name }, data });
    res.send({ id: out.id, orderNo: out.order.orderNo, notified: out.notified });
  });

  // ── List ────────────────────────────────────────────────────────────────
  router.get("/work-orders", mw.auth, mustBeInvolved, async (req, res) => {
    const ctx = req.ctx;
    const col = orders(ctx);
    const snap = isGoldsmith(ctx) ? await col.where("assignedUserId", "==", ctx.userId).get() : await col.get();
    let list = snap.docs.map(docOut);
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    list = list.slice(0, 300);
    const today = todayIST();
    const overdue = (o) => o.dueDate && o.dueDate < today && ["assigned", "in_progress"].includes(o.status);
    const counts = { assigned: 0, in_progress: 0, completed: 0, closed: 0, cancelled: 0, overdue: 0 };
    for (const o of list) { counts[o.status] = (counts[o.status] || 0) + 1; if (overdue(o)) counts.overdue += 1; }
    const status = String(req.query.status || "");
    const shown = status === "overdue" ? list.filter(overdue) : status ? list.filter((o) => o.status === status) : list;
    res.send({ counts, orders: shown.map((o) => ({ ...o, overdue: !!overdue(o) })) });
  });

  router.get("/work-orders/:id", mw.auth, mustBeInvolved, async (req, res) => {
    res.send(docOut(await load(req.ctx, req.params.id)));
  });

  // ── Status changes ──────────────────────────────────────────────────────
  router.post("/work-orders/:id/status", mw.auth, mustBeInvolved, async (req, res) => {
    const ctx = req.ctx;
    const action = String(req.body.action || "");
    const note = str(req.body.note, { max: 500 });
    const doc = await load(ctx, req.params.id);
    const o = doc.data();

    const rule = {
      // goldsmith actions
      start:    { who: "goldsmith", from: ["assigned"], to: "in_progress" },
      complete: { who: "goldsmith", from: ["assigned", "in_progress"], to: "completed" },
      // office actions
      close:    { who: "office", from: ["completed"], to: "closed" },
      reopen:   { who: "office", from: ["completed", "closed"], to: "in_progress", needsNote: true },
      cancel:   { who: "office", from: ["assigned", "in_progress"], to: "cancelled" }
    }[action];
    if (!rule) throw bad("Unknown action.");
    if (rule.who === "goldsmith" ? !isGoldsmith(ctx) : !office(ctx)) throw new HttpError(403, "You can't do that on this work order.");
    if (!rule.from.includes(o.status)) throw new HttpError(409, `This work order is already "${STATUS_LABEL[o.status]}".`);
    if (rule.needsNote && !note) throw bad("Please write a short note about what needs fixing.");

    const update = { status: rule.to, updatedAt: new Date() };
    let finishedWt = o.finishedWt;
    let wastageWt = o.wastageWt ?? null;
    if (action === "complete") {
      finishedWt = req.body.finishedWt === "" || req.body.finishedWt == null
        ? null
        : number(req.body.finishedWt, { min: 0, max: 100000, field: "Finished weight" });
      update.finishedWt = finishedWt;
      wastageWt = req.body.wastageWt === "" || req.body.wastageWt == null
        ? null
        : number(req.body.wastageWt, { min: 0, max: 100000, field: "Wastage" });
      update.wastageWt = wastageWt;
      update.completedAt = new Date();
    }
    const entry = { status: rule.to, byName: ctx.name, at: new Date().toISOString(), note };
    if (action === "complete" && finishedWt != null) entry.finishedWt = finishedWt;
    if (action === "complete" && wastageWt != null) entry.wastageWt = wastageWt;
    update.history = [...(o.history || []), entry];
    await doc.ref.update(update);

    // Keep the customer's invoice in step (completed → "ready for pickup")
    let inv = null;
    if (o.invoiceId) {
      try { inv = await syncInvoiceWithWork(ctx.licenseRef, o.invoiceId, rule.to, { finishedWt, wastageWt }); } catch (e) { console.error("invoice sync failed:", e.message); }
    }

    // Tell the other side
    const label = `${o.orderNo} · ${o.title}`;
    if (rule.who === "goldsmith") {
      const to = [o.createdBy, ...(await ownerIds(ctx.licenseRef))].filter((id) => id !== ctx.userId);
      const diff = action === "complete"
        ? `${finishedWt != null && o.issuedWt ? ` · issued ${o.issuedWt} g → finished ${finishedWt} g` : finishedWt != null ? ` · finished ${finishedWt} g` : ""}${wastageWt != null ? ` · wastage ${wastageWt} g` : ""}`
        : "";
      await notify(ctx.licenseRef, to, {
        type: `work_${rule.to}`,
        title: action === "start" ? `▶ ${ctx.name} started work`
          : inv?.customer?.name ? `📞 Ready for pickup — ${inv.customer.name}` : `✅ ${ctx.name} completed work`,
        body: `${label}${diff}${note ? ` — "${note}"` : ""}${action === "complete" && inv ? ` · Call ${inv.customer?.name || "the customer"}${inv.customer?.mobile ? ` on ${inv.customer.mobile}` : ""} — invoice ${inv.invoiceNumber}` : ""}`,
        workOrderId: doc.id
      });
    } else if (o.assignedUserId) {
      const text = { close: "✔ Verified and closed", reopen: "↩ Sent back for rework", cancel: "✖ Cancelled" }[action];
      await notify(ctx.licenseRef, [o.assignedUserId], {
        type: `work_${rule.to}`, title: text, body: `${label}${note ? ` — "${note}"` : ""}`, workOrderId: doc.id
      });
    }
    res.send({ success: true, status: rule.to });
  });

  return router;
};
