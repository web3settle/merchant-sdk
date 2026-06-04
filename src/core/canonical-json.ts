/**
 * Deterministic JSON encoding shared with the backend's
 * `MerchantPaymentApi.Authentication.PaymentConfigSigner.CanonicalJson`. If you
 * change one you MUST change the other or every signature will fail.
 *
 * Algorithm — RFC 8785-lite tailored to the JSON shapes the SDK actually
 * receives over the wire:
 *   - Object keys sorted lexicographically (ordinal compare).
 *   - No insignificant whitespace.
 *   - Numbers serialized via `JSON.stringify` (the backend's `JsonSerializer`
 *     uses the same IEEE-754 → decimal lowering for round-trippable values).
 *   - Strings serialized via `JSON.stringify` (UTF-16 escapes).
 *   - Arrays preserve order (signature inputs are not commutative across
 *     arrays — chains[0] vs chains[1] is meaningful).
 *
 * The function is exported so tests can assert byte-for-byte parity with the
 * backend.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [k, v] of entries) {
      sorted[k] = sortValue(v);
    }
    return sorted;
  }
  return value;
}
