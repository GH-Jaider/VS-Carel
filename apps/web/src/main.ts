/**
 * The wiring.
 *
 * Every other module owns one thing and knows nothing about the rest: the
 * Session owns execution state, the renderer owns the canvas, the editor owns
 * the document, draft.ts owns what editing a world means, curriculum.ts owns
 * the book and levels.ts owns the collection. This file is the only place they
 * meet, and the only place that reaches into the DOM the page ships with.
 *
 * The shape is Collisions': one class holds the state, one render() projects
 * all of it onto the page, and every event handler mutates state and calls
 * render() rather than touching the DOM directly. It stays honest because
 * there is exactly one path from a change to what you see.
 *
 * ── The three modes ──────────────────────────────────────────────────────
 *
 * There is one active mode, named in the masthead, and it decides what the
 * bench is:
 *
 *   learn    the book. A lesson column, a chapter's world, a chapter's
 *            program, and a check that runs the moment the program finishes.
 *   levels   the collection. A gallery to choose from, the same solving
 *            workbench once one is open, and the form that turns a world you
 *            built into a pull-worthy issue on the repository.
 *   sandbox  the free world: the program, the map editor, files and the link.
 *            Everything this page could do before the modes existed.
 *
 * Two rules keep them from becoming three applications. The Session is still
 * the only owner of execution, whatever mode is on; and the world is only
 * editable where editing it means something — in sandbox, and while a level of
 * your own is being built. A chapter whose world can be edited is a chapter
 * that can be "solved" by moving the beepers by hand, and the whole point of
 * checking against `compareWorlds` is that passing here means passing at the
 * command line.
 *
 * ── The two edit modes, inside a mode ────────────────────────────────────
 *
 * In `run` the canvas is a readout of whatever the Session reports. In `edit`
 * the canvas is an instrument: the program is stopped, the transport is dead,
 * and every gesture goes through draft.ts and back in as the session's
 * starting map. A world being rewritten under a running interpreter is two
 * owners of one state, and that is the bug this file is arranged to prevent.
 */

import { MAX_WORLD_SIZE, validateKarelMap, type KarelMap, type Wall } from "@karel/core";
import { createEditor } from "./editor/editor.js";
import { createRenderer } from "./render/world.js";
import { highlight, renderHelp } from "./help.js";
import { THEMES, currentTheme, onThemeChange, restoreTheme, setTheme } from "./render/theme.js";
// The skin packs bring their own picker. All this file owes them is the two
// calls below, next to the theme's -- see the header of render/skins.ts.
import { mountSkinPicker, restoreSkin } from "./render/skins.js";
import { DEFAULT_SPEED_MS, SPEED_PRESETS, Session } from "./session.js";
import type {
  HitTarget,
  KarelEditor,
  SessionState,
  SessionView,
  WorldRenderer,
} from "./contracts.js";
import {
  LOCALES,
  applyStaticText,
  currentLocale,
  onLocaleChange,
  restoreLocale,
  setLocale,
  t,
  type MessageKey,
} from "./i18n.js";
import {
  changeBeepers,
  clearBeepers,
  clearWalls,
  placeKarel,
  resize,
  setBag,
  toggleWall,
  turnKarel,
} from "./draft.js";
import {
  canonicalWorld,
  createMapSourceEditor,
  parseMapSource,
  sameWorld,
  serializeWorld,
  type MapProblem,
  type MapSourceEditor,
} from "./mapsource.js";
import { decodeState, shareUrl, type SharedState } from "./share.js";
import {
  downloadProgram,
  downloadWorld,
  exerciseById,
  loadWorkspace,
  saveWorkspace,
  type Exercise,
} from "./worlds.js";
import {
  CHAPTERS,
  chapterById,
  chapterIndex,
  checkChapter,
  loadProgress,
  markSolved as markChapterSolved,
  nextChapter,
  programFor,
  saveProgress,
  type Chapter,
  type LearnProgress,
} from "./curriculum.js";
import {
  DIFFICULTIES,
  LEVELS,
  PROGRAM_SKELETON,
  checkLevel,
  levelBrief,
  levelById,
  levelGroups,
  levelTitle,
  loadSolved,
  markSolved as markLevelSolved,
  startingProgram,
  type Difficulty,
  type Level,
} from "./levels.js";
import { buildLevel, contributionUrl, formatLevelJson, type LevelDraft } from "./contribute.js";

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`the page is missing ${selector}`);
  }
  return element;
}

/** The three ways in. Exactly one is active, and it is in the masthead. */
type Mode = "learn" | "levels" | "sandbox";

/**
 * Which surface `levels` is showing. The other two modes are always on the
 * board; keeping one field rather than one per mode means "what is on screen"
 * is answered in one place.
 */
type Screen = "board" | "gallery" | "contribute";

/** What the canvas is right now: a readout, or an instrument. */
type EditMode = "run" | "edit";

type Tool = "wall" | "beeper" | "karel";

/**
 * One gesture with the pointer down, and what it has already done.
 *
 * Dragging paints, which means the same target arrives many times as the
 * pointer jitters inside it. A wall may only be toggled once per stroke or it
 * flickers on and off under a still hand; a beeper may only be added once per
 * corner, or crossing a square would drop a dozen.
 */
interface Stroke {
  pointerId: number;
  /** Right button, alt or shift: take away rather than add. */
  subtract: boolean;
  /** Boundaries already toggled in this stroke. */
  toggled: Set<string>;
  /** The last corner acted on, so re-entering it does nothing. */
  last: string | null;
}

/**
 * What a finished run was judged to be, in learn and in a level.
 *
 * `message` is `checkChapter`'s or `checkLevel`'s own sentence, already in the
 * language on screen — it names the first difference between the world the
 * program left and the world the task asked for, which is more use than any
 * wording this file could invent.
 */
interface Verdict {
  solved: boolean;
  message: string | null;
}

/**
 * A run captured for publication: the world it started in, the world it left,
 * and the program that got from one to the other.
 *
 * Capturing all three at once is the whole of the contribution design. A level
 * file needs a start, a goal and a reference solution, and taking them from
 * one run means the goal is reachable by construction — the contributor cannot
 * describe an impossible level, because they have just watched it happen.
 */
interface CapturedRun {
  world: KarelMap;
  goal: KarelMap;
  solution: string;
  steps: number;
}

/** Identifies a boundary for stroke bookkeeping. draft.ts owns the real rule. */
function edgeKey(wall: Wall): string {
  return [`${wall.from.x},${wall.from.y}`, `${wall.to.x},${wall.to.y}`].sort().join("|");
}

/**
 * Put `text` on the clipboard, reporting whether it got there.
 *
 * The async API is the right one and it is also the one that fails: it needs a
 * secure context, it needs the document focused, and a browser is free to
 * refuse. The old execCommand path still works where it does not, and the
 * caller has a third answer for when neither does — showing the text.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied, insecure context, or the document was not focused.
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

/** What each tool does, said once, where the tool is chosen. */
const TOOL_HINT: Record<Tool, MessageKey> = {
  wall: "palette.hintWall",
  beeper: "palette.hintBeeper",
  karel: "palette.hintKarel",
};

/**
 * The word for each speed, keyed on the interval rather than on the position
 * in SPEED_PRESETS: a preset inserted in the middle would otherwise silently
 * shift every label by one. A preset with no entry keeps its own label.
 */
const SPEED_LABEL: Record<number, MessageKey> = {
  1000: "speed.quarter",
  500: "speed.half",
  250: "speed.normal",
  120: "speed.double",
  50: "speed.quad",
};

const STATUS_LABEL: Record<SessionState, MessageKey> = {
  idle: "status.idle",
  running: "status.running",
  stepping: "status.stepping",
  done: "status.done",
  error: "status.error",
};

const FACING_LABEL: Record<KarelMap["karel"]["facing"], MessageKey> = {
  north: "facing.north",
  south: "facing.south",
  east: "facing.east",
  west: "facing.west",
};

/** The masthead's three buttons, in the order they are shown. */
const MODES: { id: Mode; label: MessageKey; title: MessageKey }[] = [
  { id: "learn", label: "mode.learn", title: "mode.learnTitle" },
  { id: "levels", label: "mode.levels", title: "mode.levelsTitle" },
  { id: "sandbox", label: "mode.sandbox", title: "mode.sandboxTitle" },
];

/** The bands levels.ts sorts by, worded. */
const DIFFICULTY_LABEL: Record<Difficulty, MessageKey> = {
  starter: "levels.difficulty.starter",
  tricky: "levels.difficulty.tricky",
  hard: "levels.difficulty.hard",
};

/**
 * Where "send your own level" starts: a small empty room.
 *
 * Deliberately not the sandbox's world. A contributor is designing an
 * exercise, and starting from someone else's walls and beepers means the first
 * thing they do is clear them.
 */
/** Which of the bundled exercises the sandbox opens on. */
const SANDBOX_EXERCISE = "sandbox";

const NEW_LEVEL_WORLD: KarelMap = {
  dimensions: { width: 8, height: 5 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [],
  walls: [],
};

// ── What the chrome remembers between visits ──────────────────────────────
//
// Kept apart from the three stores the modules already own -- the sandbox
// workspace in worlds.ts, the reader's progress in curriculum.ts, the solved
// levels in levels.ts -- because this is the chrome's own state and it has a
// different lifetime from all three. Clearing one must not clear the others.

const UI_KEY = "karel.ui";

interface StoredUi {
  mode: Mode;
  screen: Screen;
  /** The level that was open, or null. */
  levelId: string | null;
  /** What was typed, per level, so a level reopens where it was left. */
  levelPrograms: Record<string, string>;
  /** The world and the program of a level being built. */
  draftWorld: KarelMap | null;
  draftProgram: string | null;
}

function defaultUi(): StoredUi {
  return {
    // Learn is the door for someone who has never met Karel, and that is who
    // arrives on this page cold. Anyone who already knows changes it once and
    // the choice is remembered.
    mode: "learn",
    screen: "gallery",
    levelId: null,
    levelPrograms: {},
    draftWorld: null,
    draftProgram: null,
  };
}

function isMode(value: unknown): value is Mode {
  return value === "learn" || value === "levels" || value === "sandbox";
}

function isScreen(value: unknown): value is Screen {
  return value === "board" || value === "gallery" || value === "contribute";
}

/**
 * A world read back out of storage, or null.
 *
 * Put through the core's validator rather than trusted: what comes back is
 * whatever was in localStorage, which a visitor is free to edit and a previous
 * version of this page is free to have written differently.
 */
function readStoredWorld(value: unknown): KarelMap | null {
  if (!value) {
    return null;
  }
  const result = validateKarelMap(value);
  return result.ok && result.map ? result.map : null;
}

/**
 * Always a usable object, never null.
 *
 * Storage can throw outright rather than come back empty -- a private window,
 * or a browser set to block site data -- and none of this is worth failing a
 * page load for. Everything is re-derived on the way in, because what comes
 * back is a string somebody could have written by hand.
 */
function loadUi(): StoredUi {
  const fallback = defaultUi();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(UI_KEY);
  } catch {
    return fallback;
  }
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredUi>;
    const programs: Record<string, string> = {};
    if (parsed.levelPrograms && typeof parsed.levelPrograms === "object") {
      for (const [id, source] of Object.entries(parsed.levelPrograms)) {
        // A level that has since been renamed or withdrawn leaves a program
        // nothing can open; dropping it here keeps the store honest.
        if (typeof source === "string" && levelById(id)) {
          programs[id] = source;
        }
      }
    }
    return {
      mode: isMode(parsed.mode) ? parsed.mode : fallback.mode,
      screen: isScreen(parsed.screen) ? parsed.screen : fallback.screen,
      levelId:
        typeof parsed.levelId === "string" && levelById(parsed.levelId) ? parsed.levelId : null,
      levelPrograms: programs,
      draftWorld: readStoredWorld(parsed.draftWorld),
      draftProgram: typeof parsed.draftProgram === "string" ? parsed.draftProgram : null,
    };
  } catch {
    return fallback;
  }
}

