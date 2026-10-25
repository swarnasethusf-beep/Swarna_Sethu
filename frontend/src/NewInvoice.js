import React, { useState, useEffect, useMemo } from "react";
import api, { errMsg } from "./api";
import { computeInvoice, amountInWords, PURITIES, MAKING_TYPES, PAYMENT_MODES, STATES } from "./shared/billing";
import { inr, grams, todayLocal } from "./format";

let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;
const blankItem = () => ({
  key: rowKey(), productId: null, itemCode: "", description: "", purity: "22K", huid: "", hsn: "",
  pcs: 1, grossWt: "", stoneWt: "", wastagePct: "", makingType: "per_gram", makingValue: "", stoneCharges: "", rate: ""
});
const blankOld = () => ({ key: rowKey(), description: "Old gold", grossWt: "", lessWt: "", touch: "91.6" });
const blankPayment = () => ({ key: rowKey(), mode: "Cash", amount: "", reference: "" });
const strip = ({ key, ...rest }) => rest;
const EMPTY_ROW = { netWt: 0, fineWt: 0, goldValue: 0, makingAmount: 0, lineTotal: 0 };

/**
 * 🧾 New Invoice — live preview uses the same billing engine as the server.
 * The server recomputes everything on save; nothing the client sends as a total is trusted.
 */
