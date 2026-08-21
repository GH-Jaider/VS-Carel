import { describe, expect, it } from "vitest";
import { BUILT_IN_INSTRUCTIONS, Lexer, Parser, TokenType, VALID_CONDITIONS } from "@karel/core";

import {
  DOCUMENTED_CONDITIONS,
  DOCUMENTED_INSTRUCTIONS,
  HELP_SECTIONS,
  MOD_KEY,
  type HelpBlock,
} from "../src/help";

/**
 * The manual is the one place in the app that restates the language in prose,
 * so it is the one place that can quietly stop being true. help.ts writes the
 * eighteen conditions and the five instructions out by hand — the order is the
 * teaching, and a Set has no order — which makes these three tests the only
 * thing standing between a renamed condition and a page that documents a word
 * the parser no longer knows.
 */

function blocks(): HelpBlock[] {
  return HELP_SECTIONS.flatMap((section) => section.blocks);
}

/** Put a fragment back inside the frame the manual says every program has. */
function asProgram(source: string): string {
  if (/BEGINNING-OF-PROGRAM/i.test(source)) {
    return source;
  }
  const body = /^\s*DEFINE-NEW-INSTRUCTION/i.test(source);
  return [
    "BEGINNING-OF-PROGRAM",
    body ? source : "",
    "BEGINNING-OF-EXECUTION",
    body ? "turnoff" : source,
    "END-OF-EXECUTION",
    "END-OF-PROGRAM",
  ].join("\n");
}

describe("what the manual documents", () => {
  it("lists exactly the conditions the parser accepts", () => {
    expect(new Set(DOCUMENTED_CONDITIONS)).toEqual(VALID_CONDITIONS);
  });

  it("lists exactly the instructions Karel is born knowing", () => {
    expect(new Set(DOCUMENTED_INSTRUCTIONS)).toEqual(BUILT_IN_INSTRUCTIONS);
  });

  it("names each condition once, so a family cannot borrow another's", () => {
    expect(DOCUMENTED_CONDITIONS).toHaveLength(new Set(DOCUMENTED_CONDITIONS).size);
  });
});

describe("the samples", () => {
  /**
   * Every word in a sample has to be one the lexer classifies, or the snippet
   * is teaching a typo. Identifiers are the exception the language allows —
   * `turnright` is invented on purpose — so they are checked against the names
   * the samples themselves define.
   */
  it("contains no word the lexer cannot place", () => {
    const defined = new Set<string>();
    const unknown: string[] = [];

    for (const block of blocks()) {
      if (block.kind !== "code") {
        continue;
      }
      let previous: TokenType | null = null;
      for (const token of new Lexer(block.source).tokenize()) {
        if (previous === TokenType.DefineNewInstruction) {
          defined.add(token.value.toLowerCase());
        }
        if (token.type === TokenType.Identifier) {
          const name = token.value.toLowerCase();
          if (!BUILT_IN_INSTRUCTIONS.has(name) && !defined.has(name)) {
            unknown.push(token.value);
          }
        }
        previous = token.type;
      }
    }

    expect(unknown).toEqual([]);
  });

  /**
   * A fragment is a fragment because it is *shown* out of context, not because
   * it is allowed to be wrong. Each one is put back into the frame the manual
   * says every program has, and handed to the real parser: a sample the reader
   * can copy has to be a sample that parses.
   */
  it("parses, every one of them", () => {
    for (const block of blocks()) {
      if (block.kind !== "code") {
        continue;
      }
      const { diagnostics } = new Parser().parse(asProgram(block.source));
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect({ source: block.source, errors }).toEqual({ source: block.source, errors: [] });
    }
  });
});

describe("the index", () => {
  it("gives every section a distinct anchor and a tab to reach it by", () => {
    const ids = HELP_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of HELP_SECTIONS) {
      expect(section.tab.length).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.blocks.length).toBeGreaterThan(0);
    }
  });

  it("spells the modifier with the placeholder rather than one platform's key", () => {
    const keys = blocks().flatMap((block) => (block.kind === "keys" ? block.rows : []));
    expect(keys.length).toBeGreaterThan(0);
    // ⌘ is written in by the renderer at display time; finding it in the data
    // would mean a Windows visitor is being told to press a key they lack.
    expect(keys.some((row) => row.keys.includes(MOD_KEY))).toBe(true);
    expect(JSON.stringify(keys)).not.toContain("⌘");
  });
});
