/**
 * The wiring.
 *
 * Every other module owns one thing and knows nothing about the rest: the
 * Session owns execution state, the renderer owns the canvas, the editor owns
 * the document. This file is the only place they meet, and the only place that
 * reaches into the DOM the page ships with.
 *
 * The shape is Collisions': one class holds the state, one render() projects
 * all of it onto the page, and every event handler mutates state and calls
 * render() rather than touching the DOM directly. It stays honest because
 * there is exactly one path from a change to what you see.
 */

import type { KarelMap } from "@karel/core";
import { createEditor } from "./editor/editor.js";
import { createRenderer } from "./render/world.js";
import { THEMES, currentTheme, onThemeChange, restoreTheme, setTheme } from "./render/theme.js";
import { DEFAULT_SPEED_MS, SPEED_PRESETS, Session } from "./session.js";
import type { KarelEditor, WorldRenderer } from "./contracts.js";
import {
  EXERCISES,
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

class Application {
  private readonly editor: KarelEditor;
  private readonly renderer: WorldRenderer;
  private session: Session;
  private exercise: Exercise;
  /** Set when the world has been replaced by an imported file. */
  private importedWorld: KarelMap | null = null;
  private showAxes = true;

  private readonly dom = {
    canvas: query<HTMLCanvasElement>("#world-canvas"),
    worlds: query("#worlds"),
    themes: query("#themes"),
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
    aboutContent: query("#about-content"),
  };

  constructor() {
    const stored = loadWorkspace();
    this.exercise = exerciseById(stored?.exerciseId ?? EXERCISES[0].id);
    this.importedWorld = stored?.world ?? null;

    this.session = new Session(this.importedWorld ?? this.exercise.world, {
      onChange: () => this.render(),
    });
    this.session.setSpeed(stored?.speedMs ?? DEFAULT_SPEED_MS);

    this.renderer = createRenderer(this.dom.canvas);
    this.editor = createEditor(query("#editor-host"), stored?.program ?? this.exercise.program);
    this.editor.onChange((source) => {
      this.session.setSource(source);
      this.persist();
    });
    this.session.setSource(this.editor.getSource());

    this.buildExercises();
    this.buildThemes();
    this.buildSpeeds();
    this.buildToggles();
    this.buildReadout();
    this.bindTransport();
    this.bindKeyboard();
    this.bindWorldFiles();
    this.bindAbout();

    onThemeChange(() => this.render());
    new ResizeObserver(() => {
      this.renderer.resize();
      this.render();
    }).observe(query("#viewport"));

    this.render();
  }

  // ── Chrome ──────────────────────────────────────────────────────────────

  private buildExercises(): void {
    for (const [index, exercise] of EXERCISES.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel";
      button.innerHTML = `<span class="index">${index + 1}</span>${exercise.label}`;
      button.addEventListener("click", () => this.selectExercise(exercise));
      this.dom.worlds.append(button);
    }
  }

  private buildThemes(): void {
    for (const theme of THEMES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `swatch swatch-${theme.id}`;
      button.title = theme.label;
      button.setAttribute("aria-label", `${theme.label} theme`);
      button.addEventListener("click", () => setTheme(theme.id));
      this.dom.themes.append(button);
    }
  }

  private buildSpeeds(): void {
    for (const preset of SPEED_PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rate-option";
      button.textContent = preset.label;
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
    toggle.textContent = "coordinates";
    toggle.addEventListener("click", () => {
      this.showAxes = !this.showAxes;
      this.render();
    });
    this.dom.toggles.append(toggle);
  }

  private buildReadout(): void {
    // Four readings, built once and updated in place. Rebuilding the nodes on
    // every step would throw away the flash animation that marks a change.
    for (const [key, label] of METRICS) {
      const panel = document.createElement("section");
      panel.className = "panel";
      panel.innerHTML =
        `<span class="panel-title">${label}</span>` +
        `<div class="panel-body"><span class="metric-value" data-metric="${key}">—</span></div>`;
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
      const inEditor = (event.target as HTMLElement | null)?.closest(".cm-editor") !== null;
      const chord = event.metaKey || event.ctrlKey;

      // The browser keeps F5, so run and step are chords rather than the
      // function keys the VS Code extension uses.
      if (chord && event.key === "Enter") {
        event.preventDefault();
        void this.session.run();
        return;
      }
      if (chord && event.key === ".") {
        event.preventDefault();
        this.session.step();
        return;
      }
      if (inEditor) {
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
      if (event.key === "r") {
        this.session.reset();
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
    frame.addEventListener("dragleave", () => frame.classList.remove("dropping"));
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
          this.dom.worldNote.textContent = "invalid world";
          return;
        }
        this.importedWorld = result.world;
        this.session.setWorld(result.world);
        this.persist();
      });
    });
  }

  private bindAbout(): void {
    this.dom.aboutButton.addEventListener("click", () => this.dom.about.showModal());
    this.dom.aboutClose.addEventListener("click", () => this.dom.about.close());
  }

  // ── State changes ───────────────────────────────────────────────────────

  private selectExercise(exercise: Exercise): void {
    this.exercise = exercise;
    this.importedWorld = null;
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
      ...(this.importedWorld ? { world: this.importedWorld } : {}),
      speedMs: this.session.speed(),
    });
  }

  // ── Projection ──────────────────────────────────────────────────────────

  private render(): void {
    const view = this.session.view();

    this.renderer.draw(view.world, { showAxes: this.showAxes, cursor: null });

    this.editor.setDiagnostics(this.session.currentDiagnostics());
    this.editor.setActiveLine(view.line);
    this.editor.setEditable(view.state !== "running");

    const action = this.session.primaryAction();
    this.dom.runGlyph.textContent = ACTION_GLYPH[action];
    this.dom.runLabel.textContent = action;
    this.dom.step.disabled = view.state === "running";

    this.dom.status.textContent = view.message ?? view.state;
    this.dom.status.dataset.state = view.state;

    const { width, height } = view.world.dimensions;
    this.dom.worldNote.textContent = `${width}x${height}`;
    this.dom.programNote.textContent = this.exercise.label;

    this.renderProblems();
    this.renderMetrics(view.world, view.steps);
    this.renderSelections();
    this.dom.aboutContent.textContent = this.exercise.brief;
  }

  private renderProblems(): void {
    const diagnostics = this.session.currentDiagnostics();
    this.dom.problemsNote.textContent = diagnostics.length === 0 ? "none" : `${diagnostics.length}`;

    const list = this.dom.problems.querySelector(".problem-list");
    if (!list) {
      return;
    }
    list.replaceChildren(
      ...diagnostics.map((d) => {
        const row = document.createElement("li");
        row.className = `problem problem-${d.severity}`;
        // Columns are 0-based in the parser and 1-based everywhere a person
        // reads them, including the line:column the CLI prints.
        row.innerHTML =
          `<button type="button" class="problem-where">${d.line}:${d.column + 1}</button>` +
          `<span class="problem-message"></span>`;
        row.querySelector(".problem-message")!.textContent = d.message;
        row.querySelector("button")!.addEventListener("click", () => {
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
      facing: world.karel.facing,
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
      node.classList.remove("value-touched");
      void node.offsetWidth;
      node.classList.add("value-touched");
    }
  }

  private renderSelections(): void {
    for (const [index, button] of [...this.dom.worlds.children].entries()) {
      const selected = EXERCISES[index]?.id === this.exercise.id && !this.importedWorld;
      button.setAttribute("aria-selected", String(selected));
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
    this.dom.toggles.firstElementChild?.setAttribute("aria-pressed", String(this.showAxes));
  }
}

type MetricKey = "position" | "facing" | "bag" | "steps";

const METRICS: [MetricKey, string][] = [
  ["position", "corner"],
  ["facing", "facing"],
  ["bag", "bag"],
  ["steps", "steps"],
];

const ACTION_GLYPH: Record<"run" | "stop", string> = {
  run: "▶",
  stop: "■",
};

restoreTheme();

// The footer spells the modifier out, and it is not the same word everywhere.
for (const node of document.querySelectorAll("[data-mod]")) {
  node.textContent = navigator.platform.startsWith("Mac") ? "\u2318" : "ctrl";
}

new Application();
