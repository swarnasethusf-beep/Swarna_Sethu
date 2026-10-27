import React, { useState, useEffect, useMemo, useCallback } from "react";
import api, { errMsg } from "./api";
import { inr, grams } from "./format";
import { EMPTY_PRODUCT as EMPTY, ProductFields, productToForm } from "./ProductForm";
import {
  LABEL_SIZES, labelHtml, labelFromProduct, expandQueue, previewCss, normalizeScan,
  printLabels, saveLabelsPdf, listPrinters, hasDesktopPrinting
} from "./barcode";

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};

let rowSeq = 0;
const netOf = (form) => Math.round(Math.max(0, (parseFloat(form.grossWt) || 0) - (parseFloat(form.stoneWt) || 0)) * 1000) / 1000;

/**
 * 📦 Inventory & Barcodes — one record per tagged piece (stored in Firestore). Saving a piece can
 * queue its Code 128 label; scanning a label here loads the piece (or queues a reprint), and Billing
 * finds it by the same code. Billing marks a piece sold; cancelling the invoice returns it to stock.
 * `canEdit` = the "inventory" permission. With only "barcode", a user can add pieces and print labels.
 */
function Inventory({ userRole, canEdit, shopName, showCreatedBy }) {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState("in_stock");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState("");
  const [scanMode, setScanMode] = useState(canEdit ? "edit" : "label");   // what a scanned label does
  const [labelOnSave, setLabelOnSave] = useState(() => store.get("labelOnSave", true));
  const [queue, setQueue] = useState([]);                                  // [{ key, id, label, copies }]

  useEffect(() => store.set("labelOnSave", labelOnSave), [labelOnSave]);

  const load = useCallback(() => {
    api.get("/products", { params: { status: status === "all" ? undefined : status } })
      .then(({ data }) => setList(data))
      .catch((err) => setMsg({ text: errMsg(err), type: "error" }));
  }, [status]);
  useEffect(load, [load]);

  // Re-queuing a piece refreshes its label (weights may have changed) and adds copies
  const addToQueue = (product, copies = 1) => {
    const label = labelFromProduct(product, shopName);
    setQueue((cur) => {
      const hit = cur.find((x) => x.id === product.id);
      if (hit) return cur.map((x) => (x.id === product.id ? { ...x, label, copies: Number(x.copies) + copies } : x));
      return [...cur, { key: `q${++rowSeq}`, id: product.id, label, copies }];
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      let id = editingId;
      let code = form.itemCode;
      if (editingId) await api.put(`/products/${editingId}`, form);
      else ({ id, itemCode: code } = (await api.post("/products", form)).data);
      if (labelOnSave) addToQueue({ ...form, id, itemCode: code, netWt: netOf(form), grossWt: parseFloat(form.grossWt) });
      setMsg({ text: `✅ ${code} ${editingId ? "updated" : "added to stock"}${labelOnSave ? " — label added to the print queue" : ""}.`, type: "success" });
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

  // A scanned barcode (or a typed code + Enter) loads that piece into the form, or queues a reprint
  const onScan = async (raw, mode = scanMode) => {
    const code = normalizeScan(raw);
    if (!code) return;
    setMsg({ text: "", type: "" });
    try {
      const { data: p } = await api.get(`/products/by-code/${encodeURIComponent(code)}`);
      setScan("");
      if ((p.status || "in_stock") !== "in_stock") {
        setMsg({ text: `${p.itemCode} was sold${p.soldInvoiceNumber ? ` on ${p.soldInvoiceNumber}` : ""}.`, type: "warn" });
        return;
      }
      if (mode === "label") {
        addToQueue(p);
        setMsg({ text: `✔ ${p.itemCode} added to the print queue.`, type: "success" });
      } else {
        edit(p);
        setMsg({ text: `✔ ${p.itemCode} loaded — change anything and click Update.`, type: "success" });
      }
    } catch (err) {
      setMsg({ text: errMsg(err, "Scan failed."), type: "error" });
      setScan("");
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.itemCode} from stock?`)) return;
    try {
      await api.delete(`/products/${p.id}`);
      setQueue((cur) => cur.filter((x) => x.id !== p.id));
      load();
    } catch (err) {
      alert(errMsg(err));
    }
  };

  const shown = list.filter((p) => !q || `${p.itemCode} ${p.description} ${p.huid || ""}`.toLowerCase().includes(q.toLowerCase()));
  const shownInStock = shown.filter((p) => (p.status || "in_stock") === "in_stock");
  const totalNet = shown.reduce((s, p) => s + (p.netWt || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Inventory &amp; Barcodes</h1>
          <p>Register tagged pieces, print their labels, and scan them later in Billing or here</p>
        </div>
      </div>

      <style>{previewCss}</style>

      <form className="card section" onSubmit={submit}>
        <h3>{editingId ? `Edit ${form.itemCode}` : "1 · Add piece to stock"}</h3>
        <div className="form-grid cols-4" style={{ marginBottom: 14 }}>
          <label className="field span-3">📷 Scan a barcode
            <input
              placeholder="Click here, then scan a label (or type a code and press Enter)"
              value={scan}
              autoComplete="off"
              onChange={(e) => setScan(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(scan); } }}
            />
          </label>
          <label className="field">A scan should
            <select value={scanMode} onChange={(e) => setScanMode(e.target.value)}>
              {canEdit && <option value="edit">Load the item to edit</option>}
              <option value="label">Add a label reprint</option>
            </select>
          </label>
        </div>
        <ProductFields
          form={form}
          setForm={setForm}
          codeOptional
          onCodeEnter={canEdit ? (code) => onScan(code, "edit") : undefined}
          codeHint={canEdit && !editingId ? "Scan an existing label here to edit it" : ""}
        />
        <label className="check-line" style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 10px" }}>
          <input type="checkbox" checked={labelOnSave} onChange={(e) => setLabelOnSave(e.target.checked)} />
          Add a barcode label to the print queue when I save
        </label>
        <div className="btn-group">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editingId ? "💾 Update item" : labelOnSave ? "🏷️ Save item & generate barcode" : "➕ Add to stock"}
          </button>
          {editingId && <button type="button" className="btn btn-secondary" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel edit</button>}
        </div>
        {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      </form>

      <LabelQueue queue={queue} setQueue={setQueue} />

      <div className="card section">
        <h3>3 · Stock</h3>
        <div className="filter-bar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="in_stock">In stock</option>
            <option value="sold">Sold</option>
            <option value="all">All</option>
          </select>
          <input className="search" placeholder="🔍 Code, description or HUID" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted-text">{shown.length} pieces · {grams(totalNet)} net</span>
          <button className="btn btn-sm btn-secondary" disabled={!shownInStock.length} onClick={() => shownInStock.slice(0, 100).forEach((p) => addToQueue(p))}>
            🏷️ Label {Math.min(shownInStock.length, 100)} shown
          </button>
        </div>

        <div className="table-card" style={{ boxShadow: "none", border: "1px solid var(--line)" }}>
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
                        {inStock && <button className="btn btn-sm btn-secondary" onClick={() => addToQueue(p)}>+ Label</button>}
                        {inStock && canEdit && (userRole === "super_admin" || p.createdBy) && (
                          <>
                            {" "}<button className="btn btn-sm btn-secondary" onClick={() => edit(p)}>Edit</button>
                            {" "}<button className="btn btn-sm btn-danger" onClick={() => remove(p)}>Delete</button>
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
    </div>
  );
}

/** 🏷️ Label print queue — label size, printer, copies; prints straight to the label printer in the desktop app */
function LabelQueue({ queue, setQueue }) {
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);
  const [sizeId, setSizeId] = useState(() => store.get("labelSize", "50x25"));
  const [custom, setCustom] = useState(() => store.get("labelCustom", { w: 50, h: 25 }));
  const [printers, setPrinters] = useState([]);
  const [printer, setPrinter] = useState(() => store.get("labelPrinter", ""));
  const desktop = hasDesktopPrinting();

  const size = useMemo(() => {
    const s = LABEL_SIZES.find((x) => x.id === sizeId) || LABEL_SIZES[0];
    return s.id === "custom"
      ? { ...s, w: Math.min(300, Math.max(15, Number(custom.w) || 50)), h: Math.min(200, Math.max(10, Number(custom.h) || 25)) }
      : s;
  }, [sizeId, custom]);

  useEffect(() => { if (desktop) listPrinters().then(setPrinters).catch(() => {}); }, [desktop]);
  useEffect(() => store.set("labelSize", sizeId), [sizeId]);
  useEffect(() => store.set("labelCustom", custom), [custom]);
  useEffect(() => store.set("labelPrinter", printer), [printer]);

  const labels = useMemo(() => expandQueue(queue), [queue]);
  const total = labels.length;

  const run = async (fn, okText) => {
    if (!total) { setMsg({ text: "The print queue is empty.", type: "warn" }); return; }
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      const res = await fn();
      if (res?.canceled) return;
      setMsg({ text: res?.filePath ? `✅ Saved: ${res.filePath}` : okText, type: res?.browser ? "warn" : "success" });
    } catch (err) {
      setMsg({ text: `Printing failed: ${err.message || err}`, type: "error" });
    } finally {
      setBusy(false);
    }
  };
  const doPrint = () => run(() => printLabels(labels, size, { deviceName: printer }), `✅ ${total} label${total === 1 ? "" : "s"} sent to the printer.`);
  const doPdf = () => run(() => saveLabelsPdf(labels, size), "In the print dialog, choose “Save as PDF”.");

  return (
    <div className="card section">
      <h3>2 · Barcode label print queue {total > 0 && <span className="pill gold">{total} label{total === 1 ? "" : "s"}</span>}</h3>

      <div className="form-grid cols-4" style={{ marginBottom: 10 }}>
        <label className="field span-2">Label size
          <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
            {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        {sizeId === "custom" && (
          <>
            <label className="field">Width (mm)<input type="number" min="15" max="300" value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} /></label>
            <label className="field">Height (mm)<input type="number" min="10" max="200" value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} /></label>
          </>
        )}
        {desktop && (
          <label className="field span-2">Label printer
            <select value={printer} onChange={(e) => setPrinter(e.target.value)}>
              <option value="">System default printer</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? " (default)" : ""}</option>)}
            </select>
          </label>
        )}
      </div>
      {!desktop && (
        <p className="hint">In the browser, Print opens the print dialog — pick your label printer there and set paper size to {size.w} × {size.h} mm. The Windows desktop app prints straight to the chosen printer.</p>
      )}

      {queue.length === 0 ? (
        <div className="empty">Nothing queued yet — save a piece above, scan a label, or click “+ Label” in the stock list.</div>
      ) : (
        <>
          <div className="label-grid">
            {queue.map((item) => (
              <div key={item.key} className="label-card">
                <div className="label-preview" style={{ zoom: 1.7 }} dangerouslySetInnerHTML={{ __html: labelHtml(item.label, size) }} />
                <div className="label-meta">
                  <label>Copies
                    <input type="number" min="1" max="500" value={item.copies}
                      onChange={(e) => setQueue((cur) => cur.map((x) => (x.key === item.key ? { ...x, copies: e.target.value } : x)))} />
                  </label>
                  <button type="button" className="icon-btn" title="Remove" onClick={() => setQueue((cur) => cur.filter((x) => x.key !== item.key))}>✕</button>
                </div>
              </div>
            ))}
          </div>
          <div className="btn-group" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled={busy} onClick={doPrint}>🖨️ Print {total} label{total === 1 ? "" : "s"}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={doPdf}>⬇️ Save as PDF</button>
            <button className="btn btn-secondary" onClick={() => setQueue([])}>Clear queue</button>
          </div>
        </>
      )}
      {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}
    </div>
  );
}

export default Inventory;
