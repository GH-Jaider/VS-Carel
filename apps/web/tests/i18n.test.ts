/**
 * The catalogues, held against each other.
 *
 * The type in i18n.ts already makes a missing key a compile error, and that
 * is the guarantee that matters — but a build that fails somewhere in a
 * mapped type says much less about what went wrong than a test named after
 * the property it checks. These are the four things a translation gets wrong
 * in practice: a key that never arrived, a value left empty, an English
 * string pasted across untouched, and a `{placeholder}` dropped on the way.
 *
 * The last group goes further and reads index.html, because a `data-i18n`
 * attribute is a reference into the catalogue that nothing else type-checks:
 * a key renamed here and not there would leave a button silently in English.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { getLocale } from "@karel/core";
import {
  CATALOGUES,
  LOCALES,
  applyStaticText,
  currentLocale,
  detectLocale,
  setLocale,
  t,
  type Locale,
  type MessageKey,
} from "../src/i18n";

const INDEX_HTML = fileURLToPath(new URL("../index.html", import.meta.url));

const englishKeys = Object.keys(CATALOGUES.en) as MessageKey[];

/**
 * Strings that are legitimately identical in both languages.
 *
 * Every entry has to earn its place, because the point of the check is to
 * catch a value that was copied and never translated. These are the two
 * kinds that survive: a word Spanish spells the same way, and a token that is
 * not prose at all — a key name on a keyboard, an instruction name, a
 * multiplier.
 */
const SAME_IN_BOTH: Partial<Record<MessageKey, string>> = {
  "status.error": "the same word in Spanish",
  "about.close": "the name printed on the key",
  "palette.toolKarel": "a name, and the robot's name at that",
  "speed.normal": "a multiplier, not prose",
  "speed.double": "a multiplier, not prose",
  "speed.quad": "a multiplier, not prose",
};

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

describe("the catalogues", () => {
  it("offers every locale it lists in the masthead", () => {
    for (const entry of LOCALES) {
      expect(CATALOGUES[entry.id], entry.id).toBeDefined();
    }
    expect(LOCALES.map((entry) => entry.id).sort()).toEqual(Object.keys(CATALOGUES).sort());
  });

  it("has the same keys in every language", () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      expect(Object.keys(catalogue).sort(), locale).toEqual([...englishKeys].sort());
    }
  });

  it("has nothing blank", () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const key of englishKeys) {
        expect(catalogue[key].trim(), `${locale}: ${key}`).not.toBe("");
      }
    }
  });

  it("translated everything that is prose", () => {
    const untranslated = englishKeys.filter(
      (key) => CATALOGUES.es[key] === CATALOGUES.en[key] && !(key in SAME_IN_BOTH)
    );
    expect(untranslated).toEqual([]);
  });

  it("does not carry exceptions for strings that were translated after all", () => {
    // An exception that is no longer true is a licence for the next copied
    // string to hide behind it.
    for (const key of Object.keys(SAME_IN_BOTH) as MessageKey[]) {
      expect(CATALOGUES.es[key], key).toBe(CATALOGUES.en[key]);
    }
  });

  it("keeps the same placeholders in every language", () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const key of englishKeys) {
        expect(placeholders(catalogue[key]), `${locale}: ${key}`).toEqual(
          placeholders(CATALOGUES.en[key])
        );
      }
    }
  });

  it("names every bundled exercise in every language", () => {
    // worlds.ts reads these by id, and an exercise added there without a name
    // would otherwise only be noticed by looking at the masthead.
    for (const id of ["first-steps", "collect", "maze", "sandbox"]) {
      expect(englishKeys).toContain(`world.${id}.label`);
      expect(englishKeys).toContain(`world.${id}.brief`);
    }
  });
});

describe("t", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("answers in the current language", () => {
    expect(t("transport.run")).toBe("run");
    setLocale("es");
    expect(t("transport.run")).toBe("ejecutar");
  });

  it("substitutes placeholders", () => {
    expect(t("masthead.themeOption", { name: "ember" })).toBe("ember theme");
    setLocale("es");
    expect(t("masthead.themeOption", { name: "ember" })).toBe("tema ember");
  });

  it("leaves a placeholder it was given nothing for alone", () => {
    // Better a visible `{message}` in a rare error than a sentence with a
    // hole in it that reads as finished.
    expect(t("error.notJson")).toContain("{message}");
  });
});

