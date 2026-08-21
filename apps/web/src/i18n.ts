/**
 * Every user-facing string the app itself produces, in one place.
 *
 * This is the chrome's half of the same seam the core already has in
 * messages.ts, and it is deliberately built the same way: the English
 * catalogue is the definition, every other catalogue is annotated with its
 * type, and a translation that forgot a key is a compile error rather than a
 * sentence that quietly falls back to English in front of a classroom.
 *
 * The two halves stay in step because `setLocale` here also sets the core's:
 * an interpreter error and the label on the button that ran it must never
 * disagree about what language this page is in.
 *
 * Values are plain strings rather than functions, because a flat table of
 * strings is what the markup pass below needs — `data-i18n="key"` on a node
 * and one sweep to fill them all in. The handful of strings that take a
 * parameter carry a `{name}` placeholder that `t()` substitutes; a test
 * checks that both catalogues agree about which placeholders a string has,
 * since the type alone cannot say that.
 */

import { setLocale as setCoreLocale, type Locale as CoreLocale } from "@karel/core";

/**
 * The app's locales are the core's locales, by definition rather than by
 * coincidence. Together with `CATALOGUES` below being a `Record<Locale, …>`,
 * this means a language added to the core stops this build until the chrome
 * has been translated too — which beats a page that is half in one language.
 */
export type Locale = CoreLocale;

const en = {
  // ── Masthead ────────────────────────────────────────────────────────────
  "page.title": "Karel · a robot on a grid",
  "page.description":
    "Karel the Robot in the browser. Write a program, watch it walk the grid, " +
    "pick up the beepers, build your own world.",
  "masthead.subtitle": "a robot on a grid",
  "masthead.worlds": "Worlds",
  "masthead.themes": "Colour theme",
  "masthead.theme": "theme",
  // {name} is a theme's own name, which is not translated: "charm" is what the
  // palette is called in either language.
  "masthead.themeOption": "{name} theme",
  "masthead.languages": "Language",
  "masthead.language": "lang",
  "masthead.languageOption": "Show this page in {name}",
  "masthead.share": "share",
  "masthead.shareTitle": "Copy a link that opens this program and this world",
  "masthead.shareUrl": "Link to this program and world",
  "masthead.about": "how it works",

  // ── Panels ──────────────────────────────────────────────────────────────
  "panel.program": "program",
  "panel.problems": "problems",
  "panel.world": "world",
  "panel.map": "map",
  "panel.readout": "Readings",

  "problems.none": "none",
  "problems.clean": "the program parses",

  // ── Transport ───────────────────────────────────────────────────────────
  "transport.group": "Run or stop",
  "transport.run": "run",
  "transport.stop": "stop",
  "transport.step": "step",
  "transport.stepTitle": "Execute one instruction",
  "transport.reset": "reset",
  "transport.resetTitle": "Put the world back as it started",

  "speed.label": "speed",
  // Multipliers, not prose — but the decimal separator is not the same
  // everywhere, which is exactly the kind of thing a catalogue is for.
  "speed.quarter": "0.25x",
  "speed.half": "0.5x",
  "speed.normal": "1x",
  "speed.double": "2x",
  "speed.quad": "4x",

  "toggle.coordinates": "coordinates",
  "toggle.editMap": "edit map",
  "toggle.editMapTitle": "Build the world by hand",

  // ── Readout ─────────────────────────────────────────────────────────────
  "metric.position": "corner",
  "metric.facing": "facing",
  "metric.bag": "bag",
  "metric.steps": "steps",

  "facing.north": "north",
  "facing.south": "south",
  "facing.east": "east",
  "facing.west": "west",

  // ── Status chip ─────────────────────────────────────────────────────────
  "status.idle": "idle",
  "status.running": "running",
  "status.stepping": "stepping",
  "status.done": "done",
  "status.error": "error",
  "status.edit": "edit",

  // ── Map editor ──────────────────────────────────────────────────────────
  "palette.group": "Map editor",
  "palette.tool": "tool",
  "palette.tools": "Tool",
  "palette.toolWall": "wall",
  "palette.toolBeeper": "beeper",
  "palette.toolKarel": "karel",
  "palette.hintWall": "click the edge between two corners · again to remove",
  "palette.hintBeeper": "click adds one · alt or right click takes one back",
  "palette.hintKarel": "click sets him down · r turns him left",

  "palette.size": "size",
  "palette.narrower": "Narrower",
  "palette.wider": "Wider",
  "palette.shorter": "Shorter",
  "palette.taller": "Taller",
  "palette.width": "World width",
  "palette.height": "World height",

  "palette.bag": "bag",
  "palette.bagField": "Beepers in Karel's bag",
  "palette.bagFewer": "One beeper fewer",
  "palette.bagMore": "One beeper more",

  "palette.clearBeepers": "clear beepers",
  "palette.clearWalls": "clear walls",
  "palette.export": "export .klm",
  "palette.exportTitle": "Download this world as a .klm file",

  // ── Notes: a word in the palette's chip, gone a few seconds later ───────
  "note.exported": "saved as .klm",
  "note.wallOnEdge": "a wall goes on the edge between two corners",
  "note.linkCopied": "link copied to the clipboard",
  "note.clipboardRefused": "the clipboard refused — copy the link below",

  // ── The app's own errors ────────────────────────────────────────────────
  "error.invalidWorld": "invalid world",
  "error.notJson": "That file is not valid JSON: {message}",
  "error.fixProgram": "Fix the errors in the program first.",

  // ── Footer hints ────────────────────────────────────────────────────────
  "hint.run": "run",
  "hint.step": "step",
  "hint.stop": "stop",
  "hint.reset": "reset",
  "hint.editMap": "edit map",
  "hint.world": "world",
  "hint.help": "help",

  // ── The "how it works" dialog ───────────────────────────────────────────
  "about.title": "how it works",
  "about.close": "esc",

  // ── The bundled exercises ───────────────────────────────────────────────
  // Keyed on the exercise id in worlds.ts, so an exercise added there without
  // a name and a brief in both languages does not compile.
  "world.first-steps.label": "first steps",
  "world.first-steps.brief":
    "An empty 8 by 8 world. Move Karel around and get a feel for the four " +
    "instructions that do anything: move, turnleft, pickbeeper, putbeeper.",
  "world.collect.label": "collect",
  "world.collect.brief":
    "Three beepers sit in a row ahead of Karel. Pick up all of them and " +
    "come back to the corner you started from.",
  "world.maze.label": "maze",
  "world.maze.brief":
    "A wall stands between Karel and the beeper. Walls block movement in " +
    "both directions, and front-is-clear is how Karel finds out.",
  "world.sandbox.label": "sandbox",
  "world.sandbox.brief":
    "The world from the repository's examples, with a few piles and a few " +
    "walls. Nothing to solve — a place to try things.",
} as const;

