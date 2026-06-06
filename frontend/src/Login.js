import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import logo from "./Swarna_Raseid_logo.png";
import { auth } from "./firebase";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";

// Disable reCAPTCHA verification in Firebase testing mode (non‑production)
// if (process.env.NODE_ENV !== "production" && typeof auth === "object") {
//   // Ensure the settings object exists before assigning
//   // @ts-ignore – Firebase may not expose the type in this context
//   auth.settings = { ...(auth.settings || {}), appVerificationDisabledForTesting: true };
// }


/**
 * 🔐 LOGIN — with OTP-based Forgot Password flow
 *
 * Screens:
 *  "login"            → Normal login form
 *  "confirm_mobile"   → Show masked mobile, ask user to confirm
 *  "no_mobile"        → User has no mobile; ask them to enter new one
 *  "request_change"   → Enter new mobile to request change
 *  "waiting_approval" → Waiting for Super Admin / Global Admin to approve
 *  "enter_otp"        → Enter the 6-digit OTP received via SMS
 *  "new_credentials"  → Enter new Username + New Password
 */
function Login({ onAuthSuccess }) {
  // ── Normal login state ─────────────────────────────────────
  const [licenseKey, setLicenseKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deviceStatus, setDeviceStatus] = useState({ status: "OFFLINE", port: null });

  // ── Forgot password state ───────────────────────────────────
  const [screen, setScreen] = useState("login");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState("");
  const [fpSuccess, setFpSuccess] = useState("");

  // Data captured during the forgot-password flow
  const [fpData, setFpData] = useState({
    userId: "", licenseDocId: "", role: "",
    maskedMobile: "", hasMobile: false
  });
  const [newMobile, setNewMobile] = useState("");
  const [requestId, setRequestId] = useState("");
  const [otp, setOtp] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // OTP session tracking
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [isTestMode, setIsTestMode] = useState(false);

  // ── ESP32 device ───────────────────────────────────────────
  useEffect(() => {
    if (!window.esp32) return;
    window.esp32.onStatus((data) => setDeviceStatus(data));
    window.esp32.onCredentials((data) => {
      if (data.username) setLicenseKey(data.username.toUpperCase());
    });
    return () => window.esp32.removeListeners();
  }, []);

  // ── Poll Firestore for approval when waiting ───────────────
  useEffect(() => {
    if (screen !== "waiting_approval" || !fpData.licenseDocId || !fpData.userId) return;
    const interval = setInterval(async () => {
      try {
        const endpoint = fpData.role === "super_admin"
          ? "http://localhost:5000/global-pending-requests"
          : `http://localhost:5000/pending-requests?licenseDocId=${fpData.licenseDocId}`;
        const res = await axios.get(endpoint);
        // Match by userId (requestedBy field) — more reliable than requestId
        const myRequest = res.data.find(
          r => r.requestedBy === fpData.userId &&
            (r.id === requestId || requestId === "pending")
        );
        console.log("🔄 Polling approval... found:", myRequest?.status);
        if (myRequest?.status === "approved") {
          setFpSuccess("✅ Your request was approved! Sending OTP now...");
          clearInterval(interval);
          setTimeout(() => sendOtp(), 1000);
        } else if (myRequest?.status === "rejected") {
          setFpError("❌ Your request was rejected. Contact your administrator.");
          clearInterval(interval);
          setTimeout(() => setScreen("login"), 3000);
        }
      } catch { }
    }, 3000); // poll every 3 seconds
    return () => clearInterval(interval);
  }, [screen, requestId, fpData]);

  // ─────────────────────────────────────────────────────────────
  // STEP 1: User clicks "Forgot Password"
  // ─────────────────────────────────────────────────────────────
  const handleForgotClick = async () => {
    if (!licenseKey || !username) {
      setError("Please enter your License Key and Username first.");
      return;
    }
    setFpError(""); setFpSuccess(""); setLoading(true);
    try {
      const res = await axios.post("http://localhost:5000/get-user-mobile", {
        licenseKey, username
      });
      if (!res.data.found) {
        setFpError(res.data.message || "User not found.");
        setLoading(false);
        return;
      }
      setFpData({
        userId: res.data.userId,
        licenseDocId: res.data.licenseDocId,
        role: res.data.role,
        maskedMobile: res.data.maskedMobile || "",
        hasMobile: res.data.hasMobile,
        rawMobile: res.data.rawMobile // store the full mobile number for Firebase OTP
      });
      setScreen(res.data.hasMobile ? "confirm_mobile" : "no_mobile");
    } catch {
      setFpError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // STEP 2a: Send OTP via backend (no reCAPTCHA needed)
  // ─────────────────────────────────────────────────────────────
  const sendOtp = async () => {
    setFpLoading(true); setFpError("");
    try {
      // Clean mobile number — strip non-digits
      const mobile = String(fpData.rawMobile || "").replace(/\D/g, "");

      // ── Test mode: skip Firebase for placeholder number ──
      if (mobile === "0000000000") {
        console.log("📞 Test mode — skipping Firebase OTP for placeholder number");
        setIsTestMode(true);
        setConfirmationResult(null);
        setScreen("enter_otp");
        setFpSuccess("🔑 Test mode — enter any 6-digit code to verify.");
        return;
      }

      // ── Production mode: use Firebase Phone Auth ──
      setIsTestMode(false);

      // Clear any previous reCAPTCHA verifier to avoid stale tokens
      if (window.recaptchaVerifier) {
        try { window.recaptchaVerifier.clear(); } catch (_) {}
        window.recaptchaVerifier = null;
      }

      // Create a fresh invisible reCAPTCHA verifier
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        "recaptcha-container",
        { size: "invisible" }
      );
      await window.recaptchaVerifier.render();

      // Build E.164 phone number
      const phoneNumber =
        mobile.length === 10
          ? `+91${mobile}`
          : `+${mobile}`;

      console.log("📞 Sending OTP to:", phoneNumber);

      const result = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
      setConfirmationResult(result);
      setScreen("enter_otp");
      setFpSuccess("🔑 OTP sent via Firebase. Enter the verification code.");

    } catch (err) {
      console.error("Firebase sendOtp error:", err);
      setFpError(err.message || "❌ Failed to send OTP via Firebase.");
      // Clear broken verifier so next attempt creates a fresh one
      if (window.recaptchaVerifier) {
        try { window.recaptchaVerifier.clear(); } catch (_) {}
        window.recaptchaVerifier = null;
      }
    } finally {
      setFpLoading(false);
    }
  };




  // ─────────────────────────────────────────────────────────────
  // STEP 2b: User requests mobile change
  // ─────────────────────────────────────────────────────────────
  const handleRequestChange = async () => {
    if (!newMobile || newMobile.replace(/\D/g, "").length !== 10) {
      setFpError("Please enter a valid 10-digit mobile number.");
      return;
    }
    setFpLoading(true); setFpError("");
    try {
      const res = await axios.post("http://localhost:5000/request-mobile-change", {
        licenseDocId: fpData.licenseDocId,
        userId: fpData.userId,
        userName: username,
        role: fpData.role,
        newMobile,
        shopName: "Swarna Raseid" // could be fetched dynamically
      });
      // Backend returns the requestId so we can poll for status
      setRequestId(res.data.requestId || "pending");
      setScreen("waiting_approval");
      setFpSuccess(
        fpData.role === "admin"
          ? "📨 Request sent to your Super Admin. Waiting for approval..."
          : "📨 Request sent to the system administrator. Waiting for approval..."
      );
    } catch {
      setFpError("Failed to send request. Please try again.");
    } finally {
      setFpLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // STEP 3: Verify OTP via backend
  // ─────────────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      setFpError("Please enter the 6-digit verification code.");
      return;
    }
    setFpLoading(true); setFpError("");
    try {
      if (isTestMode) {
        // Test mode — accept any 6-digit code
        console.log("✅ Test mode — OTP accepted");
      } else {
        // Production — verify with Firebase
        if (!confirmationResult) throw new Error("No OTP request pending.");
        await confirmationResult.confirm(otp);
      }
      setNewUsername(username);
      setScreen("new_credentials");
      setFpSuccess("✅ Phone verified! Now set your new credentials.");
    } catch (err) {
      console.error("Firebase verify error:", err);
      setFpError(err.message || "❌ Verification failed. Please try again.");
    } finally {
      setFpLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // STEP 4: Submit new username + password
  // ─────────────────────────────────────────────────────────────
  const handleResetCredentials = async () => {
    if (!newPassword || newPassword.length < 6) {
      setFpError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFpError("Passwords do not match.");
      return;
    }
    setFpLoading(true); setFpError("");
    try {
      await axios.post("http://localhost:5000/reset-password", {
        licenseDocId: fpData.licenseDocId,
        userId: fpData.userId,
        newUsername,
        newPassword
      });
      setFpSuccess("🎉 Credentials updated successfully! Please log in.");
      setTimeout(() => {
        setScreen("login");
        setUsername(newUsername);
        setPassword("");
      }, 2000);
    } catch (err) {
      setFpError(err.response?.data?.error || "Failed to reset credentials.");
    } finally {
      setFpLoading(false);
    }

  };

  const isOnline = deviceStatus.status === "ONLINE";

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="admin-login-overlay">
      {/* Invisible reCAPTCHA container for Firebase Phone Auth */}
      <div id="recaptcha-container"></div>

      <div className="admin-login-card">
        <img src={logo} alt="Logo" className="login-logo-img" />
        <h1 className="login-title">Swarna Raseid</h1>

        {/* ── SCREEN: Normal Login ── */}
        {screen === "login" && (
          <>
            <div className="device-status-bar">
              <span className={`device-dot ${isOnline ? "dot-online" : "dot-offline"}`}></span>
              <span className={`device-label ${isOnline ? "label-online" : "label-offline"}`}>
                {isOnline ? `ONLINE — ${deviceStatus.port}` : "OFFLINE — No Device"}
              </span>
              {isOnline && <span className="device-hint">Press ESP32 button to autofill key</span>}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleAuthSubmit(); }}>
              <input type="text" placeholder="License Key (e.g. SW-ABC123)"
                value={licenseKey} onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                className="login-input" required />
              <input type="text" placeholder="Username"
                value={username} onChange={(e) => setUsername(e.target.value)}
                className="login-input" required />
              <input type="password" placeholder="Password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="login-input" required />
              <button type="submit" disabled={loading} className="login-submit-btn">
                {loading ? "Verifying..." : "Enter Workspace"}
              </button>
            </form>

            <button
              onClick={handleForgotClick}
              disabled={loading}
              style={{
                marginTop: "14px", background: "none", border: "none",
                color: "#b8860b", fontWeight: 600, cursor: "pointer",
                fontSize: "0.9rem", textDecoration: "underline"
              }}
            >
              🔑 Forgot Username / Password?
            </button>

            {error && <p className="error-text">{error}</p>}
            {fpError && <p className="error-text">{fpError}</p>}
          </>
        )}

        {/* ── SCREEN: Confirm Mobile ── */}
        {screen === "confirm_mobile" && (
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#555", marginBottom: "8px" }}>An OTP will be sent to:</p>
            <div style={{
              fontSize: "1.5rem", fontWeight: 700, letterSpacing: "4px",
              color: "#b8860b", margin: "16px 0"
            }}>
              📱 {fpData.maskedMobile}
            </div>
            <p style={{ color: "#888", fontSize: "0.85rem", marginBottom: "24px" }}>
              This is the mobile number registered with your account.
            </p>
            {fpError && <p className="error-text">{fpError}</p>}
            <button onClick={sendOtp} disabled={fpLoading}
              className="login-submit-btn" style={{ marginBottom: "10px" }}>
              {fpLoading ? "Sending OTP..." : "📤 Send OTP"}
            </button>
            <br />
            <button onClick={() => setScreen("request_change")}
              style={{
                background: "none", border: "none", color: "#888",
                cursor: "pointer", textDecoration: "underline", fontSize: "0.85rem"
              }}>
              I don't have access to this number
            </button>
            <br />
            <button onClick={() => setScreen("login")}
              style={{
                background: "none", border: "none", color: "#ccc",
                cursor: "pointer", marginTop: "10px", fontSize: "0.8rem"
              }}>
              ← Back to Login
            </button>
          </div>
        )}

        {/* ── SCREEN: No Mobile Registered ── */}
        {screen === "no_mobile" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "12px" }}>📵</div>
            <p style={{ color: "#555", marginBottom: "20px" }}>
              No mobile number is registered for your account.<br />
              Enter a new number to request access.
            </p>
            {fpError && <p className="error-text">{fpError}</p>}
            <input type="tel" placeholder="Enter 10-digit mobile number"
              value={newMobile} onChange={(e) => setNewMobile(e.target.value)}
              className="login-input" maxLength={10} />
            <button onClick={handleRequestChange} disabled={fpLoading} className="login-submit-btn">
              {fpLoading ? "Sending..." : "📨 Send Request"}
            </button>
            <br />
            <button onClick={() => setScreen("login")}
              style={{
                background: "none", border: "none", color: "#ccc",
                cursor: "pointer", marginTop: "10px", fontSize: "0.8rem"
              }}>
              ← Back to Login
            </button>
          </div>
        )}

        {/* ── SCREEN: Request Mobile Change ── */}
        {screen === "request_change" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "12px" }}>📲</div>
            <p style={{ color: "#555", marginBottom: "20px" }}>
              Enter your new mobile number.<br />
              <span style={{ fontSize: "0.82rem", color: "#888" }}>
                {fpData.role === "admin"
                  ? "Your Super Admin will be notified to approve this change."
                  : "The system administrator will be notified to approve this change."}
              </span>
            </p>
            {fpError && <p className="error-text">{fpError}</p>}
            <input type="tel" placeholder="Enter new 10-digit mobile number"
              value={newMobile} onChange={(e) => setNewMobile(e.target.value)}
              className="login-input" maxLength={10} />
            <button onClick={handleRequestChange} disabled={fpLoading} className="login-submit-btn">
              {fpLoading ? "Sending Request..." : "📨 Submit Request"}
            </button>
            <br />
            <button onClick={() => setScreen("confirm_mobile")}
              style={{
                background: "none", border: "none", color: "#ccc",
                cursor: "pointer", marginTop: "10px", fontSize: "0.8rem"
              }}>
              ← Back
            </button>
          </div>
        )}

        {/* ── SCREEN: Waiting for Approval ── */}
        {screen === "waiting_approval" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "16px" }}>⏳</div>
            <p style={{ fontWeight: 700, color: "#b8860b" }}>Request Submitted</p>
            <p style={{ color: "#555", fontSize: "0.9rem", marginBottom: "20px" }}>
              {fpData.role === "admin"
                ? "Waiting for your Super Admin to approve the mobile change."
                : "Waiting for the system administrator to approve your request."}
            </p>
            {fpSuccess && <p style={{ color: "#27ae60", fontWeight: 600 }}>{fpSuccess}</p>}
            {fpError && <p className="error-text">{fpError}</p>}
            <div style={{ color: "#ccc", fontSize: "0.8rem", marginTop: "12px" }}>
              This page will update automatically when approved.
            </div>
            <button onClick={() => setScreen("login")}
              style={{
                background: "none", border: "none", color: "#ccc",
                cursor: "pointer", marginTop: "16px", fontSize: "0.8rem"
              }}>
              ← Back to Login
            </button>
          </div>
        )}

        {/* ── SCREEN: Enter OTP ── */}
        {screen === "enter_otp" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "12px" }}>💬</div>
            <p style={{ color: "#555", marginBottom: "8px" }}>Enter the 6-digit OTP sent to</p>
            <p style={{ fontWeight: 700, color: "#b8860b", fontSize: "1.1rem", marginBottom: "20px" }}>
              {fpData.maskedMobile}
            </p>
            {fpSuccess && <p style={{ color: "#27ae60", fontSize: "0.85rem" }}>{fpSuccess}</p>}
            {fpError && <p className="error-text">{fpError}</p>}
            <input
              type="text" placeholder="Enter 6-digit OTP"
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="login-input"
              style={{ letterSpacing: "8px", textAlign: "center", fontSize: "1.4rem", fontWeight: 700 }}
              maxLength={6}
            />
            <button onClick={handleVerifyOtp} disabled={fpLoading} className="login-submit-btn">
              {fpLoading ? "Verifying OTP..." : "✅ Verify OTP"}
            </button>
            <br />
            <button onClick={() => setScreen("confirm_mobile")}
              style={{
                background: "none", border: "none", color: "#ccc",
                cursor: "pointer", marginTop: "10px", fontSize: "0.8rem"
              }}>
              ← Resend OTP
            </button>
          </div>
        )}

        {/* ── SCREEN: New Credentials ── */}
        {screen === "new_credentials" && (
          <div>
            <p style={{ textAlign: "center", color: "#27ae60", fontWeight: 600, marginBottom: "16px" }}>
              ✅ OTP Verified — Set your new credentials
            </p>
            {fpError && <p className="error-text">{fpError}</p>}
            <div className="input-row">
              <label>New Username</label>
              <input type="text" value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="login-input"
                placeholder="New username (or keep current)" />
            </div>
            <div className="input-row">
              <label>New Password *</label>
              <input type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="login-input" placeholder="Min. 6 characters" />
            </div>
            <div className="input-row">
              <label>Confirm Password *</label>
              <input type="password" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="login-input" placeholder="Repeat new password" />
            </div>
            <button onClick={handleResetCredentials} disabled={fpLoading} className="login-submit-btn">
              {fpLoading ? "Saving..." : "💾 Save New Credentials"}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // Normal login submit handler
  async function handleAuthSubmit() {
    setLoading(true); setError("");
    try {
      const res = await axios.post("http://localhost:5000/login", { licenseKey, username, password });
      if (res.data.valid) {
        onAuthSuccess({
          licenseDocId: res.data.licenseDocId,
          userId: res.data.userId,
          role: res.data.role,
          name: res.data.name,
          permissions: res.data.permissions
        });
      } else {
        setError(res.data.message || "Invalid credentials.");
      }
    } catch {
      setError("Server connection failed. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }
}

export default Login;
