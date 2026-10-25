/**
 * 🔔 In-app notifications. Stored under licenses/{id}/users/{uid}/notifications so each
 * user's list is a single-collection read (no composite index needed).
 */

/** @param {string[]} userIds  @param {{type,title,body,workOrderId?}} n */
async function notify(licenseRef, userIds, n) {
  const ids = [...new Set(userIds.filter(Boolean))];
  await Promise.all(ids.map((uid) =>
    licenseRef.collection("users").doc(uid).collection("notifications").add({
      type: n.type,
      title: String(n.title || "").slice(0, 140),
      body: String(n.body || "").slice(0, 400),
      workOrderId: n.workOrderId || null,
      read: false,
      createdAt: new Date()
    })
  ));
  return ids.length;
}

/** The owner(s) of the shop — they hear about every work order outcome */
async function ownerIds(licenseRef) {
  const snap = await licenseRef.collection("users").where("role", "==", "super_admin").get();
  return snap.docs.map((d) => d.id);
}

module.exports = { notify, ownerIds };
