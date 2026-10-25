import React, { useState, useEffect, useRef, useCallback } from "react";
import api from "./api";

const POLL_MS = 20000;

/**
 * 🔔 Polls /notifications every 20 s (and when the window regains focus).
 * `fresh` holds notifications that arrived since the last poll, for the pop-up toast; the very
 * first load never pops up (it would replay old history). If the user has allowed desktop
 * alerts, new ones also appear as system notifications.
 */
export function useNotifications(enabled) {
  const [state, setState] = useState({ unread: 0, items: [] });
  const [fresh, setFresh] = useState([]);
  const seen = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications");
      setState({ unread: data.unread, items: data.items });
      if (seen.current === null) {
        seen.current = new Set(data.items.map((n) => n.id));
        return;
      }
      const arrived = data.items.filter((n) => !n.read && !seen.current.has(n.id));
      if (arrived.length) {
        arrived.forEach((n) => seen.current.add(n.id));
        setFresh((cur) => [...arrived, ...cur].slice(0, 3));
        if ("Notification" in window && Notification.permission === "granted") {
          arrived.slice(0, 3).forEach((n) => { try { new Notification(n.title, { body: n.body }); } catch { /* not supported here */ } });
        }
      }
    } catch { /* offline or session ended — the API client handles logout */ }
  }, []);

  useEffect(() => {
    if (!enabled) { seen.current = null; setState({ unread: 0, items: [] }); setFresh([]); return undefined; }
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [enabled, refresh]);

  const markRead = useCallback(async (ids) => {
    setState((s) => ({ unread: Math.max(0, s.unread - s.items.filter((n) => ids.includes(n.id) && !n.read).length), items: s.items.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)) }));
    try { await api.post("/notifications/read", { ids }); } catch { refresh(); }
  }, [refresh]);

  const markAll = useCallback(async () => {
    setState((s) => ({ unread: 0, items: s.items.map((n) => ({ ...n, read: true })) }));
    setFresh([]);
    try { await api.post("/notifications/read", { all: true }); } catch { refresh(); }
  }, [refresh]);

  return { ...state, fresh, dismissFresh: () => setFresh([]), markRead, markAll, refresh };
}

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

/** Pop-up for notifications that just arrived (bottom-right, closes itself) */
export function NotificationToast({ items, onOpen, onClose }) {
  useEffect(() => {
    if (!items.length) return undefined;
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [items, onClose]);
  if (!items.length) return null;
  return (
    <div className="toast-stack no-print">
      {items.map((n) => (
        <div key={n.id} className="toast" onClick={() => { onOpen(n); onClose(); }}>
          <strong>{n.title}</strong>
          <div>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

export function Notifications({ items, unread, onOpen, onMarkAll, onMarkRead }) {
  const [, bump] = useState(0);
  const canAlert = "Notification" in window && Notification.permission === "default";
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p>{unread ? `${unread} unread` : "You're all caught up"}</p>
        </div>
        <div className="btn-group">
          {canAlert && (
            <button className="btn btn-secondary" onClick={() => Notification.requestPermission().then(() => bump((n) => n + 1))}>
              🔔 Allow desktop alerts
            </button>
          )}
          <button className="btn btn-secondary" disabled={!unread} onClick={onMarkAll}>Mark all as read</button>
        </div>
      </div>
      <div className="table-card">
        {items.length === 0 ? <div className="empty">No notifications yet.</div> : items.map((n) => (
          <div key={n.id} className={`notif-row ${n.read ? "" : "unread"} ${n.workOrderId ? "clickable" : ""}`}
               onClick={() => { if (!n.read) onMarkRead([n.id]); if (n.workOrderId) onOpen(n); }}>
            <span className="notif-dot" />
            <div style={{ flex: 1 }}>
              <div className="notif-title">{n.title}</div>
              <div className="sub">{n.body}</div>
            </div>
            <span className="sub nowrap">{ago(n.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