function saveUi(ui: StoredUi): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // Out of quota, or storage denied. Everything still works for this visit.
  }
}

class Application {
  private readonly editor: KarelEditor;
  private readonly renderer: WorldRenderer;
  private session: Session;

  // ── Where we are ────────────────────────────────────────────────────────
  private mode: Mode;
  private screen: Screen;
  private editMode: EditMode = "run";

  // ── learn ───────────────────────────────────────────────────────────────
  private progress: LearnProgress;
  /** How many of the current chapter's hints have been asked for. */
  private hintsShown = 0;

  // ── levels ──────────────────────────────────────────────────────────────
  private level: Level | null;
  private solvedLevels: Set<string>;
  private levelPrograms: Record<string, string>;
  /** Set when the reference solution has been put in the editor. */
  private solutionShown = false;

  // ── sending a level ─────────────────────────────────────────────────────
  private draftWorld: KarelMap;
  private draftProgram: string;
  private captured: CapturedRun | null = null;
  /** The contribution panel, built once and updated in place ever after. */
  private contribution: ContributionPanel | null = null;
  private draftDifficulty: Difficulty = "starter";
  private draftFacing = true;
  /** What `buildLevel` refused. English only, and addressed to the author. */
  private contributionErrors: string[] = [];
  private contributionNote: { text: string; tone: "good" | "warn" } | null = null;
  /** The level file, shown when a link could not carry it or a copy failed. */
  private contributionFile: string | null = null;
  /** The issue URL, shown when the browser refused to open a tab for it. */
  private contributionLink: string | null = null;
  private contributionSent = false;

  // ── sandbox ─────────────────────────────────────────────────────────────
  private exercise: Exercise;
  /** Set when the world is no longer the exercise's: imported, or edited. */
  private customWorld: KarelMap | null = null;
  private sandboxProgram: string;

  // ── The finished run, judged ────────────────────────────────────────────
  private verdict: Verdict | null = null;
  /**
   * Whether the run on screen has already been judged.
   *
   * render() runs on every executed instruction and on every keystroke, and
   * the check is not free — it compares two whole worlds. It also has a side
   * effect, marking a chapter solved, which must happen exactly once.
   */
  private judged = false;

  private showAxes = true;
  private tool: Tool = "wall";
  /** The corner under the pointer, previewed while editing. */
  private cursor: { x: number; y: number } | null = null;
  /** The boundary the wall tool would toggle, previewed instead of a cell. */
  private edgeCursor: Wall | null = null;
  private stroke: Stroke | null = null;
  private noteTimer = 0;
  /** Built by buildToggles, and the only view toggle there is so far. */
  private axesToggle: HTMLButtonElement | null = null;

  /**
   * What the guide column is currently showing, as a string.
   *
   * The guide is prose and it is rebuilt from nothing, which is far too much
   * work to do on every executed instruction — and it would throw away the
   * reader's scroll position mid-sentence while a program ran behind it. The
   * signature names everything the guide draws; when it has not moved, neither
   * has the guide.
   */
  private guideKey = "";
  private galleryKey = "";

  /**
   * The world as a .klm file, editable, beside the canvas that draws it.
   *
   * `mapSourcePinned` says who is holding the pen. While it is set the text in
   * the panel is the visitor's own -- half-typed, or simply not written the
   * way the canvas writes it -- and nothing repaints it; see applyMapSource
   * for the whole of the rule that keeps the two from chasing each other.
   */
  private readonly mapSource: MapSourceEditor;
  private mapProblems: MapProblem[] = [];
  private mapSourcePinned = false;
  private fileNoteTimer = 0;

  private readonly dom = {
    canvas: query<HTMLCanvasElement>("#world-canvas"),
    bench: query("#bench"),
    modes: query("#modes"),
    guide: query("#guide"),
    guideTitle: query("#guide-title"),
    guideNote: query("#guide-note"),
    guideBody: query("#guide-body"),
    gallery: query("#gallery"),
    galleryNote: query("#gallery-note"),
    galleryBody: query("#gallery-body"),
    workshop: query(".workshop"),
    stage: query(".stage"),
    themes: query("#themes"),
    langs: query("#langs"),
    rate: query("#rate-options"),
    toggles: query("#toggles"),
    readout: query("#readout"),
    problems: query("#problems"),
    problemsNote: query("#problems-note"),
    programNote: query("#program-note"),
    worldNote: query("#world-note"),
    status: query("#status"),
    run: query<HTMLButtonElement>("#run"),
    runGlyph: query("#run-glyph"),
    runLabel: query("#run-label"),
    step: query<HTMLButtonElement>("#step"),
    reset: query<HTMLButtonElement>("#reset"),
    about: query<HTMLDialogElement>("#about"),
    aboutButton: query("#about-button"),
    aboutClose: query("#about-close"),

    modeToggle: query<HTMLButtonElement>("#mode-toggle"),
    hintEdit: query("#hint-edit"),
    palette: query("#palette"),
    paletteNote: query("#palette-note"),
    tools: query("#tools"),
    toolHint: query("#tool-hint"),
    width: query<HTMLInputElement>("#world-width"),
    height: query<HTMLInputElement>("#world-height"),
    bag: query<HTMLInputElement>("#karel-bag"),
    clearBeepers: query<HTMLButtonElement>("#clear-beepers"),
    clearWalls: query<HTMLButtonElement>("#clear-walls"),
    formatMap: query<HTMLButtonElement>("#format-map"),
    mapProblems: query("#map-problems"),
    mapProblemsNote: query("#map-problems-note"),
    files: query("#files"),
    openFile: query<HTMLButtonElement>("#open-file"),
    fileInput: query<HTMLInputElement>("#file-input"),
    saveProgram: query<HTMLButtonElement>("#save-program"),
    saveWorld: query<HTMLButtonElement>("#save-world"),
    fileNote: query("#file-note"),
    shareLink: query<HTMLButtonElement>("#share-link"),
    shareUrlField: query<HTMLInputElement>("#share-url"),
    aboutContent: query("#about-content"),
  };

