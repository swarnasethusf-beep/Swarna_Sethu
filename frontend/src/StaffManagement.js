import React, { useState, useEffect, useCallback } from "react";
import api, { errMsg } from "./api";

/**
 * 👥 Staff Management — List first, Create/Edit on button click
 */
function StaffManagement({ userRole, showCreatedBy }) {
  const [view, setView] = useState("list"); // "list" | "form"
  const [staffList, setStaffList] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [loginDialog, setLoginDialog] = useState(null); // { staff, mode: "create" | "password", username, password }
  const [loginMsg, setLoginMsg] = useState("");
  const isOwner = userRole === "super_admin";

  const fetchStaff = useCallback(() => {
    api.get("/staff").then(({ data }) => setStaffList(data)).catch((err) => setError(errMsg(err)));
  }, []);
  useEffect(fetchStaff, [fetchStaff]);

  const [formData, setFormData] = useState({
    joiningDate: new Date().toISOString().split('T')[0],
    referredBy: "",
    designation: "",
    department: "",
    fullName: "",
    gender: "Male",
    address: "",
    emailId: "",
    mobileNo: "",
    dob: "",
    anniversaryDate: "",
    emergencyContactPerson: "",
    emergencyContactNo: "",
    bloodGroup: "",
    documentType: "",
    documentNo: "",
    communicationSms: true,
    communicationEmail: true,
    salesCommission: false,
    remark: "",
    loginUsername: "",
    loginPassword: ""
  });

  const resetForm = () => { setEditingId(null); setError(""); setFormData({
    joiningDate: new Date().toISOString().split('T')[0],
    referredBy: "", designation: "", department: "",
    fullName: "", gender: "Male", address: "", emailId: "",
    mobileNo: "", dob: "", anniversaryDate: "",
    emergencyContactPerson: "", emergencyContactNo: "",
    bloodGroup: "", documentType: "", documentNo: "",
    communicationSms: true, communicationEmail: true,
    salesCommission: false, remark: "",
    loginUsername: "", loginPassword: ""
  }); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (editingId) await api.put(`/staff/${editingId}`, formData);
      else {
        const { data } = await api.post("/staff", formData);
        if (data.loginUsername) {
          alert(`Staff saved and login created.\n\nUsername: ${data.loginUsername}\nThey sign in on the normal login page with the shop's license key, this username and the password you set.`);
        }
      }
      resetForm();
      fetchStaff();
      setView("list"); // go back to list after save
    } catch (err) {
      setError(errMsg(err, "Failed to save staff member."));
    }
  };

  const startEdit = (s) => {
    setFormData((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, k.startsWith("login") ? "" : (s[k] ?? prev[k])])));
    setEditingId(s.id);
    setView("form");
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    const { staff, mode, username, password } = loginDialog;
    setLoginMsg("");
    try {
      if (mode === "create") await api.post(`/staff/${staff.id}/login`, { username, password });
      else await api.post(`/staff/${staff.id}/login/password`, { password });
      setLoginDialog(null);
      fetchStaff();
      alert(mode === "create"
        ? `Login created for ${staff.fullName}.\n\nUsername: ${username}\nThey sign in with the shop's license key, this username and the password you set.`
        : `Password changed for ${staff.fullName}. They have been signed out.`);
    } catch (err) {
      setLoginMsg(errMsg(err, "Could not save the login."));
    }
  };

  const removeLogin = async (s) => {
    if (!window.confirm(`Remove ${s.fullName}'s login? They won't be able to sign in or receive work any more.`)) return;
    try {
      await api.delete(`/staff/${s.id}/login`);
      fetchStaff();
    } catch (err) {
      alert(errMsg(err));
    }
  };

  const handleDelete = async (s) => {
    if (!window.confirm(`Remove ${s.fullName} from staff?`)) return;
    try {
      await api.delete(`/staff/${s.id}`);
      fetchStaff();
    } catch (err) {
      alert(errMsg(err));
    }
  };

  const f = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

  // ─── LIST VIEW ────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="staff-mgmt-page">
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1>Staff Management</h1>
            <p>Manage your workforce profiles</p>
          </div>
          <button
            onClick={() => { resetForm(); setView("form"); }}
            style={{
              padding: "11px 24px",
              background: "linear-gradient(135deg, #b8860b, #ffd700)",
              color: "white", border: "none", borderRadius: "10px",
              fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
              boxShadow: "0 4px 15px rgba(184,134,11,0.3)",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            ➕ Create Staff
          </button>
        </header>

        {error && <div className="alert error">{error}</div>}
        {loginDialog && (
          <div className="modal-backdrop" onClick={() => setLoginDialog(null)}>
            <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitLogin}>
              <h3>{loginDialog.mode === "create" ? "Create username & password" : "Reset password"} — {loginDialog.staff.fullName}</h3>
              <p className="hint">
                {loginDialog.mode === "create"
                  ? "This is not a login page — it creates the credentials. They sign in on the normal login page with the shop's license key plus this username and password, and see only their own work."
                  : "They will be signed out everywhere and must use the new password."}
              </p>
              {loginDialog.mode === "create" && (
                <label className="field">Username
                  <input autoFocus value={loginDialog.username} onChange={(e) => setLoginDialog({ ...loginDialog, username: e.target.value.trim() })} placeholder="e.g. venkat" required minLength={3} />
                </label>
              )}
              <label className="field">{loginDialog.mode === "create" ? "Password" : "New password"} (min. 8 characters)
                <input type="text" autoComplete="off" value={loginDialog.password} onChange={(e) => setLoginDialog({ ...loginDialog, password: e.target.value })} required minLength={8} />
              </label>
              {loginMsg && <div className="alert error">{loginMsg}</div>}
              <div className="btn-group">
                <button className="btn btn-primary" type="submit">Save</button>
                <button className="btn btn-secondary" type="button" onClick={() => setLoginDialog(null)}>Cancel</button>
              </div>
            </form>
          </div>
        )}
        <div className="table-card" style={{ marginTop: "24px" }}>
          {staffList.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "60px 20px",
              color: "#aaa"
            }}>
              <div style={{ fontSize: "3rem", marginBottom: "12px" }}>👥</div>
              <p style={{ fontWeight: 600, fontSize: "1rem" }}>No staff members yet</p>
              <p style={{ fontSize: "0.85rem" }}>Click "Create Staff" to add your first member</p>
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Full Name</th>
                  <th>Designation</th>
                  <th>Department</th>
                  <th>Mobile</th>
                  <th>Joining Date</th>
                  <th>Gender</th>
                  <th>App login</th>
                  {showCreatedBy && userRole === "super_admin" && <th>Created By</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((s, i) => (
                  <tr key={s.id}>
                    <td style={{ color: "#aaa", fontWeight: 600 }}>{i + 1}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          background: "linear-gradient(135deg, #b8860b, #ffd700)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "white", fontWeight: 700, fontSize: "0.85rem", flexShrink: 0
                        }}>
                          {s.fullName?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                        <span style={{ fontWeight: 600 }}>{s.fullName || "—"}</span>
                      </div>
                    </td>
                    <td>{s.designation || "—"}</td>
                    <td>{s.department || "—"}</td>
                    <td>{s.mobileNo || "—"}</td>
                    <td>{s.joiningDate || "—"}</td>
                    <td>
                      <span style={{
                        background: s.gender === "Female" ? "#fce4ec" : "#e3f2fd",
                        color: s.gender === "Female" ? "#c2185b" : "#1565c0",
                        padding: "3px 10px", borderRadius: "12px",
                        fontSize: "0.78rem", fontWeight: 600
                      }}>
                        {s.gender || "—"}
                      </span>
                    </td>
                    <td className="nowrap">
                      {s.hasLogin ? (
                        <>
                          <span className="pill ok" title="Can sign in and receive work orders">🔔 @{s.loginUsername}</span>
                          {isOwner && (
                            <div style={{ marginTop: 4 }}>
                              <button className="link-btn inline sub" onClick={() => { setLoginMsg(""); setLoginDialog({ staff: s, mode: "password", username: s.loginUsername, password: "" }); }}>Reset password</button>
                              {" · "}
                              <button className="link-btn inline sub" onClick={() => removeLogin(s)}>Remove login</button>
                            </div>
                          )}
                        </>
                      ) : isOwner ? (
                        <button className="btn btn-sm btn-secondary" onClick={() => { setLoginMsg(""); setLoginDialog({ staff: s, mode: "create", username: "", password: "" }); }}>🔑 Give login</button>
                      ) : <span className="sub">—</span>}
                    </td>
                    {showCreatedBy && userRole === "super_admin" && (
                      <td>
                        <span style={{
                          background: s.createdByName ? "#eaf4fb" : "#f5f5f5",
                          color: s.createdByName ? "#2980b9" : "#bbb",
                          padding: "3px 10px", borderRadius: "12px",
                          fontSize: "0.78rem", fontWeight: 600
                        }}>
                          👤 {s.createdByName || "—"}
                        </span>
                      </td>
                    )}
                    <td className="nowrap">
                      <button className="btn btn-sm btn-secondary" onClick={() => startEdit(s)}>Edit</button>{" "}
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // ─── FORM VIEW ────────────────────────────────────────────────────────────
  return (
    <div className="staff-mgmt-page">
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1>{editingId ? "Edit Staff Profile" : "Create Staff Profile"}</h1>
          <p>Fill in the details and save the staff member</p>
        </div>
        <button
          onClick={() => { setView("list"); resetForm(); }}
          style={{
            padding: "10px 20px", background: "#f5f5f5", color: "#555",
            border: "1px solid #ddd", borderRadius: "8px",
            fontWeight: 600, cursor: "pointer", fontSize: "0.9rem"
          }}
        >
          ← Back to List
        </button>
      </header>

      <form className="staff-form-container" onSubmit={handleSubmit} style={{ marginTop: "20px" }}>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>

          {/* Staff Information */}
          <div className="details-card">
            <h3>Staff Information</h3>
            <div className="input-row"><label>Joining Date</label>
              <input type="date" value={formData.joiningDate} onChange={e => f("joiningDate", e.target.value)} />
            </div>
            <div className="input-row"><label>Referred By</label>
              <input type="text" value={formData.referredBy} onChange={e => f("referredBy", e.target.value)} />
            </div>
            <div className="input-row"><label>Designation *</label>
              <input type="text" value={formData.designation} onChange={e => f("designation", e.target.value)} required />
            </div>
            <div className="input-row"><label>Department *</label>
              <input type="text" value={formData.department} onChange={e => f("department", e.target.value)} required />
            </div>
          </div>

          {/* Emergency Contact */}
          <div className="details-card">
            <h3>Emergency Contact</h3>
            <div className="input-row"><label>Contact Person</label>
              <input type="text" value={formData.emergencyContactPerson} onChange={e => f("emergencyContactPerson", e.target.value)} />
            </div>
            <div className="input-row"><label>Contact No</label>
              <input type="tel" inputMode="numeric" maxLength={10} value={formData.emergencyContactNo} onChange={e => f("emergencyContactNo", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="input-row"><label>Blood Group</label>
              <select value={formData.bloodGroup} onChange={e => f("bloodGroup", e.target.value)}>
                <option value="">Select</option>
                <option>A+</option><option>B+</option><option>O+</option><option>AB+</option>
                <option>A-</option><option>B-</option><option>O-</option><option>AB-</option>
              </select>
            </div>
          </div>

          {/* Personal Information */}
          <div className="details-card" style={{ gridColumn: "span 2" }}>
            <h3>Personal Information</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
              <div className="input-row"><label>Full Name *</label>
                <input type="text" value={formData.fullName} onChange={e => f("fullName", e.target.value)} required />
              </div>
              <div className="input-row"><label>Mobile No. *</label>
                <input type="tel" inputMode="numeric" maxLength={10} value={formData.mobileNo} onChange={e => f("mobileNo", e.target.value.replace(/\D/g, ""))} required />
              </div>
              <div className="input-row"><label>Email ID</label>
                <input type="email" value={formData.emailId} onChange={e => f("emailId", e.target.value)} />
              </div>
              <div className="input-row"><label>Date of Birth</label>
                <input type="date" value={formData.dob} onChange={e => f("dob", e.target.value)} />
              </div>
              <div className="input-row"><label>Anniversary Date</label>
                <input type="date" value={formData.anniversaryDate} onChange={e => f("anniversaryDate", e.target.value)} />
              </div>
              <div className="input-row"><label>Gender</label>
                <div className="radio-group" style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                  <label><input type="radio" checked={formData.gender === "Male"} onChange={() => f("gender", "Male")} /> Male</label>
                  <label><input type="radio" checked={formData.gender === "Female"} onChange={() => f("gender", "Female")} /> Female</label>
                  <label><input type="radio" checked={formData.gender === "Other"} onChange={() => f("gender", "Other")} /> Other</label>
                </div>
              </div>
            </div>
            <div className="input-row" style={{ marginTop: "12px" }}><label>Address *</label>
              <textarea value={formData.address} onChange={e => f("address", e.target.value)} required />
            </div>
          </div>

          {/* Identity Details */}
          <div className="details-card">
            <h3>Identity Details</h3>
            <div className="input-row"><label>Document Type</label>
              <input type="text" value={formData.documentType} onChange={e => f("documentType", e.target.value)} />
            </div>
            <div className="input-row"><label>Document No.</label>
              <input type="text" value={formData.documentNo} onChange={e => f("documentNo", e.target.value)} />
            </div>
          </div>

          {/* App login — created together with the staff member */}
          {isOwner && !editingId && (
            <div className="details-card" style={{ gridColumn: "span 2" }}>
              <h3>🔑 App login (optional) — so they can receive work and notifications</h3>
              <p className="hint" style={{ marginTop: 0 }}>
                They sign in on the normal login page with the shop's <strong>license key</strong>, this <strong>username</strong> and <strong>password</strong>.
                They will see only their own work — nothing about billing, stock or customers. Leave empty for staff who don't need to sign in.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div className="input-row"><label>Username</label>
                  <input type="text" autoComplete="off" value={formData.loginUsername} onChange={e => f("loginUsername", e.target.value.trim())} placeholder="e.g. venkat" minLength={3} />
                </div>
                <div className="input-row"><label>Password</label>
                  <input type="text" autoComplete="off" value={formData.loginPassword} onChange={e => f("loginPassword", e.target.value)} placeholder="min. 8 characters" minLength={8} required={!!formData.loginUsername} />
                </div>
              </div>
            </div>
          )}

          {/* Other Details */}
          <div className="details-card">
            <h3>Other Details</h3>
            <div className="input-row"><label>Communication</label>
              <div className="check-group" style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                <label><input type="checkbox" checked={formData.communicationSms} onChange={e => f("communicationSms", e.target.checked)} /> SMS</label>
                <label><input type="checkbox" checked={formData.communicationEmail} onChange={e => f("communicationEmail", e.target.checked)} /> Email</label>
              </div>
            </div>
            <div className="input-row"><label>Remark / Note</label>
              <textarea value={formData.remark} onChange={e => f("remark", e.target.value)} />
            </div>
          </div>

        </div>

        {error && <div className="alert error">{error}</div>}
        {/* Footer Buttons */}
        <div style={{ display: "flex", gap: "12px", marginTop: "24px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => { setView("list"); resetForm(); }}
            style={{
              padding: "12px 28px", background: "#f5f5f5", color: "#555",
              border: "1px solid #ddd", borderRadius: "8px", fontWeight: 600, cursor: "pointer"
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              padding: "12px 32px",
              background: "linear-gradient(135deg, #b8860b, #ffd700)",
              color: "white", border: "none", borderRadius: "10px",
              fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
              boxShadow: "0 4px 15px rgba(184,134,11,0.3)"
            }}
          >
            💾 {editingId ? "Update" : "Save"} Staff Profile
          </button>
        </div>
      </form>
    </div>
  );
}

export default StaffManagement;
