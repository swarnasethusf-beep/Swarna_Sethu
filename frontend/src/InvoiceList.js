import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { inr, displayDate, daysAgo, todayLocal } from "./format";

/**
 * 📋 Invoice List — date range + search, click a row to open the printable invoice
 */
function InvoiceList({ canCreate, showCreatedBy, onNewInvoice, onOpen }) {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayLocal());
  const [q, setQ] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await api.get("/invoices", { params: { from, to, q } });
      setInvoices(data.invoices);
    } catch (err) {
      setError(errMsg(err, "Failed to load invoices."));
    } finally {
      setLoading(false);
    }
  }, [from, to, q]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing in search
    return () => clearTimeout(t);
  }, [load]);

  const active = invoices.filter((i) => i.status !== "cancelled");
  const total = active.reduce((s, i) => s + (i.payable || 0), 0);
  const due = active.reduce((s, i) => s + Math.max(0, i.balance || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Invoices</h1>
          <p>{active.length} bills · {inr(total)}{due > 0 ? ` · ${inr(due)} due` : ""}</p>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={onNewInvoice}>➕ New Invoice</button>}
      </div>

      <div className="filter-bar">
        <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <input className="search" placeholder="🔍 Invoice no., customer or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <div className="alert error">{error}</div>}
      <div className="table-card">
        {loading ? (
          <div className="empty">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="empty">
            <div className="big-emoji">📜</div>
            <p><strong>No invoices in this period</strong></p>
            {canCreate && <p>Click “New Invoice” to create a bill.</p>}
          </div>
        ) : (
          <table className="admin-table clickable">
            <thead>
              <tr>
                <th>Invoice No.</th><th>Date</th><th>Customer</th><th>Type</th><th>Payment</th>
                <th className="right">Amount</th><th className="right">Balance</th><th>Status</th>
                {showCreatedBy && <th>Created By</th>}
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} onClick={() => onOpen(inv.id)} className={inv.status === "cancelled" ? "row-cancelled" : ""}>
                  <td className="nowrap"><span className="pill gold">{inv.invoiceNumber || "—"}</span></td>
                  <td className="nowrap">{displayDate(inv.date)}</td>
                  <td><strong>{inv.customerName || "—"}</strong><div className="sub">{inv.customerMobile}</div></td>
                  <td>{inv.mode === "job_work" ? "Job work" : "Sale"}</td>
                  <td>{inv.paymentModes || "—"}</td>
                  <td className="right strong nowrap">{inr(inv.payable)}</td>
                  <td className="right nowrap">{inv.balance > 0 ? <span className="text-warn">{inr(inv.balance)}</span> : "—"}</td>
                  <td>{inv.status === "cancelled" ? <span className="pill danger">Cancelled</span> : <span className="pill ok">Active</span>}</td>
                  {showCreatedBy && <td className="nowrap"><span className="pill blue">👤 {inv.createdByName || "—"}</span></td>}
                  <td className="nowrap no-print" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-secondary" title="Print invoice" onClick={() => onOpen(inv.id, "print")}>🖨️ Print</button>{" "}
                    <button className="btn btn-sm btn-secondary" title="Save invoice as PDF" onClick={() => onOpen(inv.id, "pdf")}>⬇️ PDF</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default InvoiceList;
