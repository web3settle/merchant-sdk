import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalJson } from '../core/canonical-json';
import { PaymentStatus } from '../core/types';
import * as configModule from '../core/config';

// The `./headless` controller and the `./wc` Web Component build their own API client, so the
// payment config they act on has gone through the real Ed25519 verification against the baked-in
// key. These tests swap that key for a test key through the seam `api-client.test.ts` already
// uses (`vi.spyOn(config, 'WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY', 'get')`) — a test-only
// override; the production key is not touched — and serve a fixture envelope over a fetch spy.

const STOREFRONT_ID = 'c9b88f30-7a20-4416-8bc9-2612684ec4cd';
const API = 'https://api.example.test';
const CONTRACT = '0x675f8cc6d9b5b02bd8eb0920d860ce748dd1b3a0';
const REF = '0x8f14e45fceea167a5a36dedd4bea254300000000000000000000000000000000' as const;

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}
const TEST_PRIV = ed25519.utils.randomSecretKey();
const TEST_PUB_HEX = bytesToHex(ed25519.getPublicKey(TEST_PRIV));

const paymentConfig = {
  storefrontId: STOREFRONT_ID,
  commissionBps: 300,
  contractAbiVersion: 'V3.2',
  // Elevates the test contract address: the SDK refuses chains whose address is neither baked in
  // nor allowlisted by the signed payload.
  allowedContractAddresses: { '8453': [CONTRACT] },
  chains: [
    {
      chainId: 8453,
      name: 'Base',
      contractAddress: CONTRACT,
      tokens: [{ address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 }],
      explorerUrl: 'https://basescan.org',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  ],
};

function envelope(data: unknown, signWith: Uint8Array = TEST_PRIV) {
  const signedAt = new Date().toISOString();
  const signature = bytesToHex(ed25519.sign(new TextEncoder().encode(signedAt + canonicalJson(data)), signWith));
  return { data, signedAt, signature, publicKey: TEST_PUB_HEX };
}

function serve(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

beforeEach(() => {
  vi.spyOn(configModule, 'WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY', 'get').mockReturnValue(TEST_PUB_HEX);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const { createPayButtonController } = await import('../headless/usePayButton');

describe('headless controller on a verified payment config', () => {
  it('loads the config the test key signed and hands it to the runner with the reference', async () => {
    const fetchSpy = serve(envelope(paymentConfig));
    const runPayment = vi.fn().mockResolvedValue({ txHash: '0xabc' });
    const controller = createPayButtonController({ apiBaseUrl: API, storefrontId: STOREFRONT_ID, runPayment });

    await controller.start(10, { paymentReference: REF });

    expect(fetchSpy).toHaveBeenCalledWith(`${API}/api/storefronts/${STOREFRONT_ID}/payment-config`, expect.anything());
    expect(controller.getState()).toMatchObject({ status: PaymentStatus.Success, txHash: '0xabc', paymentReference: REF });
    expect(controller.getState().paymentConfig).toEqual(paymentConfig);
    expect(runPayment).toHaveBeenCalledWith({ amount: 10, paymentConfig, paymentReference: REF, mode: 'attributed' });
  });

  it('refuses a config signed by another key — error state, runner never called', async () => {
    serve(envelope(paymentConfig, ed25519.utils.randomSecretKey()));
    const runPayment = vi.fn();
    const controller = createPayButtonController({ apiBaseUrl: API, storefrontId: STOREFRONT_ID, runPayment });

    await controller.start(10, { paymentReference: REF });

    expect(controller.getState().status).toBe(PaymentStatus.Error);
    expect(controller.getState().error).toMatch(/signature verification failed \(signature-invalid\)/);
    expect(controller.getState().paymentConfig).toBeNull();
    expect(runPayment).not.toHaveBeenCalled();
  });

  it('refuses a config whose contract address is tampered after signing', async () => {
    const signed = envelope(paymentConfig);
    const tampered = {
      ...signed,
      data: { ...paymentConfig, chains: [{ ...paymentConfig.chains[0], contractAddress: '0x1111111111111111111111111111111111111111' }] },
    };
    serve(tampered);
    const controller = createPayButtonController({ apiBaseUrl: API, storefrontId: STOREFRONT_ID, runPayment: vi.fn() });

    await controller.start(10, { paymentReference: REF });

    expect(controller.getState().status).toBe(PaymentStatus.Error);
    expect(controller.getState().error).toMatch(/signature-invalid/);
  });
});

describe('<web3settle-pay-button> on a verified payment config', () => {
  beforeEach(async () => {
    const { registerWebComponents } = await import('../wc/pay-button');
    registerWebComponents();
  });

  function mount() {
    const el = document.createElement('web3settle-pay-button');
    el.setAttribute('amount', '10');
    el.setAttribute('storefront-id', STOREFRONT_ID);
    el.setAttribute('api-base-url', API);
    el.setAttribute('payment-reference', REF);
    document.body.appendChild(el);
    const events: { type: string; detail: unknown }[] = [];
    for (const type of ['payment-started', 'payment-success', 'payment-error']) {
      el.addEventListener(type, (e) => events.push({ type, detail: (e as CustomEvent).detail }));
    }
    return { el, events, click: () => el.shadowRoot?.querySelector('button')?.click() };
  }

  it('loads the signed config without raising payment-error (no runner: the host pays)', async () => {
    const fetchSpy = serve(envelope(paymentConfig));
    const { events, click, el } = mount();
    click();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Let the controller settle: with no runner it goes Connecting → Idle, which raises no event.
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([{ type: 'payment-started', detail: { amount: 10, paymentReference: REF } }]);
    el.remove();
  });

  it('raises payment-error with the verification failure when the config is not signed by a trusted key', async () => {
    serve(envelope(paymentConfig, ed25519.utils.randomSecretKey()));
    const { events, click, el } = mount();
    click();
    await waitFor(() => expect(events.some((e) => e.type === 'payment-error')).toBe(true));
    const err = events.find((e) => e.type === 'payment-error') as { detail: { message: string } };
    expect(err.detail.message).toMatch(/signature verification failed \(signature-invalid\)/);
    el.remove();
  });
});
