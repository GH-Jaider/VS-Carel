/**
 * "Send my level to the repository", with no backend and nobody to sign in to.
 *
 * The whole mechanism is a link. The page turns the level a visitor has built
 * into the exact JSON file it would live in, wraps it in an issue body and
 * hands GitHub a pre-filled `issues/new` URL; the visitor presses submit and a
 * maintainer — or a workflow reading the fenced block — drops the file into
 * `apps/web/levels/`. That only works because a level *is* one file, which is
 * why levels.ts loads a folder instead of exporting an array.
 *
 * The one hard constraint is length. Browsers are not the binding limit any
 * more (Chrome will carry megabytes), but the machinery in between is: 8 KiB
 * is the classic request-line budget — nginx's `large_client_header_buffers`
 * and Apache's `LimitRequestLine` both sit at roughly 8190 — and GitHub
 * answers an over-long `issues/new` with a 414 rather than opening the form.
 * A 100 by 100 world with every wall set is nearly a megabyte of JSON, so
 * "the level does not fit in a URL" is a case that genuinely happens rather
 * than a theoretical one. `contributionUrl` therefore always returns a URL
 * that is safe to open: when the body fits it carries the level, and when it
 * does not the same body arrives with an empty JSON fence for the contributor
 * to paste into, and `tooLong` tells the chrome to offer the clipboard.
 *
 * Percent-encoding is done with `encodeURIComponent` and nothing cleverer.
 * Encoding a space as `+` would shave roughly a fifth off the payload and let
 * a few more levels through, but it is only correct if the far end decodes
 * the query as a form; a body that arrives with `+` where its spaces were is
 * a corrupted contribution, and one more level through the URL is not worth
 * that bet.
 *
 * Nothing here touches the clipboard or the DOM: the chrome already owns a
 * `copyText` helper with the fallbacks that matter, and a second one here
 * would be a second thing to keep working.
 */

import type { KarelMap } from "@karel/core";
import {
  DEFAULT_ORDER,
  validateLevel,
  type Difficulty,
  type Level,
  type LevelValidation,
  type LocalisedText,
} from "./levels.js";
import { currentLocale, type Locale } from "./i18n.js";

export const REPO = "GH-Jaider/karel";
export const ISSUE_LABEL = "level";
export const LEVELS_DIRECTORY = "apps/web/levels";

/**
 * The longest URL worth handing to a browser. See the note above: this is a
 * limit on the servers in between, not on the browser.
 */
export const MAX_URL_LENGTH = 8000;

// ── Formatting the file ───────────────────────────────────────────────────

/**
 * How wide a line of the emitted JSON may get before it breaks.
 *
 * Under the repository's Prettier width of 100, so a level file that is later
 * swept by `prettier --write` comes back looking the way it was published.
 */
const PRINT_WIDTH = 92;

