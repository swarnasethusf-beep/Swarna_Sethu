import React, { useState, useEffect, useCallback } from "react";
import api, { getToken, setToken, onUnauthorized } from "./api";
import logo from "./Swarna_Sethu_logo.png";

import Login from "./Login";
import Dashboard from "./Dashboard";
import Inventory from "./Inventory";
import BarcodeLabels from "./BarcodeLabels";
import InvoiceList from "./InvoiceList";
import NewInvoice from "./NewInvoice";
import InvoiceView from "./InvoiceView";
import Rates from "./Rates";
import Customers from "./Customers";
import Reports from "./Reports";
import StaffManagement from "./StaffManagement";
import AdminManagement from "./AdminManagement";
import Settings from "./Settings";
import WorkOrders from "./WorkOrders";
import MyWork from "./MyWork";
import { useNotifications, NotificationToast, Notifications } from "./notifications";

/**
 * 💎 Swarna Sethu — Jewellery Billing
 * Session = { user, license, shop, displaySettings }. The role and permissions
 * come from the server; the UI only uses them to decide what to show.
 */
function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(null);                 // null = the role's home page (see below)
  const [invoiceFilter, setInvoiceFilter] = useState("");   // opens the invoice list on "unfinished job work" etc.
  const [focusWork, setFocusWork] = useState(null);        // work order to open when arriving from a notification
  const [invoiceView, setInvoiceView] = useState({ mode: "list", id: null, action: null, invoiceData: null, isSecret: false }); // list | new | secret_new | view

  const logout = useCallback((message) => {
    setToken(null);
    setSession(null);
    setPage(null);
    setInvoiceView({ mode: "list", id: null, invoiceData: null, isSecret: false });
    setNotice(typeof message === "string" ? message : "");
  }, []);

  const clearInvoiceAction = useCallback(() => setInvoiceView((v) => ({ ...v, action: null })), []);
  const clearFocusWork = useCallback(() => setFocusWork(null), []);
  const notifs = useNotifications(!!session);   // hooks must run before the early returns below

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
  const isGoldsmith = user.role === "goldsmith";
  const can = (perm) => isOwner || !!user.permissions?.[perm];
  const current = page || (isGoldsmith ? "mywork" : "dashboard");

  const nav = isGoldsmith ? [
    { key: "mywork", label: "🔨 My Work", show: true },
    { key: "notifications", label: "🔔 Notifications", show: true },
    { key: "settings", label: "⚙️ Settings", show: true }
  ] : [
    { key: "dashboard", label: "📊 Dashboard", show: true },
    { key: "invoices", label: "📜 Invoices", show: can("invoice") || can("reports") },
    { key: "rates", label: "🪙 Today's Rates", show: can("invoice") },
    { key: "inventory", label: "📦 Inventory", show: can("inventory") },
    { key: "barcodes", label: "🏷️ Barcode Generator", show: can("inventory") || can("barcode") },
    { key: "customers", label: "🧑‍🤝‍🧑 Customers", show: can("invoice") || can("reports") },
    { key: "reports", label: "📈 Reports", show: can("reports") },
    { key: "staff", label: "👥 Staff", show: can("staff") },
    { key: "workorders", label: "🔨 Work Orders", show: can("workorders") },
    { key: "notifications", label: "🔔 Notifications", show: true },
    { key: "admin_mgmt", label: "🔑 Admin Management", show: isOwner },
    { key: "settings", label: "⚙️ Settings", show: true }
  ].filter((n) => n.show);

  // A notification about a work order takes you straight to it
  const openFromNotification = (n) => {
    if (!n.workOrderId) return;
    setFocusWork(n.workOrderId);
    setPage(isGoldsmith ? "mywork" : "workorders");
  };

  const go = (key) => {
    setPage(key);
    if (key === "invoices") { setInvoiceFilter(""); setInvoiceView({ mode: "list", id: null, invoiceData: null, isSecret: false }); }
  };
  // action: "print" | "pdf" → the invoice page prints / saves as soon as it loads
  const openInvoice = (id, action = null) => { setPage("invoices"); setInvoiceView({ mode: "view", id, action, invoiceData: null, isSecret: false }); };
  const openJobWork = (filter = "open") => { setInvoiceFilter(filter); setPage("invoices"); setInvoiceView({ mode: "list", id: null, invoiceData: null, isSecret: false }); };
  const newInvoice = () => { setPage("invoices"); setInvoiceView({ mode: "new", id: null, invoiceData: null, isSecret: false }); };
  const secretInvoice = () => { setPage("invoices"); setInvoiceView({ mode: "secret_new", id: null, invoiceData: null, isSecret: true }); };

  return (
    <div className="dashboard-container">
      <aside className="side-nav no-print">
        <div className="nav-logo"><img src={logo} alt="Swarna Sethu" /></div>
        <div className="nav-shop">{session.shop.name || session.license.business}</div>
        <div className="nav-user">
          {user.name}
          <span className={`role-badge ${isOwner ? "owner" : ""}`}>{isOwner ? "Super Admin" : isGoldsmith ? "Goldsmith" : "Admin"}</span>
        </div>
        {nav.map((n) => (
          <div key={n.key} className={`nav-item ${current === n.key ? "active" : ""}`} onClick={() => go(n.key)}>
            {n.label}
            {n.key === "notifications" && notifs.unread > 0 && <span className="nav-badge">{notifs.unread}</span>}
          </div>
        ))}
        <div className="nav-item" style={{ marginTop: "auto" }} onClick={() => logout()}>🚪 Sign Out</div>
      </aside>

      <NotificationToast items={notifs.fresh} onClose={notifs.dismissFresh} onOpen={(n) => { notifs.markRead([n.id]); openFromNotification(n); }} />

      <main className="main-view">
        {current === "mywork" && isGoldsmith && <MyWork user={user} focusId={focusWork} onFocusDone={clearFocusWork} />}
        {current === "workorders" && can("workorders") && <WorkOrders focusId={focusWork} onFocusDone={clearFocusWork} />}
        {current === "notifications" && (
          <Notifications items={notifs.items} unread={notifs.unread} onOpen={openFromNotification} onMarkAll={notifs.markAll} onMarkRead={notifs.markRead} />
        )}
        {current === "dashboard" && !isGoldsmith && <Dashboard session={session} can={can} onNewInvoice={newInvoice} onOpenInvoice={openInvoice} onGo={go} onJobWork={openJobWork} />}

        {current === "invoices" && invoiceView.mode === "list" && (
          <InvoiceList
            key={invoiceFilter || "all"}
            initialFilter={invoiceFilter}
            canCreate={can("invoice")}
            showCreatedBy={session.displaySettings.invoice && isOwner}
            onNewInvoice={newInvoice}
            onOpen={openInvoice}
            onSecretInvoice={secretInvoice}
          />
        )}
        {current === "invoices" && (invoiceView.mode === "new" || invoiceView.mode === "secret_new" || invoiceView.mode === "settle") && (
          <NewInvoice
            settleId={invoiceView.mode === "settle" ? invoiceView.id : null}
            shop={session.shop}
            isSecret={invoiceView.mode === "secret_new" || invoiceView.isSecret}
            onSaved={(id, data) => setInvoiceView({ mode: "view", id, invoiceData: data, isSecret: !!data?.isSecret })}
            onBack={() => setInvoiceView(invoiceView.mode === "settle"
              ? { mode: "view", id: invoiceView.id, invoiceData: null, isSecret: false }
              : { mode: "list", id: null, invoiceData: null, isSecret: false })}
            onGoRates={() => setPage("rates")}
          />
        )}
        {current === "invoices" && invoiceView.mode === "view" && (
          <InvoiceView
            id={invoiceView.id}
            invoiceData={invoiceView.invoiceData}
            autoAction={invoiceView.action}
            onAutoActionDone={clearInvoiceAction}
            canBill={can("invoice")}
            onSettle={() => setInvoiceView({ mode: "settle", id: invoiceView.id, invoiceData: null, isSecret: false })}
            canCancel={isOwner && !invoiceView.invoiceData?.isSecret}
            onBack={() => setInvoiceView({ mode: "list", id: null, invoiceData: null, isSecret: false })}
            onNew={can("invoice") ? (invoiceView.isSecret ? secretInvoice : newInvoice) : null}
          />
        )}

        {current === "rates" && <Rates />}
        {current === "inventory" && <Inventory userRole={user.role} showCreatedBy={session.displaySettings.inventory && isOwner} />}
        {current === "barcodes" && <BarcodeLabels shopName={session.shop.name || session.license.business} />}
        {current === "customers" && <Customers />}
        {current === "reports" && <Reports onOpenInvoice={openInvoice} />}
        {current === "staff" && <StaffManagement userRole={user.role} showCreatedBy={session.displaySettings.staff && isOwner} />}
        {current === "admin_mgmt" && isOwner && <AdminManagement currentUserId={user.id} />}
        {current === "settings" && (
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
