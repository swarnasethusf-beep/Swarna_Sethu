const express = require("express");
const bcrypt = require("bcrypt");
const { HttpError, bad, str, number, mobile10, todayIST, docOut, serialize } = require("../lib/util");
const { PURITIES, STATES, GSTIN_RE } = require("../lib/billing");
const { shopProfile, validatePassword, SALT_ROUNDS } = require("./auth");

const MODULES = ["invoice", "inventory", "staff", "reports"];
const LIVE_RATE_CACHE_MS = 5 * 60 * 1000;

module.exports = function shopRoutes(deps) {
  const { db, mw, can, forgetUser, forgetLicense } = deps;
  const router = express.Router();

  // ── Settings: shop profile (printed on invoices) + display settings ─────
  router.get("/settings", mw.auth, async (req, res) => {
    const lic = (await req.ctx.licenseRef.get()).data();
    res.send({
      shop: shopProfile(lic),
      displaySettings: { invoice: false, dashboard: false, inventory: false, staff: false, ...(lic.displaySettings || {}) }
    });
  });

  router.put("/settings", mw.auth, mw.superAdmin, async (req, res) => {
    const s = req.body.shop || {};
    const gstin = str(s.gstin, { max: 15 }).toUpperCase();
    if (gstin && !GSTIN_RE.test(gstin)) throw bad("GSTIN format is invalid (e.g. 36ABCDE1234F1Z5).");
    const stateCode = str(s.stateCode, { max: 2 });
    if (stateCode && !STATES.some((st) => st.code === stateCode)) throw bad("Select a valid state.");
    if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) throw bad("GSTIN state code does not match the selected state.");
    const invoicePrefix = str(s.invoicePrefix, { max: 10 }).toUpperCase() || "INV";
    if (!/^[A-Z0-9-]+$/.test(invoicePrefix)) throw bad("Invoice prefix may only contain letters, digits and '-'.");

    const shop = {
      name: str(s.name, { required: true, field: "Shop name", max: 120 }),
      address: str(s.address, { max: 400 }),
      phone: str(s.phone, { max: 40 }),
      email: str(s.email, { max: 120 }),
      gstin,
      stateCode,
      invoicePrefix,
      terms: str(s.terms, { max: 1000 })
    };
    const d = req.body.displaySettings || {};
    const displaySettings = {
      invoice: !!d.invoice, dashboard: !!d.dashboard, inventory: !!d.inventory, staff: !!d.staff
    };
    await req.ctx.licenseRef.update({ shop, displaySettings });
    forgetLicense(req.ctx.licenseDocId);
    res.send({ shop, displaySettings });
  });

  // ── Daily metal rates (₹ per gram) ──────────────────────────────────────
  router.get("/rates", mw.auth, async (req, res) => {
    const lic = (await req.ctx.licenseRef.get()).data();
    res.send(serialize(lic.rates || {}));
  });

  router.put("/rates", mw.auth, mw.perm("invoice"), async (req, res) => {
    const rates = {};
    for (const k of Object.keys(PURITIES)) rates[k] = number(req.body[k], { min: 0, max: 1e6, field: `${k} rate` });
    if (!rates["24K"] || !rates["22K"]) throw bad("24K and 22K rates are required.");
    const saved = { ...rates, date: todayIST(), updatedAt: new Date(), updatedByName: req.ctx.name };
    await req.ctx.licenseRef.update({ rates: saved });
    res.send(serialize(saved));
  });

  let liveCache = null;
  router.get("/rates/live", mw.auth, async (req, res) => {
    if (!deps.fetchGold24k) return res.send({ available: false, message: "Live rates are not configured (set GOLDAPI_KEY)." });
    if (!liveCache || liveCache.expires < Date.now()) {
      try {
        const g24 = await deps.fetchGold24k();
        const r = (f) => Math.round(g24 * f * 100) / 100;
        liveCache = {
          expires: Date.now() + LIVE_RATE_CACHE_MS,
          data: { available: true, source: "goldapi.io (spot, excl. duties/margin)", fetchedAt: new Date().toISOString(),
            "24K": r(1), "22K": r(PURITIES["22K"].fineness / PURITIES["24K"].fineness), "18K": r(PURITIES["18K"].fineness / PURITIES["24K"].fineness), "14K": r(PURITIES["14K"].fineness / PURITIES["24K"].fineness) }
        };
      } catch (err) {
        console.error("Live gold rate error:", err.message);
        return res.send({ available: false, message: "Could not fetch live rates right now. Enter today's rates manually." });
      }
    }
    res.send(liveCache.data);
  });

  // ── Users (Super Admin manages Admins) ──────────────────────────────────
  router.get("/users", mw.auth, mw.superAdmin, async (req, res) => {
    const snap = await req.ctx.licenseRef.collection("users").get();
    const users = snap.docs.map((doc) => {
      const u = doc.data();
      return serialize({ id: doc.id, name: u.name, username: u.username, role: u.role, mobile: u.mobile || "", permissions: u.permissions || {}, createdAt: u.createdAt });
    });
    users.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    res.send(users);
  });

  function readPermissions(p = {}) {
    return Object.fromEntries(MODULES.map((m) => [m, !!p[m]]));
  }

  router.post("/users", mw.auth, mw.superAdmin, async (req, res) => {
    const name = str(req.body.name, { required: true, field: "Full name" });
    const username = str(req.body.username, { required: true, field: "Username", max: 60 });
    if (!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) throw bad("Username must be 3–60 characters: letters, digits, . _ @ -");
    const password = validatePassword(req.body.password);
    const mobile = mobile10(req.body.mobile, { required: true });
    const users = req.ctx.licenseRef.collection("users");
    if (!(await users.where("username", "==", username).limit(1).get()).empty) throw bad("Username already exists.");
    const ref = await users.add({
      name, username, mobile,
      password: await bcrypt.hash(password, SALT_ROUNDS),
      role: "admin",
      permissions: readPermissions(req.body.permissions),
      createdAt: new Date()
    });
    res.send({ id: ref.id });
  });

  async function adminUserRef(ctx, id) {
    const ref = ctx.licenseRef.collection("users").doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpError(404, "User not found.");
    if (doc.data().role !== "admin") throw bad("The Super Admin account can't be changed here.");
    return ref;
  }

  router.patch("/users/:id", mw.auth, mw.superAdmin, async (req, res) => {
    const ref = await adminUserRef(req.ctx, req.params.id);
    await ref.update({ permissions: readPermissions(req.body.permissions) });
    forgetUser(req.ctx.licenseDocId, req.params.id);
    res.send({ success: true });
  });

  router.delete("/users/:id", mw.auth, mw.superAdmin, async (req, res) => {
    const ref = await adminUserRef(req.ctx, req.params.id);
    await ref.delete();
    forgetUser(req.ctx.licenseDocId, req.params.id);
    res.send({ success: true });
  });

  // ── Admin mobile-change requests (approved by this shop's Super Admin) ──
  const requests = db.collection("mobileChangeRequests");

  router.get("/requests", mw.auth, mw.superAdmin, async (req, res) => {
    const snap = await requests.where("licenseDocId", "==", req.ctx.licenseDocId).where("scope", "==", "license").get();
    res.send(snap.docs.map(docOut).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  });

  router.post("/requests/:id/decision", mw.auth, mw.superAdmin, async (req, res) => {
    const action = req.body.action;
    if (!["approved", "rejected"].includes(action)) throw bad("action must be 'approved' or 'rejected'.");
    const ref = requests.doc(req.params.id);
    const doc = await ref.get();
    const r = doc.exists ? doc.data() : null;
    if (!r || r.licenseDocId !== req.ctx.licenseDocId || r.scope !== "license") throw new HttpError(404, "Request not found.");
    if (r.status !== "pending") throw bad(`Request was already ${r.status}.`);
    if (action === "approved") {
      await req.ctx.licenseRef.collection("users").doc(r.requestedBy).update({ mobile: r.newMobile });
    }
    await ref.update({ status: action, resolvedAt: new Date(), resolvedBy: req.ctx.userId });
    res.send({ success: true });
  });

  // ── Dashboard ───────────────────────────────────────────────────────────
  router.get("/dashboard", mw.auth, async (req, res) => {
    const ctx = req.ctx;
    const today = todayIST();
    const monthStart = today.slice(0, 8) + "01";
    const out = { today, rates: null, invoices: null, stock: null };

    const lic = (await ctx.licenseRef.get()).data();
    out.rates = serialize(lic.rates || null);

    if (can(ctx, "invoice") || can(ctx, "reports")) {
      const snap = await ctx.licenseRef.collection("invoices").where("date", ">=", monthStart).get();
      let invs = snap.docs.map(docOut).filter((i) => i.status !== "cancelled");
      if (!can(ctx, "reports")) invs = invs.filter((i) => i.createdBy === ctx.userId); // own figures only
      const total = (list) => Math.round(list.reduce((s, i) => s + (i.summary?.payable || 0), 0) * 100) / 100;
      const todays = invs.filter((i) => i.date === today);
      out.invoices = {
        scope: can(ctx, "reports") ? "shop" : "mine",
        todayCount: todays.length,
        todayTotal: total(todays),
        monthCount: invs.length,
        monthTotal: total(invs),
        balanceDue: Math.round(invs.reduce((s, i) => s + Math.max(0, i.summary?.balance || 0), 0) * 100) / 100,
        recent: invs
          .sort((a, b) => (b.date + String(b.seq).padStart(8, "0")).localeCompare(a.date + String(a.seq).padStart(8, "0")))
          .slice(0, 6)
          .map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, date: i.date, customerName: i.customer?.name, payable: i.summary?.payable, mode: i.mode }))
      };
    }
    if (can(ctx, "inventory") || can(ctx, "invoice")) {
      const snap = await ctx.licenseRef.collection("products").where("status", "==", "in_stock").get();
      const items = snap.docs.map((d) => d.data());
      out.stock = {
        count: items.length,
        netWt: Math.round(items.reduce((s, p) => s + (p.netWt || 0), 0) * 1000) / 1000
      };
    }
    res.send(out);
  });

  // ── Customers (built automatically from invoices) ───────────────────────
  router.get("/customers", mw.auth, mw.perm("invoice", "reports"), async (req, res) => {
    const q = str(req.query.q, { max: 60 }).toLowerCase();
    const snap = await req.ctx.licenseRef.collection("customers").get();
    let list = snap.docs.map(docOut);
    if (q) list = list.filter((c) => `${c.name} ${c.mobile} ${c.gstin || ""}`.toLowerCase().includes(q));
    list.sort((a, b) => String(b.lastInvoiceAt || "").localeCompare(String(a.lastInvoiceAt || "")));
    res.send(list.slice(0, 500));
  });

  router.get("/customers/:mobile", mw.auth, mw.perm("invoice"), async (req, res) => {
    const mobile = mobile10(req.params.mobile, { required: true });
    const doc = await req.ctx.licenseRef.collection("customers").doc(mobile).get();
    if (!doc.exists) throw new HttpError(404, "Customer not found.");
    res.send(docOut(doc));
  });

  return router;
};
