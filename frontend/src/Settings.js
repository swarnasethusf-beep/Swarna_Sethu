import React, { useState } from "react";
import api, { errMsg, setToken } from "./api";
import { STATES } from "./shared/billing";
import BrandingSettings from "./BrandingSettings";

const MODULES = [
  { key: "dashboard", icon: "📊", label: "Dashboard", desc: "Show 'Created By' info on the dashboard overview" },
  { key: "inventory", icon: "📦", label: "Inventory", desc: "Show 'Created By' column in the product inventory table" },
  { key: "staff", icon: "👥", label: "Staff Management", desc: "Show 'Created By' column in the staff list" },
  { key: "invoice", icon: "📜", label: "Invoice", desc: "Show 'Created By' column in the invoice list" }
];

/**
 * ⚙️ Settings — shop profile (printed on invoices), logo + print layout and display settings
 * for the Super Admin; password change for everyone.
 */
function Settings({ isOwner, session, onSessionChange }) {
  const [shop, setShop] = useState(session.shop);
  const [display, setDisplay] = useState(session.displaySettings);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState({ text: "", type: "" });

  const s = (k) => ({ value: shop[k] || "", onChange: (e) => setShop({ ...shop, [k]: e.target.value }) });

  const saveShop = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg({ text: "", type: "" });
    try {
      const { data } = await api.put("/settings", { shop, displaySettings: display });
      onSessionChange({ shop: data.shop, displaySettings: data.displaySettings });
      setShop(data.shop);
      setMsg({ text: "✅ Settings saved.", type: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err, "Failed to save settings."), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) { setPwMsg({ text: "New passwords do not match.", type: "error" }); return; }
    setPwMsg({ text: "", type: "" });
    try {
      const { data } = await api.post("/auth/change-password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setToken(data.token); // other devices are logged out; this one stays signed in
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      setPwMsg({ text: "✅ Password changed. Other sessions were signed out.", type: "success" });
    } catch (err) {
      setPwMsg({ text: errMsg(err, "Failed to change password."), type: "error" });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>License: {session.license.business} · valid until {session.license.expiry}</p>
        </div>
      </div>

      {isOwner && (
        <form className="card section" onSubmit={saveShop}>
          <h3>🏪 Shop profile (printed on every invoice)</h3>
          <div className="form-grid cols-3">
            <label className="field">Shop name *<input {...s("name")} required /></label>
            <label className="field">Phone<input {...s("phone")} /></label>
            <label className="field">Email<input type="email" {...s("email")} /></label>
            <label className="field span-3">Address<input {...s("address")} /></label>
            <label className="field">GSTIN<input {...s("gstin")} maxLength={15} onChange={(e) => setShop({ ...shop, gstin: e.target.value.toUpperCase() })} placeholder="e.g. 36ABCDE1234F1Z5" /></label>
            <label className="field">State
              <select {...s("stateCode")}>
                <option value="">— Select —</option>
                {STATES.map((st) => <option key={st.code} value={st.code}>{st.code} · {st.name}</option>)}
              </select>
            </label>
            <label className="field">Invoice prefix<input {...s("invoicePrefix")} maxLength={10} onChange={(e) => setShop({ ...shop, invoicePrefix: e.target.value.toUpperCase() })} placeholder="INV" /></label>
            <label className="field span-3">Terms printed on invoice<textarea rows={2} {...s("terms")} /></label>
          </div>
          <p className="hint">Invoice numbers look like <strong>{(shop.invoicePrefix || "INV").toUpperCase()}/26-27/0001</strong> and restart each financial year (April). Changing the prefix applies to new invoices only.</p>

          <h3 style={{ marginTop: 28 }}>👁️ Display settings</h3>
          {MODULES.map(({ key, icon, label, desc }) => (
            <div key={key} className={`toggle-card ${display[key] ? "on" : ""}`} onClick={() => setDisplay({ ...display, [key]: !display[key] })}>
              <span className="toggle-icon">{icon}</span>
              <div style={{ flex: 1 }}><strong>{label}</strong><div className="sub">{desc}</div></div>
              <div className={`switch ${display[key] ? "on" : ""}`}><div /></div>
            </div>
          ))}

          <div className="btn-group" style={{ marginTop: 20 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "💾 Save settings"}</button>
          </div>
          {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        </form>
      )}

      {isOwner && <BrandingSettings session={session} onSessionChange={onSessionChange} />}

      <form className="card section narrow" onSubmit={changePassword}>
        <h3>🔒 Change my password</h3>
        <label className="field">Current password<input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></label>
        <label className="field">New password (min. 8 characters)<input type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></label>
        <label className="field">Confirm new password<input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></label>
        <button type="submit" className="btn btn-primary">Change password</button>
        {pwMsg.text && <div className={`alert ${pwMsg.type}`}>{pwMsg.text}</div>}
      </form>
    </div>
  );
}

export default Settings;
