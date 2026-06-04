/**
 * TRON fee estimator (item 14.1).
 *
 * TRON does not have "gas". Smart-contract calls cost two resources:
 *   - **Energy**: consumed by VM execution. Convertible from sun (1 TRX = 1e6
 *     sun) at ~280 sun per energy unit on mainnet (the rate is set by the
 *     Witnesses, not us).
 *   - **Bandwidth**: consumed by the raw tx bytes. Most callers have free
 *     daily bandwidth; if not it costs 1 sun per byte.
 *
 * `triggerconstantcontract` (a.k.a. `triggerSmartContract` with
 * `_isConstant: true` in TronWeb) returns `energy_used` without sending the tx,
 * which is the equivalent of EVM's `eth_estimateGas`. We then convert energy →
 * sun → TRX → USD using the caller-supplied price oracle.
 */
import type { TronWebLike } from './tronweb-global';
import { getTronWeb } from './tronweb-global';
import { NATIVE_TOKEN_SENTINEL, type TokenSelection } from '../core/types';
import type {
  GasEstimate,
  TronGasBreakdown,
  FeeOracleOptions,
} from '../evm/estimateGas';

/** Sun per energy unit on TRON mainnet (set by the Witnesses; ~280 since 2023). */
export const DEFAULT_SUN_PER_ENERGY = 280;
/** TRX decimals — 6 (1 TRX = 1e6 sun). */
const TRX_DECIMALS = 6;
/** Conservative default transaction byte size when we can't read it. */
const DEFAULT_TX_BANDWIDTH_BYTES = 270;
/** TronGrid endpoint that returns the current sun-per-energy schedule. */
const TRONGRID_ENERGY_PRICES_URL = 'https://api.trongrid.io/wallet/getenergyprices';
/** Cache TTL for the dynamic sun-per-energy lookup. Set tight enough that a
 *  Witness fee bump propagates to fresh estimates within minutes; loose
 *  enough to absorb the SDK's call rate without rate-limiting TronGrid. */
const SUN_PER_ENERGY_CACHE_TTL_MS = 5 * 60 * 1000;

/** TRON base58 (T + 33 chars). */
const TRON_BASE58 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function assertTronAddress(address: string, kind: string): void {
  if (!TRON_BASE58.test(address)) {
    throw new Error(`Invalid TRON ${kind} address: "${address}"`);
  }
}

interface SunPerEnergyCacheEntry {
  value: number;
  fetchedAt: number;
}
let sunPerEnergyCache: SunPerEnergyCacheEntry | null = null;
let sunPerEnergyInflight: Promise<number> | null = null;

/**
 * For tests — drop the cached sun-per-energy value so the next call goes back
 * over the wire. Production callers don't need this.
 */
export function clearSunPerEnergyCache(): void {
  sunPerEnergyCache = null;
  sunPerEnergyInflight = null;
}

/**
 * Lazy-fetch the latest sun-per-energy from TronGrid's `/wallet/getenergyprices`
 * endpoint. Cached per-process for {@link SUN_PER_ENERGY_CACHE_TTL_MS}. Falls
 * back to {@link DEFAULT_SUN_PER_ENERGY} on any failure (network, parse, empty
 * response) so a TronGrid outage cannot stall the pay-in flow.
 *
 * The endpoint returns a string of historical prices, e.g.
 *   "0:100,1542607200000:10,1606537500000:40,…,1697461200000:280"
 * We take the rightmost entry, which is the current rate.
 *
 * Test hook: pass `fetchOverride` to short-circuit the network call.
 */
export async function fetchCurrentSunPerEnergy(
  fetchOverride?: typeof fetch,
): Promise<number> {
  const now = Date.now();
  if (sunPerEnergyCache && now - sunPerEnergyCache.fetchedAt < SUN_PER_ENERGY_CACHE_TTL_MS) {
    return sunPerEnergyCache.value;
  }
  if (sunPerEnergyInflight) return sunPerEnergyInflight;

  const fetcher = fetchOverride ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetcher) {
    return DEFAULT_SUN_PER_ENERGY;
  }

  sunPerEnergyInflight = (async () => {
    try {
      const res = await fetcher(TRONGRID_ENERGY_PRICES_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return DEFAULT_SUN_PER_ENERGY;
      const body = (await res.json()) as { prices?: string };
      const raw = body.prices ?? '';
      const last = raw.split(',').pop()?.split(':').pop();
      const parsed = last ? Number.parseInt(last, 10) : NaN;
      const value = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SUN_PER_ENERGY;
      sunPerEnergyCache = { value, fetchedAt: Date.now() };
      return value;
    } catch {
      return DEFAULT_SUN_PER_ENERGY;
    } finally {
      sunPerEnergyInflight = null;
    }
  })();
  return sunPerEnergyInflight;
}

export interface EstimateTronGasInput {
  /** MerchantPayIn contract address (base58). */
  contractAddress: string;
  /** `"native"` for `payInNative`, or the TRC-20 contract address. */
  token: TokenSelection;
  /** Amount in smallest unit (sun for TRX, raw decimals for TRC-20). */
  amount: bigint;
  /** Optional sender override. Defaults to `tronWeb.defaultAddress.base58`. */
  sender?: string;
  /**
   * Optional cluster sun-per-energy rate. Falls back to {@link DEFAULT_SUN_PER_ENERGY}
   * if not set. Mainnet ≈ 280 today; testnet may differ.
   */
  sunPerEnergy?: number;
  /** Allow callers (tests) to inject a TronWeb instance. */
  tronWebOverride?: TronWebLike;
  /** Allow callers (tests) to inject a fetcher when sunPerEnergy is dynamically refreshed. */
  fetchOverride?: typeof fetch;
}

