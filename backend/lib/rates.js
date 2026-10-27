const { PURITIES } = require("./billing");
const { bad, number } = require("./util");

/**
 * 🪙 Gold rates (₹ per gram).
 *  • Market rate — published by the software provider from the admin portal (Firestore `platform/goldRate`),
 *    one value for every licensed shop. Each day's last value is kept in `goldRateHistory/{date}`.
 *  • Shop rate   — a shop's own override (`licenses/{id}.rates`).
 * A shop bills with whichever of the two was saved last, so a newly published market rate reaches
 * every shop, and any shop can still change it for itself.
 */
const marketRateRef = (db) => db.collection("platform").doc("goldRate");
const rateHistory = (db) => db.collection("goldRateHistory");

/** Every purity's rate from a request body; 24K and 22K are required */
function readRates(body = {}) {
  const rates = {};
  for (const k of Object.keys(PURITIES)) rates[k] = number(body[k], { min: 0, max: 1e6, field: `${k} rate` });
  if (!rates["24K"] || !rates["22K"]) throw bad("24K and 22K rates are required.");
  return rates;
}

/** Lower purities in proportion to their fineness */
function deriveFrom24k(g24) {
  const r = (k) => Math.round(((g24 * PURITIES[k].fineness) / PURITIES["24K"].fineness) * 100) / 100;
  return Object.fromEntries(Object.keys(PURITIES).map((k) => [k, r(k)]));
}

const millis = (v) => (!v ? 0 : typeof v.toMillis === "function" ? v.toMillis() : new Date(v).getTime() || 0);

/** The rates a shop bills with, tagged `source: "shop" | "market"` (null when neither exists) */
function effectiveRates(shopRates, marketRates) {
  if (shopRates && (!marketRates || millis(shopRates.updatedAt) >= millis(marketRates.updatedAt))) return { ...shopRates, source: "shop" };
  return marketRates ? { ...marketRates, source: "market" } : null;
}

async function loadMarketRates(db) {
  const doc = await marketRateRef(db).get();
  return doc.exists ? doc.data() : null;
}

module.exports = { marketRateRef, rateHistory, readRates, deriveFrom24k, effectiveRates, loadMarketRates };
