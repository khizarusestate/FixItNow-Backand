/** Normalize CNIC to 13 digits only for storage and duplicate checks. */
export function normalizeCnic(value) {
  if (value == null || value === "") return "";
  return String(value).replace(/\D/g, "");
}

/** Format 13-digit CNIC as XXXXX-XXXXXXX-X */
export function formatCnicDisplay(digits) {
  const clean = normalizeCnic(digits);
  if (clean.length !== 13) return digits || "";
  return `${clean.slice(0, 5)}-${clean.slice(5, 12)}-${clean.slice(12)}`;
}
