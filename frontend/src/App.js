import React, { useState, useEffect } from "react";
import axios from "axios";
import logo from "./Swarna_Raseid_logo.png";

// Import Modular Components
import Login from "./Login";
import Dashboard from "./Dashboard";
import Inventory from "./Inventory";
import InvoiceList from "./InvoiceList";
import NewInvoice from "./NewInvoice";
import StaffManagement from "./StaffManagement";
import AdminManagement from "./AdminManagement";
import Settings from "./Settings";

/**
 * 💎 Swarna Raseid - Modular Professional Suite
 */
function App() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [licenseDocId, setLicenseDocId] = useState(""); // 🔑 Per-license namespace
  const [userRole, setUserRole] = useState("");          // super_admin | admin
  const [userName, setUserName] = useState("");          // Display name
  const [userId, setUserId] = useState("");              // Firestore user doc ID
  const [permissions, setPermissions] = useState({});   // Module access flags
  const [displaySettings, setDisplaySettings] = useState({ // ⚙️ Column visibility
    dashboard: false, inventory: false, staff: false, invoice: false
  });
  const [page, setPage] = useState("dashboard");
  const [invoiceView, setInvoiceView] = useState("list"); // "list" | "form"
  const [inventoryList, setInventoryList] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [newProduct, setNewProduct] = useState({ itemCode: "", description: "", weight: "", makingCharges: "" });

  const [invoice, setInvoice] = useState({
    shopName: "Swarna Raseid Jewellery",
    shopAddress: "Main Gold Market, 1st Floor",
    shopGSTIN: "22AAAAA0000A1Z5",
    customerName: "",
    customerContact: "",
    customerAddress: "",
    date: new Date().toISOString().split('T')[0],
    items: [{ slNo: 1, itemCode: "", description: "", ogGrossWt: 0, weight: 0, ogImp: 0, agGrossWt: 0, totalWeight: 0, targetWeight: 0, rate: 0, making: 0, wastage: 0 }],
    paymentMode: "Cash",
    assignedStaffId: ""
  });

  useEffect(() => {
    if (isAuthorized && userId) {  // wait until userId is set
      fetchInventory();
      fetchStaff();
      // Load display settings for super_admin
      if (userRole === "super_admin") {
        axios.get("http://localhost:5000/settings", { params: { licenseDocId } })
          .then(res => setDisplaySettings(res.data))
          .catch(err => console.error("Settings load error:", err));
      }
    }
  }, [isAuthorized, userId, userRole]); // re-fetch if user context changes

  const fetchInventory = async () => {
    try {
      const res = await axios.get("http://localhost:5000/products", {
        params: { licenseDocId, role: userRole, userId }
      });
      setInventoryList(res.data);
    } catch (err) { console.error("Inventory Fetch Error", err); }
  };

  const fetchStaff = async () => {
    try {
      const res = await axios.get("http://localhost:5000/staff", {
        params: { licenseDocId, role: userRole, userId }
      });
      setStaffList(res.data);
    } catch (err) { console.error("Staff Fetch Error", err); }
  };

  const addProductToInventory = async (e) => {
    e.preventDefault();
    try {
      await axios.post("http://localhost:5000/add-product", {
        licenseDocId, userId, userName, ...newProduct
      });
      setNewProduct({ itemCode: "", description: "", weight: "", makingCharges: "" });
      fetchInventory();
      alert("Item Added!");
    } catch (err) { alert("Failed to add"); }
  };

  const addItemRow = () => {
    setInvoice({
      ...invoice,
      items: [...invoice.items, { slNo: invoice.items.length + 1, itemCode: "", description: "", ogGrossWt: 0, weight: 0, ogImp: 0, agGrossWt: 0, totalWeight: 0, targetWeight: 0, rate: 0, making: 0, wastage: 0 }]
    });
  };

  const updateInvoiceItem = (index, field, value) => {
    const newItems = [...invoice.items];
    const item = newItems[index];
    item[field] = value;

    if (field === 'itemCode') {
        const match = inventoryList.find(p => p.itemCode.toUpperCase() === value.toUpperCase());
        if (match) {
            item.description = match.description;
            item.targetWeight = match.weight;
            item.making = match.makingCharges;
        }
    }

    const gross = parseFloat(item.ogGrossWt) || 0;
    if (field === 'ogImp' && gross > 0) {
        const imp = parseFloat(value) || 0;
        item.weight = (gross - (gross * (imp / 100))).toFixed(3);
    } 
    else if (field === 'weight' && gross > 0) {
        const wt = parseFloat(value) || 0;
        item.ogImp = (((gross - wt) / gross) * 100).toFixed(2);
    }
    else if (field === 'ogGrossWt') {
        const imp = parseFloat(item.ogImp) || 0;
        item.weight = (gross - (gross * (imp / 100))).toFixed(3);
    }


    // Only auto-calculate agGrossWt when item code is matched from inventory (targetWeight > 0)
    const target = parseFloat(item.targetWeight) || 0;
    const netBought = parseFloat(item.weight) || 0;

    if (item.itemCode && item.itemCode.trim() !== '' && target > 0) {
        // Item code matched → auto-calculate AG Gross Wt
        item.agGrossWt = (target - netBought).toFixed(3);
    } else if (field === 'agGrossWt') {
        // Manual entry of AG Gross Wt → keep the typed value as-is
        item.agGrossWt = value;
    }
    // else: agGrossWt unchanged (keep whatever was set before)

    // Total weight = net bought gold + additional gold
    item.totalWeight = (netBought + (parseFloat(item.agGrossWt) || 0)).toFixed(3);


    setInvoice({ ...invoice, items: newItems });
  };

  const calculateTotals = () => {
    let ogValue = 0;
    let agValue = 0;
    let totalMaking = 0;
    let totalGST = 0;

    invoice.items.forEach(i => {
        const rate = parseFloat(i.rate) || 0;
        const ogWt = parseFloat(i.weight) || 0;
        const agWt = parseFloat(i.agGrossWt) || 0;
        const making = parseFloat(i.making) || 0;

        ogValue += ogWt * rate;
        agValue += agWt * rate;
        totalMaking += making;
        totalGST += ((ogWt + agWt) * rate * 0.03) + (making * 0.05);
    });

    const grand = ogValue + agValue + totalMaking + totalGST;
    return { ogValue, agValue, totalMaking, totalGST, grand };
  };

  const saveInvoice = async () => {
    try {
      const dataToSave = { licenseDocId, userId, userName, ...invoice, totals: calculateTotals() };
      await axios.post("http://localhost:5000/create-invoice", dataToSave);
      alert("Invoice Generated Successfully!");
      setInvoiceView("list"); // return to list after save
    } catch (err) { alert("Save Failed"); }
  };

  if (!isAuthorized) {
    return (
      <Login onAuthSuccess={(session) => {
        setLicenseDocId(session.licenseDocId);
        setUserRole(session.role);
        setUserName(session.name);
        setUserId(session.userId);
        setPermissions(session.permissions);
        setIsAuthorized(true);
      }} />
    );
  }

  return (
    <div className="dashboard-container">
      {/* 🏰 SIDE NAVIGATIONBAR */}
      <aside className="side-nav">
        <div style={{ marginBottom: '40px' }}><img src={logo} alt="Logo" style={{ width: '50px' }} /></div>
        <div style={{ fontSize: '0.75rem', color: '#aaa', marginBottom: '20px' }}>
          {userName} <span style={{ background: userRole === 'super_admin' ? '#f39c12' : '#3498db', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '0.65rem', marginLeft: '4px' }}>
            {userRole === 'super_admin' ? 'Super Admin' : 'Admin'}
          </span>
        </div>
        <div className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => setPage('dashboard')}>📊 Dashboard</div>
        {(permissions.invoice || userRole === 'super_admin') && (
          <div className={`nav-item ${page === 'new_invoice' ? 'active' : ''}`}
          onClick={() => { setPage('new_invoice'); setInvoiceView('list'); }}>
          📜 Invoices
        </div>
        )}
        {(permissions.inventory || userRole === 'super_admin') && (
          <div className={`nav-item ${page === 'inventory' ? 'active' : ''}`} onClick={() => setPage('inventory')}>📦 Inventory</div>
        )}
        {(permissions.staff || userRole === 'super_admin') && (
          <div className={`nav-item ${page === 'staff' ? 'active' : ''}`} onClick={() => setPage('staff')}>👥 Staff Management</div>
        )}
        {userRole === 'super_admin' && (
          <div className={`nav-item ${page === 'admin_mgmt' ? 'active' : ''}`} onClick={() => setPage('admin_mgmt')}>🔑 Admin Management</div>
        )}
        {userRole === 'super_admin' && (
          <div className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>⚙️ Settings</div>
        )}
        <div className="nav-item" style={{ marginTop: 'auto' }} onClick={() => setIsAuthorized(false)}>🚪 Sign Out</div>
      </aside>

      {/* 🚀 MAIN COMPONENT ORCHESTRATOR */}
      <main className="main-view">
        {page === "dashboard" && <Dashboard inventoryCount={inventoryList.length} />}
        
        {page === "inventory" && (
            <Inventory 
                inventoryList={inventoryList} 
                newProduct={newProduct} 
                setNewProduct={setNewProduct} 
                addProductToInventory={addProductToInventory}
                userRole={userRole}
                showCreatedBy={displaySettings.inventory}
            />
        )}

        {page === "staff" && (
            <StaffManagement
              fetchStaff={fetchStaff}
              staffList={staffList}
              licenseDocId={licenseDocId}
              userId={userId}
              userName={userName}
              userRole={userRole}
              showCreatedBy={displaySettings.staff}
            />
        )}

        {page === "admin_mgmt" && userRole === "super_admin" && (
            <AdminManagement licenseDocId={licenseDocId} />
        )}

        {page === "settings" && userRole === "super_admin" && (
            <Settings
              licenseDocId={licenseDocId}
              displaySettings={displaySettings}
              onSettingsChange={(updated) => setDisplaySettings(updated)}
            />
        )}

        {page === "new_invoice" && invoiceView === "list" && (
            <InvoiceList
              licenseDocId={licenseDocId}
              userId={userId}
              userRole={userRole}
              showCreatedBy={displaySettings.invoice}
              onNewInvoice={() => setInvoiceView("form")}
            />
        )}

        {page === "new_invoice" && invoiceView === "form" && (
            <NewInvoice
                invoice={invoice}
                setInvoice={setInvoice}
                addItemRow={addItemRow}
                updateInvoiceItem={updateInvoiceItem}
                totals={calculateTotals()}
                saveInvoice={saveInvoice}
                staffList={staffList}
                onBack={() => setInvoiceView("list")}
            />
        )}
      </main>
    </div>
  );
}

export default App;