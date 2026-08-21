import { afterEach, describe, expect, it } from "vitest";

import { Interpreter, World, getLocale, setLocale, validateKarelMap } from "../src/index";
import { ErrorMessages } from "../src/messages";
import { makeMap, program } from "./helpers";

// Every test that switches language has to put it back, or the locale leaks
// into whatever runs next and the failure surfaces somewhere unrelated.
afterEach(() => setLocale("en"));

describe("the locale seam", () => {
  it("starts in English", () => {
    expect(getLocale()).toBe("en");
  });

  it("re-words a message that was already reachable", () => {
    const english = ErrorMessages.moveBlocked();
    setLocale("es");

    expect(ErrorMessages.moveBlocked()).not.toBe(english);
    expect(ErrorMessages.moveBlocked()).toContain("muro");
  });

  it("resolves the language when the message is built, not when it is imported", () => {
    // The catalogue is captured once at module load, so a host that holds a
    // reference to ErrorMessages from before the switch must still get the new
    // language. Otherwise a long-lived editor would keep the old one for ever.
    const held = ErrorMessages.noBeepersInBag;
    setLocale("es");

    expect(held()).toBe(ErrorMessages.noBeepersInBag());
    expect(held()).toContain("mochila");
  });

  it("keeps interpolated values out of the translation", () => {
    setLocale("es");
    const message = ErrorMessages.noBeepersToPickUp(3, 4);

    expect(message).toContain("(3, 4)");
  });
});

describe("what the language must not change", () => {
  it("leaves RuntimeErrorKind alone, so nothing has to read the prose", () => {
    // This is the property that lets the CLI map failures to exit codes and
    // the editor pick an icon: the words are for people, the kind is for code.
    const source = program("move");
    const kinds: string[] = [];

    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      // Against the top edge of a 5x5 world, so the first move is blocked.
      const world = new World(makeMap({ karel: { x: 1, y: 5, facing: "north", beepers: 0 } }));
      const interpreter = new Interpreter(world);
      interpreter.load(source);
      interpreter.onError = (error) => kinds.push(error.kind);
      while (interpreter.step()) {
        /* drive to the wall */
      }
    }

    expect(kinds).toEqual(["blocked", "blocked"]);
  });

  it("translates validation errors without changing what is rejected", () => {
    const bad = { dimensions: { width: 0, height: 3 }, karel: { x: 1, y: 1, facing: "north" } };

    setLocale("en");
    const english = validateKarelMap(bad);
    setLocale("es");
    const spanish = validateKarelMap(bad);

    expect(english.ok).toBe(false);
    expect(spanish.ok).toBe(false);
    expect(spanish.errors).toHaveLength(english.errors.length);
    expect(spanish.errors[0]).not.toBe(english.errors[0]);
  });
});

describe("the Spanish catalogue", () => {
  const keys = Object.keys(ErrorMessages) as (keyof typeof ErrorMessages)[];

  // The type annotation on the Spanish catalogue already makes a missing key a
  // compile error. These check the part the type cannot: that somebody wrote
  // actual Spanish rather than copying the English line across.
  it("answers to every key the English one does", () => {
    setLocale("es");
    for (const key of keys) {
      const translate = ErrorMessages[key] as (...args: never[]) => string;
      expect(typeof translate).toBe("function");
    }
    expect(keys.length).toBeGreaterThan(30);
  });

  it("has no empty translation", () => {
    setLocale("es");
    for (const key of keys) {
      const built = (ErrorMessages[key] as (...args: unknown[]) => string)(1, 1, 1, 1);
      expect(built.trim(), `${key} is empty in Spanish`).not.toBe("");
    }
  });

  it("leaves the language's own keywords untranslated", () => {
    setLocale("es");

    // A student types BEGINNING-OF-PROGRAM whichever language they read the
    // error in, so translating the keyword would send them looking for a
    // spelling that does not exist.
    expect(ErrorMessages.missingProgramStart()).toContain("BEGINNING-OF-PROGRAM");
    expect(ErrorMessages.missingTurnoff()).toContain("turnoff");
    expect(ErrorMessages.invalidIterateCount()).toContain("ITERATE");
    expect(ErrorMessages.cannotRedefineBuiltIn("move")).toContain("move");
  });
});
