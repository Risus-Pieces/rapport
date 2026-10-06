/** Parses a dollar amount typed by a person ("250,000", "$1.5k" is not supported) into cents. */
export function parseDollars(input: string): number | null | "invalid" {
  const text = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (text === "") return null;
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(text)) return "invalid";
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) ? cents : "invalid";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatCents(cents: number | null): string {
  return cents === null ? "" : usd.format(cents / 100);
}

/** Dollars as an editable string for a form field. */
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toString();
}
