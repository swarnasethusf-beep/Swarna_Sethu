import React, { useState, useEffect } from "react";
import api, { errMsg } from "./api";
import { STATES } from "./shared/billing";
import { displayDate } from "./format";

/**
 * 🧑‍🤝‍🧑 Customers — saved automatically from invoices (keyed by mobile number)
 */
function Customers() {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api.get("/customers", { params: { q } })
        .then(({ data }) => { setList(data); setError(""); })
        .catch((err) => setError(errMsg(err)));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>Saved automatically when a bill has a mobile number. Typing the mobile on a new invoice fills these details.</p>
        </div>
      </div>
      <div className="filter-bar">
        <input className="search" placeholder="🔍 Name, mobile or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="table-card">
        {list.length === 0 ? <div className="empty">No customers yet.</div> : (
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Mobile</th><th>Address</th><th>State</th><th>GSTIN</th><th>PAN</th><th>Last bill</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.mobile}</td>
                  <td>{c.address || "—"}</td>
                  <td>{STATES.find((s) => s.code === c.stateCode)?.name || "—"}</td>
                  <td>{c.gstin || "—"}</td>
                  <td>{c.pan ? `${c.pan.slice(0, 2)}•••••${c.pan.slice(-3)}` : "—"}</td>
                  <td>{c.lastInvoiceNumber || "—"}<div className="sub">{displayDate(c.lastInvoiceAt)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Customers;
