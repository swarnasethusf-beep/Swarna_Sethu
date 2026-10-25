const express = require("express");
const { HttpError, bad, str, number, docOut } = require("../lib/util");
const { PURITIES, MAKING_TYPES, HUID_RE } = require("../lib/billing");

/**
 * 📦 Inventory — each product is one tagged piece. Pieces are marked "sold"
 * when billed and return to stock if the invoice is cancelled.
 */
function readProduct(b) {
  const itemCode = str(b.itemCode, { required: true, field: "Item code", max: 30 }).toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(itemCode)) throw bad("Item code may only contain letters, digits and '-'.");
  const purity = PURITIES[b.purity] ? b.purity : "22K";
  const huid = str(b.huid, { max: 6 }).toUpperCase();
  if (huid && !HUID_RE.test(huid)) throw bad("HUID must be 6 letters/digits.");
  const grossWt = number(b.grossWt, { min: 0.001, max: 100000, field: "Gross weight" });
  const stoneWt = number(b.stoneWt, { min: 0, max: grossWt, field: "Stone weight" });
  return {
    itemCode,
    description: str(b.description, { required: true, field: "Description" }),
    purity,
    hsn: str(b.hsn, { max: 8 }) || "7113",
    huid,
    pcs: Math.max(1, Math.round(number(b.pcs, { min: 0, max: 1000, field: "Pieces" }) || 1)),
    grossWt,
    stoneWt,
    netWt: Math.round((grossWt - stoneWt) * 1000) / 1000,
    wastagePct: number(b.wastagePct, { min: 0, max: 100, field: "Wastage %" }),
    makingType: MAKING_TYPES[b.makingType] ? b.makingType : "per_gram",
    makingValue: number(b.makingValue, { min: 0, max: 1e7, field: "Making charge" }),
    stoneCharges: number(b.stoneCharges, { min: 0, max: 1e8, field: "Stone charges" })
  };
}

module.exports = function inventoryRoutes(deps) {
  const { db, mw } = deps;
  const router = express.Router();
  const products = (ctx) => ctx.licenseRef.collection("products");
  const ownOnly = (ctx) => ctx.role === "admin"; // admins see the stock they registered

  router.get("/products", mw.auth, mw.perm("inventory"), async (req, res) => {
    const status = ["in_stock", "sold"].includes(req.query.status) ? req.query.status : null;
    const snap = status ? await products(req.ctx).where("status", "==", status).get() : await products(req.ctx).get();
    let list = snap.docs.map(docOut);
    if (ownOnly(req.ctx)) list = list.filter((p) => p.createdBy === req.ctx.userId);
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.send(list);
  });

  // Billing lookup — any in-stock piece in the shop, by item code
  router.get("/products/lookup/:code", mw.auth, mw.perm("invoice"), async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    const snap = await products(req.ctx).where("itemCode", "==", code).get();
    const doc = snap.docs.find((d) => (d.data().status || "in_stock") === "in_stock");
    if (!doc) throw new HttpError(404, snap.empty ? `No item with code ${code}.` : `Item ${code} is already sold.`);
    res.send(docOut(doc));
  });

  router.post("/products", mw.auth, mw.perm("inventory"), async (req, res) => {
    const data = readProduct(req.body);
    const col = products(req.ctx);
    const ref = col.doc();
    await db.runTransaction(async (t) => {
      const clash = await t.get(col.where("itemCode", "==", data.itemCode));
      if (!clash.empty) throw bad(`Item code ${data.itemCode} is already used.`);
      t.set(ref, {
        ...data,
        status: "in_stock",
        createdBy: req.ctx.userId,
        createdByName: req.ctx.name,
        createdAt: new Date()
      });
    });
    res.send({ id: ref.id });
  });

  async function editableRef(ctx, id) {
    const ref = products(ctx).doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpError(404, "Item not found.");
    const p = doc.data();
    if (ownOnly(ctx) && p.createdBy !== ctx.userId) throw new HttpError(403, "You can only change items you registered.");
    if ((p.status || "in_stock") !== "in_stock") throw bad("Sold items can't be changed.");
    return { ref, data: p };
  }

  router.put("/products/:id", mw.auth, mw.perm("inventory"), async (req, res) => {
    const { ref, data: current } = await editableRef(req.ctx, req.params.id);
    const data = readProduct(req.body);
    if (data.itemCode !== current.itemCode) {
      const clash = await products(req.ctx).where("itemCode", "==", data.itemCode).get();
      if (clash.docs.some((d) => d.id !== ref.id)) throw bad(`Item code ${data.itemCode} is already used.`);
    }
    await ref.update({ ...data, updatedAt: new Date() });
    res.send({ success: true });
  });

  router.delete("/products/:id", mw.auth, mw.perm("inventory"), async (req, res) => {
    const { ref } = await editableRef(req.ctx, req.params.id);
    await ref.delete();
    res.send({ success: true });
  });

  return router;
};
