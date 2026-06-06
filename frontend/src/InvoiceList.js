import React, { useState, useEffect } from "react";
import axios from "axios";

/**
 * 📋 Invoice List — shows all invoices with "New Invoice" button
 */
function InvoiceList({ licenseDocId, userId, userRole, showCreatedBy, onNewInvoice }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const res = await axios.get("http://localhost:5000/invoices", {
        params: { licenseDocId, role: userRole, userId }
      });
      setInvoices(res.data);
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) =>
    `₹ ${parseFloat(val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    return dateStr;
  };

  return (
    <div className="staff-mgmt-page">
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1>Invoices</h1>
          <p>View and manage all billing records</p>
        </div>
        <button
          onClick={onNewInvoice}
          style={{
            padding: "11px 24px",
            background: "linear-gradient(135deg, #b8860b, #ffd700)",
            color: "white", border: "none", borderRadius: "10px",
            fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
            boxShadow: "0 4px 15px rgba(184,134,11,0.3)",
            display: "flex", alignItems: "center", gap: "8px"
          }}
        >
          ➕ New Invoice
        </button>
      </header>

      <div className="table-card" style={{ marginTop: "24px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#aaa" }}>
            Loading invoices...
          </div>
        ) : invoices.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
            <div style={{ fontSize: "3rem", marginBottom: "12px" }}>📜</div>
            <p style={{ fontWeight: 600, fontSize: "1rem" }}>No invoices yet</p>
            <p style={{ fontSize: "0.85rem" }}>Click "New Invoice" to create your first bill</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Invoice No.</th>
                <th>Customer</th>
                <th>Contact</th>
                <th>Date</th>
                <th>Total Amount</th>
                <th>Payment</th>
                {showCreatedBy && userRole === "super_admin" && <th>Created By</th>}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={inv.id}>
                  <td style={{ color: "#aaa", fontWeight: 600 }}>{i + 1}</td>
                  <td>
                    <span style={{
                      background: "#fef9e7", color: "#b8860b",
                      padding: "3px 10px", borderRadius: "8px",
                      fontSize: "0.82rem", fontWeight: 700
                    }}>
                      {inv.invoiceNumber || "—"}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{inv.customerName || "—"}</td>
                  <td>{inv.customerContact || "—"}</td>
                  <td>{formatDate(inv.date)}</td>
                  <td style={{ fontWeight: 700, color: "#27ae60" }}>
                    {formatCurrency(inv.totals?.grand)}
                  </td>
                  <td>
                    <span style={{
                      background: inv.paymentMode === "Cash" ? "#eafaf1" : "#eaf4fb",
                      color: inv.paymentMode === "Cash" ? "#27ae60" : "#2980b9",
                      padding: "3px 10px", borderRadius: "12px",
                      fontSize: "0.78rem", fontWeight: 600
                    }}>
                      {inv.paymentMode || "—"}
                    </span>
                  </td>
                  {showCreatedBy && userRole === "super_admin" && (
                    <td>
                      <span style={{
                        background: inv.createdByName ? "#eaf4fb" : "#f5f5f5",
                        color: inv.createdByName ? "#2980b9" : "#bbb",
                        padding: "3px 10px", borderRadius: "12px",
                        fontSize: "0.78rem", fontWeight: 600
                      }}>
                        👤 {inv.createdByName || "—"}
                      </span>
                    </td>
                  )}
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
