import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

export const SUPPORTED_LOCALES = ['en', 'pt-BR'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

const SDK_NAMESPACE = 'web3settle-sdk' as const;

/**
 * Lazily create or reuse the SDK's i18next instance. We do NOT touch the host
 * app's default `i18next` singleton unless the consumer explicitly opts in by
 * passing their own instance to `Web3SettleProvider`. This avoids clobbering
 * the consumer's translations if they already use i18next.
 */
let sdkInstance: I18nInstance | null = null;

export function ensureSdkI18n(): I18nInstance {
  if (sdkInstance) return sdkInstance;

  sdkInstance = i18next.createInstance();
  void sdkInstance.use(initReactI18next).init({
    resources: {
      en: { [SDK_NAMESPACE]: en },
      'pt-BR': { [SDK_NAMESPACE]: ptBR },
    },
    defaultNS: SDK_NAMESPACE,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    interpolation: { escapeValue: false },
  });
  return sdkInstance;
}

/**
 * Call from the app's own i18next instance to inject SDK translations into it.
 * Use this when the consumer ALREADY has i18next configured and wants the SDK's
 * strings to participate in their locale switching.
 */
export function addSdkResourcesTo(host: I18nInstance): void {
  for (const locale of SUPPORTED_LOCALES) {
    const pack = locale === 'en' ? en : ptBR;
    host.addResourceBundle(locale, SDK_NAMESPACE, pack, true, false);
  }
}

export { SDK_NAMESPACE };
