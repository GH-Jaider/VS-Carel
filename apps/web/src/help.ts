/**
 * The manual, as data.
 *
 * Someone arrives on a shared link, has never heard of Karel, and presses "?".
 * What they get has to be enough to write a first program without leaving the
 * page — which means the dialog is a small reference book, not a sentence.
 *
 * It is written as typed sections rather than as one long HTML string for the
 * usual reason a template is a bad place to keep facts: the eighteen
 * conditions and the five instructions are *language*, they live in the core,
 * and a string literal cannot be checked against them. Here they are arrays,
 * `DOCUMENTED_CONDITIONS` and `DOCUMENTED_INSTRUCTIONS` expose them as sets,
 * and tests/help.test.ts fails the build if either drifts from
 * `VALID_CONDITIONS` / `BUILT_IN_INSTRUCTIONS`.
 *
 * The order, on the other hand, is deliberately hand-written. A Set has no
 * order, and the order is most of the teaching: `front-is-clear` before
 * `facing-north`, the pair before the family, the family before the list.
 *
 * Code samples are coloured by `tokenizeLine`, the same function that paints
 * the editor, which is itself driven by the core lexer. A snippet in the help
 * therefore cannot be highlighted differently from the same text typed into
 * the program column, and there is no second keyword table anywhere.
 */

import { BUILT_IN_INSTRUCTIONS } from "@karel/core";
import { tokenizeLine } from "./editor/language.js";

// ── The shape of the manual ───────────────────────────────────────────────

/** A name and the one line that explains it. Rendered as a two-column table. */
export interface HelpTerm {
  name: string;
  gloss: string;
}

/**
 * Conditions, grouped by the question they answer.
 *
 * Eighteen names in a flat list is a wall of text that gets skipped. The same
 * eighteen in four groups is four ideas, each with an obvious shape: ahead,
 * sideways, beepers, bearing. Every group is a set of pairs, and saying so
 * once is what stops it reading as eighteen unrelated words.
 */
export interface HelpFamily {
  question: string;
  gloss: string;
  names: string[];
}

/** A shortcut. `MOD_KEY` in `keys` is replaced with this platform's modifier. */
export interface HelpKey {
  keys: string[];
  action: string;
}

export type HelpBlock =
  | { kind: "prose"; text: string }
  /** A sub-heading inside a section, for the one case a section has two halves. */
  | { kind: "lead"; text: string }
  | { kind: "code"; source: string; caption?: string }
  | { kind: "terms"; head?: [string, string]; rows: HelpTerm[] }
  | { kind: "families"; families: HelpFamily[] }
  | { kind: "keys"; rows: HelpKey[] };

export interface HelpSection {
  /** Anchor id, and what the index button scrolls to. */
  id: string;
  /** The word in the index. One word wherever possible. */
  tab: string;
  title: string;
  blocks: HelpBlock[];
}

/** Stands in for ⌘ or ctrl until the page knows which platform it is on. */
export const MOD_KEY = "MOD";

// ── The five instructions ─────────────────────────────────────────────────

/**
 * Taught in the order they are needed: the two that move him, the two that
 * touch beepers, and the one that ends the program.
 */
const INSTRUCTIONS: HelpTerm[] = [
  {
    name: "move",
    gloss: "One square forward, the way he is facing. A wall in the way is an error, not a bump.",
  },
  {
    name: "turnleft",
    gloss: "A quarter turn anticlockwise, on the spot. The only turn the language has.",
  },
  {
    name: "pickbeeper",
    gloss: "Take one beeper from the square he stands on and put it in the bag.",
  },
  {
    name: "putbeeper",
    gloss: "Drop one beeper from the bag onto the square he stands on.",
  },
  {
    name: "turnoff",
    gloss: "Stop the program. Nothing written after it runs.",
  },
];

// ── The eighteen conditions ───────────────────────────────────────────────

