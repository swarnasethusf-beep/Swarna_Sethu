import React, { useState, useEffect, useMemo } from "react";
import api, { errMsg } from "./api";
import { computeInvoice, amountInWords, PURITIES, MAKING_TYPES, PAYMENT_MODES, STATES } from "./shared/billing";
import { inr, grams, todayLocal } from "./format";
import JobOrderForm from "./JobOrderForm";

let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;
const blankItem = () => ({
  key: rowKey(), productId: null, itemCode: "", description: "", purity: "22K", huid: "", hsn: "",
  pcs: 1, grossWt: "", stoneWt: "", wastagePct: "", wastageGrams: "", makingType: "per_gram", makingValue: "", stoneCharges: "", rate: ""
});
const blankOld = () => ({ key: rowKey(), description: "Old gold", grossWt: "", lessWt: "", touch: "91.6" });
const blankPayment = () => ({ key: rowKey(), mode: "Cash", amount: "", reference: "" });
const strip = ({ key, ...rest }) => rest;
/** Bill-row fields taken from a stock record (used by the code box and the barcode scan box) */
const fieldsFromProduct = (p) => ({
  productId: p.id, itemCode: p.itemCode, description: p.description, purity: p.purity || "22K",
  huid: p.huid || "", hsn: p.hsn || "", pcs: p.pcs || 1, grossWt: p.grossWt ?? "", stoneWt: p.stoneWt ?? "",
  wastagePct: p.wastagePct ?? "", makingType: p.makingType || "per_gram", makingValue: p.makingValue ?? "",
  stoneCharges: p.stoneCharges ?? ""
});
const isBlankRow = (r) => !r.itemCode && !r.description && !r.grossWt;
const rowFromStoredItem = (i, order = null) => ({
  key: rowKey(), productId: i.productId || null, itemCode: i.itemCode || "", description: i.description || "", purity: i.purity || "22K",
  huid: i.huid || "", hsn: i.hsn || "", pcs: i.pcs || 1,
  grossWt: order ? order.workFinishedWt ?? "" : i.grossWt ?? "",              // order stage: what the goldsmith reported
  wastageGrams: order ? order.workWastageWt ?? "" : i.wastageGrams ?? "",
  stoneWt: i.stoneWt || "", wastagePct: order ? "" : i.wastagePct || "",
  makingType: i.makingType || "per_gram", makingValue: i.makingValue ?? "", stoneCharges: i.stoneCharges || "", rate: ""   // blank = follow the rates above
});
const rowFromStoredOld = (o) => ({ key: rowKey(), description: o.description || "Old gold", grossWt: o.grossWt ?? "", lessWt: o.lessWt || "", touch: String(o.touch ?? 91.6) });
const EMPTY_ROW = { netWt: 0, fineWt: 0, goldValue: 0, makingAmount: 0, lineTotal: 0 };

/**
 * 🧾 New Invoice — live preview uses the same billing engine as the server.
 * The server recomputes everything on save; nothing the client sends as a total is trusted.
 */
