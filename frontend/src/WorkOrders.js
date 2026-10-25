import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { displayDate, todayLocal } from "./format";

export const STATUS = {
  assigned: { label: "Assigned", cls: "blue" },
  in_progress: { label: "In progress", cls: "warn" },
  completed: { label: "Completed — check it", cls: "gold" },
  closed: { label: "Closed", cls: "ok" },
  cancelled: { label: "Cancelled", cls: "danger" }
};

export const stamp = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** Status history as a timeline (shared by the owner's and the goldsmith's screens) */
export function History({ history = [] }) {
  return (
    <ul className="timeline">
      {history.map((h, i) => (
        <li key={i}>
          <strong>{STATUS[h.status]?.label || h.status}</strong>
          <span className="sub"> · {h.byName} · {stamp(h.at)}</span>
          {h.finishedWt != null && <div className="sub">Finished weight: {h.finishedWt} g{h.wastageWt != null ? ` · wastage ${h.wastageWt} g` : ""}</div>}
          {h.note && <div className="note">“{h.note}”</div>}
        </li>
      ))}
    </ul>
  );
}

const EMPTY = { staffId: "", title: "", details: "", itemCode: "", reference: "", issuedWt: "", dueDate: "", priority: "normal" };

/**
 * 🔨 Work Orders (owner / admins) — hand gold work to a goldsmith and follow it to completion.
 */
