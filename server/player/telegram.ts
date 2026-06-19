/**
 * RedM has no phones; characters are reached through the telegraph.
 * Generates a telegraph contact id (call-sign style, e.g. "WA-4827") used as the
 * RedM equivalent of the old phone number.
 */
export function GenerateTelegramId() {
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = Math.floor(1000 + Math.random() * 9000);

  return `${letter()}${letter()}-${digits}`;
}
