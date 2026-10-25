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
