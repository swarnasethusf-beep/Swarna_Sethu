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

test("job work: surplus customer gold is RETURNED in grams — never turned into money", () => {
  const r = computeInvoice({
    mode: "job_work", rates,
    items: [{ description: "Ring", purity: "22K", grossWt: 5, makingType: "fixed", makingValue: 1000 }],
    oldGold: [{ grossWt: 10, touch: 91.6 }]
  }, shop);
  assert.equal(r.summary.addedFineWt, 0);
  assert.equal(r.summary.excessFineWt, 4.58);      // 9.16 g fine given − 4.58 g fine used → goes back to the customer
  assert.equal(r.summary.credit, 0);               // …no rupee value is ever deducted for it
  assert.equal(r.summary.oldGoldValue, 0);
  assert.equal(r.oldGold[0].value, 0);             // his gold is weighed, not priced
  assert.equal(r.summary.taxLines.length, 1);      // only the 5% job-work labour line
  assert.equal(r.summary.payable, 1050);           // ₹1,000 making + 5% GST — nothing else, never negative
});

test("job work: wastage is charged as money together with making and stones (5% job work), on top of any gold the shop adds", () => {
  // 25 g 22K piece, wastage 10% = 2.5 g × ₹6,500 = ₹16,250; making ₹300/g = ₹7,500; stones ₹2,000
  const bill = (oldGold) => computeInvoice({
    mode: "job_work", rates,
    items: [{ description: "Haram", purity: "22K", grossWt: 25, wastagePct: 10, makingType: "per_gram", makingValue: 300, stoneCharges: 2000 }],
    oldGold
  }, shop);

  // customer gave MORE gold than the piece needs (30 g → 27.48 fine ≥ 22.9 fine): nothing for gold, surplus returned
  const plenty = bill([{ grossWt: 30, touch: 91.6 }]);
  assert.equal(plenty.items[0].wastageWt, 2.5);
  assert.equal(plenty.items[0].wastageAmount, 16250);
  assert.equal(plenty.summary.wastageTotal, 16250);
  assert.equal(plenty.summary.addedFineWt, 0);
  assert.equal(plenty.summary.excessFineWt, 4.58);
  assert.equal(plenty.summary.taxLines.length, 1);
  assert.equal(plenty.summary.taxLines[0].taxable, 25750);      // 7,500 making + 2,000 stones + 16,250 wastage
  assert.equal(plenty.summary.taxLines[0].tax, 1287.5);         // 5%
  assert.equal(plenty.summary.payable, 27038);                  // 27,037.5 rounded
  assert.equal(plenty.summary.credit, 0);

  // customer gave LESS (10 g → 9.16 fine): the shop adds 22.9 − 9.16 = 13.74 g fine @ ₹7,000 (+3%); the rest is the same
  const short = bill([{ grossWt: 10, touch: 91.6 }]);
  assert.equal(short.summary.addedFineWt, 13.74);
  assert.equal(short.summary.taxLines[0].taxable, 96180);       // 13.74 × 7000 — only the NEW gold
  assert.equal(short.summary.taxLines[0].tax, 2885.4);          // 3%
  assert.equal(short.summary.taxLines[1].taxable, 25750);       // making + stones + wastage
  assert.equal(short.summary.payable, 126103);                  // 96,180 + 2,885.4 + 25,750 + 1,287.5 = 126,102.9, rounded
});

test("job work: the customer's own gold never changes the price except through how much gold the shop must add", () => {
  const price = (grams) => computeInvoice({
    mode: "job_work", rates,
    items: [{ description: "Chain", purity: "22K", grossWt: 20, makingType: "per_gram", makingValue: 250 }],
    oldGold: [{ grossWt: grams, touch: 91.6 }]
  }, shop).summary;
  // every extra gram of his 91.6 gold saves exactly 0.916 g × ₹7,000 (+3% GST) of NEW gold — it is never valued or paid for separately
  const a = price(10), b = price(11);
  assert.equal(Math.round((a.addedFineWt - b.addedFineWt) * 1000) / 1000, 0.916);
  assert.equal(Math.round((a.invoiceTotal - b.invoiceTotal) * 100) / 100, Math.round(0.916 * 7000 * 1.03 * 100) / 100);   // before the whole-rupee round-off
  // once he has given enough, more gold changes nothing at all on the bill
  assert.equal(price(30).payable, price(40).payable);
  assert.equal(price(30).excessFineWt < price(40).excessFineWt, true);
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

test("wastage can be given in GRAMS (as the goldsmith reports it) and then overrides the %", () => {
  const job = (extra) => computeInvoice({
    mode: "job_work", rates,
    items: [{ description: "Bracelet", purity: "22K", grossWt: 12.4, makingType: "per_gram", makingValue: 300, wastagePct: 10, ...extra }],
    oldGold: [{ grossWt: 9.5, touch: 91.6 }]
  }, shop);
  const byGrams = job({ wastageGrams: 0.8 });
  assert.equal(byGrams.items[0].wastageWt, 0.8);
  assert.equal(byGrams.items[0].wastageAmount, 5200);                // 0.8 g × ₹6,500 — the 10% is ignored
  assert.equal(byGrams.items[0].wastageGrams, 0.8);                  // kept, so a recalculation gives the same bill
  assert.equal(byGrams.items[0].wastagePct, 6.45);                   // shown as the equivalent %
  const byPct = job({});
  assert.equal(byPct.items[0].wastageWt, 1.24);                      // 10% of 12.4 g
  assert.equal(byPct.items[0].wastageAmount, 8060);
  assert.equal(job({ wastageGrams: "" }).items[0].wastageWt, 1.24);  // blank grams = use the %
  assert.equal(job({ wastageGrams: 0 }).items[0].wastageAmount, 0);  // the goldsmith says no loss
  // re-feeding a stored item gives the identical bill
  const again = computeInvoice({ mode: "job_work", rates, items: byGrams.items, oldGold: [{ grossWt: 9.5, touch: 91.6 }] }, shop);
  assert.equal(again.summary.payable, byGrams.summary.payable);
});

test("sale: wastage in grams adds that gold to the bill; a zero row rate means 'use the purity rate'", () => {
  const sale = (extra) => computeInvoice({ mode: "sale", rates, items: [{ description: "Chain", purity: "22K", grossWt: 10, makingType: "fixed", makingValue: 0, ...extra }] }, shop);
  assert.equal(sale({ wastageGrams: 0.5 }).items[0].goldValue, 68250);    // (10 + 0.5) × 6,500
  assert.equal(sale({ rate: 0 }).items[0].rate, 6500);
});
