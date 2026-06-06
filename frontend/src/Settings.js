import React, { useState } from "react";
import axios from "axios";

/**
 * ⚙️ Settings — Display Settings (Super Admin only)
 * Toggles update App.js state immediately (no reset on navigation).
 * Changes are committed to Firestore only when "Save Settings" is clicked.
 */
function Settings({ licenseDocId, displaySettings, onSettingsChange }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Toggle updates parent (App.js) state immediately — no local state needed
  const handleToggle = (key) => {
    const updated = { ...displaySettings, [key]: !displaySettings[key] };
    onSettingsChange(updated); // App.js is the single source of truth
    setSaved(false);           // mark as unsaved
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await axios.post("http://localhost:5000/settings", {
        licenseDocId,
        displaySettings
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const MODULES = [
    {
      key: "dashboard",
      icon: "📊",
      label: "Dashboard",
      desc: "Show 'Created By' info on the dashboard overview"
    },
    {
      key: "inventory",
      icon: "📦",
      label: "Inventory",
      desc: "Show 'Created By' column in the product inventory table"
    },
    {
      key: "staff",
      icon: "👥",
      label: "Staff Management",
      desc: "Show 'Created By' column in the staff list"
    },
    {
      key: "invoice",
      icon: "📜",
      label: "Invoice",
      desc: "Show 'Created By' info on each invoice record"
    }
  ];

  return (
    <div className="staff-mgmt-page">
      <header>
        <h1>Settings</h1>
        <p>Control display preferences for your workspace</p>
      </header>

      <div style={{ maxWidth: "720px", marginTop: "24px" }}>

        {/* Section header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: "20px"
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>👁️ Display Settings</h3>
            <p style={{ margin: "4px 0 0", color: "#888", fontSize: "0.85rem" }}>
              Toggle the "Created By" column visibility per module, then click Save
            </p>
          </div>
        </div>

        {/* Toggle cards */}
        {MODULES.map(({ key, icon, label, desc }) => (
          <div
            key={key}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "18px 22px", marginBottom: "12px",
              borderRadius: "12px", border: "1px solid #eee",
              background: displaySettings[key] ? "#f0fdf4" : "#fff",
              transition: "background 0.3s",
              cursor: "pointer"
            }}
            onClick={() => handleToggle(key)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <span style={{ fontSize: "1.6rem" }}>{icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{label}</div>
                <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "2px" }}>{desc}</div>
              </div>
            </div>

            {/* Toggle Switch */}
            <div
              style={{
                width: "52px", height: "28px", borderRadius: "14px",
                background: displaySettings[key] ? "#27ae60" : "#ddd",
                position: "relative",
                transition: "background 0.3s", flexShrink: 0
              }}
            >
              <div style={{
                position: "absolute",
                top: "3px",
                left: displaySettings[key] ? "26px" : "3px",
                width: "22px", height: "22px",
                borderRadius: "50%", background: "white",
                boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                transition: "left 0.25s"
              }} />
            </div>
          </div>
        ))}

        {/* Save Button */}
        <div style={{ marginTop: "24px", display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "13px 36px",
              background: saving ? "#aaa" : "linear-gradient(135deg, #b8860b, #ffd700)",
              color: "white", border: "none", borderRadius: "10px",
              fontWeight: 700, fontSize: "1rem", cursor: saving ? "not-allowed" : "pointer",
              boxShadow: "0 4px 15px rgba(184,134,11,0.3)",
              transition: "all 0.2s"
            }}
          >
            {saving ? "⏳ Saving..." : "💾 Save Settings"}
          </button>

          {saved && (
            <span style={{
              fontSize: "0.9rem", color: "#27ae60", fontWeight: 700,
              background: "#eafaf1", padding: "8px 16px", borderRadius: "20px",
              border: "1px solid #a9dfbf"
            }}>
              ✅ Settings saved successfully!
            </span>
          )}
        </div>

        <p style={{ fontSize: "0.8rem", color: "#aaa", marginTop: "16px" }}>
          ⚠️ Toggle settings are applied immediately. Click "Save Settings" to persist across sessions.
        </p>
      </div>
    </div>
  );
}

export default Settings;
