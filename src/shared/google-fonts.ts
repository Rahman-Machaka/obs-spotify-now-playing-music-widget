export function extractGoogleFontFamily(input: string): string | null {
  try {
    const url = new URL(input.trim());
    let family = "";
    if (url.protocol === "https:" && url.hostname === "fonts.google.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const specimenIndex = parts.indexOf("specimen");
      if (specimenIndex >= 0 && parts[specimenIndex + 1]) family = decodeURIComponent(parts[specimenIndex + 1]);
    } else if (url.protocol === "https:" && url.hostname === "fonts.googleapis.com") {
      family = url.searchParams.get("family")?.split(":")[0] ?? "";
    }
    family = family.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
    if (!family || family.length > 100 || !/^[\p{L}\p{N} ._'()-]+$/u.test(family)) return null;
    return family;
  } catch {
    return null;
  }
}
