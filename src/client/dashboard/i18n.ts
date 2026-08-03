import de from "./locales/de.json";
import en from "./locales/en.json";

export type SupportedLanguage = "de" | "en";
export type TranslationKey = keyof typeof en;

const translations: Record<SupportedLanguage, Record<TranslationKey, string>> = { de, en };

export function browserLanguage(): SupportedLanguage {
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

export function translator(language: SupportedLanguage) {
  return (key: TranslationKey): string => translations[language][key];
}
