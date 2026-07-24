export function formatUgandanPhoneNumber(phone) {
  if (!phone) return '';
  // Remove all non-digit characters except '+'
  let cleaned = phone.toString().replace(/[^\d+]/g, '');

  // If starts with '+256'
  if (cleaned.startsWith('+256')) {
    const rest = cleaned.slice(4);
    if (rest.length === 9) {
      return `+256 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
    }
    return cleaned;
  }
  // If starts with '256'
  if (cleaned.startsWith('256')) {
    const rest = cleaned.slice(3);
    if (rest.length === 9) {
      return `+256 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
    }
  }
  // If starts with '07' or '03' or '04'
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    const rest = cleaned.slice(1);
    return `+256 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  }
  // If 9 digits starting with 7, 3, or 4
  if (cleaned.length === 9 && (cleaned.startsWith('7') || cleaned.startsWith('3') || cleaned.startsWith('4'))) {
    return `+256 ${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }

  // Fallback for any 9 digit number
  if (cleaned.length === 9) {
    return `+256 ${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }

  return phone;
}