const CONDITION_FAMILIES: HelpFamily[] = [
  {
    question: "what is straight ahead",
    gloss:
      "Whether the square in front of Karel can be stepped into. A wall blocks it, and so does " +
      "the edge of the world.",
    names: ["front-is-clear", "front-is-blocked"],
  },
  {
    question: "what is to the sides",
    gloss:
      "The same question about his left and his right, asked without turning to look. There is " +
      "no condition for what is behind him.",
    names: ["left-is-clear", "left-is-blocked", "right-is-clear", "right-is-blocked"],
  },
  {
    question: "where the beepers are",
    gloss:
      "One pair asks about the square he is standing on, the other about the bag he is carrying. " +
      "Both are worth checking before `pickbeeper` or `putbeeper`, which fail on an empty square " +
      "and an empty bag.",
    names: ["next-to-a-beeper", "not-next-to-a-beeper", "beeper-in-bag", "no-beeper-in-bag"],
  },
  {
    question: "which way he is facing",
    gloss:
      "North is up the screen and east is to the right, the same bearing the facing readout " +
      "shows under the world.",
    names: [
      "facing-north",
      "not-facing-north",
      "facing-south",
      "not-facing-south",
      "facing-east",
      "not-facing-east",
      "facing-west",
      "not-facing-west",
    ],
  },
];

/**
 * What the manual claims the language has. Exported so a test can hold it
 * against the core's own sets: the lists above are hand-ordered for teaching,
 * which means nothing else can keep them honest.
 */
export const DOCUMENTED_CONDITIONS: string[] = CONDITION_FAMILIES.flatMap((family) => family.names);

export const DOCUMENTED_INSTRUCTIONS: string[] = INSTRUCTIONS.map((term) => term.name);

// ── The sections ──────────────────────────────────────────────────────────

/**
 * Ordered so that each section only uses what the ones above it introduced.
 * The world comes late on purpose: coordinates matter when you start reading
 * the readout, not when you are still working out what `move` does.
 */
