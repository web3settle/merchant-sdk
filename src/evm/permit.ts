/**
 * EIP-712 typed-data signing for EIP-2612 `permit` (item 14.6).
 *
 * When an ERC-20 implements `permit` (USDC, DAI, USDT-on-some-chains, most
 * tokens since 2022), the user can grant the merchant contract an allowance
 * via an off-chain signature instead of a separate `approve()` transaction.
 * That saves them ~$0.50 of gas and one wallet popup.
 *
 * This module:
 *   1. **Detects** support by reading the four EIP-2612 view functions
 *      (`name`, `version`, `nonces`, `DOMAIN_SEPARATOR`). If any throw the
 *      token is treated as non-permit.
 *   2. **Builds** the EIP-712 typed-data payload.
 *   3. **Signs** it via `walletClient.signTypedData`.
 *   4. **Splits** the signature into `(v, r, s)` so the caller can submit the
 *      `permit(...)` tx (or pass it to a meta-transaction relayer).
 *
 * The MerchantPayIn contract itself does not consume permits today — this
 * module is a building block for `payInTokenPermit(...)` once the on-chain
 * side ships, and useful right now for merchants who want to cut their own
 * approval flow before sending tokens to the contract.
 */
import {
  type Address,
  type PublicClient,
  type WalletClient,
  type Hex,
  hexToBigInt,
  hexToNumber,
  isHex,
  parseSignature,
} from 'viem';

/** Minimal EIP-2612 ABI we read for detection. */
const EIP2612_ABI = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'version',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'nonces',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'DOMAIN_SEPARATOR',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** Default DAI/USDC/USDT permit version when the token doesn't expose `version()`. */
const DEFAULT_PERMIT_VERSION = '1';

export interface PermitSupport {
  /** Whether the token responds to all four EIP-2612 view calls. */
  supported: boolean;
  /** EIP-712 domain `name`. Available when `supported` is true. */
  name?: string;
  /** EIP-712 domain `version`. Defaults to "1" when the token omits the view. */
  version?: string;
  /** Current `nonces(owner)` for the owner. */
  nonce?: bigint;
}

/**
 * Probe an ERC-20 for EIP-2612 `permit` support. Returns `{ supported: false }`
 * when any of the calls revert. Never throws — callers wire this into the
 * pay-token flow as `if (await detectPermitSupport(...).supported) ...`.
 */
export async function detectPermitSupport(
  publicClient: PublicClient,
  tokenAddress: Address,
  owner: Address,
): Promise<PermitSupport> {
  try {
    const [name, nonce] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: EIP2612_ABI,
        functionName: 'name',
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: EIP2612_ABI,
        functionName: 'nonces',
        args: [owner],
      }),
    ]);

    // `version()` is optional even within EIP-2612. USDC returns "1"; DAI uses
    // "1" too. Fall back when the call reverts.
    let version: string = DEFAULT_PERMIT_VERSION;
    try {
      const v = await publicClient.readContract({
        address: tokenAddress,
        abi: EIP2612_ABI,
        functionName: 'version',
      });
      if (typeof v === 'string' && v.length > 0) version = v;
    } catch {
      // keep default
    }

    // `DOMAIN_SEPARATOR` confirms the token is fully wired for EIP-712. We
    // don't need the value (we'll build the domain ourselves) — we only need
    // the call to succeed.
    await publicClient.readContract({
      address: tokenAddress,
      abi: EIP2612_ABI,
      functionName: 'DOMAIN_SEPARATOR',
    });

    return {
      supported: true,
      name,
      version,
      nonce,
    };
  } catch {
    return { supported: false };
  }
}

/** EIP-2612 typed-data parameters bundled for `signPermit`. */
export interface SignPermitInput {
  walletClient: WalletClient;
  /** Connected chain id — must match the wallet's active chain. */
  chainId: number;
  tokenAddress: Address;
  /** EIP-712 domain `name`. Read with `detectPermitSupport`. */
  tokenName: string;
  /** EIP-712 domain `version`. Defaults to "1" if undefined. */
  tokenVersion?: string;
  owner: Address;
  spender: Address;
  /** Amount in smallest unit. */
  value: bigint;
  /** Current nonce for the owner. Read with `detectPermitSupport`. */
  nonce: bigint;
  /** Unix-seconds deadline. Pass e.g. `now + 30*60` for a 30-min window. */
  deadline: bigint;
}