export type MessageKey = keyof typeof en;

/** The shape every catalogue has to satisfy. */
type Catalogue = Record<MessageKey, string>;

/**
 * Spanish.
 *
 * "Zumbador" rather than "beeper", matching the core and matching how Karel
 * is taught in Spanish. Instruction and condition names are never translated
 * — `pickbeeper` is what you type either way — so where a brief names one it
 * keeps the English spelling and the sentence around it does the explaining.
 */
const es: Catalogue = {
  // ── Masthead ────────────────────────────────────────────────────────────
  "page.title": "Karel · un robot en una cuadrícula",
  "page.description":
    "Karel el Robot en el navegador. Escribe un programa, míralo recorrer la " +
    "cuadrícula, recoger los zumbadores y construye tu propio mundo.",
  "masthead.subtitle": "un robot en una cuadrícula",
  "masthead.worlds": "Mundos",
  "masthead.themes": "Tema de color",
  "masthead.theme": "tema",
  "masthead.themeOption": "tema {name}",
  "masthead.languages": "Idioma",
  "masthead.language": "idioma",
  "masthead.languageOption": "Ver esta página en {name}",
  "masthead.share": "compartir",
  "masthead.shareTitle": "Copiar un enlace que abre este programa y este mundo",
  "masthead.shareUrl": "Enlace a este programa y este mundo",
  "masthead.about": "cómo funciona",

  // ── Panels ──────────────────────────────────────────────────────────────
  "panel.program": "programa",
  "panel.problems": "problemas",
  "panel.world": "mundo",
  "panel.map": "mapa",
  "panel.readout": "Lecturas",

  "problems.none": "ninguno",
  "problems.clean": "el programa compila",

  // ── Transport ───────────────────────────────────────────────────────────
  "transport.group": "Ejecutar o parar",
  "transport.run": "ejecutar",
  "transport.stop": "parar",
  "transport.step": "paso",
  "transport.stepTitle": "Ejecutar una sola instrucción",
  "transport.reset": "reiniciar",
  "transport.resetTitle": "Dejar el mundo como estaba al principio",

  "speed.label": "velocidad",
  "speed.quarter": "0,25x",
  "speed.half": "0,5x",
  "speed.normal": "1x",
  "speed.double": "2x",
  "speed.quad": "4x",

  "toggle.coordinates": "coordenadas",
  "toggle.editMap": "editar mapa",
  "toggle.editMapTitle": "Construir el mundo a mano",

  // ── Readout ─────────────────────────────────────────────────────────────
  "metric.position": "esquina",
  "metric.facing": "mirando",
  "metric.bag": "mochila",
  "metric.steps": "pasos",

  "facing.north": "norte",
  "facing.south": "sur",
  "facing.east": "este",
  "facing.west": "oeste",

  // ── Status chip ─────────────────────────────────────────────────────────
  "status.idle": "en espera",
  "status.running": "ejecutando",
  "status.stepping": "paso a paso",
  "status.done": "terminado",
  "status.error": "error",
  "status.edit": "edición",

  // ── Map editor ──────────────────────────────────────────────────────────
  "palette.group": "Editor de mapas",
  "palette.tool": "herramienta",
  "palette.tools": "Herramienta",
  "palette.toolWall": "muro",
  "palette.toolBeeper": "zumbador",
  "palette.toolKarel": "karel",
  "palette.hintWall": "haz clic en la arista entre dos esquinas · otra vez para quitarlo",
  "palette.hintBeeper": "un clic añade uno · alt o clic derecho quita uno",
  "palette.hintKarel": "un clic lo coloca · r lo gira a la izquierda",

  "palette.size": "tamaño",
  "palette.narrower": "Más estrecho",
  "palette.wider": "Más ancho",
  "palette.shorter": "Más bajo",
  "palette.taller": "Más alto",
  "palette.width": "Ancho del mundo",
  "palette.height": "Alto del mundo",

  "palette.bag": "mochila",
  "palette.bagField": "Zumbadores en la mochila de Karel",
  "palette.bagFewer": "Un zumbador menos",
  "palette.bagMore": "Un zumbador más",

  "palette.clearBeepers": "quitar zumbadores",
  "palette.clearWalls": "quitar muros",
  "palette.export": "exportar .klm",
  "palette.exportTitle": "Descargar este mundo como un fichero .klm",

  // ── Notes ───────────────────────────────────────────────────────────────
  "note.exported": "guardado como .klm",
  "note.wallOnEdge": "un muro va en la arista entre dos esquinas",
  "note.linkCopied": "enlace copiado al portapapeles",
  "note.clipboardRefused": "el portapapeles se negó — copia el enlace de abajo",

  // ── The app's own errors ────────────────────────────────────────────────
  "error.invalidWorld": "mundo inválido",
  "error.notJson": "Ese fichero no es JSON válido: {message}",
  "error.fixProgram": "Corrige antes los errores del programa.",

  // ── Footer hints ────────────────────────────────────────────────────────
  "hint.run": "ejecutar",
  "hint.step": "paso",
  "hint.stop": "parar",
  "hint.reset": "reiniciar",
  "hint.editMap": "editar mapa",
  "hint.world": "mundo",
  "hint.help": "ayuda",

  // ── The "how it works" dialog ───────────────────────────────────────────
  "about.title": "cómo funciona",
  "about.close": "esc",

  // ── The bundled exercises ───────────────────────────────────────────────
  "world.first-steps.label": "primeros pasos",
  "world.first-steps.brief":
    "Un mundo vacío de 8 por 8. Mueve a Karel y hazte con las cuatro " +
    "instrucciones que hacen algo: move, turnleft, pickbeeper, putbeeper.",
  "world.collect.label": "recoger",
  "world.collect.brief":
    "Hay tres zumbadores en fila delante de Karel. Recógelos todos y vuelve " +
    "a la esquina de la que saliste.",
  "world.maze.label": "laberinto",
  "world.maze.brief":
    "Un muro se interpone entre Karel y el zumbador. Los muros bloquean el " +
    "paso en ambos sentidos, y front-is-clear es como Karel se entera.",
  "world.sandbox.label": "pruebas",
  "world.sandbox.brief":
    "El mundo de los ejemplos del repositorio, con unas cuantas pilas y unos " +
    "cuantos muros. Nada que resolver — un sitio donde probar cosas.",
};

