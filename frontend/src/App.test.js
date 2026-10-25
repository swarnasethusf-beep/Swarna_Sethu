import { computeInvoice, amountInWords } from "./shared/billing";

// The UI preview must use the same maths as the server (see backend/test for full coverage)
test("shared billing engine is wired in", () => {
  const r = computeInvoice({
    mode: "sale",
    rates: { "22K": 6500 },
    items: [{ description: "Ring", purity: "22K", grossWt: 1, makingType: "fixed", makingValue: 0 }]
  }, { stateCode: "36" });
  expect(r.summary.payable).toBe(6695);
  expect(amountInWords(6695)).toBe("Rupees Six Thousand Six Hundred Ninety Five Only");
});

// Barcode labels: user text must never be able to inject markup into the printed label
test("barcode label escapes text and always carries the item code", () => {
  const { labelHtml, expandQueue } = require("./barcode");
  const html = labelHtml({ code: "SS00001", name: '<img src=x onerror=alert(1)> "Ring"', purity: "22K", netWt: 12.5, grossWt: 13, huid: "AB12CD" }, { w: 50, h: 25 });
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).toContain("SS00001");
  expect(html).toContain("<svg");
  expect(expandQueue([{ label: { code: "A" }, copies: 3 }, { label: { code: "B" }, copies: "x" }, { label: { code: "C" }, copies: 9999 }])).toHaveLength(3 + 1 + 500);
});