/**
 * Run a constant call against the contract to read the energy estimate, then
 * fold the standard TRON resource model.
 */
export async function estimateTronGas(
  input: EstimateTronGasInput,
  fee: FeeOracleOptions = {},
): Promise<GasEstimate> {
  assertTronAddress(input.contractAddress, 'merchant contract');
  // Premortem F6: default to a live fetch instead of the hardcoded 280 so a
  // Witness fee bump is reflected within the cache TTL. The literal default
  // remains available as the fallback when the network fetch fails.
  const sunPerEnergy = input.sunPerEnergy ?? (await fetchCurrentSunPerEnergy(input.fetchOverride));

  const tw = input.tronWebOverride ?? getTronWeb();
  if (!tw) {
    throw new Error(
      'TronLink (or compatible TRON wallet) is not available. Install the extension and reload.',
    );
  }
  const sender = input.sender ?? (typeof tw.defaultAddress.base58 === 'string' ? tw.defaultAddress.base58 : '');
  if (!sender) {
    throw new Error('TRON wallet is locked. Unlock it and try again.');
  }
  assertTronAddress(sender, 'sender');

  const isNative = input.token === NATIVE_TOKEN_SENTINEL;
  // TronWeb's transactionBuilder lives off the same root. We declare the slim
  // shape we need rather than depending on the full type — keeps the SDK
  // tolerant across TronWeb minor versions.
  const txBuilder = (tw as unknown as {
    transactionBuilder?: {
      triggerConstantContract: (
        contract: string,
        functionSelector: string,
        options: Record<string, unknown>,
        params: { type: string; value: string | number }[],
        sender: string,
      ) => Promise<{
        energy_used?: number;
        energy_penalty?: number;
        result?: { result: boolean; message?: string };
        transaction?: { raw_data_hex?: string };
      }>;
    };
  }).transactionBuilder;
  if (!txBuilder?.triggerConstantContract) {
    throw new Error('TronWeb instance does not expose transactionBuilder.triggerConstantContract');
  }

  let functionSelector: string;
  let params: { type: string; value: string | number }[];
  let callValue = 0;
  if (isNative) {
    functionSelector = 'payInNative()';
    params = [];
    callValue = Number(input.amount);
  } else {
    assertTronAddress(String(input.token), 'token');
    functionSelector = 'payInToken(address,uint256)';
    params = [
      { type: 'address', value: String(input.token) },
      { type: 'uint256', value: input.amount.toString() },
    ];
  }

  let energy = 0;
  let bandwidth = DEFAULT_TX_BANDWIDTH_BYTES;
  try {
    const result = await txBuilder.triggerConstantContract(
      input.contractAddress,
      functionSelector,
      callValue ? { callValue } : {},
      params,
      sender,
    );
    if (typeof result.energy_used === 'number') {
      energy = result.energy_used;
    }
    const rawHex = result.transaction?.raw_data_hex;
    if (typeof rawHex === 'string' && rawHex.length > 0) {
      // Hex string → byte length (2 hex chars per byte). Fall back if odd.
      bandwidth = Math.ceil(rawHex.length / 2);
    }
  } catch (err) {
    throw new Error(
      `TRON triggerConstantContract failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const energySun = energy * sunPerEnergy;
  // Bandwidth is "free" up to the daily quota, but the SDK takes the
  // conservative path: report the full sun cost. Merchants who want the free
  // path can subtract `bandwidth` from `sunCost` — we expose both pieces.
  const bandwidthSun = bandwidth; // 1 sun/byte when paid.
  const sunCost = energySun + bandwidthSun;

  const usd = await convertSunToUsd(sunCost, fee);

  const breakdown: TronGasBreakdown = {
    family: 'tron',
    energy,
    bandwidth,
    sunPerEnergy,
  };

  return {
    native: sunCost,
    usd,
    breakdown,
  };
}

async function convertSunToUsd(
  sun: number,
  fee: FeeOracleOptions,
): Promise<number | null> {
  let priceUsd = fee.priceUsd;
  if (priceUsd === undefined && fee.fetchPriceUsd) {
    try {
      priceUsd = await fee.fetchPriceUsd(fee.signal);
    } catch {
      return null;
    }
  }
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }
  const trx = sun / 10 ** TRX_DECIMALS;
  return trx * priceUsd;
}

/**
 * Convenience helper exposed for tests: same shape as `estimateTronGas`'s
 * return, computed purely from inputs without hitting any chain.
 */
export function computeTronCost(
  energy: number,
  bandwidth: number,
  sunPerEnergy = DEFAULT_SUN_PER_ENERGY,
): { sunCost: number; energySun: number; bandwidthSun: number } {
  const energySun = energy * sunPerEnergy;
  const bandwidthSun = bandwidth;
  return { energySun, bandwidthSun, sunCost: energySun + bandwidthSun };
}
