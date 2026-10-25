import React, { useState, useEffect, useCallback } from "react";
import api, { getToken, setToken, onUnauthorized } from "./api";
import logo from "./Swarna_Sethu_logo.png";

import Login from "./Login";
import Dashboard from "./Dashboard";
import Inventory from "./Inventory";
import InvoiceList from "./InvoiceList";
import NewInvoice from "./NewInvoice";
import InvoiceView from "./InvoiceView";
import Rates from "./Rates";
import Customers from "./Customers";
import Reports from "./Reports";
import StaffManagement from "./StaffManagement";
import AdminManagement from "./AdminManagement";
import Settings from "./Settings";

/**
 * 💎 Swarna Sethu — Jewellery Billing
 * Session = { user, license, shop, displaySettings }. The role and permissions
 * come from the server; the UI only uses them to decide what to show.
 */
function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState("dashboard");
  const [invoiceView, setInvoiceView] = useState({ mode: "list", id: null, action: null }); // list | new | view

  const logout = useCallback((message) => {
    setToken(null);
    setSession(null);
    setPage("dashboard");
    setInvoiceView({ mode: "list", id: null });
    setNotice(typeof message === "string" ? message : "");
  }, []);

  const clearInvoiceAction = useCallback(() => setInvoiceView((v) => ({ ...v, action: null })), []);

  useEffect(() => {
    onUnauthorized((message) => logout(message || "Your session has ended. Please log in again."));
    if (!getToken()) return;
    api.get("/auth/me")
      .then((res) => setSession(res.data))
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, [logout]);

  if (booting) return <div className="boot-screen">Loading…</div>;

  if (!session) {
    return (
      <Login
        notice={notice}
        onAuthSuccess={(data) => {
          setToken(data.token);
          setNotice("");
          setSession({ user: data.user, license: data.license, shop: data.shop, displaySettings: data.displaySettings });
        }}
      />
    );
  }

  const { user } = session;
  const isOwner = user.role === "super_admin";
  const can = (perm) => isOwner || !!user.permissions?.[perm];

  const nav = [
    { key: "dashboard", label: "📊 Dashboard", show: true },
    { key: "invoices", label: "📜 Invoices", show: can("invoice") || can("reports") },
    { key: "rates", label: "🪙 Today's Rates", show: can("invoice") },
    { key: "inventory", label: "📦 Inventory", show: can("inventory") },
    { key: "customers", label: "🧑‍🤝‍🧑 Customers", show: can("invoice") || can("reports") },
    { key: "reports", label: "📈 Reports", show: can("reports") },
    { key: "staff", label: "👥 Staff", show: can("staff") },
    { key: "admin_mgmt", label: "🔑 Admin Management", show: isOwner },
    { key: "settings", label: "⚙️ Settings", show: true }
  ].filter((n) => n.show);

  const go = (key) => {
    setPage(key);
    if (key === "invoices") setInvoiceView({ mode: "list", id: null });
  };
  // action: "print" | "pdf" → the invoice page prints / saves as soon as it loads
  const openInvoice = (id, action = null) => { setPage("invoices"); setInvoiceView({ mode: "view", id, action }); };
  const newInvoice = () => { setPage("invoices"); setInvoiceView({ mode: "new", id: null }); };

  return (
    <div className="dashboard-container">
      <aside className="side-nav no-print">
        <div className="nav-logo"><img src={logo} alt="Swarna Sethu" /></div>
        <div className="nav-shop">{session.shop.name || session.license.business}</div>
        <div className="nav-user">
          {user.name}
          <span className={`role-badge ${isOwner ? "owner" : ""}`}>{isOwner ? "Super Admin" : "Admin"}</span>
        </div>
        {nav.map((n) => (
          <div key={n.key} className={`nav-item ${page === n.key ? "active" : ""}`} onClick={() => go(n.key)}>
            {n.label}
          </div>
        ))}
        <div className="nav-item" style={{ marginTop: "auto" }} onClick={() => logout()}>🚪 Sign Out</div>
      </aside>

      <main className="main-view">
        {page === "dashboard" && <Dashboard session={session} can={can} onNewInvoice={newInvoice} onOpenInvoice={openInvoice} onGo={go} />}

        {page === "invoices" && invoiceView.mode === "list" && (
          <InvoiceList
            canCreate={can("invoice")}
            showCreatedBy={session.displaySettings.invoice && isOwner}
            onNewInvoice={newInvoice}
            onOpen={openInvoice}
          />
        )}
        {page === "invoices" && invoiceView.mode === "new" && (
          <NewInvoice
            shop={session.shop}
            onSaved={(id) => setInvoiceView({ mode: "view", id })}
            onBack={() => setInvoiceView({ mode: "list", id: null })}
            onGoRates={() => setPage("rates")}
          />
        )}
        {page === "invoices" && invoiceView.mode === "view" && (
          <InvoiceView
            id={invoiceView.id}
            autoAction={invoiceView.action}
            onAutoActionDone={clearInvoiceAction}
            canCancel={isOwner}
            onBack={() => setInvoiceView({ mode: "list", id: null })}
            onNew={can("invoice") ? newInvoice : null}
          />
        )}

        {page === "rates" && <Rates />}
        {page === "inventory" && <Inventory userRole={user.role} showCreatedBy={session.displaySettings.inventory && isOwner} />}
        {page === "customers" && <Customers />}
        {page === "reports" && <Reports onOpenInvoice={openInvoice} />}
        {page === "staff" && <StaffManagement userRole={user.role} showCreatedBy={session.displaySettings.staff && isOwner} />}
        {page === "admin_mgmt" && isOwner && <AdminManagement currentUserId={user.id} />}
        {page === "settings" && (
          <Settings
            isOwner={isOwner}
            session={session}
            onSessionChange={(patch) => setSession((s) => ({ ...s, ...patch }))}
          />
        )}
      </main>
    </div>
  );
}

export default App;