  /**
   * `shared` is the state a link carried, already decoded. It wins over
   * localStorage outright: someone who opens a link is expecting what they
   * were sent, not the world they left open last week.
   *
   * A link opens the sandbox, always. What it carries is a program and a
   * world, which is exactly what the sandbox is; dropping a stranger into
   * chapter three with somebody else's program in the editor would be a worse
   * answer than any of the alternatives.
   */
  constructor(shared: SharedState | null) {
    const stored = loadWorkspace();
    const ui = shared ? { ...loadUi(), mode: "sandbox" as Mode } : loadUi();

    this.mode = ui.mode;
    this.screen = ui.screen;
    this.progress = loadProgress();
    this.solvedLevels = loadSolved();
    this.levelPrograms = ui.levelPrograms;
    this.level = ui.levelId ? (levelById(ui.levelId) ?? null) : null;
    if (!this.level && this.screen === "board") {
      // A level that has gone from the collection leaves the gallery as the
      // only honest place to be.
      this.screen = "gallery";
    }
    this.draftWorld = ui.draftWorld ?? NEW_LEVEL_WORLD;
    this.draftProgram = ui.draftProgram ?? PROGRAM_SKELETON;

    // The sandbox opens on the exercise of the same name: a world with a few
    // walls and a few piles, and a program that does something. An empty grid
    // and an empty file is the worst first screen for "play freely".
    this.exercise = exerciseById(stored?.exerciseId ?? SANDBOX_EXERCISE);
    this.customWorld = shared?.world ?? stored?.world ?? null;
    this.sandboxProgram = shared?.program ?? stored?.program ?? this.exercise.program;

    this.session = new Session(this.startingWorld(), {
      onChange: () => this.render(),
    });
    this.session.setSpeed(stored?.speedMs ?? DEFAULT_SPEED_MS);

    this.renderer = createRenderer(this.dom.canvas);
    this.editor = createEditor(query("#editor-host"), this.startingProgram());
    this.editor.onChange((source) => {
      this.session.setSource(source);
      this.rememberProgram(source);
      this.persist();
    });
    this.session.setSource(this.editor.getSource());

    // Opened on the world the session starts from, which is the only world the
    // map editor ever edits: the panel and the canvas are two views of one
    // value, never two values kept in step.
    this.mapSource = createMapSourceEditor(
      query("#map-source-host"),
      serializeWorld(this.session.startingMap())
    );
    this.mapSource.onChange((text) => this.applyMapSource(text));

    this.buildModes();
    this.buildThemes();
    this.buildLanguages();
    this.buildSpeeds();
    this.buildToggles();
    this.buildReadout();
    this.bindTransport();
    this.bindKeyboard();
    this.bindFileDrop();
    this.bindFiles();
    this.bindAbout();
    this.bindPalette();
    this.bindCanvas();

    onThemeChange(() => this.render());
    onLocaleChange(() => {
      // Four things have to move, and none of them may touch the program or
      // the world: the document's own text, the diagnostics (which the core
      // worded when the source was last parsed, so they are re-parsed rather
      // than left in the previous language), everything render() writes, and
      // the guide and gallery, whose prose is keyed on the locale so they
      // rebuild on the next render.
      applyStaticText();
      this.session.setSource(this.editor.getSource());
      this.render();
    });
    new ResizeObserver(() => {
      this.renderer.resize();
      this.render();
    }).observe(query("#viewport"));

    if (shared) {
      // The link has been taken in, so it becomes this browser's workspace and
      // the address goes back to being an address. Leaving the payload in the
      // bar would mean every later reload silently undid the visitor's edits.
      this.persist();
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    this.render();
  }

  // ── Where we are, derived ───────────────────────────────────────────────

  private chapter(): Chapter {
    return chapterById(this.progress.current);
  }

  /**
   * May the world be edited here?
   *
   * Only where editing it means something. A chapter or a level whose world
   * can be rearranged by hand is a chapter that can be passed without writing
   * a program, and the check would then certify nothing.
   */
  private canEditWorld(): boolean {
    return this.mode === "sandbox" || (this.mode === "levels" && this.screen === "contribute");
  }

  /** Is the workbench on screen at all? The gallery replaces it. */
  private onBoard(): boolean {
    return !(this.mode === "levels" && this.screen === "gallery");
  }

  /** Is a finished run judged against a goal here? */
  private isGraded(): boolean {
    return (
      this.mode === "learn" || (this.mode === "levels" && this.screen === "board" && !!this.level)
    );
  }

  /** The world this context starts from. */
  private startingWorld(): KarelMap {
    if (this.mode === "learn") {
      return this.chapter().world;
    }
    if (this.mode === "levels") {
      if (this.screen === "contribute") {
        return this.draftWorld;
      }
      if (this.level) {
        return this.level.world;
      }
      return this.draftWorld;
    }
    return this.customWorld ?? this.exercise.world;
  }

  /** The program the editor opens with in this context. */
  private startingProgram(): string {
    if (this.mode === "learn") {
      return programFor(this.chapter(), this.progress);
    }
    if (this.mode === "levels") {
      if (this.screen === "contribute") {
        return this.draftProgram;
      }
      if (this.level) {
        return this.levelPrograms[this.level.id] ?? startingProgram(this.level);
      }
      return this.draftProgram;
    }
    return this.sandboxProgram;
  }

  /** Where a keystroke in the editor goes to be remembered. */
  private rememberProgram(source: string): void {
    if (this.mode === "learn") {
      this.progress = { ...this.progress, programs: { ...this.progress.programs } };
      this.progress.programs[this.chapter().id] = source;
      saveProgress(this.progress);
      return;
    }
    if (this.mode === "levels") {
      if (this.screen === "contribute") {
        this.draftProgram = source;
      } else if (this.level) {
        this.levelPrograms[this.level.id] = source;
      }
      return;
    }
    this.sandboxProgram = source;
  }

  /** A name for whatever is on the bench: the filename, and the box note. */
  private contextId(): string {
    if (this.mode === "learn") {
      return this.chapter().id;
    }
    if (this.mode === "levels") {
      return this.screen === "contribute" ? "new-level" : (this.level?.id ?? "levels");
    }
    return this.exercise.id;
  }

  /** The same thing, worded, for the program box and the manual. */
  private contextLabel(): string {
    if (this.mode === "learn") {
      return this.chapter().title;
    }
    if (this.mode === "levels") {
      if (this.screen === "contribute") {
        return t("contribute.title");
      }
      if (this.level) {
        return levelTitle(this.level);
      }
      return t("levels.title");
    }
    return this.exercise.label;
  }

  /** One sentence about it, for the "how it works" dialog. */
  private contextBrief(): string {
    if (this.mode === "learn") {
      return this.chapter().task;
    }
    if (this.mode === "levels") {
      if (this.screen === "contribute") {
        return t("contribute.lead");
      }
      if (this.level) {
        return levelBrief(this.level);
      }
      return t("levels.lead", { count: LEVELS.length });
    }
    return this.exercise.brief;
  }

  // ── Chrome ──────────────────────────────────────────────────────────────

  private buildModes(): void {
    for (const [index, mode] of MODES.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel";
      button.dataset["mode"] = mode.id;
      // Two nodes rather than one string, because the name is translated and
      // the number is not; the sweep rewrites only the half that changes.
      const number = document.createElement("span");
      number.className = "index";
      number.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "channel-label";
      label.dataset["i18n"] = mode.label;
      label.textContent = t(mode.label);
      button.dataset["i18nTitle"] = mode.title;
      button.title = t(mode.title);
      button.append(number, label);
      button.addEventListener("click", () => this.setMode(mode.id));
      this.dom.modes.append(button);
    }
  }

  private buildThemes(): void {
    for (const theme of THEMES) {
      const button = document.createElement("button");
      button.type = "button";
      // The stylesheet draws each swatch from its own theme's fixed colours,
      // keyed on this attribute.
      button.className = "theme-swatch";
      button.dataset.theme = theme.id;
      // The palette's own name is not translated -- "charm" is what it is
      // called either way -- so only the sentence around it goes through the
      // catalogue, and the sweep re-words it on a language change.
      button.title = theme.label;
      button.dataset["i18nAria"] = "masthead.themeOption";
      button.setAttribute("aria-label", t("masthead.themeOption", { name: theme.label }));
      button.addEventListener("click", () => setTheme(theme.id));
      this.dom.themes.append(button);
    }
  }

  /**
   * The language picker, built like the theme swatches next to it: one small
   * button per choice, pressed state carried by aria-pressed so the
   * stylesheet and a screen reader read it from the same place.
   *
   * The label is the language's own endonym, never a translation of it: a
   * visitor looking for Spanish is looking for the word "Español".
   */
  private buildLanguages(): void {
    for (const entry of LOCALES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lang-option";
      button.dataset["locale"] = entry.id;
      button.textContent = entry.label;
      button.title = entry.name;
      button.setAttribute("aria-label", t("masthead.languageOption", { name: entry.name }));
      button.addEventListener("click", () => setLocale(entry.id));
      this.dom.langs.append(button);
    }
  }

  private buildSpeeds(): void {
    for (const preset of SPEED_PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rate-option";
      const key = SPEED_LABEL[preset.ms];
      if (key) {
        // Marked for the sweep rather than rewritten by render(): a speed's
        // label depends on nothing but the language.
        button.dataset["i18n"] = key;
      }
      button.textContent = key ? t(key) : preset.label;
      button.addEventListener("click", () => {
        this.session.setSpeed(preset.ms);
        this.persist();
        this.render();
      });
      this.dom.rate.append(button);
    }
  }

  private buildToggles(): void {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle";
    toggle.dataset["i18n"] = "toggle.coordinates";
    toggle.textContent = t("toggle.coordinates");
    toggle.addEventListener("click", () => {
      this.showAxes = !this.showAxes;
      this.render();
    });
    this.axesToggle = toggle;
    this.dom.toggles.append(toggle);
  }

  private buildReadout(): void {
    // Four readings, built once and updated in place. Rebuilding the nodes on
    // every step would throw away the flash animation that marks a change.
    for (const [key, label] of METRICS) {
      const panel = document.createElement("section");
      panel.className = "panel";
      panel.innerHTML =
        `<span class="panel-title" data-i18n="${label}"></span>` +
        `<div class="panel-body"><span class="metric-value" data-metric="${key}">—</span></div>`;
      panel.querySelector(".panel-title")!.textContent = t(label);
      this.dom.readout.append(panel);
    }
  }

  private bindTransport(): void {
    this.dom.run.addEventListener("click", () => {
      if (this.session.primaryAction() === "stop") {
        this.session.stop();
      } else {
        void this.session.run();
      }
    });
    this.dom.step.addEventListener("click", () => this.session.step());
    this.dom.reset.addEventListener("click", () => this.session.reset());
  }

  private bindKeyboard(): void {
    document.addEventListener("keydown", (event) => {
      // The editor owns every key while it has focus, apart from the two
      // chords below: a bare "r" has to insert an r, not restart the world.
      // The palette's number fields and the contribution form are typed into
      // the same way.
      const target = event.target as HTMLElement | null;
      const typing = target?.closest(".cm-editor, input, textarea") !== null;
      const chord = event.metaKey || event.ctrlKey;

      // The browser keeps F5, so run and step are chords rather than the
      // function keys the VS Code extension uses. Neither does anything while
      // the world is being edited: the transport is off in that mode, and a
      // shortcut that ignores the mode would be the one way back in.
      if (chord && event.key === "Enter") {
        event.preventDefault();
        if (this.editMode === "run" && this.onBoard()) {
          void this.session.run();
        }
        return;
      }
      if (chord && event.key === ".") {
        event.preventDefault();
        if (this.editMode === "run" && this.onBoard()) {
          this.session.step();
        }
        return;
      }
      if (typing) {
        return;
      }

      if (event.key === "Escape") {
        this.session.stop();
        return;
      }
      if (event.key === "?") {
        this.dom.about.showModal();
        return;
      }
      if (event.key === "e") {
        if (this.canEditWorld()) {
          this.setEditMode(this.editMode === "edit" ? "run" : "edit");
        }
        return;
      }
      if (event.key === "r") {
        // The only turn the language has, and the only way to aim Karel with
        // the pointer: clicking places him, r points him.
        if (this.editMode === "edit") {
          this.applyEdit(turnKarel);
        } else {
          this.session.reset();
        }
        return;
      }
      // 1, 2, 3 pick a mode. They used to pick one of four bundled worlds,
      // which is the thing the modes replaced.
      const index = Number(event.key);
      if (Number.isInteger(index) && index >= 1 && index <= MODES.length) {
        this.setMode(MODES[index - 1].id);
      }
    });
  }

  private bindFileDrop(): void {
    // Dropping a .klm on the page is the shortest path from an exercise a
    // teacher wrote to a student running it, and it needs no file picker.
    const frame = query(".frame");
    frame.addEventListener("dragover", (event) => {
      event.preventDefault();
      frame.classList.add("dropping");
    });
    frame.addEventListener("dragleave", (event) => {
      // dragleave also fires crossing between children, so the overlay would
      // strobe as the pointer moved over the page. Only a leave that lands
      // outside the frame is a leave.
      if (!frame.contains(event.relatedTarget as Node | null)) {
        frame.classList.remove("dropping");
      }
    });
    frame.addEventListener("drop", (event) => {
      event.preventDefault();
      frame.classList.remove("dropping");
      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }
      void this.importFile(file);
    });
  }

  /**
   * The file controls, which are the same two formats the page already took by
   * drag and drop. Dropping is faster and stays; it is also invisible until
   * somebody tries it, and on a phone there is nothing to drag from.
   */
  private bindFiles(): void {
    this.dom.openFile.addEventListener("click", () => this.dom.fileInput.click());

    this.dom.fileInput.addEventListener("change", () => {
      const file = this.dom.fileInput.files?.[0];
      // Cleared either way, and before the read: opening the same file twice
      // in a row is exactly what somebody editing it in another window does,
      // and an input still holding it fires no second change event.
      this.dom.fileInput.value = "";
      if (file) {
        void this.importFile(file);
      }
    });

    this.dom.saveProgram.addEventListener("click", () => {
      downloadProgram(this.editor.getSource(), `${this.contextId()}.kli`);
      this.fileNote(t("note.savedProgram"), true);
    });

    this.dom.saveWorld.addEventListener("click", () => {
      // Canonical on the way out, so the file on disk is the text the source
      // panel shows rather than whatever order the clicks left the arrays in.
      downloadWorld(canonicalWorld(this.session.startingMap()), `${this.contextId()}.klm`);
      this.fileNote(t("note.exported"), true);
    });
  }

