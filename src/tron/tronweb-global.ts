/**
 * TronLink (and compatible wallets) inject a `tronWeb` instance onto the
 * `window` object after the user unlocks and grants site access. This module
 * offers type-safe helpers to detect + retrieve it without pulling a specific
 * TronWeb version into the SDK bundle.
 */

/** Minimal shape of the runtime TronWeb we rely on. */
export interface TronWebLike {
  defaultAddress: { base58: string | false; hex: string | false };
  ready: boolean;
  contract(): {
    at(address: string): Promise<TronContractLike>;
  };
  trx: {
    getConfirmedTransaction(txid: string): Promise<unknown>;
  };
  toSun(trx: number | string): string;
  address: {
    toHex(addr: string): string;
    fromHex(hex: string): string;
  };
}

/**
 * TronLink's contract methods return a callable whose `.send()` / `.call()`
 * signs and submits the tx. Typed permissively on purpose — we want this to
 * stay version-agnostic across TronWeb releases. The pipeline narrows the
 * shape at each call site.
 */
export type TronContractLike = Record<string, unknown>;

declare global {
  interface Window {
    tronWeb?: TronWebLike;
    tronLink?: {
      request(args: { method: string }): Promise<{ code: number; message: string }>;
      tronWeb?: TronWebLike;
    };
  }
}

/** Synchronously read `window.tronWeb`. Returns null if the extension isn't present. */
export function getTronWeb(): TronWebLike | null {
  if (typeof window === 'undefined') return null;
  return window.tronWeb ?? null;
}

/** True when a TronWeb instance exists AND the user has an unlocked account. */
export function isTronWebReady(): boolean {
  const tw = getTronWeb();
  if (!tw) return false;
  return tw.ready === true && typeof tw.defaultAddress?.base58 === 'string';
}

/**
 * Ask TronLink for account access (popup if needed). Returns the connected
 * base58 address on success.
 *
 * Note: this uses the non-standard `tron_requestAccounts` method exposed by
 * TronLink. Other Tron wallets may offer different handshakes — consumers
 * should override with their own connector if targeting those.
 */
export async function requestTronAccounts(): Promise<string> {
  if (typeof window === 'undefined' || !window.tronLink) {
    throw new Error('TronLink not detected. Install the extension and reload.');
  }
  const res = await window.tronLink.request({ method: 'tron_requestAccounts' });
  if (res.code !== 200) {
    throw new Error(`TronLink request failed: ${res.message}`);
  }
  const tw = window.tronLink.tronWeb ?? window.tronWeb;
  const addr = tw?.defaultAddress?.base58;
  if (!tw || typeof addr !== 'string') {
    throw new Error('TronLink connected but no address available');
  }
  return addr;
}