export interface PermitSignature {
  /** Recovery byte (27 or 28). */
  v: number;
  /** EIP-712 `r` component. */
  r: Hex;
  /** EIP-712 `s` component. */
  s: Hex;
  /** Concatenated 65-byte signature (0x… + r + s + v). */
  signature: Hex;
  /** Echo of the deadline used in the signature. */
  deadline: bigint;
}

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/**
 * Build the EIP-712 typed-data structure for an EIP-2612 permit. Pure
 * function, separated from the wallet sign so tests can assert the payload.
 */
export function buildPermitTypedData(input: Omit<SignPermitInput, 'walletClient'>) {
  return {
    domain: {
      name: input.tokenName,
      version: input.tokenVersion ?? DEFAULT_PERMIT_VERSION,
      chainId: input.chainId,
      verifyingContract: input.tokenAddress,
    },
    types: PERMIT_TYPES,
    primaryType: 'Permit' as const,
    message: {
      owner: input.owner,
      spender: input.spender,
      value: input.value,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  };
}

/**
 * Validates the deadline isn't already in the past. Returns the same value
 * for ergonomics so callers can chain.
 */
export function assertDeadlineFresh(deadline: bigint, nowSeconds = Math.floor(Date.now() / 1000)): bigint {
  if (deadline <= BigInt(nowSeconds)) {
    throw new Error(
      `Permit deadline ${deadline.toString()} is not in the future (now=${nowSeconds}).`,
    );
  }
  return deadline;
}

/**
 * Ask the wallet to sign the EIP-2612 permit. Splits the resulting 65-byte
 * signature into v/r/s the caller can pass to the token's `permit(...)` tx.
 */
export async function signPermit(input: SignPermitInput): Promise<PermitSignature> {
  assertDeadlineFresh(input.deadline);

  const typedData = buildPermitTypedData(input);

  const [account] = await input.walletClient.getAddresses();
  if (!account) throw new Error('No wallet account connected');
  if (account.toLowerCase() !== input.owner.toLowerCase()) {
    throw new Error(
      `Wallet account ${account} does not match permit owner ${input.owner} — refusing to sign.`,
    );
  }

  // viem's signTypedData returns a 0x-prefixed 65-byte hex string.
  const signature = await input.walletClient.signTypedData({
    account,
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  if (!isHex(signature) || signature.length !== 132) {
    throw new Error(`Wallet returned an unexpected signature length: ${String(signature)}`);
  }

  // viem ≥2.21 ships `parseSignature` which gives us yParity-compatible v.
  // We normalise to {27, 28} so the contract's standard `permit(v, r, s)` works.
  const split = parseSignature(signature);
  let v = typeof split.v === 'bigint' ? Number(split.v) : (split.yParity === 0 ? 27 : 28);
  if (v < 27) v += 27;

  return {
    v,
    r: split.r,
    s: split.s,
    signature,
    deadline: input.deadline,
  };
}

/**
 * Sanity-check a permit signature without sending it: re-parse the 65 bytes
 * and verify v/r/s shapes. Cheap to run before broadcasting and lets the SDK
 * surface "invalid signature" earlier than the contract would.
 */
export function validatePermitSignature(sig: Hex): { valid: boolean; reason?: string } {
  if (!isHex(sig)) {
    return { valid: false, reason: 'Signature is not 0x-prefixed hex' };
  }
  if (sig.length !== 132) {
    return { valid: false, reason: `Expected 132 hex chars (65 bytes), got ${sig.length}` };
  }
  const r: Hex = `0x${sig.slice(2, 66)}`;
  const s: Hex = `0x${sig.slice(66, 130)}`;
  const vHex: Hex = `0x${sig.slice(130)}`;
  if (hexToBigInt(r) === 0n) return { valid: false, reason: 'r is zero' };
  if (hexToBigInt(s) === 0n) return { valid: false, reason: 's is zero' };
  // Reject high-s per EIP-2 to avoid signature malleability.
  const SECP256K1_HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0n;
  if (hexToBigInt(s) > SECP256K1_HALF_N) {
    return { valid: false, reason: 's is in the high half of the curve order (EIP-2 malleability)' };
  }
  const v = hexToNumber(vHex);
  if (v !== 27 && v !== 28 && v !== 0 && v !== 1) {
    return { valid: false, reason: `v must be 0/1/27/28, got ${v}` };
  }
  return { valid: true };
}
