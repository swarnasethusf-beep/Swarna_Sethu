import React, { useState, useEffect } from "react";
import api, { errMsg } from "./api";
import { PURITIES } from "./shared/billing";
import { inr, displayDate, todayLocal } from "./format";

/**
 * 🪙 Today's Rates — the shop's selling rates per gram. New invoices start from these.
 */
function Rates() {
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({ "24K": "", "22K": "", "18K": "", "14K": "" });
  const [live, setLive] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/rates").then(({ data }) => {
      setCurrent(data);
      setForm({ "24K": data["24K"] || "", "22K": data["22K"] || "", "18K": data["18K"] || "", "14K": data["14K"] || "" });
    }).catch((err) => setMsg({ text: errMsg(err), type: "error" }));
  }, []);

  const deriveFrom24 = () => {
    const g24 = parseFloat(form["24K"]);
    if (!g24) return;
    const next = { ...form };
    for (const k of ["22K", "18K", "14K"]) next[k] = Math.round((g24 * PURITIES[k].fineness) / PURITIES["24K"].fineness);
    setForm(next);
  };

  const fetchLive = async () => {
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      const { data } = await api.get("/rates/live");
      if (!data.available) setMsg({ text: data.message, type: "error" });
      setLive(data.available ? data : null);
    } catch (err) {
      setMsg({ text: errMsg(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      const { data } = await api.put("/rates", form);
      setCurrent(data);
      setMsg({ text: "✅ Rates saved. New invoices will use them.", type: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err, "Failed to save rates."), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const stale = current && current.date !== todayLocal();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Today's Rates</h1>
          <p>
            {current?.date
              ? `Last updated ${displayDate(current.date)} by ${current.updatedByName || "—"}`
              : "No rates saved yet"}
            {stale && " — please update for today"}
          </p>
        </div>
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
          <p className="hint">The 24K rate also values old gold (by fine weight) and job-work gold settlement.</p>
          <div className="btn-group">
            <button type="button" className="btn btn-secondary" onClick={deriveFrom24}>Derive 22K/18K/14K from 24K</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>💾 Save rates</button>
          </div>
          {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        </form>

        <div className="card section">
          <h3>Live market reference</h3>
          <p className="hint">International spot price converted to INR. It excludes import duty, GST and margin — use it as a reference, not as your selling rate.</p>
          <button className="btn btn-secondary" onClick={fetchLive} disabled={busy}>🔄 Fetch live rate</button>
          {live && (
            <div style={{ marginTop: 16 }}>
              {Object.keys(PURITIES).map((k) => (
                <div key={k} className="sum-row"><span>{k}</span><span>{inr(live[k])}</span></div>
              ))}
              <p className="hint">{live.source} · {new Date(live.fetchedAt).toLocaleTimeString()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Rates;