function NewInvoice({ shop, onSaved, onBack, onGoRates }) {
  const [mode, setMode] = useState("sale");
  const [rates, setRates] = useState({ "24K": "", "22K": "", "18K": "", "14K": "" });
  const [ratesInfo, setRatesInfo] = useState(null);
  const [customer, setCustomer] = useState({ name: "", mobile: "", address: "", stateCode: shop.stateCode || "", gstin: "", pan: "" });
  const [items, setItems] = useState([blankItem()]);
  const [oldGold, setOldGold] = useState([]);
  const [payments, setPayments] = useState([blankPayment()]);
  const [staffOptions, setStaffOptions] = useState([]);
  const [assignedStaffId, setAssignedStaffId] = useState("");
  const [notes, setNotes] = useState("");
  const [hints, setHints] = useState({}); // row key → lookup message
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/rates").then(({ data }) => {
      setRatesInfo(data);
      setRates({ "24K": data["24K"] || "", "22K": data["22K"] || "", "18K": data["18K"] || "", "14K": data["14K"] || "" });
    }).catch(() => {});
    api.get("/staff/options").then(({ data }) => setStaffOptions(data)).catch(() => {});
  }, []);

  const input = { mode, rates, customer, items, oldGold, payments };
  const result = useMemo(() => computeInvoice(input, shop), [mode, rates, customer, items, oldGold, payments, shop]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowCalc = (row) => computeInvoice({ mode, rates, items: [row] }, shop).items[0] || EMPTY_ROW;
  const oldCalc = (row) => computeInvoice({ mode, rates, oldGold: [row] }, shop).oldGold[0];
  const s = result.summary;
  const errors = result.issues.filter((i) => i.level === "error");
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
    if (!code || row.productId) return;
    if (items.some((r) => r.key !== row.key && r.productId && r.itemCode === code)) {
      setHints((h) => ({ ...h, [row.key]: "Already on this bill." }));
      return;
    }
    try {
      const { data: p } = await api.get(`/products/lookup/${encodeURIComponent(code)}`);
      setItems((rows) => rows.map((r) => r.key !== row.key ? r : {
        ...r, productId: p.id, itemCode: p.itemCode, description: p.description, purity: p.purity || "22K",
        huid: p.huid || "", hsn: p.hsn || "", pcs: p.pcs || 1, grossWt: p.grossWt ?? "", stoneWt: p.stoneWt ?? "",
        wastagePct: p.wastagePct ?? "", makingType: p.makingType || "per_gram", makingValue: p.makingValue ?? "",
        stoneCharges: p.stoneCharges ?? ""
      }));
      setHints((h) => ({ ...h, [row.key]: "✔ From stock" }));
    } catch (err) {
      setHints((h) => ({ ...h, [row.key]: err.response?.status === 404 ? `${errMsg(err)} Enter details manually.` : errMsg(err) }));
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
    const others = payments.filter((p) => p.key !== key).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    setPay(key, "amount", Math.max(0, Math.round((s.payable - others) * 100) / 100) || "");
  };

  const save = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await api.post("/invoices", {
        mode, rates, customer,
        items: items.map(strip), oldGold: oldGold.map(strip), payments: payments.map(strip),
        assignedStaffId, notes
      });
      onSaved(data.id);
    } catch (err) {
      setError(errMsg(err, "Could not save the invoice."));
    } finally {
      setSaving(false);
    }
  };

  const ratesStale = ratesInfo && ratesInfo.date !== todayLocal();
  const c = (field) => ({ value: customer[field], onChange: (e) => setCustomer({ ...customer, [field]: e.target.value }) });

  return (
    <div className="invoice-editor">
      <div className="page-header no-print">
        <div>
          <h1>New Invoice</h1>
          <p>Bill date: today · number is assigned when you save</p>
        </div>
        <button className="btn btn-secondary" onClick={onBack}>← Back to List</button>
      </div>

      {/* Mode + rates */}
      <div className="card section">
        <div className="mode-toggle">
          <button className={mode === "sale" ? "active" : ""} onClick={() => setMode("sale")}>🛍️ Jewellery Sale</button>
          <button className={mode === "job_work" ? "active" : ""} onClick={() => setMode("job_work")}>🔨 Job Work (customer's gold)</button>
        </div>
        <p className="hint">
          {mode === "sale"
            ? "Shop sells jewellery. GST 3% on gold + making + stones. Customer's old gold is deducted after tax."
            : "Goldsmith makes jewellery from the customer's gold. Extra fine gold added by the shop is billed at the 24K rate (3% GST); making/stone labour is job work (5% GST). Surplus customer gold is credited."}
        </p>
        <div className="rates-row">
          <strong>Rates for this bill (₹/g):</strong>
          {Object.keys(PURITIES).map((p) => (
            <label key={p} className="rate-input">
              {p}
              <input type="number" min="0" step="0.01" value={rates[p]} onChange={(e) => setRates({ ...rates, [p]: e.target.value })} />
            </label>
          ))}
          {(ratesStale || !ratesInfo?.date) && (
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
            <input {...c("mobile")} inputMode="numeric" placeholder="10 digits — finds returning customers"
              onChange={(e) => setCustomer({ ...customer, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              onBlur={lookupCustomer} />
          </label>
          <label className="field">Name *<input {...c("name")} /></label>
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
          <label className="field">Assign goldsmith
            <select value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)}>
              <option value="">— None —</option>
              {staffOptions.map((st) => <option key={st.id} value={st.id}>{st.fullName} ({st.designation})</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Items */}
      <div className="card section">
        <h3>{mode === "sale" ? "Items sold" : "Items made"}</h3>
        <div className="table-scroll">
          <table className="edit-table">
            <thead>
              <tr>
                <th>#</th><th>Item code</th><th>Description *</th><th>Purity</th><th>HUID</th>
                <th>Gross g</th><th>Stone g</th><th>Net g</th><th>Wastage %</th>
                <th>Making</th><th>Stone ₹</th>
                {mode === "sale" ? <><th>Rate ₹/g</th><th>Gold value</th></> : <th>Fine g</th>}
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
                      <input className="w-code" value={row.itemCode} placeholder="Code ↵"
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
                    <td><input className="w-sm" type="number" min="0" step="0.01" value={row.wastagePct} onChange={(e) => setItem(row.key, "wastagePct", e.target.value)} /></td>
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
                    ) : <td className="calc">{calc.fineWt.toFixed(3)}</td>}
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
        <h3>{mode === "sale" ? "Old gold exchange (optional)" : "Customer's gold received"}</h3>
        {oldGold.length > 0 && (
          <div className="table-scroll">
            <table className="edit-table">
              <thead>
                <tr><th>#</th><th>Description</th><th>Gross g</th><th>Less (stone/dust) g</th><th>Net g</th><th>Touch / purity %</th><th>Fine g</th><th>Value @ 24K</th><th></th></tr>
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
                      <td className="calc">{calc ? inr(calc.value) : "—"}</td>
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
            Gold needed: <strong>{grams(s.itemsFineWt)}</strong> fine · received: <strong>{grams(s.oldGoldFineWt)}</strong> fine ·{" "}
            {s.addedFineWt > 0 ? <>shop adds <strong>{grams(s.addedFineWt)}</strong></> : <>customer surplus <strong>{grams(s.excessFineWt)}</strong> (credited)</>}
          </p>
        )}
      </div>

      {/* Totals + payments */}
      <div className="invoice-bottom">
        <div className="card section">
          <h3>Payments</h3>
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
            {saving ? "Saving…" : "✅ Save & Generate Invoice"}
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

export default NewInvoice;