export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "help-karel",
    tab: "karel",
    title: "a robot on a grid",
    blocks: [
      {
        kind: "prose",
        text:
          "Karel is a robot standing on a grid of squares. He walks forward one square at a " +
          "time, turns left, and picks up or puts down the markers called beepers. Five " +
          "instructions, and nothing else.",
      },
      {
        kind: "prose",
        text:
          "Everything interesting is what you build out of those five. You write the program in " +
          "the left column, press `run`, and the world on the right shows you exactly what you " +
          "asked for, which is usually not what you meant.",
      },
    ],
  },
  {
    id: "help-program",
    tab: "program",
    title: "the shape of a program",
    blocks: [
      {
        kind: "prose",
        text:
          "Every program has the same frame. Instructions you define go between " +
          "`BEGINNING-OF-PROGRAM` and `BEGINNING-OF-EXECUTION`; the ones Karel actually runs go " +
          "inside the execution block.",
      },
      {
        kind: "code",
        source: [
          "BEGINNING-OF-PROGRAM",
          "    // instructions you define go here",
          "",
          "    BEGINNING-OF-EXECUTION",
          "        // and the program goes here",
          "    END-OF-EXECUTION",
          "END-OF-PROGRAM",
        ].join("\n"),
      },
      {
        kind: "prose",
        text:
          "Semicolons separate instructions rather than ending them, so the last one in a block " +
          "does not need one. Keywords are case-insensitive, and `//` comments run to the end of " +
          "the line.",
      },
      {
        kind: "code",
        caption: "the smallest program that does anything: paste it in and press run",
        source: [
          "BEGINNING-OF-PROGRAM",
          "    BEGINNING-OF-EXECUTION",
          "        move;",
          "        move;",
          "        turnoff",
          "    END-OF-EXECUTION",
          "END-OF-PROGRAM",
        ].join("\n"),
      },
      {
        kind: "prose",
        text:
          "`turnoff` is how a program ends on purpose. Leave it out and the program still stops " +
          "at the end of the block, but the problems panel will say you forgot.",
      },
    ],
  },
  {
    id: "help-instructions",
    tab: "moves",
    title: "the five instructions",
    blocks: [
      { kind: "terms", head: ["instruction", "what it does"], rows: INSTRUCTIONS },
      {
        kind: "prose",
        text:
          "Four of the five can fail: walking into a wall, picking up a beeper that is not " +
          "there, putting down one you do not have. A failure stops the program and points at " +
          "the line, which is why the conditions below exist.",
      },
    ],
  },
  {
    id: "help-control",
    tab: "control",
    title: "asking and repeating",
    blocks: [
      {
        kind: "prose",
        text:
          "Three structures. Each takes either a `BEGIN … END` block or a single instruction as " +
          "its body, so short ones need no block at all.",
      },
      {
        kind: "code",
        caption: "IF: do it only when the world says so. ELSE is optional.",
        source: ["IF front-is-clear THEN", "    move", "ELSE", "    turnleft"].join("\n"),
      },
      {
        kind: "code",
        caption: "WHILE: keep going while the answer stays yes",
        source: ["WHILE front-is-clear DO", "BEGIN", "    move", "END"].join("\n"),
      },
      {
        kind: "code",
        caption: "ITERATE: a fixed number of times",
        source: ["ITERATE 3 TIMES", "BEGIN", "    move;", "    turnleft", "END"].join("\n"),
      },
      {
        kind: "prose",
        text:
          "There are no variables, no arithmetic and no counters. `ITERATE` takes a literal " +
          "number and everything else is decided by asking the world a question.",
      },
    ],
  },
  {
    id: "help-conditions",
    tab: "conditions",
    title: "the eighteen conditions",
    blocks: [
      {
        kind: "prose",
        text:
          "A condition is a question about where Karel is standing right now. There are " +
          "eighteen, but really nine: every one ships with its opposite, so a program never " +
          "needs a NOT.",
      },
      { kind: "families", families: CONDITION_FAMILIES },
    ],
  },
  {
    id: "help-define",
    tab: "define",
    title: "teaching him a new word",
    blocks: [
      {
        kind: "prose",
        text:
          "There is no `turnright`. That is the point: three left turns make a right one, and " +
          "writing it down is the first program almost everyone writes.",
      },
      {
        kind: "code",
        source: [
          "DEFINE-NEW-INSTRUCTION turnright AS",
          "BEGIN",
          "    turnleft;",
          "    turnleft;",
          "    turnleft",
          "END",
        ].join("\n"),
      },
      {
        kind: "prose",
        text:
          "From then on `turnright` is used exactly like a built-in, and the editor colours it " +
          "differently so you can see which words are yours. Definitions may call each other in " +
          "any order, and may call themselves.",
      },
    ],
  },
  {
    id: "help-world",
    tab: "world",
    title: "how the world is built",
    blocks: [
      {
        kind: "terms",
        rows: [
          {
            name: "squares",
            gloss:
              "Karel always stands on a square, never between two. Coordinates are 1-based and " +
              "(1, 1) is the bottom-left: x counts right, y counts up.",
          },
          {
            name: "walls",
            gloss:
              "A wall sits on the edge between two squares rather than on a square, and blocks " +
              "movement in both directions.",
          },
          {
            name: "the border",
            gloss:
              "The rim of the world is always walled. Karel cannot walk out of it and no map " +
              "editor can remove it.",
          },
          {
            name: "beepers",
            gloss:
              "Beepers stack. A square holds any number of them and the canvas prints the " +
              "count; the bag Karel carries is counted separately, under the world.",
          },
        ],
      },
      {
        kind: "prose",
        text:
          "Turn on `coordinates` under the world to see the numbers on the axes. `edit map` " +
          "hands you the grid itself: walls, beepers and where Karel starts. Anything you build " +
          "can be exported as a `.klm` file, and dropping a `.klm` or a `.kli` back onto the " +
          "page loads it.",
      },
    ],
  },
  {
    id: "help-keys",
    tab: "keys",
    title: "keys and gestures",
    blocks: [
      {
        kind: "keys",
        rows: [
          { keys: [MOD_KEY, "enter"], action: "run the program, or restart it" },
          { keys: [MOD_KEY, "."], action: "one instruction, then wait" },
          { keys: ["esc"], action: "stop, and close this dialog" },
          { keys: ["r"], action: "put the world back as it started" },
          { keys: ["e"], action: "open or close the map editor" },
          { keys: ["1", "4"], action: "switch between the built-in worlds" },
          { keys: ["?"], action: "this dialog" },
        ],
      },
      {
        kind: "prose",
        text:
          "The two chords work while you are typing; the single keys only work when the editor " +
          "does not have focus, so that `r` can still be an `r`.",
      },
      { kind: "lead", text: "with the pointer, in the map editor" },
      {
        kind: "terms",
        rows: [
          {
            name: "click an edge",
            gloss: "Put a wall between two squares, or click it again to take it away.",
          },
          {
            name: "click a square",
            gloss:
              "With the beeper tool, adds one; alt-click or right-click takes one back. With " +
              "the karel tool, sets him down there.",
          },
          { name: "r", gloss: "Turns Karel left, which is the only way to aim him." },
          {
            name: "share",
            gloss: "Copies a link carrying this exact program and this exact world.",
          },
        ],
      },
    ],
  },
];

