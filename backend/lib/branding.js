const { bad, str } = require("./util");

/**
 * 🎨 Shop branding: the invoice print layout and the shop logo.
 * Print settings live on the license (`printSettings`); the logo image lives in Firebase Storage
 * (`logos/{licenseId}/…`) and only its URL is stored (`branding.logoUrl`). Storage needs the
 * Firebase Blaze plan, so logo uploads are switched off until FIREBASE_STORAGE_BUCKET is set.
 */
const PRINT_DEFAULTS = {
  showLogo: true,
  logoPosition: "left",          // left | center
  accentColor: "#111111",
  fontSize: "normal",            // compact | normal | large
  tagline: "",                   // printed under the shop name, e.g. "BIS hallmarked jewellery"
  invoiceTitle: "",              // blank = automatic ("TAX INVOICE", …)
  copyLabel: "Original for recipient",
  showRates: true,
  showItemCodes: true,           // item code + HUID under each description
  showCustomerSignature: true,
  signatoryLabel: "Authorised signatory",
  footerNote: ""                 // e.g. bank details for transfers
};

const MAX_LOGO_BYTES = 500 * 1024;
const IMAGE_TYPES = {
  "image/png": (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
};

function readPrintSettings(b = {}) {
  const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
  const flag = (k) => (typeof b[k] === "boolean" ? b[k] : PRINT_DEFAULTS[k]);
  const accentColor = str(b.accentColor, { max: 7 }) || PRINT_DEFAULTS.accentColor;
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) throw bad("Accent colour must look like #1a2b3c.");
  return {
    showLogo: flag("showLogo"),
    logoPosition: pick(b.logoPosition, ["left", "center"], PRINT_DEFAULTS.logoPosition),
    accentColor: accentColor.toLowerCase(),
    fontSize: pick(b.fontSize, ["compact", "normal", "large"], PRINT_DEFAULTS.fontSize),
    tagline: str(b.tagline, { max: 120, field: "Tagline" }),
    invoiceTitle: str(b.invoiceTitle, { max: 40, field: "Invoice title" }).toUpperCase(),
    copyLabel: str(b.copyLabel, { max: 40, field: "Copy label" }),
    showRates: flag("showRates"),
    showItemCodes: flag("showItemCodes"),
    showCustomerSignature: flag("showCustomerSignature"),
    signatoryLabel: str(b.signatoryLabel, { max: 40, field: "Signatory label" }) || PRINT_DEFAULTS.signatoryLabel,
    footerNote: str(b.footerNote, { max: 300, field: "Footer note" })
  };
}

/** `data:image/png;base64,…` → { buffer, contentType, ext }; PNG or JPEG up to 500 KB */
function readLogo(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw bad("Choose a PNG or JPG image.");
  const buffer = Buffer.from(m[2], "base64");
  if (!IMAGE_TYPES[m[1]](buffer)) throw bad("That file is not a valid PNG or JPG image.");
  if (buffer.length > MAX_LOGO_BYTES) throw bad("The logo must be 500 KB or smaller.");
  return { buffer, contentType: m[1], ext: m[1] === "image/png" ? "png" : "jpg" };
}

/** What the apps need: `{ logoUrl, print, logoUploads }` */
function brandingOut(lic, { logoUploads = false } = {}) {
  return {
    logoUrl: lic.branding?.logoUrl || "",
    print: { ...PRINT_DEFAULTS, ...(lic.printSettings || {}) },
    logoUploads
  };
}

module.exports = { PRINT_DEFAULTS, readPrintSettings, readLogo, brandingOut, MAX_LOGO_BYTES };
