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
        paymentMethod: "easypaisa",
      }),
    ).toBe(false);
  });

  it("requires receipt for wallet upfront", () => {
    expect(
      paymentReceiptRequired({
        payAfterWork: false,
        paymentMethod: "jazzcash",
      }),
    ).toBe(true);
  });

  it("does not require receipt for hand to hand", () => {
    expect(
      paymentReceiptRequired({
        payAfterWork: false,
        paymentMethod: "hand-to-hand",
      }),
    ).toBe(false);
  });

  it("accepts three payment methods", () => {
    expect(
      validatePaymentSelection({
        payAfterWork: false,
        paymentMethod: "hand-to-hand",
      }).ok,
    ).toBe(true);
  });
});
