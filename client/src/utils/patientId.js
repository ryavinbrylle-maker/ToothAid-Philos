/** Six-digit numeric patient-facing ID (stored as string). */
export const PATIENT_ID_REGEX = /^\d{6}$/;

export function isValidPatientId(value) {
  return PATIENT_ID_REGEX.test(String(value ?? '').trim());
}

/** Keep only digits, max length 6 (for controlled inputs). */
export function normalizePatientIdInput(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 6);
}

/**
 * @param {Set<string> | string[]} usedSixDigitIds
 * @returns {string}
 */
export function generateUniquePatientId(usedSixDigitIds) {
  const used = usedSixDigitIds instanceof Set ? usedSixDigitIds : new Set(usedSixDigitIds);
  for (let attempt = 0; attempt < 8000; attempt += 1) {
    const n = Math.floor(Math.random() * 1_000_000);
    const id = String(n).padStart(6, '0');
    if (!used.has(id)) return id;
  }
  for (let n = 0; n < 1_000_000; n += 1) {
    const id = String(n).padStart(6, '0');
    if (!used.has(id)) return id;
  }
  throw new Error('No available Patient ID');
}
