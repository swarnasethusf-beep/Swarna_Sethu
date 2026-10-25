import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { amountInWords, STATES } from "./shared/billing";
import { inr, displayDate } from "./format";
import { printInvoice, saveInvoicePdf, isDesktop } from "./printing";

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
function InvoiceView({ id, canCancel, onBack, onNew, autoAction, onAutoActionDone }) {
  const [inv, setInv] = useState(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [pdfMsg, setPdfMsg] = useState({ text: "", type: "" });

  const load = useCallback(() => {
    api.get(`/invoices/${id}`).then(({ data }) => setInv(data)).catch((err) => setError(errMsg(err)));
  }, [id]);
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
  const cust = inv.customer || { name: inv.customerName, mobile: inv.customerContact, address: inv.customerAddress };
  const cancelled = inv.status === "cancelled";
  const jobWork = inv.mode === "job_work";

  return (
    <div>
      <div className="page-header no-print">
        <div>
          <h1>Invoice {inv.invoiceNumber}</h1>
          <p>{cancelled ? `Cancelled — ${inv.cancelReason}` : `Created by ${inv.createdByName || "—"}`}</p>
        </div>
        <div className="btn-group">
          <button className="btn btn-secondary" onClick={onBack}>← Invoices</button>
          {onNew && <button className="btn btn-secondary" onClick={onNew}>➕ New</button>}
          {canCancel && !cancelled && !legacy && (
            <button className="btn btn-danger" disabled={cancelling} onClick={cancel}>Cancel invoice</button>
          )}
          <button className="btn btn-secondary" onClick={() => savePdf(inv)} title={isDesktop() ? "Save as a PDF file" : "Opens the print dialog — choose “Save as PDF”"}>⬇️ Save PDF</button>
          <button className="btn btn-primary" onClick={() => printInvoice(inv)}>🖨️ Print</button>
        </div>
      </div>
      {pdfMsg.text && <div className={`alert ${pdfMsg.type} no-print`}>{pdfMsg.text}</div>}

      <div className={`print-invoice ${cancelled ? "cancelled" : ""}`}>
        {cancelled && <div className="watermark">CANCELLED</div>}

        <div className="pi-head">
          <div>
            <h2>{shop.name || "—"}</h2>
            {shop.address && <div>{shop.address}</div>}
            {(shop.phone || shop.email) && <div>{[shop.phone && `Ph: ${shop.phone}`, shop.email].filter(Boolean).join(" · ")}</div>}
            {shop.gstin && <div><strong>GSTIN:</strong> {shop.gstin}</div>}
            {shop.stateCode && <div>State: {stateName(shop.stateCode)} ({shop.stateCode})</div>}
          </div>
          <div className="pi-title">
            <div className="pi-doc">TAX INVOICE{jobWork ? " — JOB WORK" : ""}</div>
            <div className="pi-copy">Original for recipient</div>
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
          </div>
        </div>

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
        {!legacy && (
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
        ) : (
          <>
            <table className="pi-table">
              <thead>
                <tr>
                  <th>#</th><th>Description</th><th>HSN</th><th>Purity</th><th>Pcs</th>
                  <th>Gross g</th><th>Stone g</th><th>Net g</th><th>VA %</th>
                  {jobWork ? <th>Fine g</th> : <><th>Rate ₹/g</th><th>Gold value ₹</th></>}
                  <th>Making ₹</th><th>Stone ₹</th><th>Amount ₹</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="left">
                      {it.description}
                      {it.itemCode && <div className="sub">Code: {it.itemCode}</div>}
                      {it.huid && <div className="sub">HUID: {it.huid}</div>}
                    </td>
                    <td>{it.hsn}</td><td>{it.purity}</td><td>{it.pcs}</td>
                    <td>{it.grossWt.toFixed(3)}</td><td>{it.stoneWt.toFixed(3)}</td><td>{it.netWt.toFixed(3)}</td>
                    <td>{it.wastagePct || "—"}</td>
                    {jobWork ? <td>{it.fineWt.toFixed(3)}</td> : <><td>{amt(it.rate)}</td><td>{amt(it.goldValue)}</td></>}
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
                  {jobWork ? <td>{s.itemsFineWt.toFixed(3)}</td> : <><td></td><td>{amt(s.goldValue)}</td></>}
                  <td>{amt(s.makingTotal)}</td><td>{amt(s.stoneTotal)}</td>
                  <td>{amt(inv.items.reduce((n, it) => n + it.lineTotal, 0))}</td>
                </tr>
              </tfoot>
            </table>

            {inv.oldGold?.length > 0 && (
              <table className="pi-table">
                <thead>
                  <tr><th>#</th><th>{jobWork ? "Customer's gold received" : "Old gold exchanged"}</th><th>Gross g</th><th>Less g</th><th>Net g</th><th>Touch %</th><th>Fine g</th><th>Rate 24K ₹/g</th><th>Value ₹</th></tr>
                </thead>
                <tbody>
                  {inv.oldGold.map((o, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td><td className="left">{o.description}</td>
                      <td>{o.grossWt.toFixed(3)}</td><td>{o.lessWt.toFixed(3)}</td><td>{o.netWt.toFixed(3)}</td>
                      <td>{o.touch}</td><td>{o.fineWt.toFixed(3)}</td><td>{amt(o.rate)}</td><td>{amt(o.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {jobWork && (
              <p className="pi-note">
                Fine gold required {s.itemsFineWt.toFixed(3)} g · received {s.oldGoldFineWt.toFixed(3)} g ·{" "}
                {s.addedFineWt > 0 ? `supplied by shop ${s.addedFineWt.toFixed(3)} g` : `customer surplus ${s.excessFineWt.toFixed(3)} g`}
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
          <div className="pi-sign">
            <div>&nbsp;</div>
            <div className="sign-line">Customer signature</div>
          </div>
          <div className="pi-sign">
            <div>For {shop.name}</div>
            <div className="sign-line">Authorised signatory</div>
          </div>
        </div>
        <div className="pi-system">Computer-generated invoice · Printed {fmtTime(new Date().toISOString())}</div>
      </div>
    </div>
  );
}

export default InvoiceView;