function InvoiceEditor({ shop, onSaved, onBack, onGoRates, isSecret: propIsSecret = false, settle = null }) {
  // `settle` = a pending / ready job-work invoice being finalised on pickup (same screen, pre-filled)
  const isSecret = propIsSecret || !!settle?.isSecret;
  const [mode, setMode] = useState(settle ? settle.mode : "sale");
  const [rates, setRates] = useState(settle
    ? { "24K": settle.rates?.["24K"] || "", "22K": settle.rates?.["22K"] || "", "18K": settle.rates?.["18K"] || "", "14K": settle.rates?.["14K"] || "" }
    : { "24K": "", "22K": "", "18K": "", "14K": "" });
  const [ratesInfo, setRatesInfo] = useState(null);
  const [customer, setCustomer] = useState(settle
    ? { name: "", mobile: "", address: "", stateCode: "", gstin: "", pan: "", ...settle.customer }
    : { name: "", mobile: "", address: "", stateCode: shop.stateCode || "", gstin: "", pan: "" });
  const [items, setItems] = useState(settle ? settle.items.map((i) => rowFromStoredItem(i, settle.stage === "order" ? settle : null)) : [blankItem()]);
  const [oldGold, setOldGold] = useState(settle ? settle.oldGold.map(rowFromStoredOld) : []);
  const [payments, setPayments] = useState([blankPayment()]);
  const [staffOptions, setStaffOptions] = useState([]);
  const [assignedStaffId, setAssignedStaffId] = useState("");
  const [notes, setNotes] = useState(settle ? settle.notes || "" : "");
  const [hints, setHints] = useState({}); // row key → lookup message
  const [scanCode, setScanCode] = useState("");
  const [scanMsg, setScanMsg] = useState({ text: "", type: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (settle && settle.stage !== "order") return;   // an older pending bill keeps the rates agreed on the order; a new order takes today's rates
    api.get("/rates").then(({ data }) => {
      setRatesInfo(data);
      setRates({ "24K": data["24K"] || "", "22K": data["22K"] || "", "18K": data["18K"] || "", "14K": data["14K"] || "" });
    }).catch(() => {});
    api.get("/staff/options").then(({ data }) => setStaffOptions(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);   // `settle` is fixed for the life of this screen (it is keyed by the invoice)

  // On settlement the money already received counts too; the rows below are only the NEW payments
  const received = settle ? settle.payments || [] : [];
  const allPayments = [...received, ...payments];
  const input = { mode, rates, customer, items, oldGold, payments: allPayments };
  const result = useMemo(() => computeInvoice(input, settle ? settle.shop || shop : shop), [mode, rates, customer, items, oldGold, payments, shop]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowCalc = (row) => computeInvoice({ mode, rates, items: [row] }, shop).items[0] || EMPTY_ROW;
  const oldCalc = (row) => computeInvoice({ mode, rates, oldGold: [row] }, shop).oldGold[0];
  const s = result.summary;
  const errors = result.issues.filter((i) => i.level === "error" && (!isSecret || i.code !== "PAN_REQUIRED"));
  const warnings = result.issues.filter((i) => i.level === "warning");

  // ── Row editing ─────────────────────────────────────────────────────────
  const editRow = (setter) => (key, field, value) =>
    setter((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const setItem = editRow(setItems);
  const setOld = editRow(setOldGold);
  const setPay = editRow(setPayments);
  const removeRow = (setter, key) => setter((rows) => rows.filter((r) => r.key !== key));

  const lookupItem = async (row) => {
    const code = row.itemCode.trim().toUpperCase();
    if (!code || row.productId || settle || mode === "job_work") return;   // a piece made to order is not in stock
    if (items.some((r) => r.key !== row.key && r.productId && r.itemCode === code)) {
      setHints((h) => ({ ...h, [row.key]: "Already on this bill." }));
      return;
    }
    try {
      const { data: p } = await api.get(`/products/lookup/${encodeURIComponent(code)}`);
      setItems((rows) => rows.map((r) => (r.key !== row.key ? r : { ...r, ...fieldsFromProduct(p) })));
      setHints((h) => ({ ...h, [row.key]: "✔ From stock" }));
    } catch (err) {
      setHints((h) => ({ ...h, [row.key]: err.response?.status === 404 ? `${errMsg(err)} Enter details manually.` : errMsg(err) }));
    }
  };

  // Barcode scanner: it types the code and presses Enter — the piece is added to the bill, filled in
  const scanItem = async () => {
    const code = scanCode.trim().toUpperCase();
    if (!code) return;
    setScanMsg({ text: "", type: "" });
    if (items.some((r) => r.productId && r.itemCode === code)) {
      setScanMsg({ text: `${code} is already on this bill.`, type: "warn" });
      setScanCode("");
      return;
    }
    try {
      const { data: p } = await api.get(`/products/lookup/${encodeURIComponent(code)}`);
      setItems((rows) => {
        const at = rows.findIndex(isBlankRow);
        const filled = { ...(at >= 0 ? rows[at] : blankItem()), ...fieldsFromProduct(p) };
        return at >= 0 ? rows.map((r, i) => (i === at ? filled : r)) : [...rows, filled];
      });
      setScanMsg({ text: `✔ ${p.itemCode} — ${p.description} added.`, type: "success" });
      setScanCode("");
    } catch (err) {
      setScanMsg({ text: errMsg(err), type: "error" });
      setScanCode(""); // a scanner types straight after the last code — never leave the old one behind
    }
  };

  const lookupCustomer = async () => {
    if (!/^[6-9]\d{9}$/.test(customer.mobile)) return;
    try {
      const { data } = await api.get(`/customers/${customer.mobile}`);
      setCustomer((c) => ({
        ...c, name: c.name || data.name, address: c.address || data.address || "",
        stateCode: data.stateCode || c.stateCode, gstin: c.gstin || data.gstin || "", pan: c.pan || data.pan || ""
      }));
    } catch { /* new customer */ }
  };

  const fillBalance = (key) => {
    const prior = received.reduce((sum, p) => sum + (p.amount || 0), 0);
    const others = prior + payments.filter((p) => p.key !== key).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    setPay(key, "amount", Math.max(0, Math.round((s.payable - others) * 100) / 100) || "");
  };

  const save = async () => {
    setSaving(true); setError("");
    try {
      if (settle) {
        const { data } = await api.post(`/invoices/${settle.id}/settle`, {
          items: items.map(strip), oldGold: oldGold.map(strip), rates,
          customer: { address: customer.address, stateCode: customer.stateCode, gstin: customer.gstin, pan: customer.pan },
          newPayments: payments.filter((p) => parseFloat(p.amount) > 0).map(strip),
          notes, reason: "Final settlement on delivery"
        });
        onSaved(data.id, data);
        return;
      }
      const endpoint = isSecret ? "/invoices/secret-sale" : "/invoices";
      const { data } = await api.post(endpoint, {
        mode, rates, customer,
        items: items.map(strip), oldGold: oldGold.map(strip), payments: payments.map(strip),
        assignedStaffId, notes
      });
      onSaved(data.id, data);
    } catch (err) {
      setError(errMsg(err, "Could not save the invoice."));
    } finally {
      setSaving(false);
    }
  };

  if (mode === "job_work" && !settle) {
    return (
      <div className="invoice-editor">
        <div className="page-header no-print">
          <div>
            <h1>{isSecret ? "🔒 New Job Work Order (Unrecorded)" : "New Job Work Order"}</h1>
            <p>{isSecret ? "Phase 1: Customer brings gold · Tracked in workshop · Removed from database upon Phase 2 delivery" : "The customer brings gold for a new piece · the bill is prepared after the work is done"}</p>
          </div>
          <button className="btn btn-secondary" onClick={onBack}>← Back to List</button>
        </div>
        <div className="card section">
          <div className="mode-toggle">
            <button onClick={() => setMode("sale")}>🛍️ Jewellery Sale</button>
            <button className="active">🔨 Job Work (customer's gold)</button>
          </div>
          <p className="hint">His gold is only weighed — it is never charged or paid for. You charge only the new gold the shop adds, making, stones and wastage, worked out when the piece is finished.</p>
        </div>
        <JobOrderForm shop={shop} staffOptions={staffOptions} onSaved={onSaved} isSecret={isSecret} />
      </div>
    );
  }

  const ratesStale = ratesInfo && ratesInfo.date !== todayLocal();
  const c = (field) => ({ value: customer[field], onChange: (e) => setCustomer({ ...customer, [field]: e.target.value }) });

  return (
    <div className="invoice-editor">
      <div className="page-header no-print">
        <div>
          <h1>{settle ? (isSecret ? `Finalize & deliver (Unrecorded) — ${settle.invoiceNumber}` : `Finalize & deliver — ${settle.invoiceNumber}`) : isSecret ? "🔒 Direct Invoice (Unrecorded)" : "New Invoice"}</h1>
          <p>{settle ? (isSecret ? "Enter finished weights and extra gold. Advance is deducted. Upon completion, this invoice and work order are permanently removed from database records." : "Enter the finished weights and any extra gold. The advance already received is carried over and the invoice keeps its number.")
            : isSecret ? "Confidential sale · No invoice log saved · Stock items permanently deleted from Firebase" : "Bill date: today · number is assigned when you save"}</p>
        </div>
        <button className="btn btn-secondary" onClick={onBack}>← Back to List</button>
      </div>

      {isSecret && (
        <div className="alert warn no-print" style={{ marginBottom: 16 }}>
          <strong>🔒 Confidential Mode Active:</strong> This invoice will <u>not</u> be recorded in invoice logs or reports. Any billed stock items will be <u>permanently deleted</u> from Firebase database upon completing the sale.
        </div>
      )}

      {/* Mode + rates */}
      <div className="card section">
        <div className="mode-toggle" style={settle ? { display: "none" } : undefined}>
          <button className={mode === "sale" ? "active" : ""} onClick={() => setMode("sale")}>🛍️ Jewellery Sale</button>
          <button className={mode === "job_work" ? "active" : ""} onClick={() => setMode("job_work")}>🔨 Job Work (customer's gold)</button>
        </div>
        <p className="hint">
          {mode === "sale"
            ? "Shop sells jewellery. GST 3% on gold + making + stones. Customer's old gold is deducted after tax."
            : "Goldsmith makes a NEW piece from the customer's gold. His gold is only weighed — it is never charged or paid for. The bill is only: new gold the shop adds (24K rate, 3% GST) + making + stones + wastage (job work, 5% GST). If he gave more gold than needed, the surplus is returned in grams."}
        </p>
        <div className="rates-row">
          <strong>Rates for this bill (₹/g):</strong>
          {Object.keys(PURITIES).map((p) => (
            <label key={p} className="rate-input">
              {p}
              <input type="number" min="0" step="0.01" value={rates[p]} onChange={(e) => setRates({ ...rates, [p]: e.target.value })} />
            </label>
          ))}
          {!settle && (ratesStale || !ratesInfo?.date) && (
            <span className="pill warn">
              ⚠️ Today's rates not saved{ratesInfo?.date ? ` (last: ${ratesInfo.date})` : ""} — <button className="link-btn inline" onClick={onGoRates}>update rates</button>
            </span>
          )}
        </div>
      </div>

      {/* Customer */}
      <div className="card section">
        <h3>Customer</h3>
        <div className="form-grid cols-3">
          <label className="field">Mobile
            <input {...c("mobile")} disabled={!!settle} inputMode="numeric" placeholder="10 digits — finds returning customers"
              onChange={(e) => setCustomer({ ...customer, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              onBlur={lookupCustomer} />
          </label>
          <label className="field">Name {isSecret ? "(Optional)" : "*"}<input {...c("name")} disabled={!!settle} placeholder={isSecret ? "Cash Customer" : ""} /></label>
          <label className="field">State (place of supply)
            <select {...c("stateCode")}>
              <option value="">— Same as shop —</option>
              {STATES.map((st) => <option key={st.code} value={st.code}>{st.code} · {st.name}</option>)}
            </select>
          </label>
          <label className="field span-2">Address<input {...c("address")} /></label>
          <label className="field">GSTIN (B2B)<input {...c("gstin")} onChange={(e) => setCustomer({ ...customer, gstin: e.target.value.toUpperCase() })} /></label>
          <label className="field">PAN {s.payable > 200000 && <span className="req">required above ₹2 lakh</span>}
            <input {...c("pan")} maxLength={10} onChange={(e) => setCustomer({ ...customer, pan: e.target.value.toUpperCase() })} />
          </label>
          <label className={`field ${settle ? "hidden" : ""}`}>Assign goldsmith
            <select value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)}>
              <option value="">— None —</option>
              {staffOptions.map((st) => <option key={st.id} value={st.id}>{st.fullName} ({st.designation}){st.hasLogin ? " 🔔" : ""}</option>)}
            </select>
            {staffOptions.find((st) => st.id === assignedStaffId)?.hasLogin && (
              <span className="sub">🔔 A work order is sent to them when you save.</span>
            )}
          </label>
        </div>
      </div>

      {/* Items */}
      <div className="card section">
        <h3>{mode === "sale" ? "Items sold" : "New piece to be made (not in stock)"}{settle ? " — enter the FINISHED weights" : ""}</h3>
        {settle?.stage === "order" && (
          <p className="hint" style={{ marginTop: 0 }}>
            {settle.workFinishedWt != null
              ? <>Filled from the goldsmith: finished weight <strong>{settle.workFinishedWt} g</strong>{settle.workWastageWt != null ? <>, wastage <strong>{settle.workWastageWt} g</strong></> : ""}. Check them on the scale, then add the <strong>HUID</strong>, making and stone charges.</>
              : <>The goldsmith hasn't reported the finished weight — enter it from the scale, with the wastage, HUID, making and stones.</>}
          </p>
        )}
        <div className="scan-box" style={settle || mode === "job_work" ? { display: "none" } : undefined}>
          <input
            autoFocus
            autoComplete="off"
            placeholder="📷 Scan item barcode here (or type the item code and press Enter)"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanItem(); } }}
          />
          {scanMsg.text && <span className={`scan-msg ${scanMsg.type}`}>{scanMsg.text}</span>}
        </div>
        <div className="table-scroll">
          <table className="edit-table">
            <thead>
              <tr>
                <th>#</th><th>{mode === "job_work" ? "Design / tag no." : "Item code"}</th><th>Description *</th><th>Purity</th><th>HUID</th>
                <th>{settle ? "Finished gross g" : "Gross g"}</th><th>Stone g</th><th>Net g</th><th>{mode === "job_work" ? "Wastage g" : "Wastage %"}</th>
                <th>Making</th><th>Stone ₹</th>
                {mode === "sale" ? <><th>Rate ₹/g</th><th>Gold value</th></> : <><th>Fine g</th><th>Wastage ₹</th></>}
                <th>Making ₹</th><th>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => {
                const calc = rowCalc(row);
                return (
                  <tr key={row.key}>
                    <td className="num-cell">{idx + 1}</td>
                    <td>
                      <input className="w-code" value={row.itemCode} placeholder={mode === "job_work" ? "optional" : "Code ↵"}
                        onChange={(e) => { setItem(row.key, "itemCode", e.target.value.toUpperCase()); setItem(row.key, "productId", null); setHints((h) => ({ ...h, [row.key]: "" })); }}
                        onBlur={() => lookupItem(row)}
                        onKeyDown={(e) => e.key === "Enter" && lookupItem(row)} />
                      {hints[row.key] && <div className={`row-hint ${row.productId ? "ok" : ""}`}>{hints[row.key]}</div>}
                    </td>
                    <td><input className="w-desc" value={row.description} onChange={(e) => setItem(row.key, "description", e.target.value)} /></td>
                    <td>
                      <select value={row.purity} onChange={(e) => setItem(row.key, "purity", e.target.value)}>
                        {Object.keys(PURITIES).map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td><input className="w-huid" value={row.huid} maxLength={6} onChange={(e) => setItem(row.key, "huid", e.target.value.toUpperCase())} /></td>
                    <td><input className="w-num" type="number" min="0" step="0.001" value={row.grossWt} onChange={(e) => setItem(row.key, "grossWt", e.target.value)} /></td>
                    <td><input className="w-num" type="number" min="0" step="0.001" value={row.stoneWt} onChange={(e) => setItem(row.key, "stoneWt", e.target.value)} /></td>
                    <td className="calc">{calc.netWt.toFixed(3)}</td>
                    <td>{mode === "job_work"
                      ? <input className="w-sm" type="number" min="0" step="0.001" value={row.wastageGrams} placeholder={row.wastagePct ? `${row.wastagePct}%` : ""} title="Gold lost in making, as told by the goldsmith" onChange={(e) => setItem(row.key, "wastageGrams", e.target.value)} />
                      : <input className="w-sm" type="number" min="0" step="0.01" value={row.wastagePct} onChange={(e) => setItem(row.key, "wastagePct", e.target.value)} />}</td>
                    <td className="nowrap">
                      <input className="w-sm" type="number" min="0" step="0.01" value={row.makingValue} onChange={(e) => setItem(row.key, "makingValue", e.target.value)} />
                      <select className="w-mtype" value={row.makingType} onChange={(e) => setItem(row.key, "makingType", e.target.value)}>
                        {Object.entries(MAKING_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                    </td>
                    <td><input className="w-num" type="number" min="0" step="0.01" value={row.stoneCharges} onChange={(e) => setItem(row.key, "stoneCharges", e.target.value)} /></td>
                    {mode === "sale" ? (
                      <>
                        <td><input className="w-num" type="number" min="0" step="0.01" value={row.rate} placeholder={rates[row.purity] || "rate"} title="Leave blank to use the purity rate above" onChange={(e) => setItem(row.key, "rate", e.target.value)} /></td>
                        <td className="calc">{inr(calc.goldValue)}</td>
                      </>
                    ) : <><td className="calc">{calc.fineWt.toFixed(3)}</td><td className="calc">{inr(calc.wastageAmount)}</td></>}
                    <td className="calc">{inr(calc.makingAmount)}</td>
                    <td className="calc strong">{inr(calc.lineTotal)}</td>
                    <td>{items.length > 1 && <button className="icon-btn" title="Remove" onClick={() => removeRow(setItems, row.key)}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="add-row-btn" onClick={() => setItems([...items, blankItem()])}>+ Add item</button>
      </div>

      {/* Old gold */}
      <div className="card section">
        <h3>{mode === "sale" ? "Old gold exchange (optional)" : "Customer's gold received — weighed only, not charged"}</h3>
        {oldGold.length > 0 && (
          <div className="table-scroll">
            <table className="edit-table">
              <thead>
                <tr><th>#</th><th>Description</th><th>Gross g</th><th>Less (stone/dust) g</th><th>Net g</th><th>Touch / purity %</th><th>Fine g</th>{mode === "sale" && <th>Value @ 24K</th>}<th></th></tr>
              </thead>
              <tbody>
                {oldGold.map((row, idx) => {
                  const calc = oldCalc(row);
                  return (
                    <tr key={row.key}>
                      <td className="num-cell">{idx + 1}</td>
                      <td><input className="w-desc" value={row.description} onChange={(e) => setOld(row.key, "description", e.target.value)} /></td>
                      <td><input className="w-num" type="number" min="0" step="0.001" value={row.grossWt} onChange={(e) => setOld(row.key, "grossWt", e.target.value)} /></td>
                      <td><input className="w-num" type="number" min="0" step="0.001" value={row.lessWt} onChange={(e) => setOld(row.key, "lessWt", e.target.value)} /></td>
                      <td className="calc">{calc ? calc.netWt.toFixed(3) : "—"}</td>
                      <td><input className="w-sm" type="number" min="0" max="100" step="0.01" value={row.touch} onChange={(e) => setOld(row.key, "touch", e.target.value)} /></td>
                      <td className="calc">{calc ? calc.fineWt.toFixed(3) : "—"}</td>
                      {mode === "sale" && <td className="calc">{calc ? inr(calc.value) : "—"}</td>}
                      <td><button className="icon-btn" title="Remove" onClick={() => removeRow(setOldGold, row.key)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button className="add-row-btn" onClick={() => setOldGold([...oldGold, blankOld()])}>+ Add old gold</button>
        {mode === "job_work" && (
          <p className="hint">
            Gold needed (net weight): <strong>{grams(s.itemsFineWt)}</strong> fine · customer gave: <strong>{grams(s.oldGoldFineWt)}</strong> fine ·{" "}
            {s.addedFineWt > 0
              ? <>shop adds <strong>{grams(s.addedFineWt)}</strong> — <strong>only this gold is charged</strong></>
              : <>enough gold given — <strong>{grams(s.excessFineWt)}</strong> surplus is <strong>returned to the customer</strong> (no money)</>}
          </p>
        )}
      </div>

      {/* Totals + payments */}
      <div className="invoice-bottom">
        <div className="card section">
          <h3>{settle ? "Collect the remaining amount" : "Payments"}</h3>
          {settle && (
            <div className="received-box">
              <strong>Already received: {inr(received.reduce((n, p) => n + (p.amount || 0), 0))}</strong>
              {received.map((p, i) => <div key={i} className="sub">{p.mode} · {inr(p.amount)}{p.reference ? ` · ${p.reference}` : ""}</div>)}
              <div className="sub" style={{ marginTop: 6 }}>Remaining to collect: <strong>{inr(Math.max(0, s.payable - received.reduce((n, p) => n + (p.amount || 0), 0)))}</strong></div>
            </div>
          )}
          {payments.map((p) => (
            <div key={p.key} className="pay-row">
              <select value={p.mode} onChange={(e) => setPay(p.key, "mode", e.target.value)}>
                {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
              <input type="number" min="0" step="0.01" placeholder="Amount" value={p.amount} onChange={(e) => setPay(p.key, "amount", e.target.value)} />
              <input placeholder="Ref / UTR (optional)" value={p.reference} onChange={(e) => setPay(p.key, "reference", e.target.value)} />
              <button className="btn btn-sm btn-secondary" onClick={() => fillBalance(p.key)} title="Fill the remaining balance">= Balance</button>
              {payments.length > 1 && <button className="icon-btn" onClick={() => removeRow(setPayments, p.key)}>✕</button>}
            </div>
          ))}
          <button className="add-row-btn" onClick={() => setPayments([...payments, blankPayment()])}>+ Split payment</button>
          <label className="field" style={{ marginTop: 16 }}>Notes (printed on invoice)
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="card section totals-card">
          <h3>Bill summary</h3>
          {mode === "sale" && <Row label="Gold value" value={s.goldValue} />}
          <Row label="Making charges" value={s.makingTotal} />
          {mode === "job_work" && s.wastageTotal > 0 && <Row label="Wastage charges" value={s.wastageTotal} />}
          {mode === "job_work" && <div className="sub" style={{ margin: "4px 0 8px" }}>Customer's gold ({grams(s.oldGoldFineWt)} fine) is not charged.</div>}
          {s.stoneTotal > 0 && <Row label="Stone charges" value={s.stoneTotal} />}
          {s.taxLines.map((t) => (
            <div key={t.hsn} className="tax-block">
              <Row label={`Taxable — ${t.label} (HSN ${t.hsn})`} value={t.taxable} />
              {result.intraState ? (
                <>
                  <Row label={`CGST ${t.ratePct / 2}%`} value={t.cgst} small />
                  <Row label={`SGST ${t.ratePct / 2}%`} value={t.sgst} small />
                </>
              ) : <Row label={`IGST ${t.ratePct}%`} value={t.igst} small />}
            </div>
          ))}
          <Row label="Invoice total" value={s.invoiceTotal} strong />
          {s.credit > 0 && <Row label={s.creditLabel} value={-s.credit} />}
          {s.roundOff !== 0 && <Row label="Round off" value={s.roundOff} small />}
          <div className="grand-total">
            <span>{s.payable < 0 ? "Payable TO customer" : "Net payable"}</span>
            <strong>{inr(Math.abs(s.payable))}</strong>
          </div>
          <div className="words">{amountInWords(s.payable)}</div>
          <Row label="Paid now" value={s.paid} />
          <Row label="Balance due" value={s.balance} strong />

          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="issues">
              {errors.map((i) => <li key={i.code + i.message} className="err">⛔ {i.message}</li>)}
              {warnings.map((i) => <li key={i.code + i.message} className="warn">⚠️ {i.message}</li>)}
            </ul>
          )}
          {error && <div className="alert error">{error}</div>}
          <button className="btn-primary-heavy" disabled={saving || errors.length > 0} onClick={save}>
            {saving ? "Processing…" : (settle ? (isSecret ? "⚡ Finalize & Deliver (No Log)" : "✅ Finalize & deliver") : isSecret ? "⚡ Complete Sale & View Bill" : "✅ Save & Generate Invoice")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, small }) {
  return (
    <div className={`sum-row ${strong ? "strong" : ""} ${small ? "small" : ""}`}>
      <span>{label}</span><span>{inr(value)}</span>
    </div>
  );
}

/** Loads the invoice first when finalising a pending job-work bill (settleId), then shows the editor */
export default function NewInvoice(props) {
  const { settleId } = props;
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!settleId) return;
    api.get(`/invoices/${settleId}`).then(({ data }) => setInv(data)).catch((e) => setErr(errMsg(e)));
  }, [settleId]);
  if (settleId && err) return <div className="alert error">{err} <button className="link-btn inline" onClick={props.onBack}>Back</button></div>;
  if (settleId && !inv) return <div className="muted-text">Loading invoice…</div>;
  return <InvoiceEditor key={settleId || "new"} {...props} settle={settleId ? inv : null} />;
}
