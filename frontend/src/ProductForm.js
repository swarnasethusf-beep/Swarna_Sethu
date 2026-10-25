import React from "react";
import { PURITIES, MAKING_TYPES } from "./shared/billing";

export const EMPTY_PRODUCT = {
  itemCode: "", description: "", purity: "22K", huid: "", hsn: "7113", pcs: 1,
  grossWt: "", stoneWt: "", wastagePct: "", makingType: "per_gram", makingValue: "", stoneCharges: ""
};

/** Copy only the product fields (drops id, status, timestamps…) from a stored record into form state */
export const productToForm = (p) =>
  Object.fromEntries(Object.keys(EMPTY_PRODUCT).map((k) => [k, p[k] ?? EMPTY_PRODUCT[k]]));

/**
 * The item fields shared by Inventory and the Barcode page.
 * `onCodeEnter` runs when Enter is pressed in the Item code box — a barcode scanner types the
 * code and presses Enter, so scanning an existing piece can load it instead of submitting the form.
 */
export function ProductFields({ form, setForm, codeOptional = false, onCodeEnter, codeHint }) {
  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  const net = Math.max(0, (parseFloat(form.grossWt) || 0) - (parseFloat(form.stoneWt) || 0));
  return (
    <div className="form-grid cols-4">
      <label className="field">Item code {codeOptional ? <span className="sub">(blank = auto)</span> : "*"}
        <input
          value={form.itemCode}
          placeholder={codeOptional ? "Auto, e.g. SS00001" : ""}
          required={!codeOptional}
          onChange={(e) => setForm({ ...form, itemCode: e.target.value.toUpperCase() })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onCodeEnter) { e.preventDefault(); onCodeEnter(form.itemCode); }
          }}
        />
        {codeHint && <span className="sub">{codeHint}</span>}
      </label>
      <label className="field span-2">Item name / description *<input {...f("description")} required /></label>
      <label className="field">Purity
        <select {...f("purity")}>{Object.entries(PURITIES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
      </label>
      <label className="field">Gross wt (g) *<input type="number" min="0" step="0.001" {...f("grossWt")} required /></label>
      <label className="field">Stone wt (g)<input type="number" min="0" step="0.001" {...f("stoneWt")} /></label>
      <label className="field">Net wt (g)<input value={net.toFixed(3)} readOnly className="readonly" /></label>
      <label className="field">Wastage / VA %<input type="number" min="0" step="0.01" {...f("wastagePct")} /></label>
      <label className="field">Making charge<input type="number" min="0" step="0.01" {...f("makingValue")} /></label>
      <label className="field">Making type
        <select {...f("makingType")}>{Object.entries(MAKING_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      <label className="field">Stone charges (₹)<input type="number" min="0" step="0.01" {...f("stoneCharges")} /></label>
      <label className="field">HUID (hallmark)<input {...f("huid")} maxLength={6} onChange={(e) => setForm({ ...form, huid: e.target.value.toUpperCase() })} /></label>
      <label className="field">HSN<input {...f("hsn")} maxLength={8} /></label>
      <label className="field">Pieces<input type="number" min="1" step="1" {...f("pcs")} /></label>
    </div>
  );
}
