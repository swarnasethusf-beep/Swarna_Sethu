import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { inr, displayDate, todayLocal, downloadCsv } from "./format";

const monthStart = () => todayLocal().slice(0, 8) + "01";

/**
 * 📈 Reports — sales summary, GST (HSN-wise) summary, payment modes, CSV export for the accountant
 */
function Reports({ onOpenInvoice }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    api.get("/reports/sales", { params: { from, to } })
      .then(({ data }) => setData(data))
      .catch((err) => setError(errMsg(err)));
  }, [from, to]);
  useEffect(load, [load]);

  const exportCsv = () => {
    downloadCsv(`sales_${from}_to_${to}.csv`, [
      ["Invoice No", "Date", "Status", "Type", "Customer", "Customer GSTIN", "Taxable", "CGST", "SGST", "IGST", "Old gold / credit", "Net payable"],
      ...data.invoices.map((i) => [i.invoiceNumber, i.date, i.status, i.mode === "job_work" ? "Job work" : "Sale", i.customerName, i.customerGstin,
        i.taxable, i.cgst, i.sgst, i.igst, i.credit, i.payable])
    ]);
  };

  const t = data?.totals;
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>Cancelled invoices are listed but excluded from totals</p>
        </div>
        {data && <button className="btn btn-secondary" onClick={exportCsv}>⬇️ Export CSV</button>}
      </div>

      <div className="filter-bar">
        <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error && <div className="alert error">{error}</div>}

      {t && (
        <>
          <div className="summary-grid four">
            <div className="summary-card"><span>Invoices</span><h2>{t.count}</h2><small>{t.sales} sale · {t.jobWork} job work · {t.cancelled} cancelled</small></div>
            <div className="summary-card"><span>Taxable value</span><h2>{inr(t.taxable)}</h2></div>
            <div className="summary-card"><span>GST collected</span><h2>{inr(t.tax)}</h2><small>CGST {inr(t.cgst)} · SGST {inr(t.sgst)} · IGST {inr(t.igst)}</small></div>
            <div className="summary-card"><span>Net billed</span><h2>{inr(t.payable)}</h2><small>Old gold/credit {inr(t.credit)} · Due {inr(t.balance)}</small></div>
          </div>

          <div className="two-col">
            <div className="table-card">
              <h3 className="table-title">GST summary (HSN/SAC-wise)</h3>
              <table className="admin-table">
                <thead><tr><th>HSN/SAC</th><th className="right">Taxable</th><th className="right">CGST</th><th className="right">SGST</th><th className="right">IGST</th></tr></thead>
                <tbody>
                  {data.byHsn.length === 0 && <tr><td colSpan={5} className="empty">No data</td></tr>}
                  {data.byHsn.map((h) => (
                    <tr key={`${h.hsn}@${h.ratePct}`}>
                      <td>{h.hsn} @ {h.ratePct}%</td><td className="right">{inr(h.taxable)}</td>
                      <td className="right">{inr(h.cgst)}</td><td className="right">{inr(h.sgst)}</td><td className="right">{inr(h.igst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-card">
              <h3 className="table-title">Payments received</h3>
              <table className="admin-table">
                <tbody>
                  {Object.keys(data.byPayment).length === 0 && <tr><td className="empty">No payments</td></tr>}
                  {Object.entries(data.byPayment).map(([mode, amt]) => (
                    <tr key={mode}><td>{mode}</td><td className="right">{inr(amt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-card">
            <h3 className="table-title">Invoices</h3>
            <table className="admin-table clickable">
              <thead><tr><th>Invoice No.</th><th>Date</th><th>Customer</th><th className="right">Taxable</th><th className="right">GST</th><th className="right">Credit</th><th className="right">Net</th><th>Status</th></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} onClick={() => onOpenInvoice(i.id)} className={i.status === "cancelled" ? "row-cancelled" : ""}>
                    <td>{i.invoiceNumber}</td><td>{displayDate(i.date)}</td><td>{i.customerName}</td>
                    <td className="right">{inr(i.taxable)}</td><td className="right">{inr(i.cgst + i.sgst + i.igst)}</td>
                    <td className="right">{inr(i.credit)}</td><td className="right strong">{inr(i.payable)}</td>
                    <td>{i.status === "cancelled" ? <span className="pill danger">Cancelled</span> : <span className="pill ok">Active</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default Reports;
