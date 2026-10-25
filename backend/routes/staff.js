const express = require("express");
const { HttpError, str, mobile10, isoDate, docOut } = require("../lib/util");

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
  const { mw } = deps;
  const router = express.Router();
  const staff = (ctx) => ctx.licenseRef.collection("staff");

  router.get("/staff", mw.auth, mw.perm("staff"), async (req, res) => {
    let list = (await staff(req.ctx).get()).docs.map(docOut);
    if (req.ctx.role === "admin") list = list.filter((s) => s.createdBy === req.ctx.userId);
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.send(list);
  });

  // Names only — for the "assign goldsmith" dropdown on invoices
  router.get("/staff/options", mw.auth, mw.perm("invoice"), async (req, res) => {
    const list = (await staff(req.ctx).get()).docs.map((d) => {
      const s = d.data();
      return { id: d.id, fullName: s.fullName, designation: s.designation };
    });
    list.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    res.send(list);
  });

  router.post("/staff", mw.auth, mw.perm("staff"), async (req, res) => {
    const ref = await staff(req.ctx).add({
      ...readStaff(req.body),
      createdBy: req.ctx.userId,
      createdByName: req.ctx.name,
      createdAt: new Date()
    });
    res.send({ id: ref.id });
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
    await ref.delete();
    res.send({ success: true });
  });

  return router;
};
