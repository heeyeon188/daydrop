import type { Language } from '@/lib/i18n';

export type CountryOption = {
  code: string;
  en: string;
  ko: string;
};

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'KR', en: 'South Korea', ko: '\uD55C\uAD6D' },
  { code: 'US', en: 'United States', ko: '\uBBF8\uAD6D' },
  { code: 'JP', en: 'Japan', ko: '\uC77C\uBCF8' },
  { code: 'CN', en: 'China', ko: '\uC911\uAD6D' },
  { code: 'GB', en: 'United Kingdom', ko: '\uC601\uAD6D' },
  { code: 'FR', en: 'France', ko: '\uD504\uB791\uC2A4' },
  { code: 'DE', en: 'Germany', ko: '\uB3C5\uC77C' },
  { code: 'CA', en: 'Canada', ko: '\uCE90\uB098\uB2E4' },
  { code: 'AU', en: 'Australia', ko: '\uD638\uC8FC' },
  { code: 'MX', en: 'Mexico', ko: '\uBA55\uC2DC\uCF54' },
  { code: 'ES', en: 'Spain', ko: '\uC2A4\uD398\uC778' },
  { code: 'IT', en: 'Italy', ko: '\uC774\uD0C8\uB9AC\uC544' },
  { code: 'TH', en: 'Thailand', ko: '\uD0DC\uAD6D' },
  { code: 'VN', en: 'Vietnam', ko: '\uBCA0\uD2B8\uB0A8' },
  { code: 'PH', en: 'Philippines', ko: '\uD544\uB9AC\uD540' },
  { code: 'ID', en: 'Indonesia', ko: '\uC778\uB3C4\uB124\uC2DC\uC544' },
  { code: 'SG', en: 'Singapore', ko: '\uC2F1\uAC00\uD3EC\uB974' },
  { code: 'TW', en: 'Taiwan', ko: '\uB300\uB9CC' },
  { code: 'HK', en: 'Hong Kong', ko: '\uD64D\uCF69' },
  { code: 'BR', en: 'Brazil', ko: '\uBE0C\uB77C\uC9C8' },
];

function normalizeCountryValue(value?: string | null) {
  return value?.trim().toLowerCase() ?? '';
}

export function findCountryOption(value?: string | null) {
  const normalized = normalizeCountryValue(value);

  if (!normalized) {
    return null;
  }

  return (
    COUNTRY_OPTIONS.find((option) => {
      return (
        option.code.toLowerCase() === normalized ||
        option.en.toLowerCase() === normalized ||
        option.ko.toLowerCase() === normalized
      );
    }) ?? null
  );
}

export function getCountryLabel(value: string | null | undefined, language: Language) {
  const option = findCountryOption(value);

  if (!option) {
    return value?.trim() || '';
  }

  return language === 'en' ? option.en : option.ko;
}

export function searchCountryOptions(query: string) {
  const normalized = normalizeCountryValue(query);

  if (!normalized) {
    return COUNTRY_OPTIONS;
  }

  return COUNTRY_OPTIONS.filter((option) => {
    return [option.code, option.en, option.ko].some((value) => value.toLowerCase().includes(normalized));
  });
}