  /**
   * Take in a file, however it arrived.
   *
   * The extension decides which format it is, for both routes, so a drop and a
   * pick cannot disagree about the same file. Anything that is not named .kli
   * is read as a world: .klm is the only other thing this page eats, and a
   * file chosen on a phone may well arrive with no extension at all.
   *
   * A world arriving while the world is not editable — in a chapter, in a
   * level — moves to the sandbox first. Someone who drops a .klm is asking to
   * look at that world, and the sandbox is the only place this page can honour
   * that without quietly breaking the check a chapter is graded by.
   */
  private async importFile(file: File): Promise<void> {
    const text = await file.text();

    if (file.name.toLowerCase().endsWith(".kli")) {
      this.editor.setSource(text);
      this.session.setSource(text);
      this.rememberProgram(text);
      this.persist();
      this.fileNote(t("note.openedProgram"), true);
      this.render();
      return;
    }

    if (!this.canEditWorld()) {
      this.setMode("sandbox");
    }

    const result = parseMapSource(text);
    if (!result.ok) {
      // The world on the canvas survives a file that will not load -- losing
      // your own world to somebody else's broken one would be the worst
      // possible answer. The text goes into the source panel with the reasons
      // beside it, which is the one place on this page where it can be fixed.
      this.setEditMode("edit");
      this.mapSourcePinned = true;
      this.mapSource.setText(text);
      this.mapProblems = result.problems;
      this.mapSource.setProblems(result.problems);
      this.fileNote(t("error.invalidWorld"));
      this.render();
      return;
    }

    this.mapSourcePinned = false;
    this.adoptWorld(result.world);
    this.persist();
    this.fileNote(t("note.openedWorld"), true);
  }

  private bindAbout(): void {
    this.dom.aboutButton.addEventListener("click", () => this.dom.about.showModal());
    this.dom.aboutClose.addEventListener("click", () => this.dom.about.close());
  }

  // ── The map editor ──────────────────────────────────────────────────────

  private bindPalette(): void {
    this.dom.modeToggle.addEventListener("click", () =>
      this.setEditMode(this.editMode === "edit" ? "run" : "edit")
    );

    for (const button of this.dom.tools.querySelectorAll<HTMLButtonElement>(".tool")) {
      button.addEventListener("click", () => this.setTool(button.dataset.tool as Tool));
    }

    // The bound the interpreter itself enforces, rather than a number typed
    // into the markup twice.
    this.dom.width.max = String(MAX_WORLD_SIZE);
    this.dom.height.max = String(MAX_WORLD_SIZE);

    // On `change`, never on `input`: resizing throws away everything outside
    // the new bounds, and typing "12" passes through "1" on the way.
    this.dom.width.addEventListener("change", () => this.applySize());
    this.dom.height.addEventListener("change", () => this.applySize());
    this.dom.bag.addEventListener("change", () => this.applyBag());

    // The spinners are ours, so they go through the same change event the
    // field does and there is still one path from a number to a world.
    for (const button of this.dom.palette.querySelectorAll<HTMLButtonElement>(".stepper-button")) {
      button.addEventListener("click", () => {
        const field = document.getElementById(
          button.dataset.target ?? ""
        ) as HTMLInputElement | null;
        if (!field) {
          return;
        }
        field.value = String(Math.trunc(Number(field.value) || 0) + Number(button.dataset.step));
        field.dispatchEvent(new Event("change"));
      });
    }

    this.dom.clearBeepers.addEventListener("click", () => this.applyEdit(clearBeepers));
    this.dom.clearWalls.addEventListener("click", () => this.applyEdit(clearWalls));

    this.dom.formatMap.addEventListener("click", () => {
      if (this.mapProblems.length > 0) {
        // Laying out a file that does not read would mean writing out the
        // world it is not describing, which would throw the visitor's text
        // away along with the mistake in it.
        this.note(t("note.mapUnreadable"));
        return;
      }
      // Written from the world rather than from the text. By now the two
      // agree -- an unreadable file is the case above -- and the world is what
      // the canvas draws, so this cannot introduce a disagreement.
      this.mapSourcePinned = false;
      this.mapSource.setText(serializeWorld(this.session.startingMap()));
      this.note(t("note.formatted"), true);
    });

    this.dom.shareLink.addEventListener("click", () => void this.share());
  }

  private bindCanvas(): void {
    const canvas = this.dom.canvas;

    canvas.addEventListener("pointerdown", (event) => {
      if (this.editMode !== "edit" || (event.button !== 0 && event.button !== 2)) {
        return;
      }
      event.preventDefault();
      const hit = this.renderer.hitTest(event.clientX, event.clientY);
      if (hit.kind === "outside") {
        return;
      }
      // Capture, so a stroke that wanders off the canvas keeps painting and
      // still ends where the button is let go.
      canvas.setPointerCapture(event.pointerId);
      this.stroke = {
        pointerId: event.pointerId,
        subtract: event.button === 2 || event.altKey || event.shiftKey,
        toggled: new Set(),
        last: null,
      };
      this.paint(hit, true);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (this.editMode !== "edit") {
        return;
      }
      const hit = this.renderer.hitTest(event.clientX, event.clientY);
      if (this.stroke?.pointerId === event.pointerId) {
        this.paint(hit, false);
      }
      this.moveCursor(hit);
    });

    const end = (event: PointerEvent): void => {
      if (this.stroke?.pointerId !== event.pointerId) {
        return;
      }
      this.stroke = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    canvas.addEventListener("pointerleave", () => {
      if (this.cursor) {
        this.cursor = null;
        this.edgeCursor = null;
        this.render();
      }
    });

    // The right button is the "take one back" gesture, so it must not also
    // raise a menu over the world.
    canvas.addEventListener("contextmenu", (event) => {
      if (this.editMode === "edit") {
        event.preventDefault();
      }
    });
  }

  /**
   * Apply one gesture, given what it landed on.
   *
   * Which reading of the hit counts is the tool's decision, which is why the
   * hit carries both: the wall tool wants the boundary and nothing else, while
   * the other two want the corner the pointer is in even when it is close
   * enough to a boundary for the renderer to have named one.
   */
  private paint(hit: HitTarget, first: boolean): void {
    const stroke = this.stroke;
    if (!stroke || hit.kind === "outside") {
      return;
    }

    if (this.tool === "wall") {
      if (hit.kind !== "edge") {
        // The middle of a square is not a boundary, and the rim of the world
        // is walled by the interpreter and cannot be changed at all. Saying so
        // once per stroke beats a click that silently does nothing.
        if (first) {
          this.note(t("note.wallOnEdge"));
        }
        return;
      }
      const key = edgeKey(hit.wall);
      if (stroke.toggled.has(key)) {
        return;
      }
      stroke.toggled.add(key);
      this.applyEdit((world) => toggleWall(world, hit.wall));
      return;
    }

    const key = `${hit.x},${hit.y}`;
    if (stroke.last === key) {
      return;
    }
    stroke.last = key;

    if (this.tool === "beeper") {
      this.applyEdit((world) => changeBeepers(world, hit.x, hit.y, stroke.subtract ? -1 : 1));
    } else {
      this.applyEdit((world) => placeKarel(world, hit.x, hit.y));
    }
  }

  /**
   * Preview where the next gesture lands. Repaints only when it moves.
   *
   * Which preview depends on the tool: the wall tool acts on a boundary, so
   * lighting up the square under the pointer would show the wrong thing and
   * leave you guessing which of its four sides you were about to change.
   */
  private moveCursor(hit: HitTarget): void {
    const wallTool = this.tool === "wall";
    const cell = hit.kind === "outside" || wallTool ? null : { x: hit.x, y: hit.y };
    const edge = wallTool && hit.kind === "edge" ? hit.wall : null;

    const sameCell = cell?.x === this.cursor?.x && cell?.y === this.cursor?.y;
    const sameEdge =
      (edge ? edgeKey(edge) : null) === (this.edgeCursor ? edgeKey(this.edgeCursor) : null);
    if (sameCell && sameEdge) {
      return;
    }
    this.cursor = cell;
    this.edgeCursor = edge;
    this.render();
  }

  /**
   * Run one of draft.ts's edits and make the result the world.
   *
   * It goes in as the Session's starting map rather than being held to one
   * side, so the canvas keeps drawing exactly what the next run will begin
   * from and there is never a second world to keep in step.
   */
  private applyEdit(
    change: (world: KarelMap) => KarelMap,
    options: { fromSource?: boolean } = {}
  ): void {
    if (!this.canEditWorld()) {
      // Nothing on screen offers this here, but the keyboard does, and a
      // chapter whose world can be rearranged by hand is a chapter whose
      // check certifies nothing.
      return;
    }
    const before = this.session.startingMap();
    const after = change(before);
    if (after === before) {
      // draft.ts hands back the same map when the edit was a no-op.
      return;
    }
    if (!options.fromSource) {
      // The world moved for a reason that is not the file, so the file is the
      // stale one and the next render writes it out again.
      this.mapSourcePinned = false;
    }
    this.adoptWorld(after);
    this.persist();
  }

  /**
   * Make `world` the one the session starts from, and remember it wherever
   * this context keeps its world.
   *
   * The two places are the sandbox's own map and the level being built. A
   * chapter and a published level never reach here — `applyEdit` refuses, and
   * a file that arrives moves to the sandbox first.
   */
  private adoptWorld(world: KarelMap): void {
    if (this.mode === "levels" && this.screen === "contribute") {
      this.draftWorld = world;
    } else {
      this.customWorld = world;
    }
    this.session.setWorld(world); // renders, through onChange
  }

  /**
   * The visitor typed in the file. Read it, and if it is a world, adopt it.
   *
   * This is one half of a two-way binding, and the half that has to be
   * careful: the other half writes this document from the world every time the
   * world changes, so an edit that started here must not come back as a
   * rewrite. Three rules keep the two from chasing each other and all three
   * are load-bearing.
   *
   *   1. The application's own writes are not edits. `setText` suppresses the
   *      change callback for anything it puts there, so repainting the panel
   *      after a click on the canvas cannot be mistaken for typing.
   *   2. Text that means the world already on the canvas changes nothing. A
   *      file with its walls listed in another order is the same world; there
   *      is nothing to apply, and applying it anyway would be a second edit
   *      that renders again.
   *   3. While the text is the visitor's own -- unreadable, or readable but
   *      not laid out the way the canvas lays it out -- the panel is pinned
   *      and render() leaves it alone. The pin drops the moment anything else
   *      edits the world, because then the canvas is the one telling the truth
   *      and the file has to follow it.
   *
   * Rule 1 alone would be enough to stop an infinite loop, since a canonical
   * serializer means an unchanged world produces an unchanged document. Rules
   * 2 and 3 are what stop the smaller, worse version of the same bug: the file
   * reformatting itself under the caret of the person writing it.
   */
  private applyMapSource(text: string): void {
    const result = parseMapSource(text);
    if (!result.ok) {
      // The canvas keeps the last world that read. A file is half-written for
      // most of the time anybody spends writing it, and a canvas that blanked
      // between keystrokes would be unusable.
      this.mapSourcePinned = true;
      this.mapProblems = result.problems;
      this.mapSource.setProblems(result.problems);
      this.render();
      return;
    }

    this.mapProblems = [];
    this.mapSource.setProblems([]);
    // Set before the edit lands, because applying it renders and the render
    // has to already know whose text is in the panel.
    this.mapSourcePinned = text !== serializeWorld(result.world);

    if (!sameWorld(result.world, this.session.startingMap())) {
      this.applyEdit(() => result.world, { fromSource: true });
      return;
    }
    this.render();
  }

  private applySize(): void {
    const width = Number(this.dom.width.value);
    const height = Number(this.dom.height.value);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      this.render(); // put the fields back to what the world actually is
      return;
    }
    this.applyEdit((world) => resize(world, width, height));
    // resize() clamps, so the field may well now disagree with the world.
    this.writeNumbers(this.session.startingMap(), true);
  }

