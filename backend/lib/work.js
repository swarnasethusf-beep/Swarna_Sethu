const { HttpError } = require("./util");
const { notify } = require("./notify");

/** The goldsmith login (user) linked to a staff record, or null */
async function goldsmithUserFor(licenseRef, staffId) {
  if (!staffId) return null;
  const snap = await licenseRef.collection("users").where("staffId", "==", staffId).get();
  const doc = snap.docs.find((d) => d.data().role === "goldsmith");
  return doc ? { id: doc.id, ...doc.data() } : null;
}

/**
 * Create a work order (numbered WO-0001…) and notify the goldsmith.
 * data: { staffId, title, details, itemCode, reference, invoiceId, issuedWt, dueDate, priority }
 * actor: { userId, name }
 */
async function createWorkOrder({ db, licenseRef, actor, data }) {
  const staffDoc = await licenseRef.collection("staff").doc(data.staffId).get();
  if (!staffDoc.exists) throw new HttpError(400, "Choose a goldsmith from the staff list.");
  const gs = await goldsmithUserFor(licenseRef, data.staffId);
  const ref = licenseRef.collection("workOrders").doc();
  const counterRef = licenseRef.collection("counters").doc("work-order");

  const order = await db.runTransaction(async (t) => {
    const counter = await t.get(counterRef);
    const seq = ((counter.exists && counter.data().seq) || 0) + 1;
    const now = new Date();
    const doc = {
      orderNo: `WO-${String(seq).padStart(4, "0")}`,
      seq,
      title: data.title,
      details: data.details || "",
      itemCode: data.itemCode || "",
      reference: data.reference || "",
      invoiceId: data.invoiceId || "",
      staffId: data.staffId,
      staffName: staffDoc.data().fullName,
      assignedUserId: gs ? gs.id : "",
      issuedWt: data.issuedWt || 0,
      finishedWt: null,
      dueDate: data.dueDate || "",
      priority: data.priority === "urgent" ? "urgent" : "normal",
      status: "assigned",
      isSecret: !!data.isSecret,
      history: [{ status: "assigned", byName: actor.name, at: now.toISOString(), note: "" }],
      createdBy: actor.userId,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now
    };
    t.set(counterRef, { seq });
    t.set(ref, doc);
    return doc;
  });

  if (gs) {
    await notify(licenseRef, [gs.id], {
      type: "work_assigned",
      title: `${order.priority === "urgent" ? "🔥 URGENT · " : ""}New work: ${order.title}`,
      body: `${order.orderNo}${order.issuedWt ? ` · gold issued ${order.issuedWt} g` : ""}${order.dueDate ? ` · due ${order.dueDate}` : ""}`,
      workOrderId: ref.id
    });
  }
  return { id: ref.id, order, notified: !!gs };
}

module.exports = { createWorkOrder, goldsmithUserFor };

/**
 * Keep the invoice in step with its work order:
 *  goldsmith completes → pending job work becomes "ready" (call the customer);
 *  owner sends it back → ready becomes "pending" again.
 * Returns the invoice (for the "call the customer" notification), or null.
 */
async function syncInvoiceWithWork(licenseRef, invoiceId, workStatus, extra = {}) {
  if (!invoiceId) return null;
  const ref = licenseRef.collection("invoices").doc(invoiceId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const inv = doc.data();
  const update = { workStatus };
  if (workStatus === "completed") {
    update.workFinishedWt = extra.finishedWt ?? null;     // what the goldsmith reported — pre-fills the final bill
    update.workWastageWt = extra.wastageWt ?? null;
    if (inv.fulfilmentStatus === "pending") { update.fulfilmentStatus = "ready"; update.readyAt = new Date(); }
  }
  if (workStatus === "in_progress" && inv.fulfilmentStatus === "ready") { update.fulfilmentStatus = "pending"; update.readyAt = null; }
  await ref.update(update);
  return { id: doc.id, ...inv, ...update };
}

/** A cancelled invoice cancels its open work order and tells the goldsmith */
async function cancelWorkForInvoice(licenseRef, workOrderId, byName, reason) {
  if (!workOrderId) return;
  const ref = licenseRef.collection("workOrders").doc(workOrderId);
  const doc = await ref.get();
  if (!doc.exists) return;
  const o = doc.data();
  if (!["assigned", "in_progress"].includes(o.status)) return;
  await ref.update({
    status: "cancelled", updatedAt: new Date(),
    history: [...(o.history || []), { status: "cancelled", byName, at: new Date().toISOString(), note: `Invoice cancelled — ${reason}` }]
  });
  if (o.assignedUserId) await notify(licenseRef, [o.assignedUserId], { type: "work_cancelled", title: "✖ Cancelled", body: `${o.orderNo} · ${o.title} — the customer's invoice was cancelled`, workOrderId });
}

/** Delivering the piece closes a finished work order */
async function closeWorkAfterDelivery(licenseRef, workOrderId, byName) {
  if (!workOrderId) return;
  const ref = licenseRef.collection("workOrders").doc(workOrderId);
  const doc = await ref.get();
  if (!doc.exists || doc.data().status !== "completed") return;
  await ref.update({
    status: "closed", updatedAt: new Date(),
    history: [...(doc.data().history || []), { status: "closed", byName, at: new Date().toISOString(), note: "Delivered to the customer" }]
  });
}

module.exports.syncInvoiceWithWork = syncInvoiceWithWork;
module.exports.cancelWorkForInvoice = cancelWorkForInvoice;
module.exports.closeWorkAfterDelivery = closeWorkAfterDelivery;
