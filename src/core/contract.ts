import {
  type WalletClient,
  type PublicClient,
  type Hash,
  type TransactionReceipt,
  parseUnits,
  encodeFunctionData,
} from 'viem';
import { PAYMENT_CONTRACT_ABI, ERC20_ABI } from './config';

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
