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
 * Execute a native currency payment (ETH, POL, etc.) to the merchant contract.
 */
export async function executePayInNative(
  walletClient: WalletClient,
  contractAddress: `0x${string}`,
  amount: bigint,
): Promise<Hash> {
  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error('No wallet account connected');
  }

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
 * Execute an ERC-20 token payment to the merchant contract.
 * Assumes approval has already been granted.
 */
export async function executePayInToken(
  walletClient: WalletClient,
  contractAddress: `0x${string}`,
  tokenAddress: `0x${string}`,
  amount: bigint,
): Promise<Hash> {
  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error('No wallet account connected');
  }

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
 * Approve the merchant contract to spend ERC-20 tokens on behalf of the user.
 */
export async function approveToken(
  walletClient: WalletClient,
  tokenAddress: `0x${string}`,
  spenderAddress: `0x${string}`,
  amount: bigint,
): Promise<Hash> {
  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error('No wallet account connected');
  }

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

/**
 * Check current ERC-20 allowance for the spender.
 */
export async function checkAllowance(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
  ownerAddress: `0x${string}`,
  spenderAddress: `0x${string}`,
): Promise<bigint> {
  const result = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  });
  return result as bigint;
}

/**
 * Read the ERC-20 balance for an account.
 */
export async function getTokenBalance(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
  accountAddress: `0x${string}`,
): Promise<bigint> {
  const result = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [accountAddress],
  });
  return result as bigint;
}

/**
 * Read the ERC-20 token decimals.
 */
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

/**
 * Wait for a transaction receipt with timeout.
 */
export async function waitForReceipt(
  publicClient: PublicClient,
  hash: Hash,
  confirmations?: number,
): Promise<TransactionReceipt> {
  return publicClient.waitForTransactionReceipt({
    hash,
    confirmations: confirmations ?? 1,
    timeout: 120_000,
  });
}

/**
 * Parse a human-readable amount to the smallest unit (wei, etc.).
 */
export function parseTokenAmount(amount: string | number, decimals: number): bigint {
  return parseUnits(String(amount), decimals);
}