/** Every catalogue, exposed so tests can compare them as a set. */
export const CATALOGUES: Record<Locale, Catalogue> = { en, es };

/** The locales offered in the masthead, in the order they are shown. */
export const LOCALES: { id: Locale; label: string; name: string }[] = [
  { id: "en", label: "EN", name: "English" },
  { id: "es", label: "ES", name: "Español" },
];

const STORAGE_KEY = "karel.locale";
const DEFAULT_LOCALE: Locale = "en";

let locale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((entry) => entry.id === value);
}

/** Substitute `{name}` placeholders. Unknown names are left as they are. */
function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}

/**
 * The string for `key` in whichever language is current.
 *
 * The lookup happens when the string is asked for, never when a module loads,
 * which is what lets a locale change re-word text that is already on screen.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = CATALOGUES[locale][key] ?? CATALOGUES[DEFAULT_LOCALE][key];
  return vars ? format(template, vars) : template;
}

export function currentLocale(): Locale {
  return locale;
}

/**
 * Guess a locale from a browser's language preferences.
 *
 * Pure and given its input, so the guess can be tested without pretending to
 * be a browser. The list is in preference order, so the first tag that names
 * a language we have wins: someone whose browser asks for French then Spanish
 * gets Spanish rather than the default.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) {
      return base;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Switch language.
 *
 * Three things move together and none of them is optional: the core, so an
 * interpreter error is worded like the page around it; `<html lang>`, so a
 * screen reader and the browser's own machinery agree with what is on screen;
 * and the listeners, so whatever is already rendered gets re-rendered.
 */