// ── Rendering ─────────────────────────────────────────────────────────────

/**
 * The modifier this platform spells its chords with.
 *
 * main.ts writes the same word into the footer's `[data-mod]` markers once, at
 * startup, before the application exists — which is no use to nodes this
 * module creates afterwards. One `navigator.platform` test in each place is a
 * cheaper duplication than a shared module for a ternary.
 */
function modifier(): string {
  return navigator.platform.startsWith("Mac") ? "⌘" : "ctrl";
}

/**
 * Prose with `backticks` around anything that is language rather than English.
 *
 * The alternative is HTML in the data, which would mean every sentence above
 * had to be trusted markup. This keeps the content strings text, escaped by
 * `textContent` like everything else here.
 */
function richText(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  // Split on the delimiters, so odd indices are exactly the spans inside them.
  for (const [index, part] of text.split("`").entries()) {
    if (!part) {
      continue;
    }
    if (index % 2 === 0) {
      fragment.append(part);
      continue;
    }
    const code = document.createElement("code");
    code.textContent = part;
    fragment.append(code);
  }
  return fragment;
}

/**
 * Colour a snippet with the editor's own tokenizer.
 *
 * The classes are the `cm-karel-*` ones the stylesheet already defines for the
 * program column, so a sample here and the same text typed in there are
 * literally the same colours, forever, without a rule being written twice.
 */
/**
 * Karel source as coloured nodes, painted by the editor's own tokenizer.
 *
 * Exported because the lesson column in main.ts shows the same kind of sample
 * the manual does, and a second highlighter would be a second keyword table to
 * keep in step with the lexer.
 */
export function highlight(source: string): HTMLElement {
  const code = document.createElement("code");

  for (const [index, line] of source.split("\n").entries()) {
    if (index > 0) {
      code.append("\n");
    }
    // The comment token is appended after the code tokens rather than in
    // position, so the run below has to walk the line in column order.
    const tokens = [...tokenizeLine(line)].sort((a, b) => a.from - b.from);
    let cursor = 0;
    for (const token of tokens) {
      if (token.from > cursor) {
        code.append(line.slice(cursor, token.from));
      }
      const span = document.createElement("span");
      span.className = token.className;
      span.textContent = line.slice(token.from, token.to);
      code.append(span);
      cursor = token.to;
    }
    code.append(line.slice(cursor));
  }

  return code;
}

function renderCode(block: Extract<HelpBlock, { kind: "code" }>): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "help-figure";

  // The caption goes first: it says what the sample is for, which is only
  // useful before the sample rather than after it.
  if (block.caption) {
    const caption = document.createElement("figcaption");
    caption.append(richText(block.caption));
    figure.append(caption);
  }

  const pre = document.createElement("pre");
  pre.className = "help-code";
  pre.append(highlight(block.source));
  figure.append(pre);
  return figure;
}

