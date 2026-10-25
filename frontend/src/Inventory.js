import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { inr, grams } from "./format";
import { EMPTY_PRODUCT as EMPTY, ProductFields, productToForm } from "./ProductForm";
import { normalizeScan } from "./barcode";

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
  const [scan, setScan] = useState("");

  const load = useCallback(() => {
    api.get("/products", { params: { status: status === "all" ? undefined : status } })
      .then(({ data }) => setList(data))
      .catch((err) => setMsg({ text: errMsg(err), type: "error" }));
  }, [status]);
  useEffect(load, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      let code = form.itemCode;
      if (editingId) await api.put(`/products/${editingId}`, form);
      else code = (await api.post("/products", form)).data.itemCode;
      setMsg({ text: `✅ ${code} ${editingId ? "updated" : "added to stock"}.`, type: "success" });
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
    setForm(productToForm(p));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // A scanned barcode (or a typed code + Enter) loads that piece into the form, filled in
  const loadByCode = async (raw) => {
    const code = normalizeScan(raw);
    if (!code) return;
    setMsg({ text: "", type: "" });
    try {
      const { data: p } = await api.get(`/products/by-code/${encodeURIComponent(code)}`);
      if ((p.status || "in_stock") !== "in_stock") {
        setMsg({ text: `${p.itemCode} was sold${p.soldInvoiceNumber ? ` on ${p.soldInvoiceNumber}` : ""}.`, type: "warn" });
        setScan("");
        return;
      }
      edit(p);
      setScan("");
      setMsg({ text: `✔ ${p.itemCode} loaded — change anything and click Update.`, type: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err, "Scan failed."), type: "error" });
      setScan("");
    }
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
        <div className="field" style={{ marginBottom: 14 }}>
          <label>📷 Scan barcode to load an item</label>
          <input
            placeholder="Click here, then scan a label (or type a code and press Enter)"
            value={scan}
            autoComplete="off"
            onChange={(e) => setScan(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadByCode(scan); } }}
          />
        </div>
        <ProductFields form={form} setForm={setForm} codeOptional onCodeEnter={loadByCode} codeHint={editingId ? "" : "Scan an existing label here to edit it"} />
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
