import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { PURITIES, MAKING_TYPES } from "./shared/billing";
import { inr, grams } from "./format";

const EMPTY = {
  itemCode: "", description: "", purity: "22K", huid: "", hsn: "7113", pcs: 1,
  grossWt: "", stoneWt: "", wastagePct: "", makingType: "per_gram", makingValue: "", stoneCharges: ""
};

/**
 * 📦 Inventory — one record per tagged piece. Billing looks pieces up by item code
 * and marks them sold; cancelling the invoice returns them to stock.
 */
function Inventory({ userRole, showCreatedBy }) {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState("in_stock");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/products", { params: { status: status === "all" ? undefined : status } })
      .then(({ data }) => setList(data))
      .catch((err) => setMsg({ text: errMsg(err), type: "error" }));
  }, [status]);
  useEffect(load, [load]);

  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      if (editingId) await api.put(`/products/${editingId}`, form);
      else await api.post("/products", form);
      setMsg({ text: `✅ ${form.itemCode} ${editingId ? "updated" : "added to stock"}.`, type: "success" });
      setForm(EMPTY);
      setEditingId(null);
      load();
    } catch (err) {
      setMsg({ text: errMsg(err, "Failed to save item."), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const edit = (p) => {
    setEditingId(p.id);
    setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, p[k] ?? EMPTY[k]])) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.itemCode} from stock?`)) return;
    try {
      await api.delete(`/products/${p.id}`);
      load();
    } catch (err) {
      alert(errMsg(err));
    }
  };

  const shown = list.filter((p) => !q || `${p.itemCode} ${p.description} ${p.huid || ""}`.toLowerCase().includes(q.toLowerCase()));
  const totalNet = shown.reduce((s, p) => s + (p.netWt || 0), 0);
  const net = Math.max(0, (parseFloat(form.grossWt) || 0) - (parseFloat(form.stoneWt) || 0));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Inventory</h1>
          <p>Register tagged pieces — billing finds them by item code</p>
        </div>
      </div>

      <form className="card section" onSubmit={submit}>
        <h3>{editingId ? `Edit ${form.itemCode}` : "Add piece to stock"}</h3>
        <div className="form-grid cols-4">
          <label className="field">Item code *<input {...f("itemCode")} onChange={(e) => setForm({ ...form, itemCode: e.target.value.toUpperCase() })} required /></label>
          <label className="field span-2">Description *<input {...f("description")} required /></label>
          <label className="field">Purity
            <select {...f("purity")}>{Object.entries(PURITIES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
          </label>
          <label className="field">Gross wt (g) *<input type="number" min="0" step="0.001" {...f("grossWt")} required /></label>
          <label className="field">Stone wt (g)<input type="number" min="0" step="0.001" {...f("stoneWt")} /></label>
          <label className="field">Net wt (g)<input value={net.toFixed(3)} readOnly className="readonly" /></label>
          <label className="field">Wastage / VA %<input type="number" min="0" step="0.01" {...f("wastagePct")} /></label>
          <label className="field">Making charge<input type="number" min="0" step="0.01" {...f("makingValue")} /></label>
          <label className="field">Making type
            <select {...f("makingType")}>{Object.entries(MAKING_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="field">Stone charges (₹)<input type="number" min="0" step="0.01" {...f("stoneCharges")} /></label>
          <label className="field">HUID (hallmark)<input {...f("huid")} maxLength={6} onChange={(e) => setForm({ ...form, huid: e.target.value.toUpperCase() })} /></label>
          <label className="field">HSN<input {...f("hsn")} maxLength={8} /></label>
          <label className="field">Pieces<input type="number" min="1" step="1" {...f("pcs")} /></label>
        </div>
        <div className="btn-group">
          <button type="submit" className="btn btn-primary" disabled={busy}>{editingId ? "💾 Update item" : "➕ Add to stock"}</button>
          {editingId && <button type="button" className="btn btn-secondary" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel edit</button>}
        </div>
        {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      </form>

      <div className="filter-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="in_stock">In stock</option>
          <option value="sold">Sold</option>
          <option value="all">All</option>
        </select>
        <input className="search" placeholder="🔍 Code, description or HUID" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted-text">{shown.length} pieces · {grams(totalNet)} net</span>
      </div>

      <div className="table-card">
        {shown.length === 0 ? <div className="empty">No items.</div> : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th><th>Description</th><th>Purity</th><th>HUID</th>
                <th className="right">Gross</th><th className="right">Net</th><th className="right">VA %</th><th>Making</th>
                <th>Status</th>
                {showCreatedBy && <th>Created By</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const inStock = (p.status || "in_stock") === "in_stock";
                return (
                  <tr key={p.id}>
                    <td><strong>{p.itemCode}</strong></td>
                    <td>{p.description}</td>
                    <td>{p.purity || "—"}</td>
                    <td>{p.huid || "—"}</td>
                    <td className="right">{grams(p.grossWt ?? p.weight)}</td>
                    <td className="right">{grams(p.netWt ?? p.weight)}</td>
                    <td className="right">{p.wastagePct || "—"}</td>
                    <td>{p.makingType === "percent" ? `${p.makingValue}%` : p.makingType === "per_gram" ? `${inr(p.makingValue)}/g` : inr(p.makingValue ?? p.makingCharges)}</td>
                    <td>{inStock ? <span className="pill ok">In stock</span> : <span className="pill">Sold · {p.soldInvoiceNumber}</span>}</td>
                    {showCreatedBy && <td><span className="pill blue">👤 {p.createdByName || "—"}</span></td>}
                    <td className="nowrap">
                      {inStock && (userRole === "super_admin" || p.createdBy) && (
                        <>
                          <button className="btn btn-sm btn-secondary" onClick={() => edit(p)}>Edit</button>{" "}
                          <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Inventory;
