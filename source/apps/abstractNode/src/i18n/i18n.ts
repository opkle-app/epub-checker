import { en } from "./locales/en.js";
import { ko } from "./locales/ko.js";
import type { AppLocale, LocalizedMessage, MessageParams, Messages } from "./types.js";

const LOCALE_STORAGE_KEY = "epub-checker.locale";
const catalogs: Record<AppLocale, Messages> = { ko, en };

const isAppLocale = (value: unknown): value is AppLocale => value === "ko" || value === "en";

const selectSupportedLocale = (preferredLanguages: string[]): AppLocale => {
  for (const tag of preferredLanguages) {
    const language = String(tag).trim().toLowerCase().split("-")[0];
    if (isAppLocale(language)) {
      return language;
    }
  }
  return "en";
};

const message = (key: keyof Messages, params?: MessageParams): LocalizedMessage => ({ key, params });

const translateMessage = (messages: Messages, value: LocalizedMessage): string => {
  if (typeof value === "string") {
    return value;
  }
  const translation = messages[value.key];
  if (typeof translation === "function") {
    return (translation as (params: MessageParams) => string)(value.params ?? {});
  }
  return translation;
};

class LocaleController {
  private locale: AppLocale = "en";
  private storage: Pick<Storage, "getItem" | "setItem"> | null;

  constructor(storage: Pick<Storage, "getItem" | "setItem"> | null = globalThis.localStorage ?? null) {
    this.storage = storage;
  }

  public initialize = (preferredLanguages: string[]): AppLocale => {
    let saved: string | null = null;
    try {
      saved = this.storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
    } catch {
      // Storage can be disabled by policy; system-language selection still works.
    }
    this.locale = isAppLocale(saved) ? saved : selectSupportedLocale(preferredLanguages);
    return this.locale;
  };

  public get current(): AppLocale {
    return this.locale;
  }

  public get messages(): Messages {
    return catalogs[this.locale];
  }

  public setLocale = (locale: AppLocale): boolean => {
    if (locale === this.locale) {
      return false;
    }
    this.locale = locale;
    try {
      this.storage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Keep the in-memory choice even when persistence is unavailable.
    }
    return true;
  };
}

export { LOCALE_STORAGE_KEY, LocaleController, isAppLocale, message, selectSupportedLocale, translateMessage };
export type { AppLocale, LocalizedMessage, MessageParams, Messages } from "./types.js";
