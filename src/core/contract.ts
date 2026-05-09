import {
  type WalletClient,
  type PublicClient,
  type Hash,
  type TransactionReceipt,
  parseUnits,
  encodeFunctionData,
} from 'viem';
import { PAYMENT_CONTRACT_ABI, ERC20_ABI } from './config';

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
