import React, { useState } from "react";
import api, { errMsg } from "./api";
import { PURITIES, PAYMENT_MODES, STATES } from "./shared/billing";
import { inr, grams } from "./format";

let seq = 0;
const key = () => `o${++seq}`;
const blankGold = () => ({ key: key(), description: "Old gold", grossWt: "", lessWt: "", touch: "91.6" });
const blankPay = () => ({ key: key(), mode: "Cash", amount: "", reference: "" });
const strip = ({ key: _k, ...rest }) => rest;
const n = (v) => parseFloat(v) || 0;
const goldNet = (r) => Math.max(0, n(r.grossWt) - n(r.lessWt));
const goldFine = (r) => (goldNet(r) * Math.min(100, Math.max(0, n(r.touch)))) / 100;

/**
 * 🔨 Job work ORDER (phase 1). The customer brings gold for a new piece.
 *   • one card: what to make (description + purity) together with the gold received
 *   • the job code is generated on save (JW00001…); there is no stock code — the piece is new
 *   • the advance has its own card; there is no bill amount yet
 * Finished weight and wastage come from the goldsmith; HUID, making and stones are entered at
 * pickup ("Finalize & deliver"), which prepares the bill.
 */
function JobOrderForm({ shop, staffOptions, onSaved, isSecret = false }) {
  const [customer, setCustomer] = useState({ name: "", mobile: "", address: "", stateCode: shop.stateCode || "", pan: "" });
  const [assignedStaffId, setAssignedStaffId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [purity, setPurity] = useState("22K");
  const [gold, setGold] = useState([blankGold()]);
  const [payments, setPayments] = useState([blankPay()]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalNet = gold.reduce((s, r) => s + goldNet(r), 0);
  const totalFine = gold.reduce((s, r) => s + goldFine(r), 0);
  const advance = payments.reduce((s, p) => s + n(p.amount), 0);
  const chosen = staffOptions.find((st) => st.id === assignedStaffId);

  const setRow = (setter) => (k, field, value) => setter((rows) => rows.map((r) => (r.key === k ? { ...r, [field]: value } : r)));
  const setG = setRow(setGold);
  const setP = setRow(setPayments);
  const c = (field) => ({ value: customer[field], onChange: (e) => setCustomer({ ...customer, [field]: e.target.value }) });

  const lookupCustomer = async () => {
    if (!/^[6-9]\d{9}$/.test(customer.mobile)) return;
    try {
      const { data } = await api.get(`/customers/${customer.mobile}`);
      setCustomer((cu) => ({ ...cu, name: cu.name || data.name, address: cu.address || data.address || "", stateCode: data.stateCode || cu.stateCode, pan: cu.pan || data.pan || "" }));
    } catch { /* new customer */ }
  };

  const save = async () => {
    setSaving(true); setError("");
    try {
      const customerPayload = { ...customer, name: customer.name.trim() || (isSecret ? "Cash Customer" : "") };
      const { data } = await api.post("/job-orders", {
        customer: customerPayload, assignedStaffId, dueDate, description, purity, notes,
        oldGold: gold.filter((r) => n(r.grossWt) > 0).map(strip),
        payments: payments.filter((p) => n(p.amount) > 0).map(strip),
        isSecret: !!isSecret
      });
      onSaved(data.id, data);
    } catch (err) {
      setError(errMsg(err, "Could not save the job order."));
    } finally {
      setSaving(false);
    }
  };

  const ready = description.trim() && (isSecret || customer.name.trim());

  return (
    <div>
      {isSecret && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <strong>🔒 Confidential Job Order (Phase 1):</strong> This order is tracked while in workshop. Once finalized &amp; delivered in Phase 2, this invoice and work order will be <strong>permanently removed</strong> from database logs.
        </div>
      )}
      <div className="card section">
        <h3>Customer</h3>
        <div className="form-grid cols-3">
          <label className="field">Mobile
            <input {...c("mobile")} inputMode="numeric" placeholder="10 digits — finds returning customers"
              onChange={(e) => setCustomer({ ...customer, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} onBlur={lookupCustomer} />
          </label>
          <label className="field">Name {isSecret ? "(Optional)" : "*"}<input {...c("name")} placeholder={isSecret ? "Cash Customer" : ""} /></label>
          <label className="field">State
            <select {...c("stateCode")}>
              <option value="">— Same as shop —</option>
              {STATES.map((st) => <option key={st.code} value={st.code}>{st.code} · {st.name}</option>)}
            </select>
          </label>
          <label className="field span-2">Address<input {...c("address")} /></label>
          <label className="field">PAN (if known)<input {...c("pan")} maxLength={10} onChange={(e) => setCustomer({ ...customer, pan: e.target.value.toUpperCase() })} /></label>
        </div>
      </div>

      {/* One card: the piece to make + the customer's gold */}
      <div className="card section">
        <div className="job-head">
          <h3 style={{ margin: 0 }}>Job order — new piece (not in stock)</h3>
          <span className="pill gold" title="Generated when you save. Stock items use SS…, job work uses JW…">Job code: auto (JW…)</span>
        </div>
        <div className="form-grid cols-3" style={{ marginTop: 14 }}>
          <label className="field span-2">What is to be made? *
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Gold bracelet, long haram, ladies ring" />
          </label>
          <label className="field">Purity wanted by the customer
            <select value={purity} onChange={(e) => setPurity(e.target.value)}>
              {Object.entries(PURITIES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </label>
          <label className="field">Assign goldsmith
            <select value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)}>
              <option value="">— None —</option>
              {staffOptions.map((st) => <option key={st.id} value={st.id}>{st.fullName} ({st.designation}){st.hasLogin ? " 🔔" : ""}</option>)}
            </select>
            {chosen?.hasLogin && <span className="sub">🔔 A work order is sent to them when you save.</span>}
          </label>
          <label className="field">Promised by (optional)<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>

        <h4 className="sub-title">Customer's gold received <span className="sub">— weighed only, never charged</span></h4>
        <div className="table-scroll">
          <table className="edit-table">
            <thead><tr><th>#</th><th>Description</th><th>Gross g</th><th>Less (stone/dust) g</th><th>Net g</th><th>Touch / purity %</th><th>Fine g</th><th></th></tr></thead>
            <tbody>
              {gold.map((r, i) => (
                <tr key={r.key}>
                  <td className="num-cell">{i + 1}</td>
                  <td><input className="w-desc" value={r.description} onChange={(e) => setG(r.key, "description", e.target.value)} /></td>
                  <td><input className="w-num" type="number" min="0" step="0.001" value={r.grossWt} onChange={(e) => setG(r.key, "grossWt", e.target.value)} /></td>
                  <td><input className="w-num" type="number" min="0" step="0.001" value={r.lessWt} onChange={(e) => setG(r.key, "lessWt", e.target.value)} /></td>
                  <td className="calc">{goldNet(r).toFixed(3)}</td>
                  <td><input className="w-sm" type="number" min="0" max="100" step="0.01" value={r.touch} onChange={(e) => setG(r.key, "touch", e.target.value)} /></td>
                  <td className="calc">{goldFine(r).toFixed(3)}</td>
                  <td>{gold.length > 1 && <button className="icon-btn" title="Remove" onClick={() => setGold((rows) => rows.filter((x) => x.key !== r.key))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="add-row-btn" onClick={() => setGold([...gold, blankGold()])}>+ Add more gold</button>
        <p className="hint">Total received: <strong>{grams(totalNet)}</strong> · <strong>{grams(totalFine)}</strong> fine. {totalNet > 0 ? "" : "Leave empty if the customer gave no gold."}</p>
        <label className="field">Instructions / notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Design, size, stones, finish…" /></label>
      </div>

      {/* Advance has its own card — there is no bill to put it in yet */}
      <div className="card section">
        <h3>Advance received</h3>
        {payments.map((p) => (
          <div key={p.key} className="pay-row">
            <select value={p.mode} onChange={(e) => setP(p.key, "mode", e.target.value)}>{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select>
            <input type="number" min="0" step="0.01" placeholder="Advance amount ₹" value={p.amount} onChange={(e) => setP(p.key, "amount", e.target.value)} />
            <input placeholder="Ref / UTR (optional)" value={p.reference} onChange={(e) => setP(p.key, "reference", e.target.value)} />
            {payments.length > 1 && <button className="icon-btn" onClick={() => setPayments((rows) => rows.filter((x) => x.key !== p.key))}>✕</button>}
          </div>
        ))}
        <button className="add-row-btn" onClick={() => setPayments([...payments, blankPay()])}>+ Split payment</button>
        <div className="order-total">
          <span>Advance received</span><strong>{inr(advance)}</strong>
        </div>
        <p className="hint">There is no bill amount yet. After the goldsmith finishes, the finished weight and <strong>wastage</strong> come from them; you add the HUID, making and stone charges at pickup, and the final bill is prepared — your advance is deducted.</p>

        {error && <div className="alert error">{error}</div>}
        <button className="btn-primary-heavy" disabled={saving || !ready} onClick={save}>{saving ? "Saving…" : "✅ Save job order"}</button>
        {!ready && <p className="hint" style={{ textAlign: "center" }}>Enter the customer's name and what is to be made.</p>}
      </div>
    </div>
  );
}

export default JobOrderForm;
