/**
 * The wiring.
 *
 * Every other module owns one thing and knows nothing about the rest: the
 * Session owns execution state, the renderer owns the canvas, the editor owns
 * the document, draft.ts owns what editing a world means. This file is the
 * only place they meet, and the only place that reaches into the DOM the page
 * ships with.
 *
 * The shape is Collisions': one class holds the state, one render() projects
 * all of it onto the page, and every event handler mutates state and calls
 * render() rather than touching the DOM directly. It stays honest because
 * there is exactly one path from a change to what you see.
 *
 * There are two modes and they are exclusive on purpose. In `run` the canvas
 * is a readout of whatever the Session reports. In `edit` the canvas is an
 * instrument: the program is stopped, the transport is dead, and every gesture
 * goes through draft.ts and back in as the session's starting map. A world
 * being rewritten under a running interpreter is two owners of one state, and
 * that is the bug this whole file is arranged to prevent.
 */

import { MAX_WORLD_SIZE, type KarelMap, type Wall } from "@karel/core";
import { createEditor } from "./editor/editor.js";
import { createRenderer } from "./render/world.js";
import { renderHelp } from "./help.js";
import { THEMES, currentTheme, onThemeChange, restoreTheme, setTheme } from "./render/theme.js";
import { DEFAULT_SPEED_MS, SPEED_PRESETS, Session } from "./session.js";
import type { HitTarget, KarelEditor, SessionState, WorldRenderer } from "./contracts.js";
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
import { decodeState, shareUrl, type SharedState } from "./share.js";
import {
  EXERCISES,
  downloadWorld,
  exerciseById,
  loadWorkspace,
  parseWorldFile,
  saveWorkspace,
  type Exercise,
} from "./worlds.js";

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`the page is missing ${selector}`);
  }
  return element;
}

type Mode = "run" | "edit";
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
 * caller has a third answer for when neither does — showing the link.
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

class Application {
  private readonly editor: KarelEditor;
  private readonly renderer: WorldRenderer;
  private session: Session;
  private exercise: Exercise;
  /** Set when the world is no longer the exercise's: imported, or edited. */
  private customWorld: KarelMap | null = null;
  private showAxes = true;

  private mode: Mode = "run";
  private tool: Tool = "wall";
  /** The corner under the pointer, previewed while editing. */
  private cursor: { x: number; y: number } | null = null;
  private stroke: Stroke | null = null;
  private noteTimer = 0;
  /** Built by buildToggles, and the only view toggle there is so far. */
  private axesToggle: HTMLButtonElement | null = null;

  private readonly dom = {
    canvas: query<HTMLCanvasElement>("#world-canvas"),
    worlds: query("#worlds"),
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
    palette: query("#palette"),
    paletteNote: query("#palette-note"),
    tools: query("#tools"),
    toolHint: query("#tool-hint"),
    width: query<HTMLInputElement>("#world-width"),
    height: query<HTMLInputElement>("#world-height"),
    bag: query<HTMLInputElement>("#karel-bag"),
    clearBeepers: query<HTMLButtonElement>("#clear-beepers"),
    clearWalls: query<HTMLButtonElement>("#clear-walls"),
    exportWorld: query<HTMLButtonElement>("#export-world"),
    shareLink: query<HTMLButtonElement>("#share-link"),
    shareUrlField: query<HTMLInputElement>("#share-url"),
    aboutContent: query("#about-content"),
  };

