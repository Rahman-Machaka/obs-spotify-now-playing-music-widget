import { useEffect, useState } from "react";
import type { Preset } from "../../../../shared/schema";
import { extractGoogleFontFamily } from "../../../../shared/google-fonts";
import type { TranslationKey } from "../../i18n";
import { ChevronDownIcon, ExternalLinkIcon } from "../atoms/Icons";

export function GoogleFontPicker({
  preset,
  t,
  onChange,
}: {
  preset: Preset;
  t: (key: TranslationKey) => string;
  onChange: (fontFamily: string, fontSource: Preset["fontSource"]) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const existing = document.getElementById("dashboard-google-font");
    if (preset.fontSource !== "google") {
      existing?.remove();
      return;
    }
    const link =
      (existing as HTMLLinkElement | null) ?? document.createElement("link");
    link.id = "dashboard-google-font";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${new URLSearchParams({ family: preset.fontFamily, display: "swap" })}`;
    if (!existing) document.head.appendChild(link);
  }, [preset.fontFamily, preset.fontSource]);

  const applyGoogleFont = () => {
    const result = extractGoogleFontFamily(url);
    if (!result) {
      setError(t("googleFontsInvalid"));
      return;
    }
    setError("");
    onChange(result, "google");
  };

  return (
    <div className="font-picker">
      <label className="field-label spaced" htmlFor="font">
        {t("fontFamily")}
      </label>
      <span className="select-control font-select">
        <select
          id="font"
          value={preset.fontSource === "local" ? preset.fontFamily : ""}
          onChange={(event) => onChange(event.target.value, "local")}
        >
          {preset.fontSource === "google" && (
            <option value="">Google: {preset.fontFamily}</option>
          )}
          <option>Poppins</option>
          <option>Inter</option>
          <option>system-ui</option>
        </select>
        <ChevronDownIcon />
      </span>

      <div className="google-font-card">
        <div className="google-font-heading">
          <div>
            <strong>{t("googleFontsTitle")}</strong>
            <small>{t("googleFontsOptional")}</small>
          </div>
          <a href="https://fonts.google.com/" target="_blank" rel="noreferrer">
            {t("googleFontsBrowse")}
            <ExternalLinkIcon />
          </a>
        </div>
        <ol>
          <li>{t("googleFontsStep1")}</li>
          <li>{t("googleFontsStep2")}</li>
          <li>{t("googleFontsStep3")}</li>
        </ol>
        <div className="font-url-row">
          <input
            id="google-font-url"
            aria-label={t("googleFontsUrl")}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "google-font-error" : undefined}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyGoogleFont();
            }}
            placeholder="https://fonts.google.com/specimen/Roboto+Slab"
            spellCheck={false}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={!url.trim()}
            onClick={applyGoogleFont}
          >
            {t("googleFontsUse")}
          </button>
        </div>
        {error && (
          <p className="font-error" id="google-font-error">
            {error}
          </p>
        )}
        {preset.fontSource === "google" && (
          <div className="selected-google-font">
            <span>{t("googleFontsActive")}</span>
            <strong
              style={{ fontFamily: `'${preset.fontFamily}', sans-serif` }}
            >
              {preset.fontFamily}
            </strong>
          </div>
        )}
        <p className="privacy-note">{t("googleFontsPrivacy")}</p>
      </div>
    </div>
  );
}
