import de from "./locales/de.json";
import en from "./locales/en.json";

type WidgetLanguage = "de" | "en";
export type WidgetTranslationKey = keyof typeof en;

const translations: Record<WidgetLanguage, Record<WidgetTranslationKey, string>> = { de, en };

export function widgetLanguage(preference: "auto" | WidgetLanguage | undefined): WidgetLanguage {
  return preference === "de" || preference === "en"
    ? preference
    : navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

export function widgetTranslator(preference: "auto" | WidgetLanguage | undefined) {
  const language = widgetLanguage(preference);
  return (key: WidgetTranslationKey): string => translations[language][key];
}
