const express = require("express");
const bcrypt = require("bcrypt");
const { HttpError, bad, str, mobile10, isoDate, docOut } = require("../lib/util");
const { validatePassword, SALT_ROUNDS } = require("./auth");

const TEXT_FIELDS = {
  referredBy: 100, designation: 100, department: 100, fullName: 120, address: 400, emailId: 120,
  emergencyContactPerson: 120, bloodGroup: 4, documentType: 60, documentNo: 60, remark: 1000
};

function readStaff(b) {
  const out = {};
  for (const [k, max] of Object.entries(TEXT_FIELDS)) out[k] = str(b[k], { max, field: k });
  for (const k of ["fullName", "designation", "department", "address"])
    if (!out[k]) throw new HttpError(400, `${k === "fullName" ? "Full name" : k[0].toUpperCase() + k.slice(1)} is required.`);
  out.gender = ["Male", "Female", "Other"].includes(b.gender) ? b.gender : "Male";
  out.mobileNo = mobile10(b.mobileNo, { required: true });
  out.emergencyContactNo = mobile10(b.emergencyContactNo, { field: "Emergency contact number" });
  out.joiningDate = isoDate(b.joiningDate, { field: "Joining date" });
  out.dob = isoDate(b.dob, { field: "Date of birth" });
  out.anniversaryDate = isoDate(b.anniversaryDate, { field: "Anniversary date" });
  out.communicationSms = !!b.communicationSms;
  out.communicationEmail = !!b.communicationEmail;
  out.salesCommission = !!b.salesCommission;
  return out;
}

module.exports = function staffRoutes(deps) {
  const { mw, forgetUser } = deps;
  const router = express.Router();
  const staff = (ctx) => ctx.licenseRef.collection("staff");
  const usersOf = (ctx) => ctx.licenseRef.collection("users");

  /** staffId → { id, username } for every staff member who has a goldsmith login */
  async function loginsByStaff(ctx) {
    const snap = await usersOf(ctx).where("role", "==", "goldsmith").get();
    return Object.fromEntries(snap.docs.map((d) => [d.data().staffId, { id: d.id, username: d.data().username }]));
  }

  /** Checks a username/password pair (throws 400 with a clear message) — nothing is written */
  async function checkNewLogin(ctx, username, password) {
    const u = str(username, { required: true, field: "Username", max: 60 });
    if (!/^[A-Za-z0-9._@-]{3,60}$/.test(u)) throw bad("Username must be 3–60 characters: letters, digits, . _ @ -");
    const pw = validatePassword(password);
    if (!(await usersOf(ctx).where("username", "==", u).limit(1).get()).empty) throw bad("Username already exists.");
    return { username: u, password: pw };
  }

  async function addLogin(ctx, staffId, staffData, { username, password }) {
    return usersOf(ctx).add({
      name: staffData.fullName, username, mobile: staffData.mobileNo || "",
      password: await bcrypt.hash(password, SALT_ROUNDS),
      role: "goldsmith", staffId, permissions: {},
      createdBy: ctx.userId, createdAt: new Date()
    });
  }

  router.get("/staff", mw.auth, mw.perm("staff"), async (req, res) => {
    const logins = await loginsByStaff(req.ctx);
    let list = (await staff(req.ctx).get()).docs.map(docOut).map((s) => ({ ...s, hasLogin: !!logins[s.id], loginUsername: logins[s.id]?.username || "" }));
    if (req.ctx.role === "admin") list = list.filter((s) => s.createdBy === req.ctx.userId);
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.send(list);
  });

  // Names only — for the "assign goldsmith" dropdown on invoices
  router.get("/staff/options", mw.auth, mw.perm("invoice", "workorders"), async (req, res) => {
    const logins = await loginsByStaff(req.ctx);
    const list = (await staff(req.ctx).get()).docs.map((d) => {
      const s = d.data();
      return { id: d.id, fullName: s.fullName, designation: s.designation, hasLogin: !!logins[d.id] };
    });
    list.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    res.send(list);
  });

  // Creating a staff member can also create their app login (username + password) in the same step
  router.post("/staff", mw.auth, mw.perm("staff"), async (req, res) => {
    const data = readStaff(req.body);
    const wantsLogin = !!(String(req.body.loginUsername || "").trim() || req.body.loginPassword);
    if (wantsLogin && req.ctx.role !== "super_admin") throw new HttpError(403, "Only the shop owner can create staff logins.");
    const login = wantsLogin ? await checkNewLogin(req.ctx, req.body.loginUsername, req.body.loginPassword) : null; // validate first: no half-created records
    const ref = await staff(req.ctx).add({
      ...data,
      createdBy: req.ctx.userId,
      createdByName: req.ctx.name,
      createdAt: new Date()
    });
    if (login) await addLogin(req.ctx, ref.id, data, login);
    res.send({ id: ref.id, loginUsername: login ? login.username : "" });
  });

  router.put("/staff/:id", mw.auth, mw.perm("staff"), async (req, res) => {
    const ref = staff(req.ctx).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpError(404, "Staff member not found.");
    if (req.ctx.role === "admin" && doc.data().createdBy !== req.ctx.userId) throw new HttpError(403, "You can only edit staff you created.");
    await ref.update({ ...readStaff(req.body), updatedAt: new Date() });
    res.send({ success: true });
  });

  router.delete("/staff/:id", mw.auth, mw.perm("staff"), async (req, res) => {
    const ref = staff(req.ctx).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpError(404, "Staff member not found.");
    if (req.ctx.role === "admin" && doc.data().createdBy !== req.ctx.userId) throw new HttpError(403, "You can only remove staff you created.");
    const login = (await loginsByStaff(req.ctx))[ref.id];
    if (login) { await usersOf(req.ctx).doc(login.id).delete(); forgetUser(req.ctx.licenseDocId, login.id); }
    await ref.delete();
    res.send({ success: true });
  });

  // ── Goldsmith login for a staff member (owner only) ────────────────────────
  router.post("/staff/:id/login", mw.auth, mw.superAdmin, async (req, res) => {
    const sdoc = await staff(req.ctx).doc(req.params.id).get();
    if (!sdoc.exists) throw new HttpError(404, "Staff member not found.");
    if ((await loginsByStaff(req.ctx))[sdoc.id]) throw bad("This staff member already has a login.");
    const login = await checkNewLogin(req.ctx, req.body.username, req.body.password);
    const ref = await addLogin(req.ctx, sdoc.id, sdoc.data(), login);
    res.send({ id: ref.id, username: login.username });
  });

  router.post("/staff/:id/login/password", mw.auth, mw.superAdmin, async (req, res) => {
    const login = (await loginsByStaff(req.ctx))[req.params.id];
    if (!login) throw new HttpError(404, "This staff member has no login.");
    const ref = usersOf(req.ctx).doc(login.id);
    const tokenVersion = ((await ref.get()).data().tokenVersion || 0) + 1; // signs the goldsmith out everywhere
    await ref.update({ password: await bcrypt.hash(validatePassword(req.body.password), SALT_ROUNDS), tokenVersion });
    forgetUser(req.ctx.licenseDocId, login.id);
    res.send({ success: true });
  });

  router.delete("/staff/:id/login", mw.auth, mw.superAdmin, async (req, res) => {
    const login = (await loginsByStaff(req.ctx))[req.params.id];
    if (!login) throw new HttpError(404, "This staff member has no login.");
    await usersOf(req.ctx).doc(login.id).delete();
    forgetUser(req.ctx.licenseDocId, login.id);
    res.send({ success: true });
  });

  return router;
};
