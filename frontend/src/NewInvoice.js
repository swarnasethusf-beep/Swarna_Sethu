import React from "react";

function NewInvoice({ invoice, setInvoice, addItemRow, updateInvoiceItem, totals, saveInvoice, staffList, onBack }) {
  return (
    <div>
      {/* Top nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div>
          <h2 style={{ margin: 0 }}>New Invoice</h2>
          <p style={{ margin: "4px 0 0", color: "#888", fontSize: "0.85rem" }}>Fill in customer and item details</p>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              padding: "10px 20px", background: "#f5f5f5", color: "#555",
              border: "1px solid #ddd", borderRadius: "8px",
              fontWeight: 600, cursor: "pointer", fontSize: "0.9rem"
            }}
          >
            ← Back to List
          </button>
        )}
      </div>

      <div className="invoice-receipt-wrapper">
      {/* 📄 RECEIPT HEADER */}
      <div className="receipt-header">
        <div className="shop-details">
          <h1>Swarna Raseid</h1>
          <p>Address: {invoice.shopAddress}</p>
          <p>Gst: {invoice.shopGSTIN}</p>
        </div>

        <div className="customer-details">
          <div className="customer-row">
            <span>Customer:</span>
            <input value={invoice.customerName} onChange={e => setInvoice({...invoice, customerName: e.target.value})} />
          </div>
          <div className="customer-row">
            <span>Contact:</span>
            <input value={invoice.customerContact} onChange={e => setInvoice({...invoice, customerContact: e.target.value})} />
          </div>
          <div className="customer-row">
            <span>Address:</span>
            <input value={invoice.customerAddress} onChange={e => setInvoice({...invoice, customerAddress: e.target.value})} />
          </div>
          {/* 👥 STAFF ASSIGNMENT DROPDOWN - Below Customer Address */}
          <div className="customer-row" style={{ borderBottom: 'none', marginTop: '10px' }}>
            <span>Assign To:</span>
            <select
              value={invoice.assignedStaffId || ""}
              onChange={(e) => setInvoice({...invoice, assignedStaffId: e.target.value})}
              className="staff-select"
              style={{ flex: 1 }}
            >
              <option value="">-- Select Goldsmith --</option>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.fullName} ({s.designation})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 📊 DYNAMIC ITEM GRID */}
      <div className="receipt-table-frame">
        <table className="receipt-table">
          <thead>
            <tr>
              <th>SL No</th>
              <th>Item code</th>
              <th style={{ width: '25%' }}>Discription</th>
              <th>OG Gross Wt</th>
              <th>weight (Net)</th>
              <th>OG imp %</th>
              <th>AG Gross Wt</th>
              <th>Total weight</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td><input value={item.itemCode} onChange={e => updateInvoiceItem(index, 'itemCode', e.target.value)} placeholder="Code" /></td>
                <td><input value={item.description} onChange={e => updateInvoiceItem(index, 'description', e.target.value)} /></td>
                <td><input type="number" value={item.ogGrossWt} onChange={e => updateInvoiceItem(index, 'ogGrossWt', e.target.value)} placeholder="0.00" /></td>
                <td><input type="number" value={item.weight} onChange={e => updateInvoiceItem(index, 'weight', e.target.value)} /></td>
                <td><input type="number" value={item.ogImp} onChange={e => updateInvoiceItem(index, 'ogImp', e.target.value)} /></td>
                <td>
                  {item.itemCode && item.itemCode.trim() !== '' ? (
                    // Item code selected → auto-calculated, read-only
                    <strong style={{ color: 'var(--primary)', display: 'block', padding: '12px', textAlign: 'center' }}>
                      {item.agGrossWt}
                    </strong>
                  ) : (
                    // No item code → manually editable
                    <input
                      type="number"
                      value={item.agGrossWt}
                      onChange={e => updateInvoiceItem(index, 'agGrossWt', e.target.value)}
                      placeholder="Enter"
                    />
                  )}
                </td>
                <td><strong>{item.totalWeight}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="add-item-row" onClick={addItemRow}>+ Add New Item to Bill</button>
      </div>

      {/* 💰 DETAILED FINANCIAL BREAKDOWN */}
      <div className="receipt-footer">
        <div className="financial-summary-grid">
           <div className="summary-section">
              <div className="price-item"><span>Rate Applied (/g):</span> <strong>₹ {(parseFloat(invoice.items[0]?.rate) || 0).toLocaleString()}</strong></div>
              <div className="price-item"><span>Old Gold Value:</span> <strong>₹ {totals.ogValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
              <div className="price-item"><span>Additional Gold Value:</span> <strong>₹ {totals.agValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
           </div>
           <div className="summary-section">
              <div className="price-item"><span>Total Making Charges:</span> <strong>₹ {totals.totalMaking.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
              <div className="price-item"><span>GST (3% on Gold + 5% Job):</span> <strong>₹ {totals.totalGST.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
           </div>
        </div>

        <div className="grand-total-banner">
          <div className="price-item">
            <span>Rate Entry:</span>
            <input 
              type="number" 
              value={invoice.items[0]?.rate || ''} 
              onChange={e => updateInvoiceItem(0, 'rate', e.target.value)} 
              placeholder="Enter Daily Rate"
            />
          </div>
          <div className="total-reveal">
            <span>Grand Total Payable:</span>
            <h1>₹ {totals.grand.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h1>
          </div>
        </div>
        
        <button onClick={saveInvoice} className="btn-primary-heavy">
          ✅ Confirm & Save Professional Invoice
        </button>
      </div>
      </div>
    </div>
  );
}

export default NewInvoice;