function renderTerms(block: Extract<HelpBlock, { kind: "terms" }>): HTMLElement {
  const table = document.createElement("table");
  table.className = "help-table";

  if (block.head) {
    const head = document.createElement("thead");
    const row = document.createElement("tr");
    for (const label of block.head) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      row.append(cell);
    }
    head.append(row);
    table.append(head);
  }

  const body = document.createElement("tbody");
  for (const term of block.rows) {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    // Only a word the language knows is set as code, and it is set in the
    // green the editor gives Karel's own vocabulary. "walls" and "click an
    // edge" are English; dressing them as code would teach a word that is not
    // one, and a colour that means something else.
    const known = BUILT_IN_INSTRUCTIONS.has(term.name);
    const label = document.createElement(known ? "code" : "span");
    if (known) {
      label.className = "cm-karel-builtin";
    }
    label.textContent = term.name;
    name.append(label);
    const gloss = document.createElement("td");
    gloss.append(richText(term.gloss));
    row.append(name, gloss);
    body.append(row);
  }
  table.append(body);
  return table;
}

function renderFamilies(block: Extract<HelpBlock, { kind: "families" }>): HTMLElement {
  const list = document.createElement("div");
  list.className = "help-families";

  for (const family of block.families) {
    const group = document.createElement("section");
    group.className = "help-family";

    const heading = document.createElement("h4");
    heading.textContent = family.question;

    const gloss = document.createElement("p");
    gloss.append(richText(family.gloss));

    const names = document.createElement("ul");
    names.className = "help-chips";
    for (const name of family.names) {
      const item = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = name;
      item.append(code);
      names.append(item);
    }

    group.append(heading, gloss, names);
    list.append(group);
  }
  return list;
}

function renderKeys(block: Extract<HelpBlock, { kind: "keys" }>): HTMLElement {
  const list = document.createElement("dl");
  list.className = "help-keys";
  const mod = modifier();

  for (const row of block.rows) {
    const term = document.createElement("dt");
    for (const [index, key] of row.keys.entries()) {
      if (index > 0) {
        const join = document.createElement("span");
        join.className = "help-key-join";
        // A range of worlds rather than a chord: 1 through 4, not 1 and 4.
        join.textContent = row.keys.length === 2 && /^\d$/.test(key) ? "–" : "+";
        term.append(join);
      }
      const cap = document.createElement("span");
      cap.className = "key-cap";
      cap.textContent = key === MOD_KEY ? mod : key;
      term.append(cap);
    }

    const action = document.createElement("dd");
    action.append(richText(row.action));
    list.append(term, action);
  }
  return list;
}

function renderBlock(block: HelpBlock): HTMLElement {
  switch (block.kind) {
    case "prose": {
      const paragraph = document.createElement("p");
      paragraph.append(richText(block.text));
      return paragraph;
    }
    case "lead": {
      const heading = document.createElement("h4");
      heading.className = "help-lead";
      heading.textContent = block.text;
      return heading;
    }
    case "code":
      return renderCode(block);
    case "terms":
      return renderTerms(block);
    case "families":
      return renderFamilies(block);
    case "keys":
      return renderKeys(block);
  }
}

/** What the dialog needs to know about the exercise on screen. */
export interface HelpBrief {
  label: string;
  brief: string;
}

/**
 * Everything a mounted help document needs to be updated in place.
 *
 * The manual is fixed and the brief is not, so the two are separated: the
 * document is built once and only the brief's text is written again.
 */
interface Mounted {
  label: HTMLElement;
  brief: HTMLElement;
}

/**
 * The documents already built, keyed by the element they were built into.
 *
 * main.ts calls this from render(), which runs on every executed instruction.
 * Rebuilding a few hundred nodes per step would be absurd, and re-rendering
 * would also throw away the reader's scroll position mid-sentence if a program
 * happened to be running behind the dialog.
 */
const MOUNTED = new WeakMap<HTMLElement, Mounted>();

/**
 * Fill `host` with the manual, and put `exercise`'s brief at the top of it.
 *
 * Safe to call on every frame: the second call onwards only touches the two
 * nodes that can actually have changed.
 */
export function renderHelp(host: HTMLElement, exercise: HelpBrief): void {
  const mounted = MOUNTED.get(host) ?? mount(host);
  mounted.label.textContent = exercise.label;
  mounted.brief.textContent = exercise.brief;
}