function WorkOrders({ focusId, onFocusDone }) {
  const [data, setData] = useState({ counts: {}, orders: [] });
  const [filter, setFilter] = useState("");
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/work-orders", { params: { status: filter || undefined } }).then(({ data }) => setData(data)).catch((e) => setMsg({ text: errMsg(e), type: "error" }));
  }, [filter]);
  useEffect(load, [load]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api.get("/staff/options").then(({ data }) => setStaff(data)).catch(() => {}); }, []);
  useEffect(() => { if (focusId) { setFilter(""); setOpenId(focusId); onFocusDone?.(); } }, [focusId, onFocusDone]);

  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  const chosen = staff.find((s) => s.id === form.staffId);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      const { data: made } = await api.post("/work-orders", form);
      setMsg(made.notified
        ? { text: `✅ ${made.orderNo} assigned — ${chosen?.fullName} has been notified.`, type: "success" }
        : { text: `${made.orderNo} created, but ${chosen?.fullName} has no login yet, so nobody was notified. Give them a login in Staff Management.`, type: "warn" });
      setForm(EMPTY); setShowForm(false); load();
    } catch (err) {
      setMsg({ text: errMsg(err, "Could not create the work order."), type: "error" });
    } finally { setBusy(false); }
  };

  const act = async (o, action) => {
    if (action === "reopen" && !note.trim()) { setMsg({ text: "Write what needs fixing in the note box first.", type: "warn" }); return; }
    if (action === "cancel" && !window.confirm(`Cancel ${o.orderNo}?`)) return;
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      await api.post(`/work-orders/${o.id}/status`, { action, note });
      setNote(""); load();
      setMsg({ text: { close: `✔ ${o.orderNo} verified and closed.`, reopen: `↩ ${o.orderNo} sent back to ${o.staffName}.`, cancel: `${o.orderNo} cancelled.` }[action], type: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err), type: "error" });
    } finally { setBusy(false); }
  };

  const c = data.counts;
  const chips = [
    ["", "All"], ["assigned", "Assigned"], ["in_progress", "In progress"], ["completed", "Awaiting check"], ["overdue", "Overdue"], ["closed", "Closed"]
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Work Orders</h1>
          <p>Give work to your goldsmiths and see where each piece stands</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "✕ Close" : "➕ New work order"}</button>
      </div>

      {showForm && (
        <form className="card section" onSubmit={create}>
          <h3>Assign work</h3>
          <div className="form-grid cols-3">
            <label className="field">Goldsmith *
              <select {...f("staffId")} required>
                <option value="">— Select —</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.designation}){s.hasLogin ? "" : " — no login"}</option>)}
              </select>
            </label>
            <label className="field span-2">Work description *<input {...f("title")} placeholder="e.g. 22K temple haram — set stones and polish" required /></label>
            <label className="field">Item code<input {...f("itemCode")} onChange={(e) => setForm({ ...form, itemCode: e.target.value.toUpperCase() })} /></label>
            <label className="field">Gold issued (g)<input type="number" min="0" step="0.001" {...f("issuedWt")} /></label>
            <label className="field">Due date<input type="date" min={todayLocal()} {...f("dueDate")} /></label>
            <label className="field">Priority
              <select {...f("priority")}><option value="normal">Normal</option><option value="urgent">🔥 Urgent</option></select>
            </label>
            <label className="field">Reference (invoice / customer)<input {...f("reference")} /></label>
            <label className="field span-3">Instructions<textarea rows={2} {...f("details")} /></label>
          </div>
          {chosen && !chosen.hasLogin && <div className="alert warn">{chosen.fullName} has no login, so they won't get a notification or be able to update this. Create one in Staff Management.</div>}
          <button className="btn btn-primary" disabled={busy}>Assign &amp; notify</button>
        </form>
      )}

      {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="chip-row">
        {chips.map(([key, label]) => (
          <button key={key || "all"} className={`chip ${filter === key ? "active" : ""} ${key === "completed" && c.completed ? "alert-chip" : ""} ${key === "overdue" && c.overdue ? "danger-chip" : ""}`} onClick={() => setFilter(key)}>
            {label}{key && c[key] ? ` · ${c[key]}` : ""}
          </button>
        ))}
      </div>

      <div className="table-card">
        {data.orders.length === 0 ? <div className="empty">No work orders here yet.</div> : (
          <table className="admin-table">
            <thead><tr><th>No.</th><th>Work</th><th>Goldsmith</th><th>Issued</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {data.orders.map((o) => (
                <React.Fragment key={o.id}>
                  <tr className="clickable-row" onClick={() => { setOpenId(openId === o.id ? null : o.id); setNote(""); }}>
                    <td className="nowrap"><span className="pill gold">{o.orderNo}</span> {o.priority === "urgent" && "🔥"}</td>
                    <td><strong>{o.title}</strong>{o.itemCode && <div className="sub">Code: {o.itemCode}</div>}</td>
                    <td>{o.staffName}{!o.assignedUserId && <div className="sub text-warn">no login</div>}</td>
                    <td className="nowrap">{o.issuedWt ? `${o.issuedWt} g` : "—"}</td>
                    <td className="nowrap">{o.dueDate ? <span className={o.overdue ? "text-danger" : ""}>{displayDate(o.dueDate)}{o.overdue ? " · overdue" : ""}</span> : "—"}</td>
                    <td><span className={`pill ${STATUS[o.status]?.cls || ""}`}>{STATUS[o.status]?.label || o.status}</span></td>
                  </tr>
                  {openId === o.id && (
                    <tr className="detail-row"><td colSpan={6}>
                      <div className="work-detail">
                        <div>
                          {o.details && <p><strong>Instructions:</strong> {o.details}</p>}
                          {o.reference && <p><strong>Reference:</strong> {o.reference}</p>}
                          <p className="sub">Assigned by {o.createdByName} · {stamp(o.createdAt)}</p>
                          {o.finishedWt != null && (
                            <p><strong>Finished weight:</strong> {o.finishedWt} g{o.wastageWt != null ? <> · <strong>wastage</strong> {o.wastageWt} g</> : null}
                              {o.issuedWt > 0 && <span className={o.issuedWt - o.finishedWt > 0.05 ? "text-warn" : ""}> · difference {(o.issuedWt - o.finishedWt).toFixed(3)} g from the {o.issuedWt} g issued</span>}
                            </p>
                          )}
                        </div>
                        <div>
                          <h4>Progress</h4>
                          <History history={o.history} />
                          {["completed", "closed", "in_progress", "assigned"].includes(o.status) && (
                            <div className="work-actions">
                              {["completed", "closed"].includes(o.status) && <textarea rows={2} placeholder="Note (required to send back)" value={note} onChange={(e) => setNote(e.target.value)} />}
                              <div className="btn-group">
                                {o.status === "completed" && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(o, "close")}>✔ Verify &amp; close</button>}
                                {["completed", "closed"].includes(o.status) && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(o, "reopen")}>↩ Send back</button>}
                                {["assigned", "in_progress"].includes(o.status) && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(o, "cancel")}>Cancel</button>}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default WorkOrders;
