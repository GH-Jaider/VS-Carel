/**
 * The shareable link.
 *
 * A link is the only input to this app that arrives from strangers, and from
 * chat clients, mailers and forums that are free to wrap, truncate or
 * lowercase it on the way. So the two things worth proving are that a link
 * this app wrote comes back as exactly the state it was written from, and that
 * anything else at all — noise, half a payload, a world that does not
 * validate — is answered with null rather than an exception that would take
 * the page down before it opened.
 *
 * Node 22+ provides CompressionStream, TextEncoder, Blob, Response and
 * btoa/atob as globals, so the "node" environment configured in vite.config.ts
 * exercises the same code path a browser takes; the guard below states that
 * dependency instead of leaving a failure here looking like a bug in share.ts.
 */

import { describe, expect, it } from "vitest";
import { validateKarelMap, type KarelMap } from "@karel/core";
import { decodeState, encodeState, shareUrl, type SharedState } from "../src/share";

const WORLD: KarelMap = {
  dimensions: { width: 10, height: 8 },
  karel: { x: 3, y: 4, facing: "north", beepers: 5 },
  beepers: [
    { x: 2, y: 2, count: 1 },
    { x: 9, y: 7, count: 3 },
  ],
  walls: [
    { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } },
    { from: { x: 6, y: 2 }, to: { x: 7, y: 2 } },
  ],
};

const PROGRAM = [
  "BEGINNING-OF-PROGRAM",
  "  BEGINNING-OF-EXECUTION",
  "    move;",
  "    turnleft;",
  "    move;",
  "  END-OF-EXECUTION",
  "END-OF-PROGRAM",
].join("\n");

const STATE: SharedState = { program: PROGRAM, world: WORLD };

const URL_SAFE = /^[A-Za-z0-9_-]+$/;

