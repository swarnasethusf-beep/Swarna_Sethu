import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { amountInWords, STATES, PAYMENT_MODES } from "./shared/billing";
import { inr, displayDate } from "./format";
import { printInvoice, saveInvoicePdf, isDesktop } from "./printing";
import { InvoiceHeader, PRINT_DEFAULTS } from "./BrandingSettings";

const stateName = (code) => STATES.find((s) => s.code === code)?.name || "";
// Plain amounts inside the wide tables (the ₹ is in the column heading) so all columns fit on A4
const amt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumWt = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0).toFixed(3);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

/**
 * 🖨️ Printable GST tax invoice. Print and Save PDF both use the print layout, so the
 * PDF carries every detail shown on the printed invoice.
 * `autoAction` ("print" | "pdf") runs once the invoice has loaded (used by the list's quick buttons).
 */
function InvoiceView({ id, invoiceData, canCancel, canBill, onSettle, onBack, onNew, autoAction, onAutoActionDone, branding }) {
  const [inv, setInv] = useState(invoiceData || null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [pdfMsg, setPdfMsg] = useState({ text: "", type: "" });
  const [pay, setPay] = useState(null);                       // payment dialog: { mode, amount, reference }
  const [jobMsg, setJobMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  const markReady = async () => {
    setBusy(true); setJobMsg({ text: "", type: "" });
    try { await api.post(`/invoices/${id || inv.id}/ready`); load(); } catch (err) { setJobMsg({ text: errMsg(err), type: "error" }); } finally { setBusy(false); }
  };
  const submitPayment = async (e) => {
    e.preventDefault();
    setBusy(true); setJobMsg({ text: "", type: "" });
    try {
      await api.post(`/invoices/${id || inv.id}/payments`, pay);
      setPay(null); load();
      setJobMsg({ text: "✅ Payment recorded.", type: "success" });
    } catch (err) { setJobMsg({ text: errMsg(err), type: "error" }); } finally { setBusy(false); }
  };

  const load = useCallback(() => {
    if (invoiceData) {
      setInv(invoiceData);
      return;
    }
    if (!id) return;
    api.get(`/invoices/${id}`).then(({ data }) => setInv(data)).catch((err) => setError(errMsg(err)));
  }, [id, invoiceData]);
  useEffect(load, [load]);

  const savePdf = useCallback(async (invoice) => {
    setPdfMsg({ text: "", type: "" });
    try {
      const res = await saveInvoicePdf(invoice);
      if (res?.filePath) setPdfMsg({ text: `✅ Saved: ${res.filePath}`, type: "success" });
      else if (res?.browser) setPdfMsg({ text: "In the print dialog, choose “Save as PDF” as the destination.", type: "warn" });
    } catch (err) {
      setPdfMsg({ text: `Could not save the PDF: ${err.message}`, type: "error" });
    }
  }, []);

  // Quick action from the invoice list: wait for the page to render, then print / save
  useEffect(() => {
    if (!inv || !autoAction) return;
    const t = setTimeout(() => {
      if (autoAction === "print") printInvoice(inv);
      else if (autoAction === "pdf") savePdf(inv);
      onAutoActionDone?.();
    }, 300);
    return () => clearTimeout(t);
  }, [inv, autoAction, onAutoActionDone, savePdf]);

  const cancel = async () => {
    const reason = window.prompt("Reason for cancelling this invoice? (The number is kept and marked cancelled.)");
    if (!reason) return;
    setCancelling(true);
    try {
      await api.post(`/invoices/${id}/cancel`, { reason });
      load();
    } catch (err) {
      alert(errMsg(err));
    } finally {
      setCancelling(false);
    }
  };

  if (error) return <div className="alert error">{error} <button className="link-btn inline" onClick={onBack}>Back</button></div>;
  if (!inv) return <div className="muted-text">Loading invoice…</div>;

  const legacy = !inv.summary;
  const s = inv.summary || {};
  const shop = inv.shop || {};
  const print = { ...PRINT_DEFAULTS, ...branding?.print };   // the shop's current print layout (Settings)
  const cust = inv.customer || { name: inv.customerName, mobile: inv.customerContact, address: inv.customerAddress };
  const cancelled = inv.status === "cancelled";
  const jobWork = inv.mode === "job_work";

  const isSecret = !!inv.isSecret;
  const fs = inv.fulfilmentStatus || "";
  const openJob = !cancelled && (fs === "pending" || fs === "ready");   // job work not yet handed over
  const orderStage = inv.stage === "order";                              // phase 1: an order receipt, no bill amount yet
  const balance = s.balance || 0;
  const WORK = { assigned: "waiting for the goldsmith to start", in_progress: "goldsmith is working on it", completed: "goldsmith finished", closed: "closed", cancelled: "cancelled" };

  return (
    <div>
      <div className="page-header no-print">
        <div>
          <h1>Invoice {inv.invoiceNumber} {isSecret && <span className="pill warn">🔒 Unrecorded</span>}</h1>
          <p>{cancelled ? `Cancelled — ${inv.cancelReason}` : (isSecret ? "Confidential Invoice · Not saved to database" : `Created by ${inv.createdByName || "—"}`)}</p>
        </div>
        <div className="btn-group">
          <button className="btn btn-secondary" onClick={onBack}>← Invoices</button>
          {onNew && <button className="btn btn-secondary" onClick={onNew}>{isSecret ? "➕ New Direct" : "➕ New"}</button>}
          {canBill && openJob && fs === "pending" && <button className="btn btn-secondary" disabled={busy} onClick={markReady} title="Use this when the work is done but the goldsmith didn't update it">✅ Mark work ready</button>}
          {canBill && !cancelled && !legacy && !isSecret && (balance > 0 || orderStage) && (
            <button className="btn btn-secondary" onClick={() => setPay({ mode: "Cash", amount: "", reference: "" })}>{orderStage ? "💰 Add advance" : "💰 Receive payment"}</button>
          )}
          {canBill && openJob && onSettle && <button className="btn btn-primary" onClick={onSettle}>📦 Finalize &amp; deliver</button>}
          {canCancel && !cancelled && !legacy && !isSecret && (
            <button className="btn btn-danger" disabled={cancelling} onClick={cancel}>Cancel invoice</button>
          )}
          <button className="btn btn-secondary" onClick={() => savePdf(inv)} title={isDesktop() ? "Save as a PDF file" : "Opens the print dialog — choose “Save as PDF”"}>⬇️ Save PDF</button>
          <button className="btn btn-primary" onClick={() => printInvoice(inv)}>🖨️ Print</button>
        </div>
      </div>
      {isSecret && openJob && (
        <div className="alert warn no-print" style={{ marginBottom: 12 }}>
          🔒 <strong>Unrecorded Job Order (Phase 1):</strong> Currently in progress in workshop. Once finalized &amp; delivered in Phase 2, this invoice and work order will be <strong>permanently deleted</strong> from database logs.
        </div>
      )}
      {isSecret && !openJob && (
        <div className="alert warn no-print" style={{ marginBottom: 12 }}>
          ℹ️ This invoice was completed in confidential mode and was <strong>not saved</strong> in the database log. Any billed stock items and work orders were <strong>permanently deleted</strong> from Firebase.
        </div>
      )}
      {pdfMsg.text && <div className={`alert ${pdfMsg.type} no-print`}>{pdfMsg.text}</div>}
      {jobMsg.text && <div className={`alert ${jobMsg.type} no-print`}>{jobMsg.text}</div>}
      {openJob && (
        <div className={`alert ${fs === "ready" ? "success" : "warn"} no-print`} style={{ lineHeight: 1.6 }}>
          {fs === "ready"
            ? <>📞 <strong>The work is ready.</strong> Call {cust.name}{cust.mobile ? ` on ${cust.mobile}` : ""} to collect it. {orderStage ? <>Advance held: <strong>{inr(s.paid)}</strong>. The final bill is prepared at pickup.</> : balance > 0 ? <>Balance expected at pickup: <strong>{inr(balance)}</strong> (may change with the final weight).</> : null}</>
            : <>⏳ <strong>Job work in progress.</strong> {inv.workOrderNo ? `${inv.workOrderNo} — ${WORK[inv.workStatus] || "with the goldsmith"}. ` : "No goldsmith login is linked — use “Mark work ready” when it is done. "}
              {orderStage ? <>Advance held: <strong>{inr(s.paid)}</strong>.</> : <>Estimated balance at pickup: <strong>{inr(balance)}</strong>.</>}</>}
          {" "}Use <strong>Finalize &amp; deliver</strong> at pickup to enter the finished weight and any extra gold.
        </div>
      )}
      {fs === "delivered" && !cancelled && (
        <div className="alert success no-print">✔ Delivered {inv.deliveredAt ? `on ${new Date(inv.deliveredAt).toLocaleDateString("en-IN")}` : ""}{inv.deliveredByName ? ` by ${inv.deliveredByName}` : ""}.</div>
      )}
      {pay && (
        <div className="modal-backdrop no-print" onClick={() => setPay(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitPayment}>
            <h3>Receive payment — {inv.invoiceNumber}</h3>
            <p className="hint">{orderStage ? <>Advance held so far: <strong>{inr(s.paid)}</strong></> : <>Balance due: <strong>{inr(balance)}</strong></>}</p>
            <label className="field">Mode
              <select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="field">Amount received (₹)
              <input type="number" min="0.01" step="0.01" autoFocus required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            </label>
            <button type="button" className="link-btn inline" onClick={() => setPay({ ...pay, amount: balance })}>= full balance ({inr(balance)})</button>
            <label className="field" style={{ marginTop: 8 }}>Reference / UTR (optional)
              <input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            </label>
            <div className="btn-group">
              <button className="btn btn-primary" type="submit" disabled={busy}>Save payment</button>
              <button className="btn btn-secondary" type="button" onClick={() => setPay(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className={`print-invoice pi-size-${print.fontSize} ${cancelled ? "cancelled" : ""}`} style={{ "--pi-accent": print.accentColor }}>
        {cancelled && <div className="watermark">CANCELLED</div>}

        <InvoiceHeader
          shop={shop}
          print={print}
          logoUrl={branding?.logoUrl}
          stateName={stateName}
          title={isSecret ? "ESTIMATE / RETAIL INVOICE" : orderStage ? "JOB WORK ORDER RECEIPT" : openJob ? "JOB WORK ORDER — PROVISIONAL" : (jobWork ? "TAX INVOICE — JOB WORK" : print.invoiceTitle || "TAX INVOICE")}
          meta={
            <table className="pi-meta">
              <tbody>
                <tr><td>Invoice No.</td><td><strong>{inv.invoiceNumber}</strong></td></tr>
                <tr><td>Date</td><td>{displayDate(inv.date)}</td></tr>
                {inv.createdAt && <tr><td>Time</td><td>{new Date(inv.createdAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}</td></tr>}
                <tr><td>Type</td><td>{jobWork ? "Job work (customer's gold)" : "Jewellery sale"}</td></tr>
                {inv.createdByName && <tr><td>Billed by</td><td>{inv.createdByName}</td></tr>}
                {inv.assignedStaffName && <tr><td>Goldsmith</td><td>{inv.assignedStaffName}</td></tr>}
              </tbody>
            </table>
          }
        />

        <div className="pi-party">
          <div><strong>Bill to:</strong> {cust.name || "—"}</div>
          {cust.address && <div>{cust.address}</div>}
          <div>
            {[cust.mobile && `Mobile: ${cust.mobile}`, cust.gstin && `GSTIN: ${cust.gstin}`, cust.pan && `PAN: ${cust.pan}`].filter(Boolean).join(" · ")}
          </div>
          {cust.stateCode && <div>Place of supply: {stateName(cust.stateCode)} ({cust.stateCode})</div>}
        </div>

        {cancelled && (
          <div className="pi-cancel">
            <strong>CANCELLED</strong>{inv.cancelledAt ? ` on ${fmtTime(inv.cancelledAt)}` : ""}
            {inv.cancelledByName ? ` by ${inv.cancelledByName}` : ""} — Reason: {inv.cancelReason || "—"}
          </div>
        )}
        {openJob && !orderStage && (
          <div className="pi-cancel" style={{ borderColor: "#b8860b", color: "#7a5a07" }}>
            <strong>PROVISIONAL.</strong> This is the order receipt. The amount is an estimate from the weights at the time of the order;
            the final tax invoice (same number) is issued when the finished piece is delivered. Advance received: {inr(s.paid)}.
          </div>
        )}
        {!legacy && !orderStage && print.showRates && (
          <div className="pi-rates">
            <span>
              <strong>Rates applied (₹/g):</strong>{" "}
              {Object.entries(inv.rates || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${inr(v)}`).join(" · ") || "—"}
            </span>
            <span>
              <strong>Supply:</strong> {inv.intraState ? "Intra-state (CGST + SGST)" : "Inter-state (IGST)"}
            </span>
          </div>
        )}

        {legacy ? (
          <p className="muted-text">This invoice was created with an older version of the app; only its total is available: <strong>{inr(inv.totals?.grand)}</strong></p>
        ) : orderStage ? (
          <>
            <table className="pi-table">
              <thead><tr><th>Job code</th><th>What is to be made</th><th>Purity</th>{inv.dueDate && <th>Promised by</th>}</tr></thead>
              <tbody><tr>
                <td className="left"><strong>{inv.items[0]?.itemCode}</strong></td>
                <td className="left">{inv.items[0]?.description}</td>
                <td>{inv.items[0]?.purity}</td>
                {inv.dueDate && <td>{displayDate(inv.dueDate)}</td>}
              </tr></tbody>
            </table>
            {inv.oldGold?.length > 0 && (
              <table className="pi-table">
                <thead><tr><th>#</th><th>Customer's gold received (weighed — not charged)</th><th>Gross g</th><th>Less g</th><th>Net g</th><th>Touch %</th><th>Fine g</th></tr></thead>
                <tbody>
                  {inv.oldGold.map((o, i) => (
                    <tr key={i}><td>{i + 1}</td><td className="left">{o.description}</td><td>{o.grossWt.toFixed(3)}</td><td>{o.lessWt.toFixed(3)}</td><td>{o.netWt.toFixed(3)}</td><td>{o.touch}</td><td>{o.fineWt.toFixed(3)}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td></td><td className="left">Total</td><td></td><td></td><td>{s.oldGoldNetWt.toFixed(3)}</td><td></td><td>{s.oldGoldFineWt.toFixed(3)}</td></tr></tfoot>
              </table>
            )}
            <div className="pi-bottom">
              <div className="pi-left">
                {inv.payments?.length > 0 && (
                  <table className="pi-table compact pi-paytable">
                    <thead><tr><th>Advance received</th><th>Reference</th><th>Amount</th></tr></thead>
                    <tbody>{inv.payments.map((p, i) => <tr key={i}><td className="left">{p.mode}</td><td className="left">{p.reference || "—"}</td><td>{inr(p.amount)}</td></tr>)}</tbody>
                  </table>
                )}
                {inv.notes && <div className="pi-pay"><strong>Notes:</strong> {inv.notes}</div>}
                <div className="pi-pay">
                  This is an order receipt, not a tax invoice. The customer's gold is not charged. After the piece is made, the final bill
                  (new gold added by the shop, making, stones and wastage, with GST) is prepared under this same number and your advance is deducted.
                </div>
              </div>
              <table className="pi-totals"><tbody><tr className="grand"><td>Advance received</td><td>{inr(s.paid)}</td></tr></tbody></table>
            </div>
          </>
        ) : (
          <>
            <table className="pi-table">
              <thead>
                <tr>
                  <th>#</th><th>Description</th><th>HSN</th><th>Purity</th><th>Pcs</th>
                  <th>Gross g</th><th>Stone g</th><th>Net g</th><th>VA %</th>
                  {jobWork ? <><th>Fine g</th><th>Wastage ₹</th></> : <><th>Rate ₹/g</th><th>Gold value ₹</th></>}
                  <th>Making ₹</th><th>Stone ₹</th><th>Amount ₹</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="left">
                      {it.description}
                      {print.showItemCodes && it.itemCode && <div className="sub">Code: {it.itemCode}</div>}
                      {print.showItemCodes && it.huid && <div className="sub">HUID: {it.huid}</div>}
                    </td>
                    <td>{it.hsn}</td><td>{it.purity}</td><td>{it.pcs}</td>
                    <td>{it.grossWt.toFixed(3)}</td><td>{it.stoneWt.toFixed(3)}</td><td>{it.netWt.toFixed(3)}</td>
                    <td>{it.wastagePct || "—"}</td>
                    {jobWork ? <><td>{it.fineWt.toFixed(3)}</td><td>{amt(it.wastageAmount)}</td></> : <><td>{amt(it.rate)}</td><td>{amt(it.goldValue)}</td></>}
                    <td>{amt(it.makingAmount)}</td><td>{amt(it.stoneCharges)}</td>
                    <td><strong>{amt(it.lineTotal)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td></td><td className="left">Total</td><td></td><td></td>
                  <td>{inv.items.reduce((n, it) => n + (it.pcs || 0), 0)}</td>
                  <td>{sumWt(inv.items, "grossWt")}</td><td>{sumWt(inv.items, "stoneWt")}</td><td>{sumWt(inv.items, "netWt")}</td>
                  <td></td>
                  {jobWork ? <><td>{s.itemsFineWt.toFixed(3)}</td><td>{amt(s.wastageTotal)}</td></> : <><td></td><td>{amt(s.goldValue)}</td></>}
                  <td>{amt(s.makingTotal)}</td><td>{amt(s.stoneTotal)}</td>
                  <td>{amt(inv.items.reduce((n, it) => n + it.lineTotal, 0))}</td>
                </tr>
              </tfoot>
            </table>

            {inv.oldGold?.length > 0 && (
              <table className="pi-table">
                <thead>
                  <tr><th>#</th><th>{jobWork ? "Customer's gold received (not charged)" : "Old gold exchanged"}</th><th>Gross g</th><th>Less g</th><th>Net g</th><th>Touch %</th><th>Fine g</th>{!jobWork && <><th>Rate 24K ₹/g</th><th>Value ₹</th></>}</tr>
                </thead>
                <tbody>
                  {inv.oldGold.map((o, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td><td className="left">{o.description}</td>
                      <td>{o.grossWt.toFixed(3)}</td><td>{o.lessWt.toFixed(3)}</td><td>{o.netWt.toFixed(3)}</td>
                      <td>{o.touch}</td><td>{o.fineWt.toFixed(3)}</td>{!jobWork && <><td>{amt(o.rate)}</td><td>{amt(o.value)}</td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {jobWork && (
              <p className="pi-note">
                The customer's own gold is not charged. Fine gold needed {s.itemsFineWt.toFixed(3)} g · received from customer {s.oldGoldFineWt.toFixed(3)} g ·{" "}
                {s.addedFineWt > 0 ? `added by the shop ${s.addedFineWt.toFixed(3)} g (charged)` : `surplus ${s.excessFineWt.toFixed(3)} g returned to the customer`}
              </p>
            )}

            <div className="pi-bottom">
              <div className="pi-left">
                <table className="pi-table compact">
                  <thead>
                    <tr><th>HSN/SAC</th><th>Taxable</th>{inv.intraState ? <><th>CGST</th><th>SGST</th></> : <th>IGST</th>}<th>Total tax</th></tr>
                  </thead>
                  <tbody>
                    {s.taxLines.map((t) => (
                      <tr key={t.hsn}>
                        <td>{t.hsn} @ {t.ratePct}%</td><td>{inr(t.taxable)}</td>
                        {inv.intraState ? <><td>{inr(t.cgst)}</td><td>{inr(t.sgst)}</td></> : <td>{inr(t.igst)}</td>}
                        <td>{inr(t.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pi-words"><strong>Amount in words:</strong> {amountInWords(s.payable)}{s.payable < 0 ? " (payable to customer)" : ""}</div>
                {inv.payments?.length > 0 && (
                  <table className="pi-table compact pi-paytable">
                    <thead><tr><th>Payment mode</th><th>Reference</th><th>Amount</th></tr></thead>
                    <tbody>
                      {inv.payments.map((p, i) => (
                        <tr key={i}><td className="left">{p.mode}</td><td className="left">{p.reference || "—"}</td><td>{inr(p.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {inv.notes && <div className="pi-pay"><strong>Notes:</strong> {inv.notes}</div>}
              </div>
              <table className="pi-totals">
                <tbody>
                  <tr><td>Taxable value</td><td>{inr(s.taxable)}</td></tr>
                  {inv.intraState ? (
                    <><tr><td>CGST</td><td>{inr(s.cgst)}</td></tr><tr><td>SGST</td><td>{inr(s.sgst)}</td></tr></>
                  ) : <tr><td>IGST</td><td>{inr(s.igst)}</td></tr>}
                  <tr className="strong"><td>Invoice total</td><td>{inr(s.invoiceTotal)}</td></tr>
                  {s.credit > 0 && <tr><td>{s.creditLabel}</td><td>- {inr(s.credit)}</td></tr>}
                  {s.roundOff !== 0 && <tr><td>Round off</td><td>{inr(s.roundOff)}</td></tr>}
                  <tr className="grand"><td>{s.payable < 0 ? "Payable to customer" : "Net payable"}</td><td>{inr(Math.abs(s.payable))}</td></tr>
                  <tr><td>Paid</td><td>{inr(s.paid)}</td></tr>
                  <tr className="strong"><td>Balance due</td><td>{inr(s.balance)}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="pi-foot">
          <div className="pi-terms">{shop.terms || "Goods once sold will be exchanged as per shop policy. Subject to local jurisdiction."}</div>
          {print.showCustomerSignature && (
            <div className="pi-sign">
              <div>&nbsp;</div>
              <div className="sign-line">Customer signature</div>
            </div>
          )}
          <div className="pi-sign">
            <div>For {shop.name}</div>
            <div className="sign-line">{print.signatoryLabel}</div>
          </div>
        </div>
        {print.footerNote && <div className="pi-footnote">{print.footerNote}</div>}
        <div className="pi-system">Computer-generated invoice · Printed {fmtTime(new Date().toISOString())}</div>
      </div>

      {inv.revisions?.length > 0 && (
        <div className="card section no-print" style={{ marginTop: 16 }}>
          <h3>Changes at delivery</h3>
          {inv.revisions.map((r, i) => (
            <div key={i} className="sub" style={{ marginBottom: 6 }}>
              {new Date(r.at).toLocaleString("en-IN")} · {r.byName} · {r.reason}:{" "}
              {r.before?.stage === "order"
                ? <>order receipt (advance {inr(r.before?.summary?.paid)}) → final bill <strong>{inr(s.payable)}</strong></>
                : <>total <strong>{inr(r.before?.summary?.payable)}</strong> → <strong>{inr(s.payable)}</strong> (fine gold added {Number(r.before?.summary?.addedFineWt || 0).toFixed(3)} g → {Number(s.addedFineWt || 0).toFixed(3)} g)</>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default InvoiceView;