  private applyBag(): void {
    const beepers = Number(this.dom.bag.value);
    if (!Number.isFinite(beepers)) {
      this.render();
      return;
    }
    this.applyEdit((world) => setBag(world, beepers));
    this.writeNumbers(this.session.startingMap(), true);
  }

  private setEditMode(mode: EditMode): void {
    if (mode === this.editMode || (mode === "edit" && !this.canEditWorld())) {
      return;
    }
    this.editMode = mode;
    this.stroke = null;
    this.cursor = null;
    this.dom.shareUrlField.hidden = true;
    this.note("");
    // Editing a world a program is walking through is two owners of one state.
    // Going the other way, the edited world is already the starting map, so
    // this only has to rewind what is on screen to it.
    this.session.reset();
    this.render();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.render();
  }

  private async share(): Promise<void> {
    const url = await shareUrl({
      program: this.editor.getSource(),
      world: this.session.startingMap(),
    });
    if (await copyText(url)) {
      this.dom.shareUrlField.hidden = true;
      this.note(t("note.linkCopied"), true);
      this.fileNote(t("note.linkCopied"), true);
      return;
    }
    // Nothing was copied, so the link has to be somewhere it can be reached.
    this.dom.shareUrlField.hidden = false;
    this.dom.shareUrlField.value = url;
    this.dom.shareUrlField.select();
    this.note(t("note.clipboardRefused"));
    this.fileNote(t("note.clipboardRefused"));
  }

  /** A word in the palette's note chip, gone again a few seconds later. */
  private note(text: string, good = false): void {
    window.clearTimeout(this.noteTimer);
    this.dom.paletteNote.textContent = text;
    this.dom.paletteNote.dataset.flash = String(good);
    if (!text) {
      return;
    }
    this.noteTimer = window.setTimeout(() => {
      this.dom.paletteNote.textContent = "";
      this.dom.paletteNote.dataset.flash = "false";
    }, 3200);
  }

  /**
   * A word in the file group's chip, gone again a few seconds later.
   *
   * Separate from `note` because that one lives in the palette, which is only
   * on screen while the world is being edited -- and saving a program, or
   * copying a link, is not an edit-mode act.
   */
  private fileNote(text: string, good = false): void {
    window.clearTimeout(this.fileNoteTimer);
    this.dom.fileNote.textContent = text;
    this.dom.fileNote.dataset.flash = String(good);
    if (!text) {
      return;
    }
    this.fileNoteTimer = window.setTimeout(() => {
      this.dom.fileNote.textContent = "";
      this.dom.fileNote.dataset.flash = "false";
    }, 3200);
  }

  // ── Moving between modes ────────────────────────────────────────────────

  private setMode(mode: Mode): void {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    if (mode === "levels" && this.screen === "board" && !this.level) {
      this.screen = "gallery";
    }
    this.enterContext();
  }

  private openChapter(id: string): void {
    this.progress = { ...this.progress, current: id };
    saveProgress(this.progress);
    this.mode = "learn";
    this.enterContext();
  }

  private openLevel(level: Level): void {
    this.mode = "levels";
    this.screen = "board";
    this.level = level;
    this.enterContext();
  }

  private openGallery(): void {
    this.mode = "levels";
    this.screen = "gallery";
    this.enterContext();
  }

  private openContribution(): void {
    this.mode = "levels";
    this.screen = "contribute";
    this.enterContext();
    // The world is the first step, so the instrument for it is already open.
    this.setEditMode("edit");
  }

  /**
   * Put the bench into whatever the mode and the screen now say it is.
   *
   * One path, whichever way we arrived: the session takes the context's world,
   * the editor takes its program, and everything that was true of the last
   * context — a revealed hint, a verdict, a pinned map file — is dropped,
   * because none of it is true of this one.
   */
  private enterContext(): void {
    this.editMode = "run";
    this.stroke = null;
    this.cursor = null;
    this.edgeCursor = null;
    this.mapSourcePinned = false;
    this.mapProblems = [];
    this.mapSource.setProblems([]);
    this.hintsShown = 0;
    this.solutionShown = false;
    this.verdict = null;
    this.judged = false;
    // Both surfaces are prose about the context, so both are stale by
    // definition. Blanking the signature is how they are asked to rebuild.
    this.guideKey = "";
    this.galleryKey = "";
    this.note("");
    this.dom.shareUrlField.hidden = true;

    this.session.setWorld(this.startingWorld()); // renders, through onChange
    const source = this.startingProgram();
    this.editor.setSource(source);
    this.session.setSource(source);
    this.persist();
    this.render();
  }

  private persist(): void {
    saveWorkspace({
      exerciseId: this.exercise.id,
      program: this.sandboxProgram,
      ...(this.customWorld ? { world: this.customWorld } : {}),
      speedMs: this.session.speed(),
    });
    saveUi({
      mode: this.mode,
      screen: this.screen,
      levelId: this.level?.id ?? null,
      levelPrograms: this.levelPrograms,
      draftWorld: this.draftWorld,
      draftProgram: this.draftProgram,
    });
  }

  // ── The verdict ─────────────────────────────────────────────────────────

  /**
   * Judge a finished run, once.
   *
   * This is the moment the whole of learn and levels turns on. The check is
   * not this file's: `checkChapter` and `checkLevel` both come down to the
   * core's `sameExercise` and `compareWorlds`, which are the two functions the
   * command line grades a submitted program with. There is deliberately no
   * second implementation of "is this right" anywhere in the app, because
   * passing here and failing there is the one outcome a teaching tool cannot
   * afford.
   *
   * What comes back on a miss is already the useful sentence — "3 beepers were
   * expected at (5, 1), there are 2" — so it is shown as it is rather than
   * being wrapped in an apology.
   */
  private judge(view: SessionView): void {
    if (view.state !== "done" || !this.isGraded()) {
      if (this.verdict) {
        this.verdict = null;
        this.guideKey = "";
      }
      this.judged = false;
      return;
    }
    if (this.judged) {
      return;
    }
    this.judged = true;

    if (this.mode === "learn") {
      const chapter = this.chapter();
      const missed = checkChapter(chapter, view.world);
      this.verdict = { solved: missed === null, message: missed };
      if (missed === null) {
        this.progress = markChapterSolved(this.progress, chapter.id);
        saveProgress(this.progress);
      }
    } else if (this.level) {
      const missed = checkLevel(this.level, view.world);
      this.verdict = { solved: missed === null, message: missed };
      if (missed === null) {
        this.solvedLevels = markLevelSolved(this.level.id);
      }
    }
    this.guideKey = "";
  }

  // ── Projection ──────────────────────────────────────────────────────────

  private render(): void {
    const view = this.session.view();
    this.judge(view);

    const board = this.onBoard();
    const editing = this.editMode === "edit";
    const guided = board && this.mode !== "sandbox";

    // One attribute decides the columns; see the bench block in main.css.
    this.dom.bench.dataset["layout"] = board ? (guided ? "guide" : "plain") : "gallery";
    this.dom.bench.dataset["mode"] = this.mode;
    this.dom.guide.hidden = !guided;
    this.dom.gallery.hidden = board;
    this.dom.workshop.hidden = !board;
    this.dom.stage.hidden = !board;
    // Written here rather than in renderPalette, which the gallery never
    // reaches: the footer is on screen in every mode and has to be right in
    // every mode.
    this.dom.hintEdit.hidden = !this.canEditWorld();

    if (!board) {
      // The gallery is the whole bench: there is no canvas to draw on and no
      // program to report about.
      this.renderGallery();
      this.dom.status.textContent = t("levels.title");
      this.dom.status.dataset.state = "idle";
      renderHelp(this.dom.aboutContent, { label: this.contextLabel(), brief: this.contextBrief() });
      this.renderSelections();
      return;
    }

    this.renderer.draw(view.world, {
      showAxes: this.showAxes,
      cursor: editing ? this.cursor : null,
      edge: editing ? this.edgeCursor : null,
    });
    this.dom.canvas.classList.toggle("editable", editing);

    this.editor.setDiagnostics(this.session.currentDiagnostics());
    this.editor.setActiveLine(view.line);
    this.editor.setEditable(view.state !== "running");

    const action = this.session.primaryAction();
    this.dom.runGlyph.textContent = ACTION_GLYPH[action];
    this.dom.runLabel.textContent = t(ACTION_LABEL[action]);
    this.dom.run.disabled = editing;
    this.dom.step.disabled = editing || view.state === "running";
    this.dom.reset.disabled = editing;

    // A message is prose the core or the session already worded; a state is
    // one of ours and goes through the catalogue on the way out.
    this.dom.status.textContent = editing
      ? t("status.edit")
      : (view.message ?? t(STATUS_LABEL[view.state]));
    this.dom.status.dataset.state = editing ? "edit" : view.state;

    const { width, height } = view.world.dimensions;
    this.dom.worldNote.textContent = `${width}x${height}`;
    this.dom.programNote.textContent = this.contextLabel();

    this.renderPalette(view.world);
    this.renderProblems();
    this.renderMetrics(view.world, view.steps);
    this.renderGuide(view);
    this.renderSelections();
    renderHelp(this.dom.aboutContent, { label: this.contextLabel(), brief: this.contextBrief() });
  }

