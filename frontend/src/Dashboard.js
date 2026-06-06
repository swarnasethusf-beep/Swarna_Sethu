import React from "react";

function Dashboard({ inventoryCount }) {
  return (
    <div className="dash-home">
      <header style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '2.4rem' }}>Gold Command Center</h1>
        <p style={{ color: '#888' }}>{new Date().toDateString()}</p>
      </header>
      <div className="summary-grid">
        <div className="summary-card">
          <span>Showroom Stock</span>
          <h2>{inventoryCount} Items</h2>
        </div>
        <div className="summary-card">
          <span>Invoices Issued</span>
          <h2>142</h2> {/* This could be dynamic later */}
        </div>
        <div className="summary-card">
          <span>Monthly Value</span>
          <h2>₹ 4,20,000</h2>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
