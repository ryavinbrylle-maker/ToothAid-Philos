/** `sms:` URI for native SMS app; strips spaces only, keeps + and digits. */
export function buildSmsHref(phone, body) {
  if (phone == null || String(phone).trim() === '') return '#';
  const raw = String(phone).trim().replace(/\s/g, '');
  if (!raw) return '#';
  if (body && String(body).trim() !== '') {
    return `sms:${raw}?body=${encodeURIComponent(String(body).trim())}`;
  }
  return `sms:${raw}`;
}
