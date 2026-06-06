import React, { useState } from "react";
import axios from "axios";

/**
 * 👥 Staff Management — List first, Create on button click
 */
function StaffManagement({ fetchStaff, staffList, licenseDocId, userId, userName, userRole, showCreatedBy }) {
  const [view, setView] = useState("list"); // "list" | "form"

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
    remark: ""
  });

  const resetForm = () => setFormData({
    joiningDate: new Date().toISOString().split('T')[0],
    referredBy: "", designation: "", department: "",
    fullName: "", gender: "Male", address: "", emailId: "",
    mobileNo: "", dob: "", anniversaryDate: "",
    emergencyContactPerson: "", emergencyContactNo: "",
    bloodGroup: "", documentType: "", documentNo: "",
    communicationSms: true, communicationEmail: true,
    salesCommission: false, remark: ""
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post("http://localhost:5000/add-staff", {
        licenseDocId, userId, userName, ...formData
      });
      alert("Staff Member Registered Successfully!");
      resetForm();
      fetchStaff();
      setView("list"); // go back to list after save
    } catch (err) {
      alert("Failed to register staff.");
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
            onClick={() => setView("form")}
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
                  {showCreatedBy && userRole === "super_admin" && <th>Created By</th>}
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
          <h1>Create Staff Profile</h1>
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
              <input type="text" value={formData.emergencyContactNo} onChange={e => f("emergencyContactNo", e.target.value)} />
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
                <input type="text" value={formData.mobileNo} onChange={e => f("mobileNo", e.target.value)} required />
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
            💾 Save Staff Profile
          </button>
        </div>
      </form>
    </div>
  );
}

export default StaffManagement;
