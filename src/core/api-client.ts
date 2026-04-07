import {
  PaymentConfigSchema,
  PaymentSessionSchema,
  CreateSessionResponseSchema,
  Web3SettleApiError,
  type PaymentConfig,
  type PaymentSession,
  type CreateSessionResponse,
} from './types';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class Web3SettleApiClient {
  private readonly baseUrl: string;
  private readonly storefrontId: string;

  constructor(baseUrl: string, storefrontId: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.storefrontId = storefrontId;
  }

  /**
   * Fetch payment configuration for the storefront.
   * Returns supported chains, tokens, commission, etc.
   */
  async fetchPaymentConfig(signal?: AbortSignal): Promise<PaymentConfig> {
    const raw = await this.request(
      `/api/storefronts/${this.storefrontId}/payment-config`,
      { signal },
    );
    const result = PaymentConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new Web3SettleApiError(
        `Invalid payment config response: ${result.error.message}`,
        0,
        raw,
      );
    }
    return result.data;
  }

  /**
   * Create a new top-up session for a user.
   */
  async createTopUpSession(
    userId: string,
    amount: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CreateSessionResponse> {
    const raw = await this.request(
      `/api/storefronts/${this.storefrontId}/sessions`,
      {
        method: 'POST',
        body: { userId, amount, idempotencyKey },
        signal,
      },
    );
    const result = CreateSessionResponseSchema.safeParse(raw);
    if (!result.success) {
      throw new Web3SettleApiError(
        `Invalid session response: ${result.error.message}`,
        0,
        raw,
      );
    }
    return result.data;
  }

  /**
   * Poll for session status by ID.
   */
  async getSessionStatus(sessionId: string, signal?: AbortSignal): Promise<PaymentSession> {
    const raw = await this.request(
      `/api/storefronts/${this.storefrontId}/sessions/${sessionId}`,
      { signal },
    );
    const result = PaymentSessionSchema.safeParse(raw);
    if (!result.success) {
      throw new Web3SettleApiError(
        `Invalid session status response: ${result.error.message}`,
        0,
        raw,
      );
    }
    return result.data;
  }

  /**
   * Type-safe fetch wrapper with consistent error handling.
   */
  private async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const { method = 'GET', body, headers = {}, signal } = options;

    const url = `${this.baseUrl}${path}`;
    const fetchHeaders: Record<string, string> = {
      'Accept': 'application/json',
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

    let responseBody: unknown;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
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
        'message' in responseBody
          ? String((responseBody as Record<string, unknown>).message)
          : `HTTP ${response.status}`;
      throw new Web3SettleApiError(message, response.status, responseBody);
    }

    return responseBody;
  }
}
