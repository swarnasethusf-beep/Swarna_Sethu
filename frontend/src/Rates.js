import React, { useState, useEffect } from "react";
import api, { errMsg } from "./api";
import { PURITIES } from "./shared/billing";
import { inr, displayDate, todayLocal } from "./format";

const toForm = (r) => Object.fromEntries(Object.keys(PURITIES).map((k) => [k, r?.[k] || ""]));
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

/**
 * 🪙 Today's Rates — selling rates per gram. New invoices start from these.
 * The provider publishes a market rate for every shop; the shop can change it for itself.
 * Whichever was saved last applies (server: lib/rates.js).
 */
function Rates() {
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState(toForm(null));
  const [market, setMarket] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  const show = (data) => { setCurrent(data); setForm(toForm(data)); };

  useEffect(() => {
    api.get("/rates").then(({ data }) => show(data)).catch((err) => setMsg({ text: errMsg(err), type: "error" }));
  }, []);

  const deriveFrom24 = () => {
    const g24 = parseFloat(form["24K"]);
    if (!g24) return;
    const next = { ...form };
    for (const k of ["22K", "18K", "14K"]) next[k] = Math.round((g24 * PURITIES[k].fineness) / PURITIES["24K"].fineness);
    setForm(next);
  };

  const act = async (fn, okText) => {
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      await fn();
      if (okText) setMsg({ text: okText, type: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // Reads the market rate the provider published (stored in Firebase)
  const fetchLive = () => act(async () => {
    const { data } = await api.get("/rates/market");
    if (!data.available) setMsg({ text: data.message, type: "warn" });
    setMarket(data.available ? data : null);
  });

  const save = (e) => {
    e.preventDefault();
    act(async () => show((await api.put("/rates", form)).data), "✅ Your shop's rates are saved. New invoices will use them.");
  };

  const useMarket = () => {
    if (!window.confirm("Stop using your own rates and follow the provider's market rate?")) return;
    act(async () => show((await api.delete("/rates")).data), "✅ Now following the market rate.");
  };

  const stale = current?.date && current.date !== todayLocal();
  const fromMarket = current?.source === "market";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Today's Rates</h1>
          <p>
            {!current?.date
              ? "No rates saved yet"
              : fromMarket
                ? `Using the market rate published ${when(current.updatedAt) || displayDate(current.date)}`
                : `Using your shop's own rate — set ${when(current.updatedAt) || displayDate(current.date)} by ${current.updatedByName || "—"}`}
            {stale && " — please update for today"}
          </p>
        </div>
        {current?.date && <span className={`pill ${fromMarket ? "blue" : "gold"}`}>{fromMarket ? "🌐 Market rate" : "🏪 Shop rate"}</span>}
      </div>

      <div className="two-col">
        <form className="card section" onSubmit={save}>
          <h3>Selling rate per gram (₹)</h3>
          {Object.entries(PURITIES).map(([k, p]) => (
            <label key={k} className="field inline-field">
              <span>{p.label}{(k === "24K" || k === "22K") && " *"}</span>
              <input type="number" min="0" step="0.01" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required={k === "24K" || k === "22K"} />
            </label>
          ))}
          <p className="hint">
            Saving here sets your shop's own rate. It stays until the provider publishes a newer market rate, or you switch back.
            The 24K rate also values old gold (by fine weight) and job-work gold settlement.
          </p>
          <div className="btn-group">
            <button type="button" className="btn btn-secondary" onClick={deriveFrom24}>Derive 22K/18K/14K from 24K</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>💾 Save my rates</button>
            {current?.source === "shop" && <button type="button" className="btn btn-secondary" disabled={busy} onClick={useMarket}>↩️ Use market rate</button>}
          </div>
          {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        </form>

        <div className="card section">
          <h3>Market rate</h3>
          <p className="hint">The day's gold rate published by your software provider for every shop.</p>
          <button className="btn btn-secondary" onClick={fetchLive} disabled={busy}>🔄 Fetch live rate</button>
          {market && (
            <div style={{ marginTop: 16 }}>
              {Object.keys(PURITIES).filter((k) => market[k]).map((k) => (
                <div key={k} className="sum-row"><span>{k}</span><span>{inr(market[k])}</span></div>
              ))}
              <p className="hint">Published {when(market.updatedAt)}</p>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setForm(toForm(market))}>Copy into my rates</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Rates;
