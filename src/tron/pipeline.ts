import { PaymentPipelineError, classifyError, type PaymentPipeline, type PaymentReceipt } from '../core/pipeline';
import type { ChainConfig, TokenSelection } from '../core/types';
import { NATIVE_TOKEN_SENTINEL } from '../core/types';
import { usdToNativeAmount, usdToTokenAmount } from '../core/price-feed';
import type { TronContractLike, TronWebLike } from './tronweb-global';
import { getTronWeb } from './tronweb-global';

const TRX_DECIMALS = 6;

/** T-address (base58) pattern. */
const TRON_BASE58 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function assertTronAddress(address: string, kind: string): void {
  if (!TRON_BASE58.test(address)) {
    throw new PaymentPipelineError(
      'unknown',
      `Invalid TRON ${kind} address: "${address}"`,
    );
  }
}

type AnyFn = (...args: unknown[]) => unknown;

async function callContractMethod<T>(
  contract: TronContractLike,
  method: string,
  args: unknown[],
  options?: { send?: boolean; value?: number | string; feeLimit?: number },
): Promise<T> {
  const fn = contract[method];
  if (typeof fn !== 'function') {
    throw new PaymentPipelineError('unknown', `Contract method not found: ${method}`);
  }
  const invocation = (fn as AnyFn)(...args);
  if (typeof invocation !== 'object' || invocation === null) {
    throw new PaymentPipelineError('unknown', `Unexpected return from contract.${method}`);
  }
  const inv = invocation as { send?: AnyFn; call?: AnyFn };
  if (options?.send) {
    if (typeof inv.send !== 'function') {
      throw new PaymentPipelineError('unknown', `Method ${method} has no .send()`);
    }
    const sendOpts: Record<string, unknown> = { shouldPollResponse: false };
    if (options.value !== undefined) sendOpts.callValue = options.value;
    if (options.feeLimit !== undefined) sendOpts.feeLimit = options.feeLimit;
    return inv.send(sendOpts) as Promise<T>;
  }
  if (typeof inv.call !== 'function') {
    throw new PaymentPipelineError('unknown', `Method ${method} has no .call()`);
  }
  return inv.call({}) as Promise<T>;
}

export class TronPaymentPipeline implements PaymentPipeline {
  readonly family = 'tron' as const;

  /** `feeLimit` in sun (default: 100 TRX) — energy budget ceiling. */
  public feeLimit = 100_000_000;

  /** Lazily-resolved TronWeb instance. */
  private tronWeb(): TronWebLike {
    const tw = getTronWeb();
    if (!tw) {
      throw new PaymentPipelineError(
        'user-rejected',
        'TronLink (or compatible TRON wallet) is not available. Install the extension and reload.',
      );
    }
    if (typeof tw.defaultAddress.base58 !== 'string') {
      throw new PaymentPipelineError(
        'user-rejected',
        'TRON wallet is locked. Unlock it and try again.',
      );
    }
    return tw;
  }

  async quoteAmount(
    usdAmount: number,
    chain: ChainConfig,
    token: TokenSelection,
  ): Promise<bigint> {
    if (token === NATIVE_TOKEN_SENTINEL) {
      const trx = await usdToNativeAmount(usdAmount, chain.chainId);
      return BigInt(Math.round(trx * 10 ** TRX_DECIMALS));
    }
    const tokenConfig = chain.tokens.find((t) => t.address === token);
    if (!tokenConfig) {
      throw new PaymentPipelineError(
        'unknown',
        `Token ${String(token)} not in TRON chain configuration`,
      );
    }
    const amount = usdToTokenAmount(usdAmount, tokenConfig.symbol);
    return BigInt(Math.round(amount * 10 ** tokenConfig.decimals));
  }

  async needsApproval(
    chain: ChainConfig,
    token: TokenSelection,
    amount: bigint,
  ): Promise<boolean> {
    if (token === NATIVE_TOKEN_SENTINEL) return false;
    const tw = this.tronWeb();
    const owner = tw.defaultAddress.base58 as string;
    assertTronAddress(owner, 'sender');
    assertTronAddress(String(token), 'token');
    assertTronAddress(chain.contractAddress, 'merchant contract');

    try {
      const trc20 = await tw.contract().at(String(token));
      const allowance = (await callContractMethod<{ toString(): string }>(
        trc20,
        'allowance',
        [owner, chain.contractAddress],
      ));
      const current = BigInt(allowance.toString());
      return current < amount;
    } catch (err) {
      throw new PaymentPipelineError(
        classifyError(err),
        err instanceof Error ? err.message : 'Failed to read TRC-20 allowance',
        err,
      );
    }
  }

  async approve(
    chain: ChainConfig,
    token: TokenSelection,
    amount: bigint,
  ): Promise<string> {
    if (token === NATIVE_TOKEN_SENTINEL) {
      throw new PaymentPipelineError('unknown', 'Native TRX requires no approval');
    }
    const tw = this.tronWeb();
    assertTronAddress(String(token), 'token');
    assertTronAddress(chain.contractAddress, 'merchant contract');

    try {
      const trc20 = await tw.contract().at(String(token));
      return await callContractMethod<string>(
        trc20,
        'approve',
        [chain.contractAddress, amount.toString()],
        { send: true, feeLimit: this.feeLimit },
      );
    } catch (err) {
      throw new PaymentPipelineError(
        classifyError(err),
        err instanceof Error ? err.message : 'TRC-20 approve failed',
        err,
      );
    }
  }

  async execute(
    chain: ChainConfig,
    token: TokenSelection,
    amount: bigint,
  ): Promise<string> {
    const tw = this.tronWeb();
    assertTronAddress(chain.contractAddress, 'merchant contract');

    try {
      const contract = await tw.contract().at(chain.contractAddress);

      if (token === NATIVE_TOKEN_SENTINEL) {
        return await callContractMethod<string>(
          contract,
          'payInNative',
          [],
          { send: true, value: amount.toString(), feeLimit: this.feeLimit },
        );
      }
      assertTronAddress(String(token), 'token');
      return await callContractMethod<string>(
        contract,
        'payInToken',
        [String(token), amount.toString()],
        { send: true, feeLimit: this.feeLimit },
      );
    } catch (err) {
      throw new PaymentPipelineError(
        classifyError(err),
        err instanceof Error ? err.message : 'TRON pay-in failed',
        err,
      );
    }
  }

  async waitForReceipt(txHash: string): Promise<PaymentReceipt> {
    const tw = this.tronWeb();
    const start = Date.now();
    // Poll for up to 90 s — TRON block time ~3 s, so this gives ~30 attempts.
    while (Date.now() - start < 90_000) {
      try {
        const tx = await tw.trx.getConfirmedTransaction(txHash);
        if (tx && typeof tx === 'object') {
          const t = tx as { ret?: { contractRet?: string }[]; blockNumber?: number };
          const contractRet = t.ret?.[0]?.contractRet;
          return {
            success: contractRet === 'SUCCESS',
            blockNumber: t.blockNumber ?? null,
            raw: tx,
          };
        }
      } catch {
        // Not yet confirmed — TronGrid returns an error until the tx lands.
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new PaymentPipelineError(
      'timeout',
      'TRON transaction did not confirm within 90 s',
    );
  }
}
