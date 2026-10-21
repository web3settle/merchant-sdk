import {
  type WalletClient,
  type PublicClient,
  type Hash,
  type TransactionReceipt,
  parseUnits,
  encodeFunctionData,
} from 'viem';
import { PAYMENT_CONTRACT_ABI, ERC20_ABI } from './config';
import { assertPaymentReference, type PaymentReference } from './payment-reference';

/**
 * Minimal ABI for an EIP-2612 token's `permit(...)` setter. The SDK uses this
 * to submit the permit signature on-chain when `payInToken` flows opt into the
 * gasless approval path (item 14.6).
 */
export const ERC20_PERMIT_ABI = [
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    name: 'permit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const DEFAULT_RECEIPT_TIMEOUT_MS = 120_000;

async function requireAccount(walletClient: WalletClient): Promise<`0x${string}`> {
  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error('No wallet account connected');
  }
  return account;
}

/**
 * Plain `payInNative()` — **unattributed**: the gateway detects and settles the deposit but links
 * it to no payment request. Checkout flows use {@link executePayInNativeWithReference}.
 */
export async function executePayInNative(
  walletClient: WalletClient,
  contractAddress: `0x${string}`,
  amount: bigint,
): Promise<Hash> {
  const account = await requireAccount(walletClient);
  const data = encodeFunctionData({
    abi: PAYMENT_CONTRACT_ABI,
    functionName: 'payInNative',
  });
  return walletClient.sendTransaction({
    account,
    to: contractAddress,
    data,
    value: amount,
    chain: walletClient.chain,
  });
}

/**
 * Plain `payInToken(token, amount)` — **unattributed** (see {@link executePayInNative}). Checkout
 * flows use {@link executePayInTokenWithReference}.
 */
export async function executePayInToken(
  walletClient: WalletClient,
  contractAddress: `0x${string}`,
  tokenAddress: `0x${string}`,
  amount: bigint,
): Promise<Hash> {
  const account = await requireAccount(walletClient);
  const data = encodeFunctionData({
    abi: PAYMENT_CONTRACT_ABI,
    functionName: 'payInToken',
    args: [tokenAddress, amount],
  });
  return walletClient.sendTransaction({
    account,
    to: contractAddress,
    data,
    chain: walletClient.chain,
  });
}

/**
 * Calldata + value for one pay-in. With a `paymentReference` it encodes MerchantPayIn V3.2.3's
 * `payInNativeWithReference(bytes32)` / `payInTokenWithReference(address,uint256,bytes32)`;
 * without one, the plain `payInNative()` / `payInToken(address,uint256)`. Pure — the executors
 * below and the tests share it, so what is tested is what is sent.
 */
export function buildPayInCall(input: {
  /** ERC-20 address, or `'native'` for the chain's gas token. */
  token: `0x${string}` | 'native';
  amount: bigint;
  paymentReference?: PaymentReference;
}): { data: `0x${string}`; value: bigint } {
  const { token, amount, paymentReference } = input;
  if (paymentReference !== undefined) assertPaymentReference(paymentReference);
  if (token === 'native') {
    return {
      data:
        paymentReference === undefined
          ? encodeFunctionData({ abi: PAYMENT_CONTRACT_ABI, functionName: 'payInNative' })
          : encodeFunctionData({
              abi: PAYMENT_CONTRACT_ABI,
              functionName: 'payInNativeWithReference',
              args: [paymentReference],
            }),
      value: amount,
    };
  }
  return {
    data:
      paymentReference === undefined
        ? encodeFunctionData({ abi: PAYMENT_CONTRACT_ABI, functionName: 'payInToken', args: [token, amount] })
        : encodeFunctionData({
            abi: PAYMENT_CONTRACT_ABI,
            functionName: 'payInTokenWithReference',
            args: [token, amount, paymentReference],
          }),
    value: 0n,
  };
}

/**
 * `payInNativeWithReference(paymentReference)` — the attributed native pay-in (V3.2.3). The
 * gateway links the deposit to the payment request `paymentReference` came from.
 */
export async function executePayInNativeWithReference(
  walletClient: WalletClient,
  contractAddress: `0x${string}`,
  amount: bigint,
  paymentReference: PaymentReference,
): Promise<Hash> {
  const account = await requireAccount(walletClient);
  const { data, value } = buildPayInCall({ token: 'native', amount, paymentReference });
  return walletClient.sendTransaction({
    account,
    to: contractAddress,
    data,
    value,
    chain: walletClient.chain,
  });
}

/**
 * `payInTokenWithReference(token, amount, paymentReference)` — the attributed ERC-20 pay-in
 * (V3.2.3). Needs the same allowance as `payInToken`.
 */
export async function executePayInTokenWithReference(
  walletClient: WalletClient,
  contractAddress: `0x${string}`,
  tokenAddress: `0x${string}`,
  amount: bigint,
  paymentReference: PaymentReference,
): Promise<Hash> {
  const account = await requireAccount(walletClient);
  const { data } = buildPayInCall({ token: tokenAddress, amount, paymentReference });
  return walletClient.sendTransaction({
    account,
    to: contractAddress,
    data,
    chain: walletClient.chain,
  });
}

export async function approveToken(
  walletClient: WalletClient,
  tokenAddress: `0x${string}`,
  spenderAddress: `0x${string}`,
  amount: bigint,
): Promise<Hash> {
  const account = await requireAccount(walletClient);
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddress, amount],
  });
  return walletClient.sendTransaction({
    account,
    to: tokenAddress,
    data,
    chain: walletClient.chain,
  });
}

export async function checkAllowance(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
  ownerAddress: `0x${string}`,
  spenderAddress: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  });
}

export async function getTokenBalance(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
  accountAddress: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [accountAddress],
  });
}

export async function getTokenDecimals(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
): Promise<number> {
  const result = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });
  return Number(result);
}

export async function waitForReceipt(
  publicClient: PublicClient,
  hash: Hash,
  confirmations?: number,
): Promise<TransactionReceipt> {
  return publicClient.waitForTransactionReceipt({
    hash,
    confirmations: confirmations ?? 1,
    timeout: DEFAULT_RECEIPT_TIMEOUT_MS,
  });
}

export function parseTokenAmount(amount: string | number, decimals: number): bigint {
  return parseUnits(String(amount), decimals);
}

/**
 * Submit an EIP-2612 `permit(owner, spender, value, deadline, v, r, s)`
 * transaction. Used by the EVM pay-token flow (item 14.6) when the token
 * supports permit, eliminating the standalone `approve()` round-trip.
 */
export async function submitPermit(
  walletClient: WalletClient,
  tokenAddress: `0x${string}`,
  args: {
    owner: `0x${string}`;
    spender: `0x${string}`;
    value: bigint;
    deadline: bigint;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  },
): Promise<Hash> {
  const account = await requireAccount(walletClient);
  const data = encodeFunctionData({
    abi: ERC20_PERMIT_ABI,
    functionName: 'permit',
    args: [args.owner, args.spender, args.value, args.deadline, args.v, args.r, args.s],
  });
  return walletClient.sendTransaction({
    account,
    to: tokenAddress,
    data,
    chain: walletClient.chain,
  });
}