export function setLocale(next: Locale): void {
  if (!isLocale(next)) {
    return;
  }
  locale = next;
  setCoreLocale(next);

  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing, or storage disabled. The language still applies for
    // this visit; only remembering it fails, which is not worth interrupting.
  }

  for (const listener of listeners) {
    listener();
  }
}

/** Called after the language changes. Returns the function that unsubscribes. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Adopt the stored language, or guess one.
 *
 * A stored choice always wins: someone who picked English on a Spanish
 * machine picked it on purpose, and a page that argued with them on every
 * visit would be worse than one that never guessed at all.
 */
export function restoreLocale(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage denied; fall through to the guess.
  }
  if (isLocale(stored)) {
    setLocale(stored);
    return;
  }
  if (typeof navigator === "undefined") {
    setLocale(DEFAULT_LOCALE);
    return;
  }
  const preferences = navigator.languages?.length
    ? navigator.languages
    : [navigator.language ?? ""];
  setLocale(detectLocale(preferences));
}

/**
 * Fill in the text the document ships with.
 *
 * The page is not built by a framework, so the markup carries its own English
 * and each translatable node names its key: `data-i18n` for the text,
 * `data-i18n-title`, `data-i18n-aria` and `data-i18n-content` for the three
 * attributes that hold prose. One sweep rewrites the lot, and running it
 * again after a locale change is the whole mechanism — there is no second
 * path by which static text changes language.
 *
 * A key the catalogue does not have leaves the node alone rather than
 * blanking it: the English in the markup is a worse answer than the right
 * translation and a much better one than an empty button.
 */
const ATTRIBUTES: [attribute: string, target: string][] = [
  ["data-i18n-title", "title"],
  ["data-i18n-aria", "aria-label"],
  ["data-i18n-content", "content"],
];

export function applyStaticText(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = node.dataset["i18n"];
    if (key && key in en) {
      node.textContent = t(key as MessageKey);
    }
  }
  for (const [attribute, target] of ATTRIBUTES) {
    for (const node of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = node.getAttribute(attribute);
      if (key && key in en) {
        node.setAttribute(target, t(key as MessageKey));
      }
    }
  }
}