  private renderPalette(world: KarelMap): void {
    // The map editor is only an instrument where the world is the visitor's to
    // change. Everywhere else the toggle is not disabled, it is absent: a
    // control that is always refused is worse than no control.
    const editable = this.canEditWorld();
    this.dom.modeToggle.hidden = !editable;
    this.dom.palette.hidden = !editable || this.editMode !== "edit";
    this.dom.modeToggle.setAttribute("aria-pressed", String(this.editMode === "edit"));

    for (const button of this.dom.tools.querySelectorAll<HTMLButtonElement>(".tool")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === this.tool));
    }
    this.dom.toolHint.textContent = t(TOOL_HINT[this.tool]);
    this.writeNumbers(world, false);

    // Only in edit mode: in run mode this world is a running snapshot, not the
    // map, and writing it into a file the visitor edits would be a lie about
    // what the file is.
    if (editable && this.editMode === "edit") {
      this.renderMapSource(world);
    }
  }

  /**
   * The world's file, and whatever is wrong with it.
   *
   * The document is written from the world unless the panel is pinned. Because
   * `serializeWorld` is canonical, an unchanged world is an unchanged string
   * and `setText` declines to touch the document at all -- which is what lets
   * this run on every render, pointer moves included, without ever moving a
   * caret.
   */
  private renderMapSource(world: KarelMap): void {
    if (!this.mapSourcePinned && this.mapSource.setText(serializeWorld(world))) {
      // The document was replaced from the world, so whatever was wrong with
      // the text that used to be there is no longer wrong with anything.
      this.mapProblems = [];
      this.mapSource.setProblems([]);
    }

    this.dom.mapProblemsNote.textContent =
      this.mapProblems.length === 0 ? t("problems.none") : `${this.mapProblems.length}`;

    if (this.mapProblems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "problems-empty";
      empty.textContent = t("problems.mapClean");
      this.dom.mapProblems.replaceChildren(empty);
      return;
    }

    this.dom.mapProblems.replaceChildren(
      ...this.mapProblems.map((problem) => {
        const row = document.createElement("div");
        // Not a button, unlike the program's rows: those jump the editor to a
        // line, and most of these have no line to jump to.
        row.className = "problem error";
        row.innerHTML = `<span class="problem-at"></span><span class="problem-text"></span>`;
        // A dot where a position would be. `validateKarelMap` answers for a
        // world, not for a file, so only the JSON itself can say where it went
        // wrong -- and pointing at a line by matching the core's translated
        // prose would point confidently at the wrong one.
        row.querySelector(".problem-at")!.textContent =
          problem.line === null ? "·" : `${problem.line}:${(problem.column ?? 0) + 1}`;
        row.querySelector(".problem-text")!.textContent = problem.message;
        return row;
      })
    );
  }

  /**
   * Put the world's own numbers back in the fields.
   *
   * A field being typed into is the one thing on the page that is not a
   * projection: writing to it would move the caret out from under the hand.
   * Once a value has been committed, though, the world's answer is the only
   * true one -- 999 was clamped to a hundred and the field has to say so, even
   * though the caret is still sitting in it.
   */
  private writeNumbers(world: KarelMap, force: boolean): void {
    const values: [HTMLInputElement, number][] = [
      [this.dom.width, world.dimensions.width],
      [this.dom.height, world.dimensions.height],
      [this.dom.bag, world.karel.beepers],
    ];
    for (const [field, value] of values) {
      if (force || document.activeElement !== field) {
        field.value = String(value);
      }
    }
  }

  private renderProblems(): void {
    const diagnostics = this.session.currentDiagnostics();
    this.dom.problemsNote.textContent =
      diagnostics.length === 0 ? t("problems.none") : `${diagnostics.length}`;

    if (diagnostics.length === 0) {
      // Stated rather than left blank: an empty panel reads as broken.
      const empty = document.createElement("p");
      empty.className = "problems-empty";
      empty.textContent = t("problems.clean");
      this.dom.problems.replaceChildren(empty);
      return;
    }

    this.dom.problems.replaceChildren(
      ...diagnostics.map((d) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `problem ${d.severity}`;
        // Columns are 0-based in the parser and 1-based everywhere a person
        // reads them, including the line:column the CLI prints.
        row.innerHTML = `<span class="problem-at"></span><span class="problem-text"></span>`;
        row.querySelector(".problem-at")!.textContent = `${d.line}:${d.column + 1}`;
        row.querySelector(".problem-text")!.textContent = d.message;
        row.addEventListener("click", () => {
          this.editor.setActiveLine(d.line);
          this.editor.focus();
        });
        return row;
      })
    );
  }

  private renderMetrics(world: KarelMap, steps: number): void {
    const values: Record<MetricKey, string> = {
      position: `${world.karel.x}, ${world.karel.y}`,
      facing: t(FACING_LABEL[world.karel.facing]),
      bag: String(world.karel.beepers),
      steps: String(steps),
    };
    for (const [key] of METRICS) {
      const node = this.dom.readout.querySelector<HTMLElement>(`[data-metric="${key}"]`);
      if (!node || node.textContent === values[key]) {
        continue;
      }
      node.textContent = values[key];
      // Restarting the animation needs the class gone for a frame, or a value
      // that changes on consecutive steps only flashes once.
      node.classList.remove("touched");
      void node.offsetWidth;
      node.classList.add("touched");
    }
  }

  private renderSelections(): void {
    for (const button of this.dom.modes.querySelectorAll<HTMLButtonElement>(".channel")) {
      button.setAttribute("aria-selected", String(button.dataset["mode"] === this.mode));
    }
    for (const [index, button] of [...this.dom.rate.children].entries()) {
      button.setAttribute(
        "aria-pressed",
        String(SPEED_PRESETS[index]?.ms === this.session.speed())
      );
    }
    for (const [index, button] of [...this.dom.themes.children].entries()) {
      button.setAttribute("aria-pressed", String(THEMES[index]?.id === currentTheme()));
    }
    for (const button of this.dom.langs.querySelectorAll<HTMLButtonElement>(".lang-option")) {
      button.setAttribute("aria-pressed", String(button.dataset["locale"] === currentLocale()));
    }
    this.axesToggle?.setAttribute("aria-pressed", String(this.showAxes));
  }

  // ── The guide column ────────────────────────────────────────────────────

  /**
   * Everything the guide draws, as one string.
   *
   * The first half names the context; the second names what has happened
   * inside it. Splitting them is what lets a verdict appear without throwing
   * away the reader's place, while opening a different chapter starts at the
   * top of the new one.
   */
  private guideContext(): string {
    return [this.mode, this.screen, this.contextId(), currentLocale()].join("|");
  }

  private guideSignature(): string {
    return [
      this.guideContext(),
      this.verdict ? `${this.verdict.solved}:${this.verdict.message ?? ""}` : "",
      this.progress.solved.length,
      this.solvedLevels.size,
      this.solutionShown,
    ].join("|");
  }

  private renderGuide(view: SessionView): void {
    if (this.mode === "sandbox") {
      return; // the column is not on screen at all
    }

    const contributing = this.mode === "levels" && this.screen === "contribute";
    if (this.mode === "learn") {
      this.dom.guideTitle.textContent = t("guide.lesson");
      this.dom.guideNote.textContent = t("guide.progress", {
        done: this.progress.solved.length,
        total: CHAPTERS.length,
      });
    } else if (contributing) {
      this.dom.guideTitle.textContent = t("contribute.title");
      this.dom.guideNote.textContent = "";
    } else {
      this.dom.guideTitle.textContent = t("guide.brief");
      this.dom.guideNote.textContent = this.level ? t(DIFFICULTY_LABEL[this.level.difficulty]) : "";
    }

    const context = this.guideContext();
    const signature = this.guideSignature();
    if (signature !== this.guideKey) {
      const moved = !this.guideKey.startsWith(`${context}|`);
      this.guideKey = signature;
      this.dom.guideBody.replaceChildren(...this.buildGuide());
      if (moved) {
        // A different chapter, a different level: start at the top of it. A
        // verdict arriving in the chapter already open is not a move, and
        // yanking the page out from under the reader would be rude.
        this.dom.guideBody.scrollTop = 0;
      }
    }

    if (contributing) {
      this.updateContribution(view);
    }
  }

  private buildGuide(): HTMLElement[] {
    if (this.mode === "learn") {
      return this.buildChapterGuide();
    }
    if (this.screen === "contribute") {
      return [this.contributionPanel()];
    }
    return this.level ? this.buildLevelGuide(this.level) : [];
  }

  // ── learn ───────────────────────────────────────────────────────────────

  private buildChapterGuide(): HTMLElement[] {
    const chapter = this.chapter();
    const at = chapterIndex(chapter.id);
    const nodes: HTMLElement[] = [];

    // The table of contents and the progress report are the same strip: one
    // cell per chapter, marked when it has been solved.
    const rail = document.createElement("nav");
    rail.className = "chapter-rail";
    rail.setAttribute("aria-label", t("guide.chapters"));
    for (const [index, entry] of CHAPTERS.entries()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chapter-chip";
      chip.textContent = String(index + 1);
      chip.title = entry.title;
      chip.setAttribute("aria-label", `${index + 1}. ${entry.title}`);
      chip.dataset["solved"] = String(this.progress.solved.includes(entry.id));
      chip.setAttribute("aria-current", String(entry.id === chapter.id));
      chip.addEventListener("click", () => this.openChapter(entry.id));
      rail.append(chip);
    }
    nodes.push(rail);

    nodes.push(heading(chapter.title));
    nodes.push(
      tags([
        `${at + 1} / ${CHAPTERS.length}`,
        ...(this.progress.solved.includes(chapter.id) ? [t("guide.solved")] : []),
      ])
    );
    nodes.push(taskBox(chapter.task));
    nodes.push(this.verdictNode());

    for (const block of chapter.lesson) {
      if (block.kind === "prose") {
        const paragraph = document.createElement("p");
        paragraph.className = "guide-prose";
        paragraph.textContent = block.text;
        nodes.push(paragraph);
      } else {
        const pre = document.createElement("pre");
        pre.className = "guide-code";
        // Painted by the editor's own tokenizer, so a sample here cannot be
        // coloured differently from the same text typed into the program box.
        pre.append(highlight(block.source));
        nodes.push(pre);
      }
    }

    if (!this.verdict && this.progress.solved.includes(chapter.id)) {
      // Solved on a previous visit. Worth saying once, quietly, so a reader
      // coming back does not wonder whether the tick meant something else.
      const already = document.createElement("p");
      already.className = "guide-note";
      already.dataset["tone"] = "good";
      already.textContent = t("guide.alreadySolved");
      nodes.push(already);
    }

    nodes.push(this.hintsNode(chapter.hints));

    const actions = document.createElement("div");
    actions.className = "guide-actions";
    if (at > 0) {
      actions.append(guideButton(t("guide.previous"), () => this.openChapter(CHAPTERS[at - 1].id)));
    }
    const following = nextChapter(chapter.id);
    if (following) {
      actions.append(guideButton(t("guide.next"), () => this.openChapter(following.id)));
    }
    actions.append(
      guideButton(t("guide.restart"), () => {
        this.editor.setSource(chapter.program);
        this.session.setSource(chapter.program);
        this.rememberProgram(chapter.program);
        this.session.reset();
        this.persist();
        this.fileNote(t("guide.restarted"), true);
        this.render();
      })
    );
    nodes.push(actions);

    if (!following) {
      const last = document.createElement("p");
      last.className = "guide-note";
      last.textContent = t("guide.last");
      nodes.push(last);
    }
    return nodes;
  }

  /**
   * The hints, all built and all hidden but the ones asked for.
   *
   * Built rather than fetched on demand so that revealing one does not rebuild
   * the column: the button that asks for a hint would otherwise destroy itself
   * and take the focus with it.
   */
  private hintsNode(hints: string[]): HTMLElement {
    const box = document.createElement("div");
    const rows = hints.map((text, index) => {
      const row = document.createElement("p");
      row.className = "guide-hint";
      const number = document.createElement("b");
      number.textContent = String(index + 1);
      const body = document.createElement("span");
      body.textContent = text;
      row.append(number, body);
      box.append(row);
      return row;
    });

    const actions = document.createElement("div");
    actions.className = "guide-actions";
    const button = guideButton(t("guide.hint"), () => {
      this.hintsShown = Math.min(this.hintsShown + 1, hints.length);
      paint();
    });
    actions.append(button);
    box.append(actions);

    const paint = (): void => {
      for (const [index, row] of rows.entries()) {
        row.hidden = index >= this.hintsShown;
      }
      const spent = this.hintsShown >= hints.length;
      button.disabled = spent;
      button.textContent = spent ? t("guide.hintsDone") : t("guide.hint");
    };
    paint();
    return box;
  }

  // ── a level ─────────────────────────────────────────────────────────────

  private buildLevelGuide(level: Level): HTMLElement[] {
    const nodes: HTMLElement[] = [];

    const back = document.createElement("div");
    back.className = "guide-actions";
    back.append(guideButton(`← ${t("levels.back")}`, () => this.openGallery()));
    nodes.push(back);

    nodes.push(heading(levelTitle(level)));
    nodes.push(
      tags([
        t(DIFFICULTY_LABEL[level.difficulty]),
        t("levels.by", { name: level.author }),
        ...(this.solvedLevels.has(level.id) ? [t("guide.solved")] : []),
      ])
    );
    nodes.push(taskBox(levelBrief(level)));
    nodes.push(this.verdictNode());

    const actions = document.createElement("div");
    actions.className = "guide-actions";
    // The solution ships in the bundle and was never a secret, so it is
    // offered as "here is one way" rather than pretended to be hidden.
    actions.append(
      guideButton(t("levels.showSolution"), () => {
        this.editor.setSource(level.solution);
        this.session.setSource(level.solution);
        this.rememberProgram(level.solution);
        this.session.reset();
        this.solutionShown = true;
        this.persist();
        this.render();
      })
    );
    const following = this.levelAfter(level);
    if (following) {
      actions.append(guideButton(t("levels.next"), () => this.openLevel(following)));
    }
    nodes.push(actions);

    if (this.solutionShown) {
      const note = document.createElement("p");
      note.className = "guide-note";
      note.textContent = t("levels.solutionShown");
      nodes.push(note);
    }
    return nodes;
  }

  /** The next level in the order the gallery shows them, or null at the end. */
  private levelAfter(level: Level): Level | null {
    const at = LEVELS.findIndex((entry) => entry.id === level.id);
    return at >= 0 && at + 1 < LEVELS.length ? LEVELS[at + 1] : null;
  }

  /** What the check said, or an invitation to find out. */
  private verdictNode(): HTMLElement {
    if (!this.verdict) {
      const note = document.createElement("p");
      note.className = "guide-note";
      note.textContent = t("guide.check");
      return note;
    }

    const box = document.createElement("div");
    box.className = "verdict";
    box.dataset["tone"] = this.verdict.solved ? "solved" : "miss";
    box.setAttribute("role", "status");

    const mark = document.createElement("span");
    mark.className = "verdict-mark";
    mark.textContent = this.verdict.solved ? t("guide.solved") : t("guide.notYet");
    box.append(mark);

    const line = document.createElement("p");
    if (this.verdict.solved) {
      // Nothing to explain: the world is the one that was asked for. What is
      // useful here is the way on, which is the button below.
      line.textContent = t("guide.solvedNote");
    } else {
      // `compareWorlds` has already named the first difference, in the
      // language on screen. Anything this file added would be noise.
      line.textContent = this.verdict.message ?? "";
    }
    box.append(line);

    if (this.verdict.solved) {
      const actions = document.createElement("div");
      actions.className = "guide-actions";
      if (this.mode === "learn") {
        const following = nextChapter(this.chapter().id);
        if (following) {
          const go = guideButton(t("guide.next"), () => this.openChapter(following.id));
          go.classList.add("primary");
          actions.append(go);
        }
      } else if (this.level) {
        const following = this.levelAfter(this.level);
        if (following) {
          const go = guideButton(t("levels.next"), () => this.openLevel(following));
          go.classList.add("primary");
          actions.append(go);
        }
        actions.append(guideButton(t("levels.back"), () => this.openGallery()));
      }
      if (actions.childElementCount > 0) {
        box.append(actions);
      }
    }
    return box;
  }

  // ── Sending a level of your own ─────────────────────────────────────────

  /**
   * The contribution panel, built once and updated in place ever after.
   *
   * Everything else in the guide is rebuilt from nothing when it changes,
   * which is fine for prose and impossible here: rebuilding a form throws away
   * what has been typed into it, and a language change would do exactly that
   * to a half-written brief. So this one panel is made once and every string
   * in it is written again on each render, which makes it locale-proof without
   * ever touching a field's value.
   */
  private contributionPanel(): HTMLElement {
    if (this.contribution) {
      return this.contribution.root;
    }

    const root = document.createElement("div");
    const labels: { key: MessageKey; node: HTMLElement }[] = [];

    const back = document.createElement("div");
    back.className = "guide-actions";
    const backButton = guideButton("", () => this.openGallery());
    labels.push({ key: "levels.back", node: backButton });
    back.append(backButton);
    root.append(back);

    // No heading of its own: the box title cut into the border already says
    // what this column is, and saying it twice in three centimetres is noise.
    const lead = document.createElement("p");
    lead.className = "guide-prose";
    labels.push({ key: "contribute.lead", node: lead });
    root.append(lead);

    const steps = document.createElement("ol");
    steps.className = "guide-steps";
    const stepNodes: HTMLLIElement[] = [];
    for (const key of [
      "contribute.step1",
      "contribute.step2",
      "contribute.step3",
      "contribute.step4",
    ] as MessageKey[]) {
      const item = document.createElement("li");
      labels.push({ key, node: item });
      steps.append(item);
      stepNodes.push(item);
    }
    root.append(steps);

    // The capture. One button, and it is the hinge of the whole flow: it takes
    // the world the run started from, the world it ended in and the program
    // that connected them, which is exactly the three things a level file
    // needs — and it means the goal is reachable because it has just been
    // reached.
    const captureRow = document.createElement("div");
    captureRow.className = "guide-actions";
    const captureButton = guideButton("", () => this.captureRun());
    captureButton.classList.add("primary");
    labels.push({ key: "contribute.capture", node: captureButton });
    captureRow.append(captureButton);
    root.append(captureRow);

    const capturedNote = document.createElement("p");
    capturedNote.className = "guide-note";
    root.append(capturedNote);

    const rule = document.createElement("hr");
    rule.className = "guide-rule";
    root.append(rule);

    const form = document.createElement("div");
    form.className = "guide-form";

    const titleField = textField("input");
    labels.push({ key: "contribute.fieldTitle", node: titleField.label });
    const briefField = textField("textarea");
    labels.push({ key: "contribute.fieldBrief", node: briefField.label });
    const authorField = textField("input");
    labels.push({ key: "contribute.fieldAuthor", node: authorField.label });
    form.append(titleField.root, briefField.root, authorField.root);

    // A segmented control, like the map editor's tool picker: three choices
    // that are exclusive and short enough to all be on screen.
    const difficulty = document.createElement("div");
    difficulty.className = "field";
    const difficultyLabel = document.createElement("span");
    difficultyLabel.className = "field-label";
    labels.push({ key: "contribute.fieldDifficulty", node: difficultyLabel });
    const bands = document.createElement("div");
    bands.className = "tools";
    bands.setAttribute("role", "group");
    const bandButtons: HTMLButtonElement[] = [];
    for (const band of DIFFICULTIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool";
      button.dataset["difficulty"] = band;
      labels.push({ key: DIFFICULTY_LABEL[band], node: button });
      button.addEventListener("click", () => {
        this.draftDifficulty = band;
        this.render();
      });
      bands.append(button);
      bandButtons.push(button);
    }
    difficulty.append(difficultyLabel, bands);
    form.append(difficulty);

    const facing = document.createElement("button");
    facing.type = "button";
    facing.className = "toggle";
    labels.push({ key: "contribute.fieldFacing", node: facing });
    facing.addEventListener("click", () => {
      this.draftFacing = !this.draftFacing;
      this.render();
    });
    form.append(facing);

    const sendRow = document.createElement("div");
    sendRow.className = "guide-actions";
    const sendButton = guideButton("", () => void this.sendContribution());
    sendButton.classList.add("primary");
    const copyButton = guideButton("", () => void this.copyContribution());
    labels.push({ key: "contribute.send", node: sendButton });
    labels.push({ key: "contribute.copyFile", node: copyButton });
    sendRow.append(sendButton, copyButton);
    form.append(sendRow);
    root.append(form);

    const note = document.createElement("p");
    note.className = "guide-note";
    note.setAttribute("role", "status");
    root.append(note);

    const errors = document.createElement("ul");
    errors.className = "guide-errors";
    root.append(errors);

    const link = document.createElement("a");
    link.className = "guide-link";
    link.target = "_blank";
    link.rel = "noopener";
    root.append(link);

    const file = document.createElement("pre");
    file.className = "guide-file";
    root.append(file);

    this.contribution = {
      root,
      labels,
      steps: stepNodes,
      captureButton,
      capturedNote,
      title: titleField.field as HTMLInputElement,
      brief: briefField.field as HTMLTextAreaElement,
      author: authorField.field as HTMLInputElement,
      bands: bandButtons,
      facing,
      sendButton,
      note,
      errors,
      link,
      file,
    };
    return root;
  }

  /** Everything in the panel that is not a value the visitor typed. */
  private updateContribution(view: SessionView): void {
    const panel = this.contribution;
    if (!panel) {
      return;
    }
    for (const { key, node } of panel.labels) {
      node.textContent = t(key);
    }

    const finished = view.state === "done";
    const built = !sameWorld(this.draftWorld, NEW_LEVEL_WORLD);
    const done = [built, finished, this.captured !== null, this.contributionSent];
    for (const [index, step] of panel.steps.entries()) {
      step.dataset["done"] = String(done[index] === true);
    }

    panel.captureButton.disabled = !finished;
    if (this.captured) {
      const { width, height } = this.captured.world.dimensions;
      panel.capturedNote.textContent = t("contribute.captured", {
        size: `${width}x${height}`,
        steps: this.captured.steps,
      });
      panel.capturedNote.dataset["tone"] = "good";
    } else {
      panel.capturedNote.textContent = t("contribute.captureWait");
      panel.capturedNote.dataset["tone"] = "";
    }

    for (const button of panel.bands) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset["difficulty"] === this.draftDifficulty)
      );
    }
    panel.facing.setAttribute("aria-pressed", String(this.draftFacing));

    panel.note.textContent = this.contributionNote?.text ?? "";
    panel.note.dataset["tone"] = this.contributionNote?.tone ?? "";

    panel.errors.replaceChildren(
      ...this.contributionErrors.map((message) => {
        const row = document.createElement("li");
        // The loader's own wording, which is English only by design: it is
        // addressed to whoever is writing a level file for this repository.
        row.textContent = message;
        return row;
      })
    );
    panel.errors.hidden = this.contributionErrors.length === 0;

    panel.link.hidden = this.contributionLink === null;
    panel.link.href = this.contributionLink ?? "#";
    panel.link.textContent = this.contributionLink ?? "";

    panel.file.hidden = this.contributionFile === null;
    panel.file.textContent = this.contributionFile ?? "";
  }

  /** Take the world, the goal and the program out of the run just finished. */
  private captureRun(): void {
    const view = this.session.view();
    if (view.state !== "done") {
      return;
    }
    this.captured = {
      world: this.session.startingMap(),
      goal: view.world,
      solution: this.editor.getSource(),
      steps: view.steps,
    };
    this.contributionErrors = [];
    this.contributionNote = null;
    this.contributionFile = null;
    this.contributionLink = null;
    this.contributionSent = false;
    this.render();
  }

  /**
   * Assemble the level, or say why it cannot be assembled.
   *
   * `buildLevel` runs the exact validation the loader runs over the folder, so
   * a level that gets past this is a level that will load. Sending one that
   * would not wastes the contributor's time and the maintainer's.
   */
  private draftLevel(): Level | null {
    const panel = this.contribution;
    if (!panel || !this.captured) {
      this.contributionErrors = [];
      this.contributionNote = { text: t("contribute.needCapture"), tone: "warn" };
      return null;
    }
    const draft: LevelDraft = {
      difficulty: this.draftDifficulty,
      author: panel.author.value,
      title: panel.title.value,
      brief: panel.brief.value,
      world: this.captured.world,
      goal: this.captured.goal,
      solution: this.captured.solution,
      ...(this.draftFacing ? { ignoreFacing: true } : {}),
    };
    const built = buildLevel(draft);
    if (!built.ok || !built.level) {
      this.contributionErrors = built.errors;
      this.contributionNote = null;
      return null;
    }
    this.contributionErrors = [];
    return built.level;
  }

  /**
   * Hand GitHub a pre-filled issue.
   *
   * `contributionUrl` never returns a link that cannot be opened: a level too
   * big for a query string comes back as the same issue with an empty JSON
   * fence and `tooLong` set, and the answer to that is the clipboard. Somebody
   * who has just built a maze should not be told their maze is the wrong shape
   * for a URL.
   */
  private async sendContribution(): Promise<void> {
    const level = this.draftLevel();
    if (!level) {
      this.render();
      return;
    }

    const contribution = contributionUrl(level);
    this.contributionFile = contribution.tooLong ? contribution.json : null;
    this.contributionLink = null;
    this.contributionSent = true;

    if (contribution.tooLong) {
      const copied = await copyText(contribution.json);
      this.contributionNote = {
        text: copied ? t("contribute.tooLong") : t("contribute.copyRefused"),
        tone: "warn",
      };
    } else {
      this.contributionNote = { text: t("contribute.sent"), tone: "good" };
    }

    // A pop-up blocker is common enough that "nothing happened" has to have an
    // answer: the link goes on the page where it can be clicked by hand.
    const opened = window.open(contribution.url, "_blank", "noopener");
    if (!opened) {
      this.contributionNote = { text: t("contribute.blocked"), tone: "warn" };
      this.contributionLink = contribution.url;
    }
    this.render();
  }

  /** The other route in: the file itself, for someone who would rather open a
   *  pull request than an issue. */
  private async copyContribution(): Promise<void> {
    const level = this.draftLevel();
    if (!level) {
      this.render();
      return;
    }
    const json = formatLevelJson(level);
    const copied = await copyText(json);
    this.contributionNote = {
      text: copied ? t("contribute.copied") : t("contribute.copyRefused"),
      tone: copied ? "good" : "warn",
    };
    this.contributionFile = copied ? null : json;
    this.render();
  }

  // ── The gallery ─────────────────────────────────────────────────────────

  private renderGallery(): void {
    this.dom.galleryNote.textContent = t("guide.progress", {
      done: [...this.solvedLevels].filter((id) => levelById(id)).length,
      total: LEVELS.length,
    });

    const key = [currentLocale(), [...this.solvedLevels].sort().join(",")].join("|");
    if (key === this.galleryKey) {
      return;
    }
    this.galleryKey = key;

    const nodes: HTMLElement[] = [];

    const head = document.createElement("div");
    head.className = "gallery-head";
    const lead = document.createElement("p");
    lead.className = "gallery-lead";
    lead.textContent = t("levels.lead", { count: LEVELS.length });

    // The way from "I solved these" to "I wrote one". It sits beside the lead
    // rather than under the last band, because this is the step that turns a
    // teacher into a contributor and it has no business being fine print.
    const invite = document.createElement("section");
    invite.className = "gallery-contribute";
    const inviteText = document.createElement("p");
    inviteText.textContent = t("contribute.invite");
    const inviteRow = document.createElement("div");
    inviteRow.className = "guide-actions";
    const inviteButton = guideButton(t("contribute.open"), () => this.openContribution());
    inviteButton.classList.add("primary");
    inviteRow.append(inviteButton);
    invite.append(inviteText, inviteRow);

    head.append(lead, invite);
    nodes.push(head);

    for (const group of levelGroups()) {
      const section = document.createElement("section");
      section.className = "gallery-group";

      const head = document.createElement("div");
      head.className = "gallery-group-head";
      const name = document.createElement("span");
      name.className = "gallery-group-name";
      name.textContent = t(DIFFICULTY_LABEL[group.difficulty]);
      const count = document.createElement("span");
      count.className = "gallery-group-count";
      count.textContent = t("guide.progress", {
        done: group.levels.filter((level) => this.solvedLevels.has(level.id)).length,
        total: group.levels.length,
      });
      head.append(name, count);
      section.append(head);

      const grid = document.createElement("div");
      grid.className = "level-grid";
      for (const level of group.levels) {
        grid.append(this.levelCard(level));
      }
      section.append(grid);
      nodes.push(section);
    }

    this.dom.galleryBody.replaceChildren(...nodes);
  }

  private levelCard(level: Level): HTMLElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "level-card";
    const solved = this.solvedLevels.has(level.id);
    card.dataset["solved"] = String(solved);

    const head = document.createElement("div");
    head.className = "level-card-head";
    const title = document.createElement("span");
    title.className = "level-card-title";
    title.textContent = levelTitle(level);
    const tick = document.createElement("span");
    tick.className = "level-tick";
    tick.textContent = solved ? "✓" : "·";
    tick.setAttribute("aria-label", solved ? t("guide.solved") : "");
    head.append(title, tick);

    const brief = document.createElement("p");
    brief.className = "level-card-brief";
    brief.textContent = levelBrief(level);

    const meta = document.createElement("span");
    meta.className = "level-card-meta";
    meta.textContent = t("levels.by", { name: level.author });

    card.append(head, brief, meta);
    card.addEventListener("click", () => this.openLevel(level));
    return card;
  }
}

