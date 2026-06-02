import {
  parsePayAfterWork,
  paymentReceiptRequired,
  validatePaymentSelection,
} from "../utils/paymentMethods.js";

describe("paymentMethods", () => {
  it("parses payAfterWork flags", () => {
    expect(parsePayAfterWork(true)).toBe(true);
    expect(parsePayAfterWork("true")).toBe(true);
    expect(parsePayAfterWork("false")).toBe(false);
  });

  it("skips receipt when paying after work", () => {
    expect(
      paymentReceiptRequired({
        payAfterWork: true,
        paymentMethod: "jazzcash",
      }),
    ).toBe(false);
  });

  it("requires receipt for jazzcash upfront", () => {
    expect(
      paymentReceiptRequired({
        payAfterWork: false,
        paymentMethod: "jazzcash",
      }),
    ).toBe(true);
  });

  it("requires receipt for bank transfer upfront", () => {
    expect(
      paymentReceiptRequired({
        payAfterWork: false,
        paymentMethod: "bank-transfer",
      }),
    ).toBe(true);
  });

  it("accepts jazzcash and bank-transfer", () => {
    expect(
      validatePaymentSelection({
        payAfterWork: false,
        paymentMethod: "jazzcash",
      }).ok,
    ).toBe(true);
    expect(
      validatePaymentSelection({
        payAfterWork: false,
        paymentMethod: "bank-transfer",
      }).ok,
    ).toBe(true);
  });

  it("rejects removed payment methods", () => {
    expect(
      validatePaymentSelection({
        payAfterWork: false,
        paymentMethod: "easypaisa",
      }).ok,
    ).toBe(false);
    expect(
      validatePaymentSelection({
        payAfterWork: false,
        paymentMethod: "hand-to-hand",
      }).ok,
    ).toBe(false);
  });
});