function mount(host: HTMLElement): Mounted {
  const index = document.createElement("nav");
  index.className = "help-index";
  index.setAttribute("aria-label", "Contents");

  // The document scrolls, not the dialog: that keeps the index beside it fixed
  // without a sticky element painting over the text sliding underneath.
  const doc = document.createElement("div");
  doc.className = "help-doc";
  doc.tabIndex = 0;
  doc.setAttribute("role", "region");
  doc.setAttribute("aria-label", "The Karel manual");

  // The exercise on screen, first and framed: whatever the manual explains,
  // the thing the reader is looking at is what they came to ask about.
  const briefBox = document.createElement("section");
  briefBox.className = "help-brief";
  const briefTitle = document.createElement("span");
  briefTitle.className = "box-title";
  briefTitle.textContent = "this world";
  const briefLabel = document.createElement("span");
  briefLabel.className = "box-note";
  const briefText = document.createElement("p");
  briefBox.append(briefTitle, briefLabel, briefText);
  doc.append(briefBox);

  const sections: HTMLElement[] = [];
  const tabs: HTMLButtonElement[] = [];

  for (const section of HELP_SECTIONS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "help-tab";
    tab.textContent = section.tab;
    tab.setAttribute("aria-selected", "false");
    tab.addEventListener("click", () => {
      document.getElementById(section.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    index.append(tab);
    tabs.push(tab);

    const element = document.createElement("section");
    element.className = "help-section";
    element.id = section.id;

    const heading = document.createElement("h3");
    heading.textContent = section.title;
    element.append(heading);

    for (const block of section.blocks) {
      element.append(renderBlock(block));
    }
    doc.append(element);
    sections.push(element);
  }

  host.replaceChildren(index, doc);
  trackReading(doc, sections, tabs);

  const mounted: Mounted = { label: briefLabel, brief: briefText };
  MOUNTED.set(host, mounted);
  return mounted;
}

/**
 * Keep the index pointing at whatever is being read.
 *
 * A long document with a static index is a document you get lost in; marking
 * the current section is the cheapest way to keep the reader placed. Measured
 * against the scroller's own top rather than the viewport's, because the
 * scroller is the dialog, not the page.
 */
function trackReading(
  scroller: HTMLElement,
  sections: HTMLElement[],
  tabs: HTMLButtonElement[]
): void {
  let queued = false;

  const mark = (): void => {
    queued = false;
    // A closed <dialog> is display:none, so everything below measures zero and
    // the end-of-document rule would fire on a document nobody is reading —
    // opening the dialog would show the index pointing at the last section
    // while the text sat at the top. Nothing is being read; say nothing.
    if (scroller.clientHeight === 0) {
      return;
    }
    // Measured with rectangles rather than offsetTop, which would depend on
    // which ancestor happens to be positioned — a stylesheet detail this has
    // no business being coupled to.
    const top = scroller.getBoundingClientRect().top;
    // The last section whose heading has passed the top edge, with a little
    // slack so a section that is one pixel short of it still counts.
    let active = 0;
    for (const [index, section] of sections.entries()) {
      if (section.getBoundingClientRect().top - top <= 24) {
        active = index;
      }
    }
    // The last section can never reach the top edge — there is nothing below
    // it to scroll up past — so the rule above would leave the index pointing
    // at the one before it however far down you go. At the end of a document
    // you are reading the end of it.
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
      active = sections.length - 1;
    }
    for (const [index, tab] of tabs.entries()) {
      tab.setAttribute("aria-selected", String(index === active));
    }
  };

  scroller.addEventListener("scroll", () => {
    if (queued) {
      return;
    }
    queued = true;
    requestAnimationFrame(mark);
  });

  // The first honest measurement is only possible once the dialog is open, and
  // opening it fires no event of its own — the `open` attribute appearing is
  // the signal there is.
  const dialog = scroller.closest("dialog");
  if (dialog) {
    new MutationObserver(() => {
      if (dialog.open) {
        requestAnimationFrame(mark);
      }
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  }

  mark();
}