// ── Small pieces the guide is built from ──────────────────────────────────

function heading(text: string): HTMLElement {
  const node = document.createElement("h2");
  node.className = "guide-head";
  node.textContent = text;
  return node;
}

/** The facts about what is on screen: a chapter number, a band, an author. */
function tags(entries: string[]): HTMLElement {
  const node = document.createElement("div");
  node.className = "guide-tags";
  for (const [index, entry] of entries.entries()) {
    const chip = document.createElement(index === 0 ? "b" : "span");
    chip.textContent = entry;
    node.append(chip);
  }
  return node;
}

/**
 * The task, framed and set apart.
 *
 * `compareWorlds` explains what is *wrong* with a world, which is only useful
 * to somebody who already knows what right looks like. This is that, and it is
 * the sentence a reader comes back to after every failed run.
 */
function taskBox(text: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "guide-task";
  const label = document.createElement("span");
  label.className = "guide-task-label";
  label.textContent = t("guide.task");
  const line = document.createElement("p");
  line.textContent = text;
  box.append(label, line);
  return box;
}

function guideButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "guide-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/** A labelled field. The label's text is written by the panel's update pass. */
function textField(kind: "input" | "textarea"): {
  root: HTMLElement;
  label: HTMLElement;
  field: HTMLInputElement | HTMLTextAreaElement;
} {
  const root = document.createElement("label");
  root.className = "field";
  const label = document.createElement("span");
  label.className = "field-label";
  const field = document.createElement(kind);
  field.className = "text-input";
  if (field instanceof HTMLInputElement) {
    field.type = "text";
  }
  root.append(label, field);
  return { root, label, field };
}

