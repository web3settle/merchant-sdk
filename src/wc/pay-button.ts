/**
 * `<web3settle-pay-button>` native Web Component.
 *
 * Reuses the headless controller (`createPayButtonController`) under the hood
 * so the same code path drives both the React `<Web3SettlePayButton>` and
 * this Web Component. The element renders a single button with a hover state
 * and emits a small CustomEvent vocabulary the merchant can listen for.
 *
 * Events:
 *   - `payment-started`   detail: `{ amount: number }`
 *   - `payment-success`   detail: `{ amount: number; txHash: string }`
 *   - `payment-error`     detail: `{ amount: number; message: string }`
 *
 * Attributes:
 *   - `amount` (required) — USD amount to charge
 *   - `storefront-id` (required) — UUID
 *   - `api-base-url` (required) — Web3Settle API base URL
 *   - `label` (optional) — button text override
 *   - `disabled` (boolean attribute) — disables click
 */
import {
  createPayButtonController,
  type PayButtonController,
  type PayButtonState,
} from '../headless/usePayButton';

const TEMPLATE = `
<style>
  :host {
    display: inline-block;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  button {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 0.75rem;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    background: #4f46e5;
    color: #fff;
    transition: background 200ms ease, box-shadow 200ms ease;
  }
  button:hover { background: #6366f1; box-shadow: 0 0 20px rgba(99, 102, 241, 0.3); }
  button:active { background: #4338ca; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
<button type="button" part="button">
  <slot>Pay</slot>
</button>
`;

/** Public class. Registered on construction via {@link registerWebComponents}. */
export class Web3SettlePayButtonElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['amount', 'storefront-id', 'api-base-url', 'label', 'disabled'];
  }

  private controller: PayButtonController | null = null;
  private unsubscribe: (() => void) | null = null;
  private buttonEl: HTMLButtonElement | null = null;

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this.shadowRoot!.innerHTML = TEMPLATE;
    this.buttonEl = this.shadowRoot!.querySelector('button');
    this.buttonEl?.addEventListener('click', this.handleClick);
    this.render();
  }

  disconnectedCallback(): void {
    this.buttonEl?.removeEventListener('click', this.handleClick);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.controller = null;
  }

  attributeChangedCallback(): void {
    // Tear down + rebuild the controller when configuration changes. Cheap.
    this.unsubscribe?.();
    this.controller = null;
    this.render();
  }

  private getController(): PayButtonController | null {
    if (this.controller) return this.controller;
    const apiBaseUrl = this.getAttribute('api-base-url');
    const storefrontId = this.getAttribute('storefront-id');
    if (!apiBaseUrl || !storefrontId) return null;
    try {
      this.controller = createPayButtonController({ apiBaseUrl, storefrontId });
      this.unsubscribe = this.controller.subscribe(this.handleStateChange);
      return this.controller;
    } catch {
      return null;
    }
  }

  private render(): void {
    if (!this.buttonEl) return;
    const label = this.getAttribute('label');
    const amount = this.getAttribute('amount');
    const fallback = amount ? `Pay $${Number(amount).toFixed(2)}` : 'Pay';
    // If consumer passed children, the <slot> will render them — only update
    // the text fallback when no slotted content exists.
    if (this.childNodes.length === 0) {
      this.buttonEl.textContent = label ?? fallback;
    }
    this.buttonEl.disabled = this.hasAttribute('disabled');
  }

  private handleClick = (): void => {
    const controller = this.getController();
    if (!controller) {
      this.dispatchEvent(new CustomEvent('payment-error', {
        detail: { amount: 0, message: 'Missing storefront-id or api-base-url attribute' },
      }));
      return;
    }
    const amount = Number(this.getAttribute('amount') ?? '0');
    if (!Number.isFinite(amount) || amount <= 0) {
      this.dispatchEvent(new CustomEvent('payment-error', {
        detail: { amount, message: 'Invalid or missing amount attribute' },
      }));
      return;
    }
    this.dispatchEvent(new CustomEvent('payment-started', { detail: { amount } }));
    void controller.start(amount);
  };

  private handleStateChange = (state: PayButtonState): void => {
    const amount = Number(this.getAttribute('amount') ?? '0');
    if (state.txHash && state.status === 'success') {
      this.dispatchEvent(new CustomEvent('payment-success', {
        detail: { amount, txHash: state.txHash },
      }));
      return;
    }
    if (state.error && state.status === 'error') {
      this.dispatchEvent(new CustomEvent('payment-error', {
        detail: { amount, message: state.error },
      }));
    }
  };
}

/**
 * Register every web component the SDK exposes. Idempotent — safe to call
 * from multiple bundles. Importing `'@web3settle/merchant-sdk/wc'` calls this
 * automatically as a side effect.
 */
export function registerWebComponents(): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get('web3settle-pay-button')) {
    customElements.define('web3settle-pay-button', Web3SettlePayButtonElement);
  }
}

// Side-effect register on import (kept gated behind the runtime check so the
// module is safe to import in Node/SSR environments).
registerWebComponents();
