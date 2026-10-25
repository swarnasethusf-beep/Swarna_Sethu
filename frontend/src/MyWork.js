import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";
import { displayDate } from "./format";
import { STATUS, History } from "./WorkOrders";

/**
 * 🔨 My Work — the goldsmith's screen. Big buttons: Start work → Mark complete (with the finished
 * weight). The owner is notified at each step and verifies the piece.
 */
function MyWork({ user, focusId, onFocusDone }) {
  const [data, setData] = useState({ counts: {}, orders: [] });
  const [completing, setCompleting] = useState(null); // order id being completed
  const [form, setForm] = useState({ finishedWt: "", wastageWt: "", note: "" });
  const [showDone, setShowDone] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/work-orders").then(({ data }) => setData(data)).catch((e) => setMsg({ text: errMsg(e), type: "error" }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!focusId) return;
    setTimeout(() => document.getElementById(`wo-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    onFocusDone?.();
  }, [focusId, data.orders.length, onFocusDone]);

  const act = async (o, action, extra = {}) => {
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      await api.post(`/work-orders/${o.id}/status`, { action, ...extra });
      setCompleting(null); setForm({ finishedWt: "", wastageWt: "", note: "" });
      setMsg({ text: action === "start" ? `▶ ${o.orderNo} started.` : `✅ ${o.orderNo} marked complete — your owner has been told.`, type: "success" });
      load();
    } catch (err) {
      setMsg({ text: errMsg(err), type: "error" });
      load();
    } finally { setBusy(false); }
  };

  const todo = data.orders.filter((o) => ["assigned", "in_progress"].includes(o.status));
  const waiting = data.orders.filter((o) => o.status === "completed");
  const done = data.orders.filter((o) => ["closed", "cancelled"].includes(o.status));

  const card = (o) => (
    <div key={o.id} id={`wo-${o.id}`} className={`work-card ${o.priority === "urgent" ? "urgent" : ""} ${o.overdue ? "late" : ""}`}>
      <div className="work-card-head">
        <span className="pill gold">{o.orderNo}</span>
        {o.priority === "urgent" && <span className="pill danger">🔥 Urgent</span>}
        <span className={`pill ${STATUS[o.status]?.cls || ""}`}>{STATUS[o.status]?.label}</span>
        {o.dueDate && <span className={`sub ${o.overdue ? "text-danger" : ""}`}>Due {displayDate(o.dueDate)}{o.overdue ? " — overdue" : ""}</span>}
      </div>
      <h3>{o.title}</h3>
      {o.itemCode && <div className="sub">Item code: <strong>{o.itemCode}</strong></div>}
      {o.details && <p className="work-text">{o.details}</p>}
      <div className="work-facts">
        {o.issuedWt > 0 && <span>Gold issued: <strong>{o.issuedWt} g</strong></span>}
        {o.finishedWt != null && <span>Finished: <strong>{o.finishedWt} g</strong></span>}
        {o.wastageWt != null && <span>Wastage: <strong>{o.wastageWt} g</strong></span>}
        <span className="sub">Given by {o.createdByName}</span>
      </div>

      {o.status === "assigned" && (
        <div className="btn-group">
          <button className="btn btn-primary big" disabled={busy} onClick={() => act(o, "start")}>▶ Start work</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => setCompleting(o.id)}>✅ Already done</button>
        </div>
      )}
      {o.status === "in_progress" && completing !== o.id && (
        <button className="btn btn-primary big" disabled={busy} onClick={() => setCompleting(o.id)}>✅ Mark complete</button>
      )}
      {completing === o.id && (
        <div className="complete-box">
          <label className="field">Finished weight (g){o.issuedWt > 0 ? ` — you were given ${o.issuedWt} g` : ""}
            <input type="number" min="0" step="0.001" autoFocus value={form.finishedWt} onChange={(e) => setForm({ ...form, finishedWt: e.target.value })} />
          </label>
          <label className="field">Wastage — gold lost while making (g)
            <input type="number" min="0" step="0.001" value={form.wastageWt} onChange={(e) => setForm({ ...form, wastageWt: e.target.value })} placeholder="e.g. 0.8" />
          </label>
          <label className="field">Note for the owner (optional)
            <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <div className="btn-group">
            <button className="btn btn-primary" disabled={busy} onClick={() => act(o, "complete", form)}>Send as completed</button>
            <button className="btn btn-secondary" onClick={() => setCompleting(null)}>Cancel</button>
          </div>
        </div>
      )}
      {o.status === "completed" && <div className="hint">Waiting for the owner to check it.</div>}
      {o.history?.length > 1 && <details><summary>History</summary><History history={o.history} /></details>}
    </div>
  );

  return (
    <div className="mywork">
      <div className="page-header">
        <div>
          <h1>My Work</h1>
          <p>Hello {user.name} — {todo.length ? `${todo.length} job${todo.length === 1 ? "" : "s"} to do` : "nothing waiting for you right now"}</p>
        </div>
      </div>
      {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {todo.length === 0 && waiting.length === 0 && <div className="card section empty">🎉 No pending work. New jobs appear here and in Notifications.</div>}
      {todo.length > 0 && <><h2 className="group-title">To do</h2><div className="work-grid">{todo.map(card)}</div></>}
      {waiting.length > 0 && <><h2 className="group-title">Waiting for the owner to check</h2><div className="work-grid">{waiting.map(card)}</div></>}
      {done.length > 0 && (
        <>
          <button className="link-btn" onClick={() => setShowDone((v) => !v)}>{showDone ? "Hide" : "Show"} finished work ({done.length})</button>
          {showDone && <div className="work-grid">{done.map(card)}</div>}
        </>
      )}
    </div>
  );
}

export default MyWork;
