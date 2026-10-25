/**
 * 🖨️ Invoice printing / PDF.
 * Both use the print layout (@media print in app-v2.css), so the paper copy and
 * the PDF contain exactly the same details.
 *  • Desktop app: "Save PDF" writes the file directly (Save dialog via Electron).
 *  • Browser: "Save PDF" opens the print dialog — choose "Save as PDF" as the printer.
 */

export const isDesktop = () => !!window.desktop?.saveInvoicePdf;

export function invoiceFileName(inv) {
  return `Invoice ${inv.invoiceNumber || ""} ${inv.customer?.name || inv.customerName || ""}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The browser uses the page title as the default PDF file name */
function printWithTitle(title) {
  const previous = document.title;
  document.title = title;
  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

export function printInvoice(inv) {
  printWithTitle(invoiceFileName(inv));
}

/** @returns {Promise<{filePath?: string, canceled?: boolean, browser?: boolean}>} */
export async function saveInvoicePdf(inv) {
  if (isDesktop()) return window.desktop.saveInvoicePdf(invoiceFileName(inv));
  printWithTitle(invoiceFileName(inv));
  return { browser: true };
}
