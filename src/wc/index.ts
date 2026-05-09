/**
 * Web Components subpath entry — `@web3settle/merchant-sdk/wc`.
 *
 * Why native HTMLElement and not Lit:
 *   - Lit pulls ~10 kB of runtime; we already kept the bundle slim by
 *     hand-rolling Solana instructions, so adding a dependency for one button
 *     doesn't fit the brief.
 *   - The button is a thin shell — it only needs `connectedCallback`,
 *     `disconnectedCallback`, attribute reflection and shadow DOM. Native is
 *     enough.
 *
 * Consumers wire it up like any other custom element:
 *
 * ```html
 * <web3settle-pay-button
 *   amount="29.99"
 *   storefront-id="<uuid>"
 *   api-base-url="https://api.web3settle.com"
 *   label="Pay with crypto">
 * </web3settle-pay-button>
 *
 * <script type="module">
 *   import '@web3settle/merchant-sdk/wc';
 *   const btn = document.querySelector('web3settle-pay-button');
 *   btn.addEventListener('payment-started', (e) => console.log(e.detail));
 * </script>
 * ```
 */
export { Web3SettlePayButtonElement, registerWebComponents } from './pay-button';
