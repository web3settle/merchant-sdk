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
    return this.parse(raw, PaymentConfigSchema, 'payment config');
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
