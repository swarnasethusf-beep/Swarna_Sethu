import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const api = axios.create({ baseURL: API_URL, timeout: 20000 });
const TOKEN_KEY = "sr_admin_token";

function errMsg(err, fallback = "Something went wrong.") {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.response?.status === 404) return `The server at ${API_URL} doesn't support this request — it may be running old code. Restart the backend.`;
  if (err?.response) return fallback;
  return "Cannot reach the server. Is the backend running?";
}

const today = () => new Date().toISOString().slice(0, 10);
const PURITIES = { "24K": 999, "22K": 916, "18K": 750, "14K": 585 };   // fineness ‰
const EMPTY_RATES = { "24K": "", "22K": "", "18K": "", "14K": "" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const EMPTY_FORM = {
  name: "", business: "", mobile: "", email: "", location: "", expiry: "",
  superAdminUsername: "", superAdminPassword: ""
};

/**
 * 👑 ADMIN PORTAL — license issuing authority. Login is verified by the server
 * (ADMIN_USERNAME / ADMIN_PASSWORD_HASH in backend/.env).
 */
function App() {
  const [token, setTokenState] = useState(() => {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [view, setView] = useState("create"); // create | list | requests | rates
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [licenses, setLicenses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [renewing, setRenewing] = useState(null); // { id, expiry }
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [goldRate, setGoldRate] = useState(null);           // { current, history, liveAvailable }
  const [rateForm, setRateForm] = useState(EMPTY_RATES);
  const [rateMsg, setRateMsg] = useState({ text: "", type: "" });

  const setToken = (t) => {
    setTokenState(t);
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  };

  // Attach the token; drop it when the server says it's no longer valid
  useEffect(() => {
    const req = api.interceptors.request.use((cfg) => {
      if (token) cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });
    const res = api.interceptors.response.use((r) => r, (err) => {
      if (err.response?.status === 401 && token) setToken(null);
      return Promise.reject(err);
    });
    return () => { api.interceptors.request.eject(req); api.interceptors.response.eject(res); };
  }, [token]);

  const fetchLicenses = useCallback(async () => {
    try {
      const res = await api.get("/admin/licenses");
      setLicenses(res.data);
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await api.get("/admin/requests");
      setRequests(res.data);
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  const fetchGoldRate = useCallback(async () => {
    try {
      const res = await api.get("/admin/gold-rate");
      setGoldRate(res.data);
      if (res.data.current) setRateForm(Object.fromEntries(Object.keys(PURITIES).map((k) => [k, res.data.current[k] || ""])));
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    setError("");
    if (view === "list") fetchLicenses();
    if (view === "requests") fetchRequests();
    if (view === "rates") fetchGoldRate();
  }, [token, view, fetchLicenses, fetchRequests, fetchGoldRate]);

  // ── Market gold rate: published to every licensed shop ──────────────────
  const deriveRates = () => {
    const g24 = parseFloat(rateForm["24K"]);
    if (!g24) return;
    setRateForm({ ...rateForm, ...Object.fromEntries(["22K", "18K", "14K"].map((k) => [k, Math.round((g24 * PURITIES[k]) / PURITIES["24K"])])) });
  };

  const fetchSpot = async () => {
    setBusy(true); setRateMsg({ text: "", type: "" });
    try {
      const { data } = await api.get("/admin/gold-rate/live");
      if (!data.available) setRateMsg({ text: data.message, type: "error" });
      else {
        setRateForm(Object.fromEntries(Object.keys(PURITIES).map((k) => [k, Math.round(data[k])])));
        setRateMsg({ text: `Filled from the international spot price (${data.source}). Spot excludes import duty, GST and margin — adjust before publishing.`, type: "info" });
      }
    } catch (err) {
      setRateMsg({ text: errMsg(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const publishRate = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Publish 24K ₹${rateForm["24K"]}/g · 22K ₹${rateForm["22K"]}/g to every licensed shop?`)) return;
    setBusy(true); setRateMsg({ text: "", type: "" });
    try {
      await api.put("/admin/gold-rate", rateForm);
      setRateMsg({ text: "✅ Published. Every shop now bills with this rate unless it sets its own.", type: "success" });
      fetchGoldRate();
    } catch (err) {
      setRateMsg({ text: "❌ " + errMsg(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await api.post("/admin/login", { username, password });
      setToken(res.data.token);
      setPassword("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const generateLicense = async (e) => {
    e.preventDefault();
    setSuccessMsg(""); setError(""); setBusy(true);
    try {
      const res = await api.post("/admin/licenses", formData);
      setSuccessMsg(`✅ License Key: ${res.data.key} | Super Admin: ${formData.superAdminUsername}`);
      setFormData(EMPTY_FORM);
    } catch (err) {
      setError("❌ " + errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const renewLicense = async () => {
    try {
      await api.post(`/admin/licenses/${renewing.id}/renew`, { expiry: renewing.expiry });
      setRenewing(null);
      fetchLicenses();
    } catch (err) {
      alert("❌ " + errMsg(err, "Failed to renew."));
    }
  };

  const setActive = async (l, active) => {
    if (!active && !window.confirm(`Deactivate ${l.business}? Their users will be signed out immediately.`)) return;
    try {
      await api.post(`/admin/licenses/${l.id}/status`, { active });
      fetchLicenses();
    } catch (err) {
      alert("❌ " + errMsg(err));
    }
  };

  const decide = async (id, action) => {
    try {
      await api.post(`/admin/requests/${id}/decision`, { action });
      fetchRequests();
    } catch (err) {
      alert("❌ " + errMsg(err));
    }
  };

  const f = (key) => ({ value: formData[key], onChange: (e) => setFormData({ ...formData, [key]: e.target.value }) });
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (!token) {
    return (
      <div className="admin-login-overlay">
        <div className="admin-login-card">
          <h1>🔐 Admin Access</h1>
          <p>Gold Smith Licensing Authority</p>
          <form onSubmit={handleLogin}>
            <input type="text" placeholder="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" disabled={busy}>{busy ? "Checking…" : "Unlock Portal"}</button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <aside className="admin-sidebar">
        <h2>👑 Swarna Admin</h2>
        <nav>
          <div className={view === "create" ? "active" : ""} onClick={() => setView("create")}>📝 Issue License</div>
          <div className={view === "list" ? "active" : ""} onClick={() => setView("list")}>📋 View Database</div>
          <div className={view === "rates" ? "active" : ""} onClick={() => setView("rates")}>🪙 Gold Rate</div>
          <div className={view === "requests" ? "active" : ""} onClick={() => setView("requests")}>
            🔔 Mobile Requests {pendingCount > 0 && <span className="count-badge">{pendingCount}</span>}
          </div>
        </nav>
        <button className="logout" onClick={() => setToken(null)}>Sign Out</button>
      </aside>

      <main className="admin-content">
        {view === "create" && (
          <section className="form-page">
            <header>
              <h1>Issue New License</h1>
              <p>Enter business details to auto-generate an activation key</p>
            </header>

            <div className="card">
              <form onSubmit={generateLicense} className="admin-form">
                <div className="form-grid">
                  <div className="input-group"><label>Client Name *</label><input type="text" {...f("name")} placeholder="Owner name" required /></div>
                  <div className="input-group"><label>Business Name *</label><input type="text" {...f("business")} placeholder="Jewellery Shop Name" required /></div>
                  <div className="input-group">
                    <label>Mobile Number * <small>(used for OTP password reset)</small></label>
                    <input type="tel" value={formData.mobile} onChange={(e) => setFormData({ ...formData, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="10 Digit Number" required />
                  </div>
                  <div className="input-group"><label>Email Address</label><input type="email" {...f("email")} placeholder="client@name.com" /></div>
                  <div className="input-group"><label>Location / Address</label><input type="text" {...f("location")} placeholder="Shop address, city" /></div>
                  <div className="input-group"><label>Expiry Date *</label><input type="date" min={today()} {...f("expiry")} required /></div>
                </div>

                <div className="credentials-box">
                  <p>🔐 Super Admin Credentials</p>
                  <div className="form-grid">
                    <div className="input-group"><label>Username *</label><input type="text" {...f("superAdminUsername")} placeholder="e.g. owner_lakshman" required /></div>
                    <div className="input-group"><label>Password * <small>(min. 8 characters)</small></label><input type="password" minLength={8} {...f("superAdminPassword")} placeholder="Set a strong password" required /></div>
                  </div>
                  <small>⚠️ Share these credentials with the shop owner. They use them to log in alongside the license key.</small>
                </div>

                <button type="submit" className="gen-btn" disabled={busy}>{busy ? "Creating…" : "Register & Generate Key"}</button>
              </form>
              {successMsg && <div className="key-reveal">{successMsg}<div className="key-note">This key is shown once here — copy it now. You can also see it in View Database.</div></div>}
              {error && <p className="error">{error}</p>}
            </div>
          </section>
        )}

        {view === "list" && (
          <section className="list-page">
            <header>
              <h1>License Database</h1>
              <p>Management of all active and expired keys</p>
            </header>
            {error && <p className="error">{error}</p>}
            <div className="table-card">
              <table className="admin-table">
                <thead>
                  <tr><th>License Key</th><th>Business</th><th>Mobile</th><th>Expiry</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {licenses.map((l) => (
                    <tr key={l.id}>
                      <td><code className="key-code">{l.key || "—"}</code></td>
                      <td>{l.business} <br /> <small>{l.name}</small></td>
                      <td>{l.mobile}</td>
                      <td>
                        {renewing?.id === l.id ? (
                          <span className="renew-inline">
                            <input type="date" min={today()} value={renewing.expiry} onChange={(e) => setRenewing({ ...renewing, expiry: e.target.value })} />
                            <button className="renew-btn" onClick={renewLicense} disabled={!renewing.expiry}>Save</button>
                            <button className="plain-btn" onClick={() => setRenewing(null)}>✕</button>
                          </span>
                        ) : l.expiry}
                      </td>
                      <td><span className={`status-pill ${l.status}`}>{l.status[0].toUpperCase() + l.status.slice(1)}</span></td>
                      <td className="actions">
                        <button className="renew-btn" onClick={() => setRenewing({ id: l.id, expiry: "" })}>🔄 Renew</button>
                        {l.active
                          ? <button className="plain-btn danger" onClick={() => setActive(l, false)}>Deactivate</button>
                          : <button className="plain-btn" onClick={() => setActive(l, true)}>Activate</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {licenses.length === 0 && <p style={{ textAlign: "center", padding: "20px" }}>No licenses found.</p>}
            </div>
          </section>
        )}

        {view === "rates" && (
          <section className="form-page">
            <header>
              <h1>Today's Gold Rate</h1>
              <p>The market rate (₹ per gram) every licensed shop bills with. A shop can still set its own rate — whichever was saved last applies.</p>
            </header>
            {error && <p className="error">{error}</p>}
            <div className="card">
              <p style={{ marginTop: 0 }}>
                <strong>Currently published:</strong>{" "}
                {goldRate?.current
                  ? <>{Object.keys(PURITIES).filter((k) => goldRate.current[k]).map((k) => `${k} ₹${goldRate.current[k]}`).join(" · ")} <small>({when(goldRate.current.updatedAt)})</small></>
                  : "nothing yet"}
              </p>
              <form onSubmit={publishRate} className="admin-form">
                <div className="form-grid">
                  {Object.keys(PURITIES).map((k) => (
                    <div key={k} className="input-group">
                      <label>{k} (₹/g){(k === "24K" || k === "22K") && " *"}</label>
                      <input type="number" min="0" step="0.01" value={rateForm[k]} required={k === "24K" || k === "22K"} onChange={(e) => setRateForm({ ...rateForm, [k]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div className="actions" style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0 14px" }}>
                  <button type="button" className="plain-btn" onClick={deriveRates}>Derive 22K / 18K / 14K from 24K</button>
                  <button type="button" className="plain-btn" onClick={fetchSpot} disabled={busy || !goldRate?.liveAvailable} title={goldRate?.liveAvailable ? "" : "Set GOLDAPI_KEY on the backend"}>
                    🔄 Fill from live spot price
                  </button>
                </div>
                <button type="submit" className="gen-btn" disabled={busy}>{busy ? "Working…" : "📢 Publish to all shops"}</button>
              </form>
              {rateMsg.text && <p className={rateMsg.type === "error" ? "error" : "key-note"}>{rateMsg.text}</p>}
            </div>

            {goldRate?.history?.length > 0 && (
              <div className="table-card" style={{ marginTop: 20 }}>
                <table className="admin-table">
                  <thead><tr><th>Date</th>{Object.keys(PURITIES).map((k) => <th key={k}>{k} ₹/g</th>)}<th>Published</th></tr></thead>
                  <tbody>
                    {goldRate.history.map((h) => (
                      <tr key={h.date}>
                        <td>{h.date}</td>
                        {Object.keys(PURITIES).map((k) => <td key={k}>{h[k] || "—"}</td>)}
                        <td>{when(h.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {view === "requests" && (
          <section className="list-page">
            <header>
              <h1>Mobile Change Requests</h1>
              <p>Shop owners (Super Admins) who lost access to their registered number</p>
            </header>
            {error && <p className="error">{error}</p>}
            <div className="table-card">
              <table className="admin-table">
                <thead><tr><th>Shop</th><th>Requested by</th><th>New mobile</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.shopName || "—"}</td>
                      <td>{r.requestedByName} <br /><small>@{r.requestedByUsername}</small></td>
                      <td>{r.newMobile}</td>
                      <td>{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                      <td><span className={`status-pill ${r.status === "approved" ? "active" : r.status === "rejected" ? "expired" : "pending"}`}>{r.status}</span></td>
                      <td className="actions">
                        {r.status === "pending" && (
                          <>
                            <button className="renew-btn ok" onClick={() => decide(r.id, "approved")}>✅ Approve</button>
                            <button className="plain-btn danger" onClick={() => decide(r.id, "rejected")}>Reject</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {requests.length === 0 && <p style={{ textAlign: "center", padding: "20px" }}>No requests.</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