/** Base64url by hand, to build payloads share.ts would never write. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("the environment share.ts needs", () => {
  it("has the web APIs the encoder is built on", () => {
    expect(typeof CompressionStream).toBe("function");
    expect(typeof DecompressionStream).toBe("function");
    expect(typeof btoa).toBe("function");
    expect(typeof atob).toBe("function");
    expect(typeof Blob).toBe("function");
    expect(typeof Response).toBe("function");
  });
});

describe("encodeState", () => {
  it("survives a round trip", async () => {
    const decoded = await decodeState(await encodeState(STATE));
    expect(decoded).not.toBeNull();
    expect(decoded?.program).toBe(PROGRAM);
    expect(decoded?.world).toEqual(WORLD);
  });

  it("survives a round trip through a hash, with the # on it", async () => {
    const decoded = await decodeState(`#${await encodeState(STATE)}`);
    expect(decoded?.world).toEqual(WORLD);
  });

  it("produces something a URL can carry unescaped", async () => {
    const encoded = await encodeState(STATE);
    expect(encoded).toMatch(URL_SAFE);
    // Whatever went in, nothing needs escaping on the way out.
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it("stays URL-safe for payloads that force base64 padding and both odd characters", async () => {
    // "+" and "/" only appear for particular byte patterns, so one sample is
    // not evidence; a spread of lengths is.
    for (let extra = 0; extra < 24; extra++) {
      const state = { ...STATE, program: `${PROGRAM}\n${"x".repeat(extra)}` };
      expect(await encodeState(state)).toMatch(URL_SAFE);
    }
  });

  it("marks the payload as compressed where the browser can compress", async () => {
    expect((await encodeState(STATE))[0]).toBe("1");
  });

  it("actually compresses: a repetitive program beats plain base64", async () => {
    const repetitive = [
      "BEGINNING-OF-PROGRAM",
      "  BEGINNING-OF-EXECUTION",
      ...Array.from({ length: 400 }, () => "    move;\n    turnleft;"),
      "  END-OF-EXECUTION",
      "END-OF-PROGRAM",
    ].join("\n");
    const state = { program: repetitive, world: WORLD };

    const compressed = await encodeState(state);
    const plain = toBase64Url(JSON.stringify({ p: state.program, w: state.world }));

    // Karel programs are this repetitive in practice; a third is the claim
    // share.ts makes, and a link that is not much shorter is not worth the
    // machinery.
    expect(compressed.length).toBeLessThan(plain.length / 3);
    expect(await decodeState(compressed)).toEqual({ program: repetitive, world: WORLD });
  });

  it("carries text outside ASCII, which comments and names may contain", async () => {
    const program = `${PROGRAM}\n{ acción: girar ← ✓ }`;
    const decoded = await decodeState(await encodeState({ program, world: WORLD }));
    expect(decoded?.program).toBe(program);
  });

  it("carries an empty program", async () => {
    const decoded = await decodeState(await encodeState({ program: "", world: WORLD }));
    expect(decoded?.program).toBe("");
    expect(decoded?.world).toEqual(WORLD);
  });

  it("carries a world with nothing in it", async () => {
    const bare: KarelMap = {
      dimensions: { width: 1, height: 1 },
      karel: { x: 1, y: 1, facing: "east", beepers: 0 },
      beepers: [],
      walls: [],
    };
    const decoded = await decodeState(await encodeState({ program: PROGRAM, world: bare }));
    expect(decoded?.world).toEqual(bare);
  });

  it("carries a world at the core's maximum size", async () => {
    const big: KarelMap = {
      dimensions: { width: 100, height: 100 },
      karel: { x: 100, y: 100, facing: "south", beepers: 12 },
      beepers: Array.from({ length: 100 }, (_, i) => ({ x: i + 1, y: i + 1, count: i + 1 })),
      walls: Array.from({ length: 99 }, (_, i) => ({
        from: { x: i + 1, y: 1 },
        to: { x: i + 2, y: 1 },
      })),
    };
    const decoded = await decodeState(await encodeState({ program: PROGRAM, world: big }));
    expect(decoded?.world).toEqual(big);
  });

  it("is deterministic, so the same state always yields the same link", async () => {
    expect(await encodeState(STATE)).toBe(await encodeState(STATE));
  });
});

describe("decodeState refuses anything it cannot read", () => {
  const junk: Array<[string, string]> = [
    ["an empty string", ""],
    ["a bare hash", "#"],
    ["a lone marker", "1"],
    ["a marker and a hash only", "#0"],
    ["plain noise", "not a payload at all"],
    ["an unknown format marker", "9SGVsbG8"],
    ["a marker that looks like a letter", "xSGVsbG8"],
    ["characters base64 cannot contain", "0!!!!!!!!"],
  ];

  it.each(junk)("returns null for %s", async (_name, input) => {
    await expect(decodeState(input)).resolves.toBeNull();
  });

  it("returns null for valid base64 that is not JSON", async () => {
    await expect(decodeState(`0${toBase64Url("hello, world")}`)).resolves.toBeNull();
  });

  it("returns null for JSON that is not an object", async () => {
    for (const value of ["42", '"a string"', "null", "true", '["p","w"]']) {
      await expect(decodeState(`0${toBase64Url(value)}`)).resolves.toBeNull();
    }
  });

  it("returns null when the program is missing or not a string", async () => {
    for (const value of [
      JSON.stringify({ w: WORLD }),
      JSON.stringify({ p: 7, w: WORLD }),
      JSON.stringify({ p: null, w: WORLD }),
      JSON.stringify({ program: PROGRAM, world: WORLD }),
    ]) {
      await expect(decodeState(`0${toBase64Url(value)}`)).resolves.toBeNull();
    }
  });

  it("returns null when the world is missing", async () => {
    await expect(
      decodeState(`0${toBase64Url(JSON.stringify({ p: PROGRAM }))}`)
    ).resolves.toBeNull();
  });

  it("returns null for a world the core rejects", async () => {
    // Each of these is a map the CLI would refuse to open, so the browser
    // must not open it either: a link is not a way around validation.
    const bad: Array<[string, unknown]> = [
      ["no dimensions", { karel: WORLD.karel, beepers: [], walls: [] }],
      [
        "Karel outside the world",
        { ...WORLD, karel: { x: 99, y: 99, facing: "north", beepers: 0 } },
      ],
      ["an unknown facing", { ...WORLD, karel: { ...WORLD.karel, facing: "sideways" } }],
      ["a beeper pile of zero", { ...WORLD, beepers: [{ x: 1, y: 1, count: 0 }] }],
      ["a beeper outside the world", { ...WORLD, beepers: [{ x: 50, y: 1, count: 1 }] }],
      [
        "a wall between cells that do not touch",
        { ...WORLD, walls: [{ from: { x: 1, y: 1 }, to: { x: 5, y: 5 } }] },
      ],
      ["a world larger than the core allows", { ...WORLD, dimensions: { width: 500, height: 8 } }],
    ];
    for (const [name, world] of bad) {
      expect(validateKarelMap(world).ok, name).toBe(false);
      const payload = `0${toBase64Url(JSON.stringify({ p: PROGRAM, w: world }))}`;
      await expect(decodeState(payload), name).resolves.toBeNull();
    }
  });

  it("returns null for a compressed payload that was corrupted in transit", async () => {
    const encoded = await encodeState(STATE);
    // Keep the marker, wreck the deflate stream underneath it.
    const damaged = `1${encoded.slice(1, 12)}${encoded.slice(20)}`;
    await expect(decodeState(damaged)).resolves.toBeNull();
  });

  it("returns null for a truncated payload", async () => {
    const encoded = await encodeState(STATE);
    await expect(decodeState(encoded.slice(0, encoded.length - 8))).resolves.toBeNull();
  });

  it("returns null for a payload marked compressed that never was", async () => {
    await expect(
      decodeState(`1${toBase64Url(JSON.stringify({ p: PROGRAM, w: WORLD }))}`)
    ).resolves.toBeNull();
  });

  it("does not throw for any of it", async () => {
    // The call site runs at start-up, before anything is on screen: a
    // rejection here would be a blank page rather than a normal open.
    const inputs = ["", "#", "1", "%%%", "0", "1abc", "#0{}", "0" + "A".repeat(1000)];
    for (const input of inputs) {
      await expect(decodeState(input)).resolves.toBeNull();
    }
  });
});

describe("the plain format marker", () => {
  it("reads a payload written without compression", async () => {
    // The fallback branch for browsers with no CompressionStream. Its links
    // stay readable everywhere, so it is built here by hand rather than by
    // taking the global away.
    const payload = `0${toBase64Url(JSON.stringify({ p: PROGRAM, w: WORLD }))}`;
    expect(payload).toMatch(URL_SAFE);
    expect(await decodeState(payload)).toEqual({ program: PROGRAM, world: WORLD });
  });

  it("normalizes the world through the core, as the compressed branch does", async () => {
    // "n" is a legal facing in a .klm; both branches must hand back the
    // spelled-out direction the rest of the app compares against.
    const world = { ...WORLD, karel: { ...WORLD.karel, facing: "n" } };
    const decoded = await decodeState(`0${toBase64Url(JSON.stringify({ p: "", w: world }))}`);
    expect(decoded?.world.karel.facing).toBe("north");
  });

  it("ignores fields it does not know about", async () => {
    const payload = `0${toBase64Url(JSON.stringify({ p: PROGRAM, w: WORLD, v: 2, extra: [1] }))}`;
    expect(await decodeState(payload)).toEqual({ program: PROGRAM, world: WORLD });
  });
});

describe("shareUrl", () => {
  it("hangs the payload off the current page, with no query string", async () => {
    const previous = Reflect.get(globalThis, "window");
    Reflect.set(globalThis, "window", {
      location: { origin: "https://gh-jaider.github.io", pathname: "/karel/" },
    });
    try {
      const url = await shareUrl(STATE);
      expect(url.startsWith("https://gh-jaider.github.io/karel/#")).toBe(true);
      // The state must stay in the fragment: a query string would be sent to
      // the host serving the page, and this app has no server to send it to.
      expect(url).not.toContain("?");
      expect(await decodeState(new URL(url).hash)).toEqual({ program: PROGRAM, world: WORLD });
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Reflect.set(globalThis, "window", previous);
      }
    }
  });
});