/**
 * The contribution form's own nodes, held so the panel can be updated rather
 * than rebuilt. Rebuilding it would throw away whatever has been typed.
 */
interface ContributionPanel {
  root: HTMLElement;
  /** Every node whose text is a catalogue entry, rewritten on each render. */
  labels: { key: MessageKey; node: HTMLElement }[];
  steps: HTMLLIElement[];
  captureButton: HTMLButtonElement;
  capturedNote: HTMLElement;
  title: HTMLInputElement;
  brief: HTMLTextAreaElement;
  author: HTMLInputElement;
  bands: HTMLButtonElement[];
  facing: HTMLButtonElement;
  sendButton: HTMLButtonElement;
  note: HTMLElement;
  errors: HTMLElement;
  link: HTMLAnchorElement;
  file: HTMLElement;
}

type MetricKey = "position" | "facing" | "bag" | "steps";

const METRICS: [MetricKey, MessageKey][] = [
  ["position", "metric.position"],
  ["facing", "metric.facing"],
  ["bag", "metric.bag"],
  ["steps", "metric.steps"],
];

const ACTION_GLYPH: Record<"run" | "stop", string> = {
  run: "▶",
  stop: "■",
};

const ACTION_LABEL: Record<"run" | "stop", MessageKey> = {
  run: "transport.run",
  stop: "transport.stop",
};

restoreTheme();
restoreSkin();

// Before the app is built, so the page is never briefly in two languages at
// once: the markup ships English, and this rewrites it in place.
restoreLocale();
applyStaticText();

// After the sweep: the picker builds its own buttons and translates them.
mountSkinPicker();

// The footer spells the modifier out, and it is not the same word everywhere.
for (const node of document.querySelectorAll("[data-mod]")) {
  node.textContent = navigator.platform.startsWith("Mac") ? "⌘" : "ctrl";
}

// Decoding a link is asynchronous, so the app is built after the answer rather
// than being corrected once it arrives: a shared world that appeared a frame
// late, over the top of the visitor's own, would be the worst of both.
void decodeState(window.location.hash).then(
  (shared) => new Application(shared),
  () => new Application(null)
);
