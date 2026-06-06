import React, { useState, useEffect } from "react";
import axios from "axios";

/**
 * 👑 Admin Management — Visible only to Super Admin
 * Create admins, assign module permissions, view/delete existing admins
 */
function AdminManagement({ licenseDocId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);

  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    mobile: "",
    permissions: {
      invoice:   false,
      inventory: false,
      staff:     false,
      reports:   false
    }
  });

  const [msg, setMsg] = useState({ text: "", type: "" });

  useEffect(() => {
    fetchUsers();
    fetchPendingRequests();
    // Poll for new requests every 10 seconds
    const interval = setInterval(fetchPendingRequests, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchPendingRequests = async () => {
    try {
      const res = await axios.get("http://localhost:5000/pending-requests", {
        params: { licenseDocId }
      });
      // Only show pending ones
      setPendingRequests(res.data.filter(r => r.status === "pending"));
    } catch (err) {
      console.error("Failed to fetch pending requests:", err);
    }
  };

  const handleApproveRequest = async (requestId, action) => {
    try {
      await axios.post("http://localhost:5000/approve-request", {
        licenseDocId, requestId, action
      });
      fetchPendingRequests();
    } catch {
      alert("Failed to process request.");
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await axios.get("http://localhost:5000/users", {
        params: { licenseDocId }
      });
      setUsers(res.data);
    } catch (err) {
      console.error("Failed to fetch users:", err);
    }
  };

  const togglePermission = (key) => {
    setForm(prev => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] }
    }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.mobile || form.mobile.replace(/\D/g, "").length !== 10) {
      setMsg({ text: "Please enter a valid 10-digit mobile number.", type: "error" });
      return;
    }
    setLoading(true);
    setMsg({ text: "", type: "" });
    try {
      await axios.post("http://localhost:5000/add-user", {
        licenseDocId,
        name: form.name,
        username: form.username,
        password: form.password,
        mobile: form.mobile,
        permissions: form.permissions
      });
      setMsg({ text: `✅ Admin "${form.name}" created successfully!`, type: "success" });
      setForm({ name: "", username: "", password: "", mobile: "", permissions: { invoice: false, inventory: false, staff: false, reports: false } });
      fetchUsers();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || "Failed to create admin.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId, userName) => {
    if (!window.confirm(`Remove admin "${userName}"? This cannot be undone.`)) return;
    try {
      await axios.delete("http://localhost:5000/delete-user", {
        data: { licenseDocId, userId }
      });
      fetchUsers();
    } catch {
      alert("Failed to delete user.");
    }
  };

  const MODULE_LABELS = {
    invoice:   { icon: "📜", label: "Invoice" },
    inventory: { icon: "📦", label: "Inventory" },
    staff:     { icon: "👥", label: "Staff" },
    reports:   { icon: "📊", label: "Reports" }
  };

  const admins = users.filter(u => u.role === "admin");
  const superAdmins = users.filter(u => u.role === "super_admin");

  return (
    <div className="staff-mgmt-page">
      <header>
        <h1>Admin Management</h1>
        <p>Create staff accounts and control their module access</p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "24px", marginTop: "20px" }}>

        {/* ─── LEFT: Create Admin Form ────────────────────────────── */}
        <div className="details-card" style={{ padding: "28px" }}>
          <h3 style={{ marginTop: 0 }}>➕ Create New Admin</h3>
          <form onSubmit={handleCreate}>
            <div className="input-row">
              <label>Full Name *</label>
              <input
                type="text"
                placeholder="e.g. Ravi Kumar"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="input-row">
              <label>Username *</label>
              <input
                type="text"
                placeholder="e.g. ravi_invoice"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="input-row">
              <label>Password *</label>
              <input
                type="password"
                placeholder="Set a password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div className="input-row">
              <label>Mobile Number * <span style={{ color: "#888", fontWeight: 400, fontSize: "0.8rem" }}>(for OTP password reset)</span></label>
              <input
                type="tel"
                placeholder="10-digit mobile number"
                value={form.mobile}
                onChange={e => setForm({ ...form, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                required
                maxLength={10}
              />
            </div>

            {/* Permissions */}
            <div style={{ marginTop: "20px" }}>
              <label style={{ fontWeight: 700, display: "block", marginBottom: "12px" }}>
                🔐 Module Permissions
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {Object.entries(MODULE_LABELS).map(([key, { icon, label }]) => (
                  <label
                    key={key}
                    onClick={() => togglePermission(key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      border: `2px solid ${form.permissions[key] ? "#27ae60" : "#ddd"}`,
                      background: form.permissions[key] ? "#eafaf1" : "#fafafa",
                      transition: "all 0.2s",
                      userSelect: "none"
                    }}
                  >
                    <span style={{ fontSize: "1.2rem" }}>{icon}</span>
                    <span style={{ fontWeight: 600, color: form.permissions[key] ? "#27ae60" : "#999" }}>
                      {label}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: "1.1rem" }}>
                      {form.permissions[key] ? "✅" : "⬜"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: "22px", width: "100%", padding: "13px",
                background: loading ? "#aaa" : "linear-gradient(135deg, #b8860b, #ffd700)",
                color: "white", border: "none", borderRadius: "10px",
                fontWeight: 700, fontSize: "0.95rem", cursor: "pointer"
              }}
            >
              {loading ? "Creating..." : "Create Admin Account"}
            </button>
          </form>

          {msg.text && (
            <div style={{
              marginTop: "14px", padding: "12px 16px", borderRadius: "8px",
              background: msg.type === "success" ? "#eafaf1" : "#fdf0f0",
              color: msg.type === "success" ? "#27ae60" : "#e74c3c",
              fontWeight: 600, fontSize: "0.9rem"
            }}>
              {msg.text}
            </div>
          )}
        </div>

        {/* ─── RIGHT: Existing Users ──────────────────────────────── */}
        <div>
          {/* Super Admins (read-only) */}
          <div className="details-card" style={{ padding: "22px", marginBottom: "18px" }}>
            <h3 style={{ marginTop: 0 }}>👑 Super Admin</h3>
            {superAdmins.map(u => (
              <div key={u.id} style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "12px 16px", borderRadius: "10px",
                background: "linear-gradient(135deg, #fef9e7, #fdebd0)",
                border: "1px solid #f39c12"
              }}>
                <div style={{
                  width: "40px", height: "40px", borderRadius: "50%",
                  background: "#f39c12", display: "flex", alignItems: "center",
                  justifyContent: "center", color: "white", fontWeight: 700, fontSize: "1.1rem"
                }}>
                  {u.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{u.name}</div>
                  <div style={{ fontSize: "0.8rem", color: "#888" }}>@{u.username} · Full Access</div>
                </div>
                <span style={{
                  marginLeft: "auto", background: "#f39c12", color: "white",
                  padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700
                }}>
                  SUPER ADMIN
                </span>
              </div>
            ))}
          </div>

          {/* Admins List */}
          <div className="details-card" style={{ padding: "22px" }}>
            <h3 style={{ marginTop: 0 }}>👤 Admin Accounts ({admins.length})</h3>
            {admins.length === 0 && (
              <p style={{ color: "#aaa", textAlign: "center", padding: "20px 0" }}>
                No admins created yet. Use the form to add one.
              </p>
            )}
            {admins.map(u => (
              <div key={u.id} style={{
                padding: "14px 16px", borderRadius: "10px", border: "1px solid #eee",
                marginBottom: "12px", background: "#fff"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{
                    width: "38px", height: "38px", borderRadius: "50%",
                    background: "#3498db", display: "flex", alignItems: "center",
                    justifyContent: "center", color: "white", fontWeight: 700
                  }}>
                    {u.name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{u.name}</div>
                    <div style={{ fontSize: "0.8rem", color: "#888" }}>@{u.username}</div>
                  </div>
                  <button
                    onClick={() => handleDelete(u.id, u.name)}
                    style={{
                      marginLeft: "auto", background: "#fee", color: "#e74c3c",
                      border: "1px solid #f5b7b1", borderRadius: "6px",
                      padding: "5px 12px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600
                    }}
                  >
                    🗑️ Remove
                  </button>
                </div>

                {/* Permission badges */}
                <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                  {Object.entries(MODULE_LABELS).map(([key, { icon, label }]) => (
                    <span
                      key={key}
                      style={{
                        padding: "4px 10px", borderRadius: "20px", fontSize: "0.75rem",
                        fontWeight: 600,
                        background: u.permissions?.[key] ? "#eafaf1" : "#f0f0f0",
                        color: u.permissions?.[key] ? "#27ae60" : "#bbb",
                        border: `1px solid ${u.permissions?.[key] ? "#a9dfbf" : "#ddd"}`
                      }}
                    >
                      {icon} {label} {u.permissions?.[key] ? "✓" : "✗"}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── NOTIFICATIONS: Pending Mobile Change Requests ─────── */}
      {pendingRequests.length > 0 && (
        <div className="details-card" style={{ marginTop: "28px", padding: "24px", border: "2px solid #f39c12" }}>
          <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{
              background: "#e74c3c", color: "white", borderRadius: "50%",
              width: "24px", height: "24px", display: "inline-flex",
              alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700
            }}>{pendingRequests.length}</span>
            🔔 Pending Requests
          </h3>
          <p style={{ color: "#888", fontSize: "0.85rem", marginBottom: "16px" }}>
            The following admins are requesting a mobile number change for password reset.
          </p>
          {pendingRequests.map(req => (
            <div key={req.id} style={{
              display: "flex", alignItems: "center", gap: "16px",
              padding: "14px 18px", borderRadius: "10px", background: "#fef9e7",
              border: "1px solid #f39c12", marginBottom: "12px"
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{req.requestedByName}</div>
                <div style={{ fontSize: "0.82rem", color: "#888" }}>
                  Requesting mobile change to: <strong>{req.newMobile}</strong>
                </div>
              </div>
              <button
                onClick={() => handleApproveRequest(req.id, "approved")}
                style={{
                  padding: "7px 16px", background: "#27ae60", color: "white",
                  border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 700
                }}
              >
                ✅ Approve
              </button>
              <button
                onClick={() => handleApproveRequest(req.id, "rejected")}
                style={{
                  padding: "7px 16px", background: "#fee", color: "#e74c3c",
                  border: "1px solid #f5b7b1", borderRadius: "8px", cursor: "pointer", fontWeight: 700
                }}
              >
                ❌ Reject
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AdminManagement;
