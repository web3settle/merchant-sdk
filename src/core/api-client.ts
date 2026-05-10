import {
  PaymentSessionSchema,
  CreateSessionResponseSchema,
  QuoteResponseSchema,
  SignedPaymentConfigEnvelopeSchema,
  Web3SettleApiError,
  type PaymentConfig,
  type PaymentSession,
  type CreateSessionResponse,
  type QuoteResponse,
} from './types';
import { verifyPaymentConfig } from './payment-config-verifier';
import { SUPPORTED_ABI_VERSIONS, KNOWN_CONTRACT_ADDRESSES } from './config';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidStorefrontId(id: string): void {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`Invalid storefrontId: must be a UUID, got "${id}"`);
  }
}

function assertValidSessionId(id: string): void {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`Invalid sessionId: must be a UUID`);
  }
}

export class Web3SettleApiClient {
  private readonly baseUrl: URL;
  private readonly storefrontId: string;

  constructor(baseUrl: string, storefrontId: string) {
    assertValidStorefrontId(storefrontId);
    this.baseUrl = new URL(baseUrl);
    this.storefrontId = storefrontId;
  }

  async fetchPaymentConfig(signal?: AbortSignal): Promise<PaymentConfig> {
    const raw = await this.request(
      `api/storefronts/${this.storefrontId}/payment-config`,
      { signal },
    );
    // Step 1: shape-validate the envelope (data + signedAt + signature).
    const envelope = this.parse(raw, SignedPaymentConfigEnvelopeSchema, 'payment config envelope');

    // Step 2: cryptographic provenance — the signature must verify against a
    // baked-in Ed25519 public key over `signed_at + canonical_json(data)`. A
    // poisoned-DNS / CDN-edge MITM that substitutes contract addresses cannot
    // forge this without the private key in Vault.
    const verify = verifyPaymentConfig({
      data: envelope.data,
      signed_at: envelope.signedAt,
      signature: envelope.signature,
    });
    if (!verify.ok) {
      throw new Web3SettleApiError(
        `Refusing payment-config response: signature verification failed (${verify.reason}${verify.detail ? `: ${verify.detail}` : ''}). The SDK will not build a transaction against an unverified contract address.`,
        0,
        { reason: verify.reason },
      );
    }

    // Step 3: ABI-version handshake (Phase 7). Fail closed when the backend
    // has rolled forward to a revision the SDK can't speak — calldata would
    // revert silently otherwise.
    if (!SUPPORTED_ABI_VERSIONS.has(envelope.data.contractAbiVersion)) {
      throw new Web3SettleApiError(
        `Unsupported contractAbiVersion "${envelope.data.contractAbiVersion}" — upgrade @web3settle/merchant-sdk to a release that supports this version.`,
        0,
        { abiVersion: envelope.data.contractAbiVersion },
      );
    }

    // Step 4: contract-address allowlist (Phase 3). The SDK refuses to build
    // calldata for a contract address that is neither in the baked-in
    // KNOWN_CONTRACT_ADDRESSES nor explicitly elevated by the signed payload.
    // Backend compromise alone cannot redirect funds — a fresh address still
    // requires an SDK release.
    for (const chain of envelope.data.chains) {
      const baked = KNOWN_CONTRACT_ADDRESSES[chain.chainId] ?? new Set<string>();
      const elevated = new Set(
        (envelope.data.allowedContractAddresses[String(chain.chainId)] ?? []).map((a) =>
          a.toLowerCase(),
        ),
      );
      const addrLower = chain.contractAddress.toLowerCase();
      if (!baked.has(addrLower) && !elevated.has(addrLower)) {
        throw new Web3SettleApiError(
          `Refusing chain ${chain.chainId}: contractAddress "${chain.contractAddress}" is not in the SDK allowlist and was not explicitly elevated by the signed payload.`,
          0,
          { chainId: chain.chainId, address: addrLower },
        );
      }
    }

    return envelope.data;
  }

  async createTopUpSession(
    userId: string,
    amount: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CreateSessionResponse> {
    const raw = await this.request(
      `api/storefronts/${this.storefrontId}/sessions`,
      {
        method: 'POST',
        body: { userId, amount, idempotencyKey },
        signal,
      },
    );
    return this.parse(raw, CreateSessionResponseSchema, 'session');
  }

  /**
   * Server-side USD → token quote backed by Chainlink. Use the returned `amountToken` (atomic,
   * decimal string) as the `value` / `amount` arg when building the on-chain tx so the user
   * signs exactly what they were quoted.
   *
   * `token` is either `"native"` for the chain's gas token or a 0x-prefixed ERC20 address. The
   * server rejects tokens not enabled on the storefront's active contract.
   */
  async fetchQuote(
    network: string,
    token: string,
    amountUsd: number,
    signal?: AbortSignal,
  ): Promise<QuoteResponse> {
    const qs = new URLSearchParams({
      network,
      token,
      amountUsd: amountUsd.toString(),
    });
    const raw = await this.request(
      `api/storefronts/${this.storefrontId}/quote?${qs.toString()}`,
      { signal },
    );
    return this.parse(raw, QuoteResponseSchema, 'quote');
  }

  async getSessionStatus(sessionId: string, signal?: AbortSignal): Promise<PaymentSession> {
    assertValidSessionId(sessionId);
    const raw = await this.request(
      `api/storefronts/${this.storefrontId}/sessions/${sessionId}`,
      { signal },
    );
    return this.parse(raw, PaymentSessionSchema, 'session status');
  }

  private parse<T>(
    raw: unknown,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
    kind: string,
  ): T {
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new Web3SettleApiError(
        `Invalid ${kind} response: ${result.error.message}`,
        0,
        raw,
      );
    }
    return result.data;
  }

  private buildUrl(path: string): string {
    const base = this.baseUrl.toString().replace(/\/+$/, '');
    const suffix = path.replace(/^\/+/, '');
    return `${base}/${suffix}`;
  }

  private async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const { method = 'GET', body, headers = {}, signal } = options;

    const url = this.buildUrl(path);
    const fetchHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };

    if (body !== undefined) {
      fetchHeaders['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: fetchHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      throw new Web3SettleApiError(
        `Network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        0,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    let responseBody: unknown;
    if (contentType.includes('application/json')) {
      try {
        responseBody = await response.json();
      } catch {
        throw new Web3SettleApiError('Failed to parse JSON response', response.status);
      }
    } else {
      responseBody = await response.text();
    }

    if (!response.ok) {
      const message =
        typeof responseBody === 'object' &&
        responseBody !== null &&
        'message' in responseBody &&
        typeof (responseBody as { message: unknown }).message === 'string'
          ? (responseBody as { message: string }).message
          : `HTTP ${response.status}`;
      throw new Web3SettleApiError(message, response.status, responseBody);
    }

    return responseBody;
  }
}