describe("setLocale", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("moves the core with it", () => {
    // The whole point: an interpreter error and the button that ran it must
    // never disagree about what language the page is in.
    setLocale("es");
    expect(currentLocale()).toBe("es");
    expect(getLocale()).toBe("es");
  });

  it("ignores a locale it does not have", () => {
    setLocale("fr" as Locale);
    expect(currentLocale()).toBe("en");
  });
});

describe("detectLocale", () => {
  it("reads a plain tag", () => {
    expect(detectLocale(["es"])).toBe("es");
    expect(detectLocale(["en"])).toBe("en");
  });

  it("reads a regional tag", () => {
    for (const tag of ["es-ES", "es-MX", "es-419", "ES-mx"]) {
      expect(detectLocale([tag]), tag).toBe("es");
    }
    expect(detectLocale(["en-GB"])).toBe("en");
  });

  it("falls back to English for a language it does not have", () => {
    expect(detectLocale(["de-DE"])).toBe("en");
    expect(detectLocale([])).toBe("en");
    expect(detectLocale([""])).toBe("en");
  });

  it("takes the first language it recognises, in preference order", () => {
    // navigator.languages is ordered, so someone asking for Catalan first and
    // Spanish second should get Spanish rather than the default.
    expect(detectLocale(["ca-ES", "es-ES", "en-US"])).toBe("es");
    expect(detectLocale(["de-DE", "en-US", "es-ES"])).toBe("en");
  });
});

describe("the markup", () => {
  const html = readFileSync(INDEX_HTML, "utf8");

  function keysIn(attribute: string): string[] {
    const pattern = new RegExp(`${attribute}="([^"]+)"`, "g");
    return [...html.matchAll(pattern)].map((match) => match[1]);
  }

  const referenced = [
    ...keysIn("data-i18n"),
    ...keysIn("data-i18n-title"),
    ...keysIn("data-i18n-aria"),
    ...keysIn("data-i18n-content"),
  ];

  it("references keys the catalogue actually has", () => {
    expect(referenced.length).toBeGreaterThan(20);
    const missing = referenced.filter((key) => !englishKeys.includes(key as MessageKey));
    expect(missing).toEqual([]);
  });

  it("translates the page's own title and description", () => {
    // These are what a link preview and a search result show, so they are the
    // one piece of the page a visitor may read before opening it.
    expect(referenced).toContain("page.title");
    expect(referenced).toContain("page.description");
  });
});

describe("applyStaticText", () => {
  /**
   * A stand-in for the two DOM calls the sweep makes, so the sweep can be
   * exercised in the "node" environment the rest of these tests run in.
   * Anything more would be testing a DOM implementation rather than this.
   */
  function fakeDocument(nodes: { attributes: Record<string, string>; text?: string }[]) {
    const built = nodes.map((node) => ({
      dataset: { i18n: node.attributes["data-i18n"] },
      textContent: node.text ?? "",
      getAttribute: (name: string) => node.attributes[name] ?? null,
      setAttribute(name: string, value: string) {
        node.attributes[name] = value;
      },
    }));
    return {
      querySelectorAll: (selector: string) =>
        built.filter((_, index) => {
          const attribute = selector.slice(1, -1);
          return nodes[index].attributes[attribute] !== undefined;
        }),
      nodes: built,
    };
  }

  beforeEach(() => {
    setLocale("es");
  });

  it("fills in text and attributes", () => {
    const page = fakeDocument([
      { attributes: { "data-i18n": "transport.reset" }, text: "reset" },
      { attributes: { "data-i18n-title": "transport.resetTitle" } },
      { attributes: { "data-i18n-aria": "palette.width" } },
    ]);
    applyStaticText(page as unknown as ParentNode);

    expect(page.nodes[0].textContent).toBe("reiniciar");
    expect(page.nodes[1].getAttribute("title")).toBe(CATALOGUES.es["transport.resetTitle"]);
    expect(page.nodes[2].getAttribute("aria-label")).toBe(CATALOGUES.es["palette.width"]);
  });

  it("leaves a node whose key does not exist alone", () => {
    // The English in the markup is a much better answer than a blank button.
    const page = fakeDocument([{ attributes: { "data-i18n": "no.such.key" }, text: "reset" }]);
    applyStaticText(page as unknown as ParentNode);
    expect(page.nodes[0].textContent).toBe("reset");
  });
});