  /**
   * `shared` is the state a link carried, already decoded. It wins over
   * localStorage outright: someone who opens a link is expecting what they
   * were sent, not the world they left open last week.
   */
  constructor(shared: SharedState | null) {
    const stored = loadWorkspace();
    this.exercise = exerciseById(stored?.exerciseId ?? EXERCISES[0].id);
    this.customWorld = shared?.world ?? stored?.world ?? null;

    this.session = new Session(this.customWorld ?? this.exercise.world, {
      onChange: () => this.render(),
    });
    this.session.setSpeed(stored?.speedMs ?? DEFAULT_SPEED_MS);

    this.renderer = createRenderer(this.dom.canvas);
    this.editor = createEditor(
      query("#editor-host"),
      shared?.program ?? stored?.program ?? this.exercise.program
    );
    this.editor.onChange((source) => {
      this.session.setSource(source);
      this.persist();
    });
    this.session.setSource(this.editor.getSource());

    this.buildExercises();
    this.buildThemes();
    this.buildLanguages();
    this.buildSpeeds();
    this.buildToggles();
    this.buildReadout();
    this.bindTransport();
    this.bindKeyboard();
    this.bindWorldFiles();
    this.bindAbout();
    this.bindPalette();
    this.bindCanvas();

    onThemeChange(() => this.render());
    onLocaleChange(() => {
      // Three things have to move, and none of them may touch the program or
      // the world: the document's own text, the diagnostics (which the core
      // worded when the source was last parsed, so they are re-parsed rather
      // than left in the previous language), and everything render() writes.
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

  // ── Chrome ──────────────────────────────────────────────────────────────

  private buildExercises(): void {
    for (const [index, exercise] of EXERCISES.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel";
      // Two nodes rather than one string, because the name is translated and
      // the number is not; render() rewrites only the half that changes.
      const number = document.createElement("span");
      number.className = "index";
      number.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "channel-label";
      label.textContent = exercise.label;
      button.append(number, label);
      button.addEventListener("click", () => this.selectExercise(exercise));
      this.dom.worlds.append(button);
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
      // The palette's number fields are typed into the same way.
      const target = event.target as HTMLElement | null;
      const typing = target?.closest(".cm-editor, input, textarea") !== null;
      const chord = event.metaKey || event.ctrlKey;

      // The browser keeps F5, so run and step are chords rather than the
      // function keys the VS Code extension uses. Neither does anything while
      // the world is being edited: the transport is off in that mode, and a
      // shortcut that ignores the mode would be the one way back in.
      if (chord && event.key === "Enter") {
        event.preventDefault();
        if (this.mode === "run") {
          void this.session.run();
        }
        return;
      }
      if (chord && event.key === ".") {
        event.preventDefault();
        if (this.mode === "run") {
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
        this.setMode(this.mode === "edit" ? "run" : "edit");
        return;
      }
      if (event.key === "r") {
        // The only turn the language has, and the only way to aim Karel with
        // the pointer: clicking places him, r points him.
        if (this.mode === "edit") {
          this.applyEdit(turnKarel);
        } else {
          this.session.reset();
        }
        return;
      }
      const index = Number(event.key);
      if (Number.isInteger(index) && index >= 1 && index <= EXERCISES.length) {
        this.selectExercise(EXERCISES[index - 1]);
      }
    });
  }

  private bindWorldFiles(): void {
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
      void file.text().then((text) => {
        if (file.name.endsWith(".kli")) {
          this.editor.setSource(text);
          this.session.setSource(text);
          this.persist();
          return;
        }
        const result = parseWorldFile(text);
        if (!result.ok) {
          this.session.reset();
          this.dom.worldNote.textContent = t("error.invalidWorld");
          return;
        }
        this.customWorld = result.world;
        this.session.setWorld(result.world);
        this.persist();
      });
    });
  }

  private bindAbout(): void {
    this.dom.aboutButton.addEventListener("click", () => this.dom.about.showModal());
    this.dom.aboutClose.addEventListener("click", () => this.dom.about.close());
  }

  // ── The map editor ──────────────────────────────────────────────────────

  private bindPalette(): void {
    this.dom.modeToggle.addEventListener("click", () =>
      this.setMode(this.mode === "edit" ? "run" : "edit")
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

    this.dom.exportWorld.addEventListener("click", () => {
      downloadWorld(this.session.startingMap(), `${this.exercise.id}.klm`);
      this.note(t("note.exported"), true);
    });

    this.dom.shareLink.addEventListener("click", () => void this.share());
  }

  private bindCanvas(): void {
    const canvas = this.dom.canvas;

    canvas.addEventListener("pointerdown", (event) => {
      if (this.mode !== "edit" || (event.button !== 0 && event.button !== 2)) {
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
      if (this.mode !== "edit") {
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
        this.render();
      }
    });

    // The right button is the "take one back" gesture, so it must not also
    // raise a menu over the world.
    canvas.addEventListener("contextmenu", (event) => {
      if (this.mode === "edit") {
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

  /** Preview where the next gesture lands. Repaints only when it moves. */
  private moveCursor(hit: HitTarget): void {
    const next = hit.kind === "outside" ? null : { x: hit.x, y: hit.y };
    if (next?.x === this.cursor?.x && next?.y === this.cursor?.y) {
      return;
    }
    this.cursor = next;
    this.render();
  }

  /**
   * Run one of draft.ts's edits and make the result the world.
   *
   * It goes in as the Session's starting map rather than being held to one
   * side, so the canvas keeps drawing exactly what the next run will begin
   * from and there is never a second world to keep in step.
   */
  private applyEdit(change: (world: KarelMap) => KarelMap): void {
    const before = this.session.startingMap();
    const after = change(before);
    if (after === before) {
      // draft.ts hands back the same map when the edit was a no-op.
      return;
    }
    this.customWorld = after;
    this.session.setWorld(after); // renders, through onChange
    this.persist();
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

  private setMode(mode: Mode): void {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
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
      return;
    }
    // Nothing was copied, so the link has to be somewhere it can be reached.
    this.dom.shareUrlField.hidden = false;
    this.dom.shareUrlField.value = url;
    this.dom.shareUrlField.select();
    this.note(t("note.clipboardRefused"));
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

  // ── State changes ───────────────────────────────────────────────────────

  private selectExercise(exercise: Exercise): void {
    this.exercise = exercise;
    this.customWorld = null;
    this.session.setWorld(exercise.world);
    this.editor.setSource(exercise.program);
    this.session.setSource(exercise.program);
    this.persist();
    this.render();
  }

  private persist(): void {
    saveWorkspace({
      exerciseId: this.exercise.id,
      program: this.editor.getSource(),
      ...(this.customWorld ? { world: this.customWorld } : {}),
      speedMs: this.session.speed(),
    });
  }

  // ── Projection ──────────────────────────────────────────────────────────

  private render(): void {
    const view = this.session.view();
    const editing = this.mode === "edit";

    this.renderer.draw(view.world, {
      showAxes: this.showAxes,
      cursor: editing ? this.cursor : null,
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
    this.dom.programNote.textContent = this.exercise.label;

    this.renderPalette(view.world);
    this.renderProblems();
    this.renderMetrics(view.world, view.steps);
    this.renderSelections();
    renderHelp(this.dom.aboutContent, this.exercise);
  }

  private renderPalette(world: KarelMap): void {
    this.dom.palette.hidden = this.mode !== "edit";
    this.dom.modeToggle.setAttribute("aria-pressed", String(this.mode === "edit"));

    for (const button of this.dom.tools.querySelectorAll<HTMLButtonElement>(".tool")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === this.tool));
    }
    this.dom.toolHint.textContent = t(TOOL_HINT[this.tool]);
    this.writeNumbers(world, false);
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
    for (const [index, button] of [...this.dom.worlds.children].entries()) {
      const exercise = EXERCISES[index];
      const selected = exercise?.id === this.exercise.id && !this.customWorld;
      button.setAttribute("aria-selected", String(selected));
      const label = button.querySelector(".channel-label");
      if (exercise && label) {
        label.textContent = exercise.label;
      }
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

// Before the app is built, so the page is never briefly in two languages at
// once: the markup ships English, and this rewrites it in place.
restoreLocale();
applyStaticText();

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
