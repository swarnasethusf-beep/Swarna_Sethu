import React, { useState, useEffect, useMemo, useCallback } from "react";
import api, { errMsg } from "./api";
import { EMPTY_PRODUCT, ProductFields } from "./ProductForm";
import {
  LABEL_SIZES, labelHtml, labelFromProduct, expandQueue, previewCss, normalizeScan,
  printLabels, saveLabelsPdf, listPrinters, hasDesktopPrinting
} from "./barcode";

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};

let rowSeq = 0;

/**
 * 🏷️ Barcode Generator — register a piece, get its Code 128 label, print it on a label printer.
 * The barcode holds the item code; scanning it in Billing / Inventory fills the rest from the database.
 */
function BarcodeLabels({ shopName }) {
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [queue, setQueue] = useState([]); // [{ key, id, label, copies }]
  const [stock, setStock] = useState([]);
  const [q, setQ] = useState("");
  const [scan, setScan] = useState("");
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

  const loadStock = useCallback(() => {
    api.get("/products", { params: { status: "in_stock" } }).then(({ data }) => setStock(data)).catch((err) => setMsg({ text: errMsg(err), type: "error" }));
  }, []);
  useEffect(loadStock, [loadStock]);
  useEffect(() => { if (desktop) listPrinters().then(setPrinters).catch(() => {}); }, [desktop]);
  useEffect(() => store.set("labelSize", sizeId), [sizeId]);
  useEffect(() => store.set("labelCustom", custom), [custom]);
  useEffect(() => store.set("labelPrinter", printer), [printer]);

  const addToQueue = (product, copies = 1) => {
    setQueue((cur) => {
      const hit = cur.find((x) => x.id === product.id);
      if (hit) return cur.map((x) => (x.id === product.id ? { ...x, copies: x.copies + copies } : x));
      return [...cur, { key: `q${++rowSeq}`, id: product.id, label: labelFromProduct(product, shopName), copies }];
    });
  };

  // ── Create a piece and generate its label ───────────────────────────────
  const createItem = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      const { data } = await api.post("/products", form);
      const net = Math.max(0, (parseFloat(form.grossWt) || 0) - (parseFloat(form.stoneWt) || 0));
      addToQueue({ ...form, id: data.id, itemCode: data.itemCode, netWt: Math.round(net * 1000) / 1000, grossWt: parseFloat(form.grossWt) });
      setMsg({ text: `✅ ${data.itemCode} saved to stock and added to the print queue.`, type: "success" });
      setForm(EMPTY_PRODUCT);
      loadStock();
    } catch (err) {
      setMsg({ text: errMsg(err, "Could not save the item."), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ── Scan an existing label to queue a reprint ───────────────────────────
  const scanAdd = async () => {
    const code = normalizeScan(scan);
    if (!code) return;
    setMsg({ text: "", type: "" });
    try {
      const { data: p } = await api.get(`/products/by-code/${encodeURIComponent(code)}`);
      addToQueue(p);
      setScan("");
      setMsg({ text: `✔ ${p.itemCode} added to the print queue.`, type: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err, "Scan failed."), type: "error" });
      setScan("");
    }
  };

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

  const shown = stock.filter((p) => !q || `${p.itemCode} ${p.description} ${p.huid || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Barcode Generator</h1>
          <p>Register a piece, print its label, and scan it later in Billing or Inventory to fill in the details</p>
        </div>
      </div>

      <style>{previewCss}</style>

      <form className="card section" onSubmit={createItem}>
        <h3>1 · Item details → barcode</h3>
        <ProductFields form={form} setForm={setForm} codeOptional />
        <div className="btn-group" style={{ marginTop: 6 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>🏷️ Save item &amp; generate barcode</button>
          <span className="hint" style={{ margin: 0 }}>The piece is added to stock, so scanning its label finds it everywhere.</span>
        </div>
      </form>

      {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="card section">
        <h3>2 · Print queue {total > 0 && <span className="pill gold">{total} label{total === 1 ? "" : "s"}</span>}</h3>

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

        <div className="field" style={{ marginBottom: 12 }}>
          <label>📷 Scan an existing label to add a reprint</label>
          <input
            placeholder="Click here, then scan (or type a code and press Enter)"
            value={scan}
            autoComplete="off"
            onChange={(e) => setScan(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanAdd(); } }}
          />
        </div>

        {queue.length === 0 ? (
          <div className="empty">Nothing queued yet — save an item above, scan a label, or pick from stock below.</div>
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
      </div>

      <div className="card section">
        <h3>3 · Stock items</h3>
        <div className="filter-bar">
          <input className="search" placeholder="🔍 Code, name or HUID" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted-text">{shown.length} in stock</span>
          <button className="btn btn-sm btn-secondary" disabled={!shown.length} onClick={() => shown.slice(0, 100).forEach((p) => addToQueue(p))}>
            Add {Math.min(shown.length, 100)} shown to queue
          </button>
        </div>
        <div className="table-card" style={{ boxShadow: "none", border: "1px solid var(--line)" }}>
          {shown.length === 0 ? <div className="empty">No items in stock.</div> : (
            <table className="admin-table">
              <thead><tr><th>Code</th><th>Name</th><th>Purity</th><th className="right">Net g</th><th>HUID</th><th></th></tr></thead>
              <tbody>
                {shown.slice(0, 200).map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.itemCode}</strong></td>
                    <td>{p.description}</td>
                    <td>{p.purity}</td>
                    <td className="right">{(p.netWt ?? 0).toFixed(3)}</td>
                    <td>{p.huid || "—"}</td>
                    <td className="nowrap"><button className="btn btn-sm btn-secondary" onClick={() => addToQueue(p)}>+ Label</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default BarcodeLabels;
