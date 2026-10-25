const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeInvoice, amountInWords, financialYear, formatInvoiceNumber
} = require("../lib/billing");

const rates = { "24K": 7000, "22K": 6500, "18K": 5300 };
const shop = { stateCode: "36" };

test("sale: every item uses its own purity rate (not just the first row)", () => {
  const r = computeInvoice({
    mode: "sale", rates,
    items: [
      { description: "Ring", purity: "22K", grossWt: 10, makingType: "fixed", makingValue: 0 },
      { description: "Chain", purity: "18K", grossWt: 10, makingType: "fixed", makingValue: 0 }
    ]
  }, shop);
  assert.equal(r.items[0].goldValue, 65000);
  assert.equal(r.items[1].goldValue, 53000);
  assert.equal(r.summary.goldValue, 118000);
});

test("sale: stones, wastage, making per gram, 3% GST split CGST/SGST, old gold deducted after tax", () => {
  const r = computeInvoice({
    mode: "sale", rates,
    items: [{
      description: "Necklace", purity: "22K", grossWt: 20.5, stoneWt: 0.5,
      wastagePct: 8, makingType: "per_gram", makingValue: 400, stoneCharges: 1500
    }],
    oldGold: [{ description: "Old bangle", grossWt: 10, lessWt: 0, touch: 91.6 }]
  }, shop);
  const it = r.items[0];
  assert.equal(it.netWt, 20);
  assert.equal(it.effectiveWt, 21.6);        // 20 g + 8% wastage
  assert.equal(it.goldValue, 140400);        // 21.6 × 6500
  assert.equal(it.makingAmount, 8000);       // 20 g × 400
  assert.equal(r.summary.taxable, 149900);   // 140400 + 8000 + 1500
  assert.equal(r.summary.cgst, 2248.5);      // 1.5%
  assert.equal(r.summary.sgst, 2248.5);
  assert.equal(r.summary.igst, 0);
  assert.equal(r.summary.invoiceTotal, 154397);
  assert.equal(r.oldGold[0].fineWt, 9.16);
  assert.equal(r.summary.credit, 64120);     // 9.16 × 7000 — deducted, not added
  assert.equal(r.summary.payable, 90277);
  assert.equal(r.summary.roundOff, 0);
});

test("sale: inter-state customer gets IGST", () => {
  const r = computeInvoice({
    mode: "sale", rates, customer: { stateCode: "29" },
    items: [{ description: "Ring", purity: "22K", grossWt: 1, makingType: "fixed", makingValue: 0 }]
  }, shop);
  assert.equal(r.intraState, false);
  assert.equal(r.summary.igst, 195);
  assert.equal(r.summary.cgst, 0);
});

test("sale: making as % of gold value and round-off to nearest rupee", () => {
  const r = computeInvoice({
    mode: "sale", rates,
    items: [{ description: "Stud", purity: "22K", grossWt: 1.234, makingType: "percent", makingValue: 12 }]
  }, shop);
  assert.equal(r.items[0].goldValue, 8021);      // 1.234 × 6500
  assert.equal(r.items[0].makingAmount, 962.52); // 12%
  assert.equal(r.summary.invoiceTotal, 9253.02);   // 8983.52 + 2 × 134.75
  assert.equal(r.summary.payable, 9253);
  assert.equal(r.summary.roundOff, -0.02);
});

test("job work: fine gold settlement, 3% on shop-supplied gold, 5% on labour", () => {
  const r = computeInvoice({
    mode: "job_work", rates,
    items: [{ description: "Haram", purity: "22K", grossWt: 25, makingType: "per_gram", makingValue: 300 }],
    oldGold: [{ grossWt: 20, touch: 91.6 }]
  }, shop);
  assert.equal(r.summary.itemsFineWt, 22.9);   // 25 × 0.916
  assert.equal(r.summary.oldGoldFineWt, 18.32);
  assert.equal(r.summary.addedFineWt, 4.58);
  const [gold, labour] = r.summary.taxLines;
  assert.equal(gold.hsn, "7108");
  assert.equal(gold.taxable, 32060);            // 4.58 × 7000
  assert.equal(gold.tax, 961.8);                // 3%
  assert.equal(labour.hsn, "9988");
  assert.equal(labour.taxable, 7500);           // 25 × 300
  assert.equal(labour.tax, 375);                // 5%
  assert.equal(r.summary.credit, 0);
  assert.equal(r.summary.payable, 40897);       // 40896.8 rounded
  assert.equal(r.items[0].goldValue, 0);        // customer's gold isn't billed
});

test("job work: customer surplus gold is credited, never makes the bill silently negative-weight", () => {
  const r = computeInvoice({
    mode: "job_work", rates,
    items: [{ description: "Ring", purity: "22K", grossWt: 5, makingType: "fixed", makingValue: 1000 }],
    oldGold: [{ grossWt: 10, touch: 91.6 }]
  }, shop);
  assert.equal(r.summary.addedFineWt, 0);
  assert.equal(r.summary.excessFineWt, 4.58);
  assert.equal(r.summary.credit, 32060);
  assert.equal(r.summary.payable, 1050 - 32060);
  assert.equal(r.summary.taxLines.length, 1);
});

test("compliance: PAN above ₹2 lakh, cash limit, overpayment", () => {
  const big = {
    mode: "sale", rates,
    items: [{ description: "Set", purity: "22K", grossWt: 40, makingType: "fixed", makingValue: 0 }],
    payments: [{ mode: "Cash", amount: 250000 }]
  };
  const codes = computeInvoice(big, shop).issues.map((i) => i.code);
  assert.ok(codes.includes("PAN_REQUIRED"));
  assert.ok(codes.includes("CASH_LIMIT"));

  const ok = computeInvoice({ ...big, customer: { pan: "ABCDE1234F" }, payments: [{ mode: "UPI", amount: 267800 }] }, shop);
  assert.deepEqual(ok.issues.filter((i) => i.level === "error"), []);
  assert.equal(ok.summary.balance, 0);

  const over = computeInvoice({ ...big, customer: { pan: "ABCDE1234F" }, payments: [{ mode: "UPI", amount: 300000 }] }, shop);
  assert.ok(over.issues.some((i) => i.code === "OVERPAID"));
});

test("validation: empty bill, missing rate, bad HUID", () => {
  assert.ok(computeInvoice({ mode: "sale", rates, items: [] }, shop).issues.some((i) => i.code === "NO_ITEMS"));
  const r = computeInvoice({
    mode: "sale", rates: {},
    items: [{ description: "Ring", purity: "22K", grossWt: 1, huid: "AB1" }]
  }, shop);
  const codes = r.issues.map((i) => i.code);
  assert.ok(codes.includes("ITEM_RATE"));
  assert.ok(codes.includes("ITEM_HUID"));
});

test("amountInWords uses the Indian numbering system", () => {
  assert.equal(amountInWords(0), "Rupees Zero Only");
  assert.equal(amountInWords(90277), "Rupees Ninety Thousand Two Hundred Seventy Seven Only");
  assert.equal(amountInWords(12345678.5), "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only");
});

test("financial year and invoice number format", () => {
  assert.equal(financialYear("2026-10-06"), "2026-27");
  assert.equal(financialYear("2027-03-31"), "2026-27");
  assert.equal(financialYear("2027-04-01"), "2027-28");
  assert.equal(formatInvoiceNumber("sr", "2026-27", 7), "SR/26-27/0007");
});
