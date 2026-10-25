const express = require("express");
const { docOut } = require("../lib/util");

/** 🔔 Each user's own notifications (any role). The apps poll /notifications every ~20 s. */
module.exports = function notificationRoutes(deps) {
  const { mw } = deps;
  const router = express.Router();
  const mine = (ctx) => ctx.licenseRef.collection("users").doc(ctx.userId).collection("notifications");

  router.get("/notifications", mw.auth, async (req, res) => {
    const snap = await mine(req.ctx).orderBy("createdAt", "desc").limit(60).get();
    const items = snap.docs.map(docOut);
    res.send({ unread: items.filter((n) => !n.read).length, items });
  });

  router.post("/notifications/read", mw.auth, async (req, res) => {
    const col = mine(req.ctx);
    const ids = req.body.all
      ? (await col.where("read", "==", false).get()).docs.map((d) => d.id)
      : (Array.isArray(req.body.ids) ? req.body.ids.slice(0, 100).map(String) : []);
    await Promise.all(ids.map(async (id) => {
      const ref = col.doc(id);
      if ((await ref.get()).exists) await ref.update({ read: true });
    }));
    res.send({ success: true, marked: ids.length });
  });

  return router;
};
