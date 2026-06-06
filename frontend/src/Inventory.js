import React from "react";

function Inventory({ inventoryList, newProduct, setNewProduct, addProductToInventory, userRole, showCreatedBy }) {
  return (
    <div className="inventory-page">
      <header>
        <h1>Inventory Management</h1>
        <p>Register showroom stock items for automatic billing lookup</p>
      </header>

      <div className="card" style={{ marginBottom: '30px' }}>
        <form onSubmit={addProductToInventory} className="admin-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
          <div className="input-group">
            <label>Item Code</label>
            <input 
              value={newProduct.itemCode} 
              onChange={e => setNewProduct({...newProduct, itemCode: e.target.value.toUpperCase()})} 
              required 
            />
          </div>
          <div className="input-group">
            <label>Description</label>
            <input 
              value={newProduct.description} 
              onChange={e => setNewProduct({...newProduct, description: e.target.value})} 
              required 
            />
          </div>
          <div className="input-group">
            <label>Required Wt (g)</label>
            <input 
              type="number" 
              value={newProduct.weight} 
              onChange={e => setNewProduct({...newProduct, weight: e.target.value})} 
              required 
            />
          </div>
          <div className="input-group">
            <label>Making (₹)</label>
            <input 
              type="number" 
              value={newProduct.makingCharges} 
              onChange={e => setNewProduct({...newProduct, makingCharges: e.target.value})} 
              required 
            />
          </div>
          <button type="submit" className="btn-primary" style={{ gridColumn: 'span 4' }}>
            Save Showroom Item
          </button>
        </form>
      </div>

      <div className="table-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Required Wt</th>
              <th>Making</th>
              {showCreatedBy && userRole === "super_admin" && <th>Created By</th>}
            </tr>
          </thead>
          <tbody>
            {inventoryList.map(p => (
              <tr key={p.id}>
                <td>{p.itemCode}</td>
                <td>{p.description}</td>
                <td>{p.weight}g</td>
                <td>₹ {p.makingCharges}</td>
                {showCreatedBy && userRole === "super_admin" && (
                  <td>
                    <span style={{
                      background: p.createdByName ? "#eaf4fb" : "#f5f5f5",
                      color: p.createdByName ? "#2980b9" : "#bbb",
                      padding: "3px 10px",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
                      fontWeight: 600
                    }}>
                      👤 {p.createdByName || "—"}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Inventory;
