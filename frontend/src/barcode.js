import JsBarcode from "jsbarcode";

/**
 * 🏷️ Barcode labels.
 *
 * The barcode encodes ONLY the item code (Code 128). That keeps it short and reliable to
 * scan; everything else (weights, purity, making…) is looked up from the database when the
 * code is scanned in Billing or Inventory, so the data is always current. The printed text
 * (name, purity, weights, HUID) is just for people to read.
 *
 * USB barcode scanners behave like a keyboard: they "type" the code and press Enter.
 */

export const LABEL_SIZES = [
  { id: "50x25", label: "50 × 25 mm — standard sticker", w: 50, h: 25 },
  { id: "38x25", label: "38 × 25 mm — small sticker", w: 38, h: 25 },
  { id: "75x25", label: "75 × 25 mm — wide sticker", w: 75, h: 25 },
  { id: "100x15", label: "100 × 15 mm — jewellery tag (wraps around)", w: 100, h: 15 },
  { id: "100x50", label: "100 × 50 mm — large label", w: 100, h: 50 },
  { id: "custom", label: "Custom size…", w: 50, h: 25 }
];

export const normalizeScan = (v) => String(v || "").trim().toUpperCase();

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** weight in grams, up to 3 decimals without trailing zeros: 12.5, 4.35, 20 */
const g3 = (n) => String(Number((Number(n) || 0).toFixed(3)));

/** Code 128 as an SVG string that stretches to its container (viewBox, no fixed size) */
export function barcodeSvg(code) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, String(code), { format: "CODE128", displayValue: false, margin: 0, width: 2, height: 60 });
  const w = svg.getAttribute("width") ? parseFloat(svg.getAttribute("width")) : 0;
  const h = svg.getAttribute("height") ? parseFloat(svg.getAttribute("height")) : 60;
  if (!svg.getAttribute("viewBox") && w) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("style", "width:100%;height:100%;display:block");
  return svg.outerHTML;
}

/** Label fields we print, taken from a product record */
export function labelFromProduct(p, shopName = "") {
  return {
    code: p.itemCode,
    name: p.description || "",
    purity: p.purity || "",
    grossWt: p.grossWt,
    netWt: p.netWt,
    huid: p.huid || "",
    shop: shopName
  };
}

/**
 * One label as HTML. Text size follows the label height so the same markup works from
 * 15 mm tags up to 50 mm labels. All user text is escaped.
 */
export function labelHtml(l, size) {
  const { w, h } = size;
  const roomy = h >= 30;                              // large labels also show shop name, gross weight and HUID on its own line
  const fs = Math.max(1.9, Math.min(3.3, h / 9));     // mm — text scales with the label height
  const barH = h >= 20 ? (roomy ? h * 0.36 : h * 0.34) : h * 0.62;
  const net = l.netWt != null ? `Net ${g3(l.netWt)}g` : "";
  const lines = roomy
    ? [[l.purity, net, l.grossWt != null ? `Gr ${g3(l.grossWt)}g` : ""], l.huid ? [`HUID ${l.huid}`] : []]
    : [[l.purity, net, l.huid ? `HUID ${l.huid}` : ""]];
  const text = `
    <div class="t">
      ${roomy && l.shop ? `<div class="shop">${esc(l.shop)}</div>` : ""}
      <div class="nm">${esc(l.name)}</div>
      ${lines.map((parts) => parts.filter(Boolean).join("  ")).filter(Boolean).map((t) => `<div class="dt">${esc(t)}</div>`).join("")}
    </div>`;
  const bar = `<div class="b" style="height:${barH}mm">${barcodeSvg(l.code)}</div><div class="cd">${esc(l.code)}</div>`;
  // Short, wide tags (jewellery tags) put text beside the barcode instead of above it
  const side = h < 20 && w >= 60;
  return `<div class="label ${side ? "side" : ""}" style="width:${w}mm;height:${h}mm;font-size:${fs}mm">${
    side ? `<div class="col">${text}</div><div class="col">${bar}</div>` : `${text}${bar}`
  }</div>`;
}

const LABEL_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  .label{overflow:hidden;padding:1mm 1.5mm;display:flex;flex-direction:column;justify-content:space-between;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;line-height:1.15;page-break-after:always;break-after:page}
  .label.side{flex-direction:row;gap:2mm;align-items:center}
  .label.side .col{flex:1;min-width:0}
  .shop{font-weight:700;font-size:.85em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.92em}
  .b{width:100%}
  .cd{text-align:center;font-family:"Courier New",monospace;font-weight:700;letter-spacing:.08em;font-size:.95em}
`;

/** Expand [{label, copies}] into one entry per printed label */
export function expandQueue(queue) {
  return queue.flatMap((q) => Array.from({ length: Math.max(1, Math.min(500, Number(q.copies) || 1)) }, () => q.label));
}

/** A complete HTML document: one label per page, page size = label size */
export function labelsDocument(labels, size) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title>
<style>@page{size:${size.w}mm ${size.h}mm;margin:0}html,body{width:${size.w}mm;background:#fff}${LABEL_CSS}</style></head>
<body>${labels.map((l) => labelHtml(l, size)).join("")}</body></html>`;
}

/** On-screen preview (same markup; the CSS is added once by the page) */
export const previewCss = LABEL_CSS;

/** Print via the desktop app (chosen printer, no dialog) or the browser's print dialog */
export async function printLabels(labels, size, { deviceName } = {}) {
  const html = labelsDocument(labels, size);
  if (window.desktop?.printLabels) {
    return window.desktop.printLabels({ html, widthMm: size.w, heightMm: size.h, deviceName: deviceName || "" });
  }
  // Browser: print from a hidden frame so the app's own styles never leak into the label
  await new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.srcdoc = html;
    frame.onload = () => {
      const win = frame.contentWindow;
      win.addEventListener("afterprint", () => { setTimeout(() => frame.remove(), 200); resolve(); });
      setTimeout(() => { win.focus(); win.print(); }, 150);
      setTimeout(resolve, 60000); // never hang if the dialog is dismissed without afterprint
    };
    document.body.appendChild(frame);
  });
  return { browser: true };
}

export async function saveLabelsPdf(labels, size) {
  const html = labelsDocument(labels, size);
  if (window.desktop?.saveLabelsPdf) return window.desktop.saveLabelsPdf({ html, widthMm: size.w, heightMm: size.h });
  return printLabels(labels, size); // browser: choose "Save as PDF" in the print dialog
}

export const listPrinters = async () => (window.desktop?.listPrinters ? window.desktop.listPrinters() : []);
export const hasDesktopPrinting = () => !!window.desktop?.printLabels;
