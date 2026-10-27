import React, { useState } from "react";
import api, { errMsg } from "./api";
import defaultLogo from "./Swarna_Sethu_logo.png";

export const PRINT_DEFAULTS = {
  showLogo: true, logoPosition: "left", accentColor: "#111111", fontSize: "normal",
  tagline: "", invoiceTitle: "", copyLabel: "Original for recipient",
  showRates: true, showItemCodes: true, showCustomerSignature: true,
  signatoryLabel: "Authorised signatory", footerNote: ""
};
const MAX_LOGO_BYTES = 500 * 1024;

const TOGGLES = [
  { key: "showLogo", label: "Print my logo on invoices" },
  { key: "showRates", label: "Show the “Rates applied” line" },
  { key: "showItemCodes", label: "Show item code and HUID under each item" },
  { key: "showCustomerSignature", label: "Show a customer signature box" }
];

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

/**
 * 🎨 Invoice print layout + shop logo (Super Admin). The logo replaces the Swarna Sethu logo in the
 * side menu and can be printed on invoices. Logo upload needs Firebase Storage (Blaze plan) on the
 * server — until then `branding.logoUploads` is false and the upload button is switched off.
 */
function BrandingSettings({ session, onSessionChange }) {
  const branding = session.branding || { logoUrl: "", print: PRINT_DEFAULTS, logoUploads: false };
  const [print, setPrint] = useState({ ...PRINT_DEFAULTS, ...branding.print });
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  const p = (k) => ({ value: print[k] ?? "", onChange: (e) => setPrint({ ...print, [k]: e.target.value }) });
  const apply = (next) => onSessionChange({ branding: next });

  const run = async (fn, okText) => {
    setBusy(true); setMsg({ text: "", type: "" });
    try {
      apply(await fn());
      setMsg({ text: okText, type: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => (await api.put("/settings/print", print)).data, "✅ Print settings saved.");
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) { setMsg({ text: "Choose a PNG or JPG image.", type: "error" }); return; }
    if (file.size > MAX_LOGO_BYTES) { setMsg({ text: "The logo must be 500 KB or smaller.", type: "error" }); return; }
    const dataUrl = await readFile(file);
    run(async () => (await api.post("/settings/logo", { dataUrl })).data, "✅ Logo updated.");
  };

  const removeLogo = () => {
    if (!window.confirm("Remove your logo and go back to the Swarna Sethu logo?")) return;
    run(async () => (await api.delete("/settings/logo")).data, "Logo removed.");
  };

  const shop = session.shop;
  const logo = branding.logoUrl;

  return (
    <form className="card section" onSubmit={save}>
      <h3>🎨 Logo &amp; invoice print layout</h3>

      <div className="branding-logo">
        <div className="branding-logo-box"><img src={logo || defaultLogo} alt="Logo" /></div>
        <div>
          <strong>{logo ? "Your shop logo" : "Default logo (Swarna Sethu)"}</strong>
          <div className="sub">Shown in the side menu and, if switched on, on printed invoices. PNG or JPG, up to 500 KB — a transparent PNG looks best.</div>
          <div className="btn-group" style={{ marginTop: 8 }}>
            <label className={`btn btn-secondary btn-sm ${branding.logoUploads && !busy ? "" : "disabled"}`} style={{ cursor: branding.logoUploads ? "pointer" : "not-allowed" }}>
              📤 {logo ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/png,image/jpeg" hidden disabled={!branding.logoUploads || busy} onChange={upload} />
            </label>
            {logo && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={removeLogo}>Remove logo</button>}
          </div>
          {!branding.logoUploads && (
            <div className="alert warn" style={{ marginTop: 8 }}>
              Logo upload isn't switched on for your account yet (it needs image storage on the server). Your provider can enable it.
            </div>
          )}
        </div>
      </div>

      <div className="form-grid cols-3" style={{ marginTop: 16 }}>
        <label className="field">Accent colour
          <input type="color" {...p("accentColor")} style={{ height: 38, padding: 2 }} />
        </label>
        <label className="field">Logo position
          <select {...p("logoPosition")}>
            <option value="left">Left, beside the shop name</option>
            <option value="center">Centred above the header</option>
          </select>
        </label>
        <label className="field">Text size
          <select {...p("fontSize")}>
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label className="field span-2">Tagline under the shop name<input {...p("tagline")} maxLength={120} placeholder="e.g. BIS hallmarked gold & diamond jewellery" /></label>
        <label className="field">Title on sale invoices<input {...p("invoiceTitle")} maxLength={40} placeholder="TAX INVOICE (automatic)" /></label>
        <label className="field">Copy label<input {...p("copyLabel")} maxLength={40} placeholder="Original for recipient" /></label>
        <label className="field">Signatory label<input {...p("signatoryLabel")} maxLength={40} /></label>
        <label className="field span-3">Footer note (e.g. bank details)<textarea rows={2} {...p("footerNote")} maxLength={300} /></label>
      </div>

      {TOGGLES.map(({ key, label }) => (
        <div key={key} className={`toggle-card ${print[key] ? "on" : ""}`} onClick={() => setPrint({ ...print, [key]: !print[key] })}>
          <div style={{ flex: 1 }}><strong>{label}</strong></div>
          <div className={`switch ${print[key] ? "on" : ""}`}><div /></div>
        </div>
      ))}

      <h4 style={{ margin: "18px 0 8px" }}>Preview</h4>
      <div className={`print-invoice pi-size-${print.fontSize}`} style={{ "--pi-accent": print.accentColor, padding: "16px 20px" }}>
        <InvoiceHeader shop={shop} print={print} logoUrl={logo} title={print.invoiceTitle || "TAX INVOICE"} meta={null} />
      </div>

      <div className="btn-group" style={{ marginTop: 16 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>💾 Save print settings</button>
        <button type="button" className="btn btn-secondary" onClick={() => setPrint(PRINT_DEFAULTS)}>Reset to defaults</button>
      </div>
      {msg.text && <div className={`alert ${msg.type}`}>{msg.text}</div>}
    </form>
  );
}

/** The invoice header (shop details, logo, title) — shared by the printed invoice and the preview above */
export function InvoiceHeader({ shop, print, logoUrl, title, meta, stateName = () => "" }) {
  const showLogo = print.showLogo && logoUrl;
  const details = (
    <div>
      <h2>{shop.name || "—"}</h2>
      {print.tagline && <div className="pi-tagline">{print.tagline}</div>}
      {shop.address && <div>{shop.address}</div>}
      {(shop.phone || shop.email) && <div>{[shop.phone && `Ph: ${shop.phone}`, shop.email].filter(Boolean).join(" · ")}</div>}
      {shop.gstin && <div><strong>GSTIN:</strong> {shop.gstin}</div>}
      {shop.stateCode && <div>State: {stateName(shop.stateCode) || shop.stateCode} ({shop.stateCode})</div>}
    </div>
  );
  return (
    <>
      {showLogo && print.logoPosition === "center" && <div className="pi-logo-center"><img src={logoUrl} alt="" /></div>}
      <div className="pi-head">
        <div className="pi-shop">
          {showLogo && print.logoPosition !== "center" && <img className="pi-logo" src={logoUrl} alt="" />}
          {details}
        </div>
        <div className="pi-title">
          <div className="pi-doc">{title}</div>
          {print.copyLabel && <div className="pi-copy">{print.copyLabel}</div>}
          {meta}
        </div>
      </div>
    </>
  );
}

export default BrandingSettings;