/** One line, with the spacing a human would use: `{ "x": 1, "y": 2 }`. */
function inline(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.map(inline).join(", ")}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    return "{}";
  }
  return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }`;
}

/**
 * JSON that a person can read.
 *
 * `JSON.stringify(value, null, 2)` puts every `x` and every `y` on its own
 * line, which turns a small maze into three hundred lines and — because a
 * newline and a space each cost three characters once percent-encoded —
 * roughly triples what the URL has to carry. Keeping anything that fits on
 * one line on one line costs a dozen lines of code and halves the payload,
 * while producing exactly the shape these files are written in by hand:
 * a wall per line, a pile per line.
 */
function write(value: unknown, indent: string, prefix: number): string {
  const compact = inline(value);
  if (
    typeof value !== "object" ||
    value === null ||
    indent.length + prefix + compact.length <= PRINT_WIDTH
  ) {
    return compact;
  }

  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => inner + write(item, inner, 0)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  const lines = entries.map(([key, v]) => {
    const name = JSON.stringify(key);
    return `${inner}${name}: ${write(v, inner, name.length + 2)}`;
  });
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/**
 * The level as a plain object in the order a level file is written.
 *
 * Fixed here rather than left to whatever order the fields happened to be
 * assigned in, so two files describing the same level are the same text and a
 * review diff shows what actually changed. `order` is dropped when it is the
 * default, since a contributor with no opinion about placement should not have
 * to express one.
 */
export function levelFileObject(level: Level): Record<string, unknown> {
  const file: Record<string, unknown> = {
    id: level.id,
    difficulty: level.difficulty,
  };
  if (level.order !== DEFAULT_ORDER) {
    file.order = level.order;
  }
  file.author = level.author;
  file.title = level.title;
  file.brief = level.brief;
  if (level.ignoreFacing) {
    file.ignoreFacing = true;
  }
  file.world = level.world;
  file.goal = level.goal;
  if (level.program !== undefined) {
    file.program = level.program;
  }
  file.solution = level.solution;
  return file;
}

/** The exact text of `apps/web/levels/<id>.json`, newline-terminated. */
export function formatLevelJson(level: Level): string {
  return `${write(levelFileObject(level), "", 0)}\n`;
}

// ── Building a level from what the visitor made ───────────────────────────

/** What the "upload your own" form collects. */
export interface LevelDraft {
  /** Left out, or empty, and it is derived from the title. */
  id?: string;
  difficulty: Difficulty;
  author: string;
  title: string;
  brief: string;
  ignoreFacing?: boolean;
  world: KarelMap;
  goal: KarelMap;
  solution: string;
  /** Which language the title and brief were typed in. Defaults to the page's. */
  textLocale?: Locale;
}

/** "The Long Way Round!" → "the-long-way-round". */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * Text under the language it was actually written in.
 *
 * English is required by the schema and the fallback for every other locale,
 * so a Spanish title has to be copied into `en` as well — otherwise the level
 * cannot load at all. The copy is flagged in the issue body rather than left
 * to be discovered, so a reviewer knows the English is a placeholder and not
 * a translation.
 */
function draftText(text: string, locale: Locale): LocalisedText {
  const value = text.trim();
  return locale === "en" ? { en: value } : { en: value, [locale]: value };
}

/**
 * Assemble a draft into a level, running it through the same validation the
 * loader uses. The chrome should show `errors` rather than build a URL: an
 * issue carrying a level that will not load wastes the contributor's time and
 * the maintainer's.
 */
export function buildLevel(draft: LevelDraft): LevelValidation {
  const locale = draft.textLocale ?? currentLocale();
  const id = (draft.id ?? "").trim() || slugify(draft.title);
  const file: Record<string, unknown> = {
    id,
    difficulty: draft.difficulty,
    order: DEFAULT_ORDER,
    author: draft.author.trim(),
    title: draftText(draft.title, locale),
    brief: draftText(draft.brief, locale),
    world: draft.world,
    goal: draft.goal,
    solution: draft.solution,
  };
  if (draft.ignoreFacing) {
    file.ignoreFacing = true;
  }
  return validateLevel(file);
}

// ── The issue ─────────────────────────────────────────────────────────────

/**
 * The issue body.
 *
 * The headings are the ones GitHub renders for the fields in
 * `.github/ISSUE_TEMPLATE/level.yml`, and the JSON sits in a fenced block
 * exactly as that form's `render: json` textarea would produce. That is the
 * point of matching them: a level sent from this page and a level typed into
 * the form by hand arrive in the same shape, so one reader — a maintainer's
 * eyes today, a workflow tomorrow — handles both.
 */
function issueBody(level: Level, json: string | null): string {
  // Was anything actually translated, or is every locale the same string the
  // page copied into `en`? Asked of the object rather than of one named
  // language, so adding a locale to the app does not make this lie.
  const translated = Object.entries(level.title).some(
    ([locale, text]) => locale !== "en" && text !== level.title.en
  );
  return [
    "### Level id",
    "",
    level.id,
    "",
    "### Author",
    "",
    level.author,
    "",
    "### Difficulty",
    "",
    level.difficulty,
    "",
    "### Level JSON",
    "",
    "```json",
    json ?? "<!-- paste the level JSON here: the page put it on your clipboard -->",
    "```",
    "",
    "### Notes",
    "",
    `Save this as \`${LEVELS_DIRECTORY}/${level.id}.json\`.`,
    translated
      ? ""
      : "The English text is a copy of what was typed on the page and still needs translating.",
    "",
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

function issueTitle(level: Level): string {
  return `level: ${level.title.en} (${level.id})`;
}

function issueUrl(title: string, body: string): string {
  const query = [
    `title=${encodeURIComponent(title)}`,
    `body=${encodeURIComponent(body)}`,
    `labels=${encodeURIComponent(ISSUE_LABEL)}`,
  ].join("&");
  return `https://github.com/${REPO}/issues/new?${query}`;
}

export interface Contribution {
  /** The file text: what goes in `apps/web/levels/<id>.json`, and on the clipboard. */
  json: string;
  /** The issue body the URL carries, or the paste-it-here body when it did not fit. */
  body: string;
  /** Always safe to open. */
  url: string;
  /**
   * The level did not fit. `url` opens the same issue with an empty JSON
   * fence, so the chrome should put `json` on the clipboard and say so.
   */
  tooLong: boolean;
  /** What the URL carrying the whole level would have measured, for the message. */
  length: number;
  /** The longest URL this would have sent, for the same message. */
  limit: number;
}

/**
 * A pre-filled GitHub issue for `level`.
 *
 * Never throws and never returns a URL that cannot be opened: an over-long
 * level degrades to the same issue with the JSON left out rather than to no
 * link at all, because a contributor who has just built a maze should not be
 * told that their maze is the wrong shape for a query string.
 */
export function contributionUrl(level: Level): Contribution {
  const json = formatLevelJson(level);
  const body = issueBody(level, json.trimEnd());
  const title = issueTitle(level);

  const full = issueUrl(title, body);
  if (full.length <= MAX_URL_LENGTH) {
    return { json, body, url: full, tooLong: false, length: full.length, limit: MAX_URL_LENGTH };
  }

  const stub = issueBody(level, null);
  return {
    json,
    body: stub,
    url: issueUrl(title, stub),
    tooLong: true,
    length: full.length,
    limit: MAX_URL_LENGTH,
  };
}
