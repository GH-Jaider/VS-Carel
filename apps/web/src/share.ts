/**
 * Putting a program and its world in a link.
 *
 * This is the feature the browser exists for. A teacher builds an exercise,
 * copies the address bar, and pastes it into a message; thirty students open
 * it and are looking at the same world, having installed nothing and signed
 * into nothing. No server is involved, because the whole state is in the URL.
 *
 * The payload is deflated before it is encoded — a Karel program is repetitive
 * enough that it compresses to roughly a third — and it goes in the fragment
 * rather than the query string, so it is never sent to the host that serves
 * the page.
 */

import { validateKarelMap, type KarelMap } from "@karel/core";

export interface SharedState {
  program: string;
  world: KarelMap;
}

/** Browsers without CompressionStream fall back to plain base64url. */
const CAN_COMPRESS = typeof CompressionStream === "function";

const PREFIX_COMPRESSED = "1";
const PREFIX_PLAIN = "0";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function through(bytes: Uint8Array, stream: TransformStream): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

/** Encode state for a location hash. Never throws; falls back to plain. */
export async function encodeState(state: SharedState): Promise<string> {
  const json = JSON.stringify({ p: state.program, w: state.world });
  const bytes = new TextEncoder().encode(json);
  if (!CAN_COMPRESS) {
    return PREFIX_PLAIN + toBase64Url(bytes);
  }
  try {
    return (
      PREFIX_COMPRESSED + toBase64Url(await through(bytes, new CompressionStream("deflate-raw")))
    );
  } catch {
    return PREFIX_PLAIN + toBase64Url(bytes);
  }
}

/**
 * Read state back out of a hash, or null if it cannot be read.
 *
 * A link is the one input that arrives from strangers and from software that
 * may have mangled it in transit, so every failure here — bad base64, a
 * payload that is not JSON, a world that does not validate — is the same
 * answer: ignore it and open normally.
 */
export async function decodeState(hash: string): Promise<SharedState | null> {
  const payload = hash.replace(/^#/, "");
  if (payload.length < 2) {
    return null;
  }
  const [marker, body] = [payload[0], payload.slice(1)];
  if (marker !== PREFIX_COMPRESSED && marker !== PREFIX_PLAIN) {
    return null;
  }

  try {
    const raw = fromBase64Url(body);
    const bytes =
      marker === PREFIX_COMPRESSED
        ? await through(raw, new DecompressionStream("deflate-raw"))
        : raw;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const { p: program, w: world } = parsed as { p?: unknown; w?: unknown };
    if (typeof program !== "string") {
      return null;
    }
    const validated = validateKarelMap(world);
    if (!validated.ok || !validated.map) {
      return null;
    }
    return { program, world: validated.map };
  } catch {
    return null;
  }
}

/** The full address to hand someone, for the current page. */
export async function shareUrl(state: SharedState): Promise<string> {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${await encodeState(state)}`;
}
