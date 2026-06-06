import React, { useState, useEffect } from "react";
import axios from "axios";

/**
 * 👑 ADMIN PORTAL - Master Dashboard
 */
function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [view, setView] = useState("create"); // 'create' or 'list'
  
  // Form State
  const [formData, setFormData] = useState({
    name: "",
    business: "",
    mobile: "",
    email: "",
    location: "",
    expiry: "",
    superAdminUsername: "",
    superAdminPassword: ""
  });

  const [licenses, setLicenses] = useState([]);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (isAdmin && view === "list") {
      fetchLicenses();
    }
  }, [isAdmin, view]);

  const fetchLicenses = async () => {
    try {
      const res = await axios.get("http://localhost:5000/licenses");
      setLicenses(res.data);
    } catch (err) {
      console.error("Fetch Error:", err);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === "admin" && password === "admin123") {
      setIsAdmin(true);
      setError("");
    } else {
      setError("❌ Invalid Admin Credentials");
    }
  };

  const generateLicense = async (e) => {
    e.preventDefault();
    setSuccessMsg("");
    setError("");

    try {
      const res = await axios.post("http://localhost:5000/add-license", formData);
      if (res.data.success) {
        setSuccessMsg(`✅ License Key: ${res.data.key} | Super Admin: ${formData.superAdminUsername}`);
        setFormData({ name: "", business: "", mobile: "", email: "", location: "", expiry: "", superAdminUsername: "", superAdminPassword: "" });
      }
    } catch (err) {
      setError("❌ Error: " + (err.response?.data?.error || err.message));
    }
  };

  const renewLicense = async (licenseId) => {
    const newExpiry = prompt("Enter new expiry date (YYYY-MM-DD):");
    if (!newExpiry) return;
    try {
      await axios.post("http://localhost:5000/renew-license", { id: licenseId, newExpiry });
      alert("✅ License renewed successfully!");
      fetchLicenses();
    } catch (err) {
      alert("❌ Failed to renew: " + (err.response?.data?.error || err.message));
    }
  };

  if (!isAdmin) {
    return (
      <div className="admin-login-overlay">
        <div className="admin-login-card">
          <h1>🔐 Admin Access</h1>
          <p>Gold Smith Licensing Authority</p>
          <form onSubmit={handleLogin}>
            <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit">Unlock Portal</button>
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
        </nav>
        <button className="logout" onClick={() => setIsAdmin(false)}>Sign Out</button>
      </aside>

      <main className="admin-content">
        {view === "create" ? (
          <section className="form-page">
            <header>
              <h1>Issue New License</h1>
              <p>Enter business details to auto-generate an activation key</p>
            </header>

            <div className="card">
              <form onSubmit={generateLicense} className="admin-form">
                <div className="form-grid">
                  <div className="input-group">
                    <label>Client Name</label>
                    <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Owner name" required />
                  </div>
                  <div className="input-group">
                    <label>Business Name</label>
                    <input type="text" value={formData.business} onChange={(e) => setFormData({...formData, business: e.target.value})} placeholder="Jewellery Shop Name" required />
                  </div>
                  <div className="input-group">
                    <label>Mobile Number</label>
                    <input type="text" value={formData.mobile} onChange={(e) => setFormData({...formData, mobile: e.target.value})} placeholder="10 Digit Number" required />
                  </div>
                  <div className="input-group">
                    <label>Email Address</label>
                    <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} placeholder="client@name.com" />
                  </div>
                  <div className="input-group">
                    <label>Location / City</label>
                    <input type="text" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} placeholder="District/State" />
                  </div>
                  <div className="input-group">
                    <label>Expiry Date</label>
                    <input type="date" value={formData.expiry} onChange={(e) => setFormData({...formData, expiry: e.target.value})} required />
                  </div>
                </div>

                {/* Super Admin Credentials Section */}
                <div style={{ marginTop: '25px', padding: '20px', background: '#f0f8ff', borderRadius: '10px', border: '1px dashed #3498db' }}>
                  <p style={{ margin: '0 0 15px', fontWeight: 700, color: '#2980b9' }}>🔐 Super Admin Credentials</p>
                  <div className="form-grid">
                    <div className="input-group">
                      <label>Username *</label>
                      <input type="text" value={formData.superAdminUsername} onChange={(e) => setFormData({...formData, superAdminUsername: e.target.value})} placeholder="e.g. owner_lakshman" required />
                    </div>
                    <div className="input-group">
                      <label>Password *</label>
                      <input type="password" value={formData.superAdminPassword} onChange={(e) => setFormData({...formData, superAdminPassword: e.target.value})} placeholder="Set a strong password" required />
                    </div>
                  </div>
                  <small style={{ color: '#888' }}>⚠️ Share these credentials with the shop owner. They use this to log in alongside the license key.</small>
                </div>

                <button type="submit" className="gen-btn" style={{ marginTop: '20px' }}>Register &amp; Generate Key</button>
              </form>
              {successMsg && <div className="key-reveal">{successMsg}</div>}
              {error && <p className="error">{error}</p>}
            </div>
          </section>
        ) : (
          <section className="list-page">
            <header>
              <h1>License Database</h1>
              <p>Management of all active and expired keys</p>
            </header>

            <div className="table-card">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>License Key</th>
                    <th>Business</th>
                    <th>Mobile</th>
                    <th>Expiry</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {licenses.map(l => {
                    const isExpired = new Date(l.expiry) < new Date();
                    return (
                      <tr key={l.id}>
                        <td><code className="key-code">{l.key}</code></td>
                        <td>{l.business} <br/> <small>{l.name}</small></td>
                        <td>{l.mobile}</td>
                        <td>{l.expiry}</td>
                        <td>
                          <span className={`status-pill ${isExpired ? 'expired' : 'active'}`}>
                            {isExpired ? 'Expired' : 'Active'}
                          </span>
                        </td>
                        <td>
                          {isExpired && (
                            <button
                              onClick={() => renewLicense(l.id)}
                              className="renew-btn"
                            >
                              🔄 Renew
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {licenses.length === 0 && <p style={{ textAlign: 'center', padding: '20px' }}>No licenses found.</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
