import React, { useState, useEffect } from "react";
import api, { errMsg } from "./api";
import { inr, grams, displayDate, todayLocal } from "./format";

/**
 * 📊 Dashboard — live figures for today / this month, stock and rates
 */
function Dashboard({ session, can, onNewInvoice, onOpenInvoice, onGo, onJobWork }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [work, setWork] = useState(null);
  useEffect(() => {
    if (can("workorders")) api.get("/work-orders").then(({ data }) => setWork(data.counts)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.get("/dashboard").then(({ data }) => setData(data)).catch((err) => setError(errMsg(err)));
  }, []);

  const inv = data?.invoices;
  const rates = data?.rates;
  const ratesStale = !rates?.date || rates.date !== todayLocal();
  const shopIncomplete = !session.shop.gstin || !session.shop.stateCode;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{session.shop.name || "Dashboard"}</h1>
          <p>{new Date().toDateString()}{inv?.scope === "mine" ? " · showing your bills" : ""}</p>
        </div>
        {can("invoice") && <button className="btn btn-primary" onClick={onNewInvoice}>➕ New Invoice</button>}
      </div>

      {shopIncomplete && session.user.role === "super_admin" && (
        <div className="alert warn">⚠️ Add your GSTIN and state in <button className="link-btn inline" onClick={() => onGo("settings")}>Settings</button> — they're printed on every tax invoice.</div>
      )}
      {can("invoice") && ratesStale && (
        <div className="alert warn">⚠️ Today's gold rates are not set. <button className="link-btn inline" onClick={() => onGo("rates")}>Update rates</button></div>
      )}
      {error && <div className="alert error">{error}</div>}

      {work && (work.completed > 0 || work.overdue > 0) && (
        <div className="alert warn">
          🔨 {work.completed > 0 && <>{work.completed} piece{work.completed === 1 ? " is" : "s are"} finished and waiting for your check. </>}
          {work.overdue > 0 && <>{work.overdue} work order{work.overdue === 1 ? " is" : "s are"} overdue. </>}
          <button className="link-btn inline" onClick={() => onGo("workorders")}>Open Work Orders</button>
        </div>
      )}

      {data?.jobWork && (data.jobWork.pending > 0 || data.jobWork.ready > 0) && (
        <div className="jobwork-strip">
          <button className={`jw-card ${data.jobWork.ready ? "ready" : ""}`} onClick={() => onJobWork("ready")}>
            <span>📞 Ready for pickup</span><strong>{data.jobWork.ready}</strong><small>call the customer</small>
          </button>
          <button className="jw-card" onClick={() => onJobWork("pending")}>
            <span>⏳ In the workshop</span><strong>{data.jobWork.pending}</strong><small>job work pending</small>
          </button>
          <div className="jw-card plain">
            <span>💰 Advance held</span><strong>{inr(data.jobWork.advance)}</strong><small>on unfinished orders</small>
          </div>
        </div>
      )}

      <div className="summary-grid four">
        {inv && (
          <>
            <div className="summary-card"><span>Today</span><h2>{inr(inv.todayTotal)}</h2><small>{inv.todayCount} invoice{inv.todayCount === 1 ? "" : "s"}</small></div>
            <div className="summary-card"><span>This month</span><h2>{inr(inv.monthTotal)}</h2><small>{inv.monthCount} invoices</small></div>
            <div className="summary-card"><span>Balance due (month)</span><h2>{inr(inv.balanceDue)}</h2></div>
          </>
        )}
        {data?.stock && (
          <div className="summary-card"><span>Stock in showroom</span><h2>{data.stock.count} pcs</h2><small>{grams(data.stock.netWt)} net</small></div>
        )}
      </div>

      <div className="two-col">
        {inv && (
          <div className="table-card">
            <h3 className="table-title">Recent invoices</h3>
            {inv.recent.length === 0 ? <div className="empty">No invoices this month yet.</div> : (
              <table className="admin-table clickable">
                <tbody>
                  {inv.recent.map((r) => (
                    <tr key={r.id} onClick={() => onOpenInvoice(r.id)}>
                      <td><span className="pill gold">{r.invoiceNumber}</span></td>
                      <td>{r.customerName}</td>
                      <td>{displayDate(r.date)}</td>
                      <td className="right strong">{inr(r.payable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <div className="table-card">
          <h3 className="table-title">Rates (₹/g){rates?.date ? ` · ${displayDate(rates.date)}` : ""}{rates?.source === "market" ? " · market rate" : ""}</h3>
          {rates ? (
            <table className="admin-table">
              <tbody>
                {["24K", "22K", "18K", "14K"].filter((k) => rates[k]).map((k) => (
                  <tr key={k}><td>{k}</td><td className="right strong">{inr(rates[k])}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">Not set</div>}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
