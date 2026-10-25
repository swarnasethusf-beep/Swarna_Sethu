import React, { useState, useEffect } from "react";
import api, { errMsg } from "./api";
import logo from "./Swarna_Sethu_logo.png";

/**
 * 🔐 LOGIN — with OTP-based Forgot Password flow (all OTP handling is on the server)
 *
 * Screens:
 *  "login"            → License key + username + password
 *  "confirm_mobile"   → Show masked mobile, send OTP
 *  "request_change"   → No access to the number → request a new one
 *  "waiting_approval" → Super Admin / license provider must approve the new number
 *  "enter_otp"        → Enter the 6-digit OTP
 *  "new_credentials"  → Set new username / password
 */
function Login({ onAuthSuccess, notice }) {
  const [licenseKey, setLicenseKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [deviceStatus, setDeviceStatus] = useState({ status: "OFFLINE", port: null });

  const [screen, setScreen] = useState("login");
  const [account, setAccount] = useState({ role: "", maskedMobile: "", hasMobile: false });
  const [newMobile, setNewMobile] = useState("");
  const [requestId, setRequestId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [otp, setOtp] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // ── ESP32 dongle: autofills the license key ─────────────────────────────
  useEffect(() => {
    if (!window.esp32) return;
    window.esp32.onStatus((data) => setDeviceStatus(data));
    window.esp32.onCredentials((data) => {
      if (data.username) setLicenseKey(data.username.toUpperCase());
    });
    return () => window.esp32.removeListeners();
  }, []);

  const go = (next) => { setError(""); setInfo(""); setScreen(next); };
  const run = async (fn) => {
    setLoading(true); setError("");
    try { await fn(); } catch (err) { setError(errMsg(err)); } finally { setLoading(false); }
  };

  // ── Poll for approval of a mobile change request ────────────────────────
  useEffect(() => {
    if (screen !== "waiting_approval" || !requestId) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/auth/forgot/request-status/${requestId}`);
        if (data.status === "approved") {
          clearInterval(interval);
          setInfo("✅ Your new number was approved. Sending OTP…");
          setAccount((a) => ({ ...a, hasMobile: true, maskedMobile: "••••••" + newMobile.slice(-4) }));
          sendOtp();
        } else if (data.status === "rejected") {
          clearInterval(interval);
          setError("❌ Your request was rejected. Contact your administrator.");
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(interval);
  }, [screen, requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await api.post("/auth/login", { licenseKey, username, password });
      onAuthSuccess(data);
    });
  };

  const handleForgot = () => {
    if (!licenseKey || !username) { setError("Enter your License Key and Username first."); return; }
    run(async () => {
      const { data } = await api.post("/auth/forgot/start", { licenseKey, username });
      setAccount(data);
      go(data.hasMobile ? "confirm_mobile" : "request_change");
    });
  };

  const sendOtp = () => run(async () => {
    const { data } = await api.post("/auth/forgot/send-otp", { licenseKey, username });
    setSessionId(data.sessionId);
    setOtp("");
    go("enter_otp");
    setInfo(data.devMode
      ? "🛠️ Dev mode: no SMS provider configured — the OTP is printed in the backend console."
      : `🔑 OTP sent to ${data.maskedMobile}.`);
  });

  const requestChange = () => {
    if (!/^[6-9]\d{9}$/.test(newMobile)) { setError("Enter a valid 10-digit mobile number."); return; }
    run(async () => {
      const { data } = await api.post("/auth/forgot/request-mobile-change", { licenseKey, username, newMobile });
      setRequestId(data.requestId);
      go("waiting_approval");
    });
  };

  const verifyOtp = () => {
    if (otp.length !== 6) { setError("Enter the 6-digit OTP."); return; }
    run(async () => {
      await api.post("/auth/forgot/verify-otp", { sessionId, otp });
      setNewUsername(username);
      go("new_credentials");
    });
  };

  const resetCredentials = () => {
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    run(async () => {
      const { data } = await api.post("/auth/forgot/reset", { sessionId, newUsername, newPassword });
      setUsername(data.username);
      setPassword("");
      setNewPassword(""); setConfirmPassword("");
      go("login");
      setInfo("🎉 Credentials updated. Please log in with your new password.");
    });
  };

  const isOnline = deviceStatus.status === "ONLINE";
  const backLink = (to, label = "← Back to Login") => (
    <button type="button" className="link-btn muted" onClick={() => go(to)}>{label}</button>
  );

  return (
    <div className="admin-login-overlay">
      <div className="admin-login-card">
        <img src={logo} alt="Logo" className="login-logo-img" />
        <h1 className="login-title">Swarna Sethu</h1>

        {screen === "login" && (
          <>
            <div className="device-status-bar">
              <span className={`device-dot ${isOnline ? "dot-online" : "dot-offline"}`}></span>
              <span className={`device-label ${isOnline ? "label-online" : "label-offline"}`}>
                {isOnline ? `ONLINE — ${deviceStatus.port}` : "OFFLINE — No Device"}
              </span>
              {isOnline && <span className="device-hint">Press ESP32 button to autofill key</span>}
            </div>
            {notice && !error && !info && <p className="error-text">{notice}</p>}

            <form onSubmit={handleLogin}>
              <input type="text" placeholder="License Key (e.g. SW-ABCD-EFGH-JKLM)" autoComplete="off"
                value={licenseKey} onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                className="login-input" required />
              <input type="text" placeholder="Username" autoComplete="username"
                value={username} onChange={(e) => setUsername(e.target.value)}
                className="login-input" required />
              <input type="password" placeholder="Password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="login-input" required />
              <button type="submit" disabled={loading} className="login-submit-btn">
                {loading ? "Verifying..." : "Enter Workspace"}
              </button>
            </form>
            <p className="login-hint">Goldsmith? Sign in with the username and password your owner gave you.</p>
            <button type="button" className="link-btn" onClick={handleForgot} disabled={loading}>
              🔑 Forgot Username / Password?
            </button>
          </>
        )}

        {screen === "confirm_mobile" && (
          <div>
            <p className="muted-text">An OTP will be sent to the mobile registered with your account:</p>
            <div className="masked-mobile">📱 {account.maskedMobile}</div>
            <button onClick={sendOtp} disabled={loading} className="login-submit-btn">
              {loading ? "Sending OTP..." : "📤 Send OTP"}
            </button>
            <button type="button" className="link-btn muted" onClick={() => go("request_change")}>
              I don't have access to this number
            </button>
            {backLink("login")}
          </div>
        )}

        {screen === "request_change" && (
          <div>
            <div className="big-emoji">📲</div>
            <p className="muted-text">
              {account.hasMobile ? "Enter your new mobile number." : "No mobile number is registered for your account. Enter one to request access."}
              <br />
              <small>
                {account.role === "admin"
                  ? "Your Super Admin must approve this change."
                  : "Your license provider must approve this change."}
              </small>
            </p>
            <input type="tel" placeholder="10-digit mobile number" inputMode="numeric"
              value={newMobile} onChange={(e) => setNewMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="login-input" />
            <button onClick={requestChange} disabled={loading} className="login-submit-btn">
              {loading ? "Sending Request..." : "📨 Submit Request"}
            </button>
            {backLink(account.hasMobile ? "confirm_mobile" : "login", "← Back")}
          </div>
        )}

        {screen === "waiting_approval" && (
          <div>
            <div className="big-emoji">⏳</div>
            <p style={{ fontWeight: 700, color: "var(--primary)" }}>Request submitted</p>
            <p className="muted-text">
              {account.role === "admin"
                ? "Waiting for your Super Admin to approve the new number."
                : "Waiting for your license provider to approve the new number."}
              <br /><small>This page updates automatically.</small>
            </p>
            {backLink("login")}
          </div>
        )}

        {screen === "enter_otp" && (
          <div>
            <div className="big-emoji">💬</div>
            <input type="text" placeholder="6-digit OTP" inputMode="numeric" autoComplete="one-time-code"
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="login-input otp-input" />
            <button onClick={verifyOtp} disabled={loading} className="login-submit-btn">
              {loading ? "Verifying..." : "✅ Verify OTP"}
            </button>
            <button type="button" className="link-btn muted" onClick={sendOtp} disabled={loading}>Resend OTP</button>
            {backLink("login")}
          </div>
        )}

        {screen === "new_credentials" && (
          <div style={{ textAlign: "left" }}>
            <p className="success-text" style={{ textAlign: "center" }}>✅ OTP verified — set your new credentials</p>
            <label className="field-label">Username</label>
            <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="login-input" />
            <label className="field-label">New password (min. 8 characters)</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="login-input" autoComplete="new-password" />
            <label className="field-label">Confirm password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="login-input" autoComplete="new-password" />
            <button onClick={resetCredentials} disabled={loading} className="login-submit-btn">
              {loading ? "Saving..." : "💾 Save New Credentials"}
            </button>
          </div>
        )}

        {info && <p className="success-text">{info}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

export default Login;
