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
  "masthead.themes": "Colour theme",
  "masthead.theme": "theme",
  // {name} is a theme's own name, which is not translated: "charm" is what the
  // palette is called in either language.
  "masthead.themeOption": "{name} theme",
  // The skin pack decides the shapes the world is drawn with -- glyphs, pixel
  // art or the book's own drafting -- while the colours stay the theme's.
  "masthead.skins": "Map skin",
  "masthead.skin": "skin",
  // {name} is a pack's own name, untranslated for the same reason a theme's is.
  "masthead.skinOption": "{name} skin",
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
  // The two tabs over the code column are two files, and the tab strip says
  // so to anything that cannot see the border they are cut into.
  "panel.documents": "Files",
  "panel.mapTitle": "The world as a .klm file",
  "panel.readout": "Readings",

  "problems.none": "none",
  "problems.clean": "the program parses",
  "problems.mapClean": "the world loads",

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
  "palette.format": "format",
  "palette.formatTitle": "Lay the file out again, the way the canvas writes it",

  // ── Files ───────────────────────────────────────────────────────────────
  "files.group": "Files",
  "files.label": "files",
  "files.open": "open",
  "files.openTitle": "Open a .kli program or a .klm world from this device",
  "files.saveProgram": "save .kli",
  "files.saveProgramTitle": "Download the program as a .kli file",
  "files.saveWorld": "save .klm",
  "files.saveWorldTitle": "Download the world as a .klm file",

  // ── Notes: a word in the palette's chip, gone a few seconds later ───────
  "note.exported": "saved as .klm",
  "note.savedProgram": "saved as .kli",
  "note.openedWorld": "world read from the file",
  "note.openedProgram": "program read from the file",
  "note.formatted": "laid out again",
  "note.mapUnreadable": "the file has to read before it can be laid out",
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
  "hint.mode": "mode",
  "hint.help": "help",

  // ── Modes ───────────────────────────────────────────────────────────────
  // The three ways in. One is active at a time and the masthead says which.
  "masthead.modes": "Modes",
  "mode.learn": "learn",
  "mode.levels": "levels",
  "mode.sandbox": "sandbox",
  "mode.learnTitle": "The language, one chapter at a time",
  "mode.levelsTitle": "Worlds with a goal, and a way to send your own",
  "mode.sandboxTitle": "A free world, the program and the map editor",

  // ── The guide column ────────────────────────────────────────────────────
  // The third column: the lesson in learn, the brief in a level, the form
  // when a level is being sent. Nothing here appears in sandbox.
  "guide.group": "The lesson and the task",
  "guide.lesson": "lesson",
  "guide.brief": "level",
  "guide.chapters": "Chapters",
  "guide.task": "the task",
  "guide.hint": "a hint",
  "guide.hintsDone": "that was the last hint",
  "guide.solved": "solved",
  "guide.notYet": "not yet",
  "guide.solvedNote": "The world you left matches the one the task asked for.",
  "guide.check":
    "Run the program to the end and the world you leave behind is checked here, " +
    "against the same rule the command line grades with.",
  "guide.next": "next chapter",
  "guide.previous": "previous chapter",
  "guide.last": "That was the last chapter. The levels are where the practice is.",
  "guide.restart": "start again",
  "guide.restarted": "the chapter's own program is back in the editor",
  "guide.progress": "{done}/{total} solved",
  "guide.alreadySolved": "You had solved this one already.",

  // ── The level gallery ───────────────────────────────────────────────────
  "levels.group": "Levels",
  "levels.title": "levels",
  "levels.lead":
    "{count} worlds, each with a goal. Pick one, write a program, and run it to " +
    "the end — the check is the same one the command line uses.",
  "levels.difficulty.starter": "starter",
  "levels.difficulty.tricky": "tricky",
  "levels.difficulty.hard": "hard",
  "levels.by": "by {name}",
  "levels.back": "all levels",
  "levels.showSolution": "show me one way",
  "levels.solutionShown": "the reference solution is in the editor — read it, then write your own",
  "levels.next": "next level",

  // ── Sending a level of your own ─────────────────────────────────────────
  "contribute.open": "send your own level",
  // Shorter than `contribute.lead`, because in the gallery it sits beside the
  // levels rather than above a form: it has to invite, not explain.
  "contribute.invite":
    "Built a world worth solving? Send it — the page writes the file and opens " +
    "a pre-filled issue on the repository.",
  "contribute.title": "your level",
  "contribute.lead":
    "A level is one JSON file in the repository. This page writes the file and " +
    "hands GitHub a pre-filled issue; nothing is uploaded from here.",
  "contribute.step1": "Build the world Karel starts in, with the map editor below.",
  "contribute.step2": "Write a program that solves it, and run it to the end.",
  "contribute.step3":
    "Capture the run. The world it leaves behind becomes the goal, and the " +
    "program becomes the reference solution — which is what makes the level " +
    "provably solvable.",
  "contribute.step4": "Name it, and send it.",
  "contribute.capture": "capture this run",
  "contribute.captureWait": "run the program to the end first",
  "contribute.captured": "captured — a {size} world and {steps} instructions",
  "contribute.fieldTitle": "title",
  "contribute.fieldBrief": "what has to be done",
  "contribute.fieldAuthor": "your name, or your GitHub handle",
  "contribute.fieldDifficulty": "difficulty",
  "contribute.fieldFacing": "any final facing",
  "contribute.send": "open the issue on GitHub",
  "contribute.sent": "the issue is waiting in a new tab",
  "contribute.tooLong":
    "too big for a link: the level file is on your clipboard — paste it into " +
    "the issue's JSON block",
  "contribute.copyRefused": "the clipboard refused — the level file is below, copy it by hand",
  "contribute.needCapture": "capture a run before sending",
  "contribute.file": "level file",
  "contribute.copyFile": "copy the level file",
  "contribute.copied": "the level file is on your clipboard",
  "contribute.blocked": "the browser blocked the new tab — open the link below",

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

  // ── The learn-mode curriculum ───────────────────────────────────────────
  // Keyed on the chapter id in curriculum.ts, one section per chapter: the
  // title, the sentence saying what the finished world has to look like, the
  // lesson's paragraphs in order, and the hints. A chapter added there without
  // all of them in both languages does not compile.
  "learn.move.title": "one step at a time",
  "learn.move.task": "Leave Karel standing on the corner (4, 1).",
  "learn.move.p1":
    "Karel lives on a grid of corners. (1, 1) is the bottom left one: the " +
    "first number counts east, the second counts north. He always faces one " +
    "of the four compass directions, and he only ever walks the way he is " +
    "facing.",
  "learn.move.p2":
    "Every program has that same frame. BEGINNING-OF-PROGRAM opens the file " +
    "and END-OF-PROGRAM closes it; what you write between " +
    "BEGINNING-OF-EXECUTION and END-OF-EXECUTION is what actually runs. " +
    "Instructions are separated by a semicolon, and turnoff — the one that " +
    "stops the robot — goes last.",
  "learn.move.p3":
    "move takes him one corner forward. He starts on (1, 1) looking east and " +
    "has to end on (4, 1), three corners away. Walking into a wall is not a " +
    "bump: it is an error and the run stops there, so count before you write.",
  "learn.move.hint1": "From (1, 1) to (4, 1) there are three corners to cross, not four.",
  "learn.move.hint2": "Press step instead of run to watch him take one instruction at a time.",

  "learn.turn.title": "turning",
  "learn.turn.task": "Walk Karel to the corner (3, 3).",
  "learn.turn.p1":
    "There is exactly one turn in the language: turnleft. It is a quarter " +
    "turn anticlockwise, on the spot — afterwards he stands on the same " +
    "corner, looking somewhere else. Facing east, one turnleft points him " +
    "north.",
  "learn.turn.p2":
    "Turning right is the same idea three times over. It works; it just " +
    "reads badly. Chapter four gives that trio a name of its own.",
  "learn.turn.p3":
    "The strip under the world shows the corner he is on and the way he " +
    "is facing. When a program does the wrong thing, that pair usually says " +
    "why before you have finished re-reading the code.",
  "learn.turn.hint1":
    "Two moves put him on (3, 1). From there (3, 3) is north of him, so he " +
    "has to be looking north before he moves again.",
  "learn.turn.hint2": "turnleft never changes the corner he is on, only the facing in the readout.",

  "learn.bag.title": "the bag",
  "learn.bag.task": "Move the beeper from (3, 1) to (5, 1) and end there with an empty bag.",
  "learn.bag.p1":
    "The markers on the grid are beepers. Karel carries a bag of them, and " +
    "two instructions move them between the bag and the corner he stands on: " +
    "pickbeeper takes one off the floor, putbeeper drops one from the bag.",
  "learn.bag.p2":
    "Both act on the corner under his feet, never on the one ahead, and both " +
    "are errors when there is nothing to act on: pickbeeper on a bare corner " +
    "stops the program, and so does putbeeper with an empty bag.",
  "learn.bag.p3":
    "A corner can hold more than one beeper — a pile, with its count drawn " +
    "on it — and the bag has no limit. Watch the bag reading as the program " +
    "runs: it is the quickest way to spot a pickbeeper that never happened.",
  "learn.bag.hint1":
    "He has to be standing on the beeper to pick it up, so walk the two " + "corners first.",
  "learn.bag.hint2":
    "Four moves in all — two to reach the beeper, two more to carry it — " +
    "with a pickbeeper and a putbeeper around them.",

  "learn.define.title": "teaching him a word",
  "learn.define.task": "Climb two corners, turn right, and finish on (3, 3).",
  "learn.define.p1":
    "Karel is born knowing five instructions. Everything else you teach him " +
    "with DEFINE-NEW-INSTRUCTION: you give a name to a group of " +
    "instructions, and from then on that name is an instruction like any " +
    "other.",
  "learn.define.p2":
    "Definitions go above BEGINNING-OF-EXECUTION, never inside it. The name " +
    "is yours to choose — turnright is only a convention, and it is the " +
    "canonical example because the language deliberately has no right turn: " +
    "three left turns are one.",
  "learn.define.p3":
    "This matters more than it looks. A program written with names you " +
    "invented reads as what it does — turnright, harvest, go-to-the-wall — " +
    "rather than as a list of steps, and a mistake inside a definition is " +
    "fixed in one place.",
  "learn.define.hint1":
    "The definition in the editor is two turns short. Work out where one " +
    "turnleft leaves him looking, then where three do.",
  "learn.define.hint2":
    "Instructions between BEGIN and END are separated by semicolons, and the " +
    "last one does not need one.",

  "learn.iterate.title": "doing it again",
  "learn.iterate.task":
    "Leave one beeper on each corner from (1, 1) to (5, 1) and finish on " +
    "(5, 1) with an empty bag.",
  "learn.iterate.p1":
    "Writing move eight times works and reads badly. ITERATE n TIMES repeats " +
    "the block that follows exactly n times.",
  "learn.iterate.p2":
    "The count has to be a number you already know when you write the " +
    "program. That is the limit of ITERATE, and the reason WHILE exists a " +
    "couple of chapters from here.",
  "learn.iterate.p3":
    "Watch the fencepost. Five corners in a row have only four gaps between " +
    "them, so a loop that drops a beeper and then moves runs four times, and " +
    "the fifth beeper is dropped after it.",
  "learn.iterate.hint1":
    "What repeats is the body between BEGIN and END; anything written after " + "END runs once.",
  "learn.iterate.hint2":
    "He carries five beepers and has to end with none, so every one of them " +
    "has to be put down somewhere.",

  "learn.conditions.title": "looking before you leap",
  "learn.conditions.task":
    "Walk east as far as the wall allows, pick up the beeper waiting there, " + "and stop.",
  "learn.conditions.p1":
    "Karel can ask eighteen yes-or-no questions about where he is: what is " +
    "straight ahead, what is to either side, whether there are beepers here " +
    "or in his bag, and which way he is facing. Every one of them has its " +
    "opposite — front-is-clear and front-is-blocked.",
  "learn.conditions.p2":
    "IF asks one of them and runs the block that follows only when the " + "answer is yes.",
  "learn.conditions.p3":
    "front-is-clear is false for a wall between two corners and equally " +
    "false at the edge of the world, which is walled all the way round. A " +
    "move guarded like this can never break the program: when the way is " +
    "blocked, nothing happens at all.",
  "learn.conditions.hint1":
    "Run the program as it stands first: it walks into the wall and stops " +
    "with an error. That error is what the IF removes.",
  "learn.conditions.hint2":
    "Five guarded attempts are more than the three he needs; the spare ones " +
    "simply do nothing.",

  "learn.while.title": "until it is done",
  "learn.while.task":
    "Send Karel east until something stops him, pick up the beeper there, " + "and stop.",
  "learn.while.p1":
    "WHILE asks a condition and repeats its block for as long as the answer " +
    "stays yes. It asks before every pass, so a condition that is false from " +
    "the start runs the body no times at all.",
  "learn.while.p2":
    "That is the difference from ITERATE: you no longer have to know the " +
    "number. Those three lines walk to the wall whether it is three corners " +
    "away or thirty, and the same program solves a world you have never seen.",
  "learn.while.p3":
    "The price is that a WHILE whose condition never turns false never ends. " +
    "The usual cause is a body that changes nothing the condition looks at; " +
    "the page stops a runaway program by itself, but the fix is always in " +
    "the body.",
  "learn.while.hint1":
    "The loop in the editor already takes him to the wall. What is missing " +
    "is what he does once he is there.",
  "learn.while.hint2":
    "Whatever comes after END runs when the condition has turned false — " +
    "that is where the beeper gets picked up.",

  "learn.else.title": "one way or the other",
  "learn.else.task":
    "Flip the row: take the beeper from every corner that has one, leave one " +
    "on every corner that has none, and finish on (6, 1).",
  "learn.else.p1":
    "IF ... THEN ... ELSE runs the first block when the answer is yes and " +
    "the second when it is no. Exactly one of the two always happens, which " +
    "is what makes it safe to pickbeeper in one branch and putbeeper in the " +
    "other.",
  "learn.else.p2":
    "next-to-a-beeper asks about the corner Karel is standing on, not the " +
    "one in front of him. Its opposite, not-next-to-a-beeper, exists too: " +
    "asking the question the other way round often reads better than " +
    "swapping the two branches.",
  "learn.else.p3":
    "The row here is six corners long and every one of them has to be " +
    "visited, but there are only five gaps to walk. Guarding the move with " +
    "front-is-clear, the way the last chapter did, makes the last pass " +
    "harmless.",
  "learn.else.hint1":
    "The program in the editor already picks up. What it is missing is the " +
    "ELSE that deals with the empty corners.",
  "learn.else.hint2":
    "He starts with three beepers and ends with three: every one he puts " +
    "down he has taken from somewhere else.",

  "learn.piles.title": "piles",
  "learn.piles.task":
    "Sweep the corridor and end up holding every beeper in it. The piles are " +
    "not all one deep.",
  "learn.piles.p1":
    "A corner can hold a pile of beepers, and pickbeeper takes exactly one. " +
    "Asking IF next-to-a-beeper and picking once empties a pile of one and " +
    "leaves two behind on a pile of three. WHILE next-to-a-beeper asks again " +
    "after every pick, so it empties whatever is there.",
  "learn.piles.p2":
    "That is a loop inside a loop, and it is where the definitions from " +
    "chapter four earn their keep: give the inner loop a name and the outer " +
    "one goes back to being three readable lines.",
  "learn.piles.p3":
    "One thing to watch. A walking loop deals with the corners it moves " +
    "onto, and Karel is already standing on one when the program starts, so " +
    "whatever is under his feet at the beginning has to be dealt with before " +
    "the first move.",
  "learn.piles.hint1":
    "Run what is in the editor and read the check: the bag is short by more " +
    "than one beeper, and there are two different reasons for that.",
  "learn.piles.hint2":
    'Empty the corner he starts on, then repeat "move, empty this corner" ' +
    "for as long as the way ahead is clear.",

  "learn.border.title": "the border",
  "learn.border.task":
    "Lay one beeper on every corner of the world's rim, come back to (1, 1) " +
    "facing east, and end with an empty bag.",
  "learn.border.p1":
    "A definition can hold loops, and a loop can call a definition. The " +
    "border of this world is four sides that are the same job done four " +
    "times, so write one side and repeat it.",
  "learn.border.p2":
    "The corner where two sides meet belongs to both of them, so each side " +
    "lays four beepers and then walks onto the fifth corner, leaving it for " +
    "the side that follows. Sixteen corners, sixteen beepers, none served " +
    "twice.",
  "learn.border.p3":
    "This chapter also checks which way he is facing at the end, and the " +
    "four turns take care of that on their own: a loop that turns left once " +
    "per side leaves him back on (1, 1) looking east, exactly as he set out.",
  "learn.border.hint1":
    "The definition in the editor lays its side and stops looking along it. " +
    "One instruction at the end of the definition points him down the next " +
    "side.",
  "learn.border.hint2":
    "Once it does, the whole execution block is an ITERATE 4 TIMES around " + "that one name.",

  "learn.sweep.title": "everything at once",
  "learn.sweep.task":
    "Collect every beeper in the world and pile all of them on the corner " + "(6, 6).",
  "learn.sweep.p1":
    "The last chapter, and nothing in it is new. The beepers lie along the " +
    "bottom row and up the east column, in piles of different sizes, and all " +
    "of them have to end up on the far corner.",
  "learn.sweep.p2":
    "The editor already has the instruction that empties a corner. Build a " +
    'second one on top of it — a name for "walk this line to the end, ' +
    'emptying every corner on the way" — and the execution block becomes: ' +
    "sweep a line, turn left, sweep another line.",
  "learn.sweep.p3":
    "To leave the pile behind, ask about the bag: beeper-in-bag is true " +
    "while he is still carrying something, so a WHILE over it empties the " +
    "bag onto the corner he stands on, however much he collected.",
  "learn.sweep.p4":
    "The check that marks this chapter solved is the same one the command " +
    "line uses to grade a submitted program. Pass here and you pass there.",
  "learn.sweep.hint1":
    "One definition can call another: sweeping a line is a WHILE " +
    'front-is-clear around "move, then empty this corner".',
  "learn.sweep.hint2":
    "He finishes at the end of the second line, which is exactly where the " +
    "pile has to go — there is no walking back.",
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
  "masthead.themes": "Tema de color",
  "masthead.theme": "tema",
  "masthead.themeOption": "tema {name}",
  "masthead.skins": "Aspecto del mapa",
  "masthead.skin": "aspecto",
  "masthead.skinOption": "aspecto {name}",
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
  "panel.documents": "Ficheros",
  "panel.mapTitle": "El mundo como fichero .klm",
  "panel.readout": "Lecturas",

  "problems.none": "ninguno",
  "problems.clean": "el programa compila",
  "problems.mapClean": "el mundo se carga",

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
  "palette.format": "formatear",
  "palette.formatTitle": "Vuelve a escribir el fichero como lo escribe el lienzo",

  "files.group": "Ficheros",
  "files.label": "ficheros",
  "files.open": "abrir",
  "files.openTitle": "Abre un programa .kli o un mundo .klm de este dispositivo",
  "files.saveProgram": "guardar .kli",
  "files.saveProgramTitle": "Descargar el programa como un fichero .kli",
  "files.saveWorld": "guardar .klm",
  "files.saveWorldTitle": "Descargar el mundo como un fichero .klm",

  // ── Notes ───────────────────────────────────────────────────────────────
  "note.exported": "guardado como .klm",
  "note.savedProgram": "guardado como .kli",
  "note.openedWorld": "mundo leído del fichero",
  "note.openedProgram": "programa leído del fichero",
  "note.formatted": "reescrito",
  "note.mapUnreadable": "el fichero tiene que leerse antes de poder reescribirlo",
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
  "hint.mode": "modo",
  "hint.help": "ayuda",

  // ── Modes ───────────────────────────────────────────────────────────────
  "masthead.modes": "Modos",
  "mode.learn": "aprender",
  "mode.levels": "niveles",
  "mode.sandbox": "libre",
  "mode.learnTitle": "El lenguaje, capítulo a capítulo",
  "mode.levelsTitle": "Mundos con un objetivo, y cómo enviar el tuyo",
  "mode.sandboxTitle": "Un mundo libre, el programa y el editor de mapas",

  // ── The guide column ────────────────────────────────────────────────────
  "guide.group": "La lección y el objetivo",
  "guide.lesson": "lección",
  "guide.brief": "nivel",
  "guide.chapters": "Capítulos",
  "guide.task": "el objetivo",
  "guide.hint": "una pista",
  "guide.hintsDone": "esa era la última pista",
  "guide.solved": "resuelto",
  "guide.notYet": "todavía no",
  "guide.solvedNote": "El mundo que has dejado coincide con el que pedía el objetivo.",
  "guide.check":
    "Ejecuta el programa hasta el final y aquí se comprueba el mundo que deja, " +
    "con la misma regla con la que corrige la línea de órdenes.",
  "guide.next": "capítulo siguiente",
  "guide.previous": "capítulo anterior",
  "guide.last": "Ese era el último capítulo. Los niveles son donde se practica.",
  "guide.restart": "empezar de nuevo",
  "guide.restarted": "el programa original del capítulo vuelve al editor",
  "guide.progress": "{done}/{total} resueltos",
  "guide.alreadySolved": "Este ya lo tenías resuelto.",

  // ── The level gallery ───────────────────────────────────────────────────
  "levels.group": "Niveles",
  "levels.title": "niveles",
  "levels.lead":
    "{count} mundos, cada uno con su objetivo. Elige uno, escribe un programa y " +
    "ejecútalo hasta el final: la comprobación es la misma que usa la línea de " +
    "órdenes.",
  "levels.difficulty.starter": "para empezar",
  "levels.difficulty.tricky": "con truco",
  "levels.difficulty.hard": "difícil",
  "levels.by": "de {name}",
  "levels.back": "todos los niveles",
  "levels.showSolution": "enséñame una forma",
  "levels.solutionShown":
    "la solución de referencia está en el editor — léela y después escribe la tuya",
  "levels.next": "nivel siguiente",

  // ── Sending a level of your own ─────────────────────────────────────────
  "contribute.open": "envía tu propio nivel",
  "contribute.invite":
    "¿Has construido un mundo que merezca resolverse? Envíalo — la página " +
    "escribe el fichero y abre una incidencia ya rellenada en el repositorio.",
  "contribute.title": "tu nivel",
  "contribute.lead":
    "Un nivel es un fichero JSON del repositorio. Esta página escribe el fichero " +
    "y le da a GitHub una incidencia rellenada; desde aquí no se sube nada.",
  "contribute.step1":
    "Construye el mundo en el que empieza Karel, con el editor de mapas de abajo.",
  "contribute.step2": "Escribe un programa que lo resuelva y ejecútalo hasta el final.",
  "contribute.step3":
    "Captura la ejecución. El mundo que deja se convierte en el objetivo, y el " +
    "programa en la solución de referencia — que es lo que demuestra que el " +
    "nivel se puede resolver.",
  "contribute.step4": "Ponle nombre y envíalo.",
  "contribute.capture": "capturar esta ejecución",
  "contribute.captureWait": "primero ejecuta el programa hasta el final",
  "contribute.captured": "capturado — un mundo de {size} y {steps} instrucciones",
  "contribute.fieldTitle": "título",
  "contribute.fieldBrief": "qué hay que hacer",
  "contribute.fieldAuthor": "tu nombre, o tu usuario de GitHub",
  "contribute.fieldDifficulty": "dificultad",
  "contribute.fieldFacing": "da igual hacia dónde mire al final",
  "contribute.send": "abrir la incidencia en GitHub",
  "contribute.sent": "la incidencia te espera en otra pestaña",
  "contribute.tooLong":
    "demasiado grande para un enlace: el fichero del nivel está en el " +
    "portapapeles — pégalo en el bloque JSON de la incidencia",
  "contribute.copyRefused":
    "el portapapeles se negó — el fichero del nivel está abajo, cópialo a mano",
  "contribute.needCapture": "captura una ejecución antes de enviar",
  "contribute.file": "fichero del nivel",
  "contribute.copyFile": "copiar el fichero del nivel",
  "contribute.copied": "el fichero del nivel está en el portapapeles",
  "contribute.blocked": "el navegador bloqueó la pestaña nueva — abre el enlace de abajo",

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

  // ── The learn-mode curriculum ───────────────────────────────────────────
  "learn.move.title": "un paso cada vez",
  "learn.move.task": "Deja a Karel en la esquina (4, 1).",
  "learn.move.p1":
    "Karel vive en una cuadrícula de esquinas. (1, 1) es la de abajo a la " +
    "izquierda: el primer número cuenta hacia el este y el segundo hacia el " +
    "norte. Siempre mira en una de las cuatro direcciones, y solo camina " +
    "hacia donde mira.",
  "learn.move.p2":
    "Todos los programas tienen ese mismo marco. BEGINNING-OF-PROGRAM abre " +
    "el fichero y END-OF-PROGRAM lo cierra; lo que escribas entre " +
    "BEGINNING-OF-EXECUTION y END-OF-EXECUTION es lo que se ejecuta. Las " +
    "instrucciones se separan con punto y coma, y turnoff — la que apaga al " +
    "robot — va la última.",
  "learn.move.p3":
    "move lo lleva una esquina hacia adelante. Empieza en (1, 1) mirando al " +
    "este y tiene que terminar en (4, 1), tres esquinas más allá. Chocar " +
    "contra un muro no es un tropiezo: es un error y la ejecución se detiene " +
    "ahí, así que cuenta antes de escribir.",
  "learn.move.hint1": "De (1, 1) a (4, 1) hay tres esquinas que cruzar, no cuatro.",
  "learn.move.hint2": "Pulsa paso en vez de ejecutar para verlo avanzar instrucción a instrucción.",

  "learn.turn.title": "girar",
  "learn.turn.task": "Lleva a Karel a la esquina (3, 3).",
  "learn.turn.p1":
    "En el lenguaje hay un solo giro: turnleft. Es un cuarto de vuelta a la " +
    "izquierda, sin moverse del sitio — después sigue en la misma esquina, " +
    "pero mirando a otro lado. Si mira al este, un turnleft lo deja mirando " +
    "al norte.",
  "learn.turn.p2":
    "Girar a la derecha es lo mismo tres veces. Funciona; solo que se lee " +
    "mal. El capítulo cuatro le pondrá nombre propio a ese trío.",
  "learn.turn.p3":
    "La línea de lecturas que hay bajo el mundo dice en qué esquina está y " +
    "hacia dónde mira. Cuando un programa hace algo raro, ese par suele " +
    "explicar por qué antes de que termines de releer el código.",
  "learn.turn.hint1":
    "Dos move lo dejan en (3, 1). Desde ahí (3, 3) le queda al norte, así " +
    "que tiene que mirar al norte antes de volver a avanzar.",
  "learn.turn.hint2":
    "turnleft nunca cambia la esquina en la que está, solo el «mirando» de " + "las lecturas.",

  "learn.bag.title": "la mochila",
  "learn.bag.task": "Lleva el zumbador de (3, 1) a (5, 1) y termina ahí con la mochila vacía.",
  "learn.bag.p1":
    "Las fichas de la cuadrícula son zumbadores. Karel lleva una mochila " +
    "llena de ellos, y dos instrucciones los mueven entre la mochila y la " +
    "esquina en la que está: pickbeeper coge uno del suelo y putbeeper deja " +
    "caer uno de la mochila.",
  "learn.bag.p2":
    "Las dos actúan sobre la esquina que pisa, nunca sobre la de delante, y " +
    "las dos son un error si no hay nada con lo que actuar: pickbeeper en " +
    "una esquina vacía detiene el programa, y putbeeper con la mochila vacía " +
    "también.",
  "learn.bag.p3":
    "Una esquina puede tener más de un zumbador — una pila, con su cuenta " +
    "dibujada encima — y la mochila no tiene límite. Mira la lectura de la " +
    "mochila mientras corre el programa: es la forma más rápida de descubrir " +
    "un pickbeeper que nunca llegó a ocurrir.",
  "learn.bag.hint1":
    "Tiene que estar encima del zumbador para cogerlo, así que primero " +
    "recorre las dos esquinas.",
  "learn.bag.hint2":
    "Cuatro move en total — dos para llegar al zumbador y dos para " +
    "llevarlo — con un pickbeeper y un putbeeper alrededor.",

  "learn.define.title": "enseñarle una palabra",
  "learn.define.task": "Sube dos esquinas, gira a la derecha y termina en (3, 3).",
  "learn.define.p1":
    "Karel nace sabiendo cinco instrucciones. Todo lo demás se lo enseñas " +
    "con DEFINE-NEW-INSTRUCTION: le pones nombre a un grupo de " +
    "instrucciones y, a partir de ahí, ese nombre es una instrucción más.",
  "learn.define.p2":
    "Las definiciones van encima de BEGINNING-OF-EXECUTION, nunca dentro. El " +
    "nombre lo eliges tú — turnright es solo una convención, y es el ejemplo " +
    "de siempre porque el lenguaje no tiene giro a la derecha a propósito: " +
    "tres giros a la izquierda son uno.",
  "learn.define.p3":
    "Esto importa más de lo que parece. Un programa escrito con nombres que " +
    "te has inventado se lee como lo que hace — turnright, harvest, " +
    "go-to-the-wall — y no como una lista de pasos; y un fallo dentro de una " +
    "definición se arregla en un solo sitio.",
  "learn.define.hint1":
    "A la definición del editor le faltan dos giros. Piensa hacia dónde mira " +
    "después de un turnleft, y hacia dónde después de tres.",
  "learn.define.hint2":
    "Las instrucciones entre BEGIN y END se separan con punto y coma, y la " +
    "última no lo necesita.",

  "learn.iterate.title": "repetir",
  "learn.iterate.task":
    "Deja un zumbador en cada esquina de (1, 1) a (5, 1) y termina en (5, 1) " +
    "con la mochila vacía.",
  "learn.iterate.p1":
    "Escribir move ocho veces funciona y se lee fatal. ITERATE n TIMES " +
    "repite el bloque siguiente exactamente n veces.",
  "learn.iterate.p2":
    "La cuenta tiene que ser un número que ya conozcas al escribir el " +
    "programa. Ese es el límite de ITERATE, y la razón de que exista WHILE " +
    "un par de capítulos más adelante.",
  "learn.iterate.p3":
    "Cuidado con el poste de la valla. Cinco esquinas seguidas solo tienen " +
    "cuatro huecos entre ellas, así que un bucle que deja un zumbador y " +
    "luego avanza se repite cuatro veces, y el quinto zumbador se deja " +
    "después.",
  "learn.iterate.hint1":
    "Lo que se repite es el cuerpo entre BEGIN y END; lo que va después de " +
    "END se ejecuta una sola vez.",
  "learn.iterate.hint2":
    "Lleva cinco zumbadores y tiene que acabar sin ninguno, así que todos " +
    "tienen que quedarse en algún sitio.",

  "learn.conditions.title": "mirar antes de saltar",
  "learn.conditions.task":
    "Avanza hacia el este hasta donde te deje el muro, recoge el zumbador " +
    "que espera allí y para.",
  "learn.conditions.p1":
    "Karel puede hacerse dieciocho preguntas de sí o no sobre dónde está: " +
    "qué hay justo delante, qué hay a los lados, si hay zumbadores aquí o en " +
    "la mochila, y hacia dónde mira. Todas tienen su contraria: " +
    "front-is-clear y front-is-blocked.",
  "learn.conditions.p2":
    "IF hace una de esas preguntas y ejecuta el bloque que la sigue solo " +
    "cuando la respuesta es sí.",
  "learn.conditions.p3":
    "front-is-clear es falso ante un muro entre dos esquinas, e igual de " +
    "falso en el borde del mundo, que está amurallado entero. Un move " +
    "protegido así no puede romper el programa: si el paso está bloqueado, " +
    "sencillamente no pasa nada.",
  "learn.conditions.hint1":
    "Ejecuta primero el programa tal como está: choca contra el muro y se " +
    "detiene con un error. Ese error es justo lo que quita el IF.",
  "learn.conditions.hint2":
    "Cinco intentos protegidos son más de los tres que necesita; los que " +
    "sobran sencillamente no hacen nada.",

  "learn.while.title": "hasta que esté hecho",
  "learn.while.task":
    "Manda a Karel al este hasta que algo lo detenga, recoge el zumbador que " +
    "haya allí y para.",
  "learn.while.p1":
    "WHILE hace una pregunta y repite su bloque mientras la respuesta siga " +
    "siendo sí. Pregunta antes de cada vuelta, así que una condición falsa " +
    "desde el principio no ejecuta el cuerpo ni una vez.",
  "learn.while.p2":
    "Esa es la diferencia con ITERATE: ya no hace falta saber el número. " +
    "Esas tres líneas llegan hasta el muro tanto si está a tres esquinas " +
    "como si está a treinta, y el mismo programa resuelve un mundo que no " +
    "has visto nunca.",
  "learn.while.p3":
    "El precio es que un WHILE cuya condición nunca se vuelve falsa no " +
    "termina nunca. La causa habitual es un cuerpo que no cambia nada de lo " +
    "que la condición mira; la página corta sola un programa desbocado, pero " +
    "el arreglo siempre está en el cuerpo.",
  "learn.while.hint1":
    "El bucle del editor ya lo lleva hasta el muro. Lo que falta es qué hace " + "cuando llega.",
  "learn.while.hint2":
    "Lo que va después de END se ejecuta cuando la condición ya es falsa: " +
    "ahí es donde se recoge el zumbador.",

  "learn.else.title": "una cosa o la otra",
  "learn.else.task":
    "Dale la vuelta a la fila: coge el zumbador de cada esquina que tenga " +
    "uno, deja uno en cada esquina que no tenga, y termina en (6, 1).",
  "learn.else.p1":
    "IF ... THEN ... ELSE ejecuta el primer bloque si la respuesta es sí y " +
    "el segundo si es no. Siempre ocurre exactamente uno de los dos, y eso " +
    "es lo que hace seguro poner pickbeeper en una rama y putbeeper en la " +
    "otra.",
  "learn.else.p2":
    "next-to-a-beeper pregunta por la esquina que Karel pisa, no por la de " +
    "delante. También existe su contraria, not-next-to-a-beeper: muchas " +
    "veces se lee mejor hacer la pregunta al revés que intercambiar las dos " +
    "ramas.",
  "learn.else.p3":
    "La fila tiene seis esquinas y hay que pasar por todas, pero solo hay " +
    "cinco huecos que recorrer. Proteger el move con front-is-clear, como en " +
    "el capítulo anterior, hace que la última vuelta no haga daño.",
  "learn.else.hint1":
    "El programa del editor ya recoge. Lo que le falta es el ELSE que se " +
    "ocupa de las esquinas vacías.",
  "learn.else.hint2":
    "Empieza con tres zumbadores y termina con tres: cada uno que deja lo ha " +
    "cogido de otro sitio.",

  "learn.piles.title": "pilas",
  "learn.piles.task":
    "Recorre el pasillo y termina llevando todos sus zumbadores. Las pilas " +
    "no son todas de uno.",
  "learn.piles.p1":
    "Una esquina puede tener una pila de zumbadores, y pickbeeper coge " +
    "exactamente uno. Preguntar IF next-to-a-beeper y coger una vez vacía " +
    "una pila de uno y deja dos en una pila de tres. WHILE next-to-a-beeper " +
    "vuelve a preguntar después de cada pickbeeper, así que vacía lo que " +
    "haya.",
  "learn.piles.p2":
    "Eso es un bucle dentro de otro, y es donde las definiciones del " +
    "capítulo cuatro se ganan el sueldo: pon nombre al bucle interior y el " +
    "exterior vuelve a ser tres líneas legibles.",
  "learn.piles.p3":
    "Un detalle. Un bucle que camina se ocupa de las esquinas a las que " +
    "llega, y Karel ya está en una cuando empieza el programa, así que lo " +
    "que tenga bajo los pies al principio hay que resolverlo antes del " +
    "primer move.",
  "learn.piles.hint1":
    "Ejecuta lo que hay en el editor y lee la comprobación: a la mochila le " +
    "falta más de un zumbador, y hay dos motivos distintos detrás.",
  "learn.piles.hint2":
    "Vacía la esquina en la que empieza y después repite «avanza y vacía " +
    "esta esquina» mientras el paso esté libre.",

  "learn.border.title": "el borde",
  "learn.border.task":
    "Deja un zumbador en cada esquina del borde del mundo, vuelve a (1, 1) " +
    "mirando al este y termina con la mochila vacía.",
  "learn.border.p1":
    "Una definición puede contener bucles, y un bucle puede llamar a una " +
    "definición. El borde de este mundo son cuatro lados que hacen el mismo " +
    "trabajo cuatro veces: escribe un lado y repítelo.",
  "learn.border.p2":
    "La esquina donde se juntan dos lados es de los dos, así que cada lado " +
    "deja cuatro zumbadores y luego avanza hasta la quinta esquina, que le " +
    "deja al siguiente. Dieciséis esquinas, dieciséis zumbadores y ninguna " +
    "servida dos veces.",
  "learn.border.p3":
    "Este capítulo comprueba además hacia dónde mira al final, y de eso se " +
    "encargan solos los cuatro giros: un bucle que gira una vez a la " +
    "izquierda por lado lo deja de vuelta en (1, 1) mirando al este, igual " +
    "que salió.",
  "learn.border.hint1":
    "La definición del editor deja su lado y se queda mirando a lo largo de " +
    "él. Una sola instrucción al final de la definición lo apunta hacia el " +
    "lado siguiente.",
  "learn.border.hint2":
    "En cuanto lo haga, todo el bloque de ejecución es un ITERATE 4 TIMES " +
    "alrededor de ese único nombre.",

  "learn.sweep.title": "todo junto",
  "learn.sweep.task": "Recoge todos los zumbadores del mundo y amontónalos en la esquina (6, 6).",
  "learn.sweep.p1":
    "El último capítulo, y no hay nada nuevo en él. Los zumbadores están " +
    "repartidos por la fila de abajo y por la columna del este, en pilas de " +
    "distintos tamaños, y todos tienen que acabar en la esquina más lejana.",
  "learn.sweep.p2":
    "En el editor ya está la instrucción que vacía una esquina. Construye " +
    "otra encima de ella — un nombre para «recorre esta línea hasta el final " +
    "vaciando cada esquina» — y el bloque de ejecución se queda en: barre " +
    "una línea, gira a la izquierda, barre otra.",
  "learn.sweep.p3":
    "Para dejar la pila, pregunta por la mochila: beeper-in-bag es cierto " +
    "mientras siga llevando algo, así que un WHILE sobre esa pregunta la " +
    "vacía en la esquina que pisa, sea cuanto sea lo que haya recogido.",
  "learn.sweep.p4":
    "La comprobación que da este capítulo por resuelto es la misma que usa " +
    "la línea de órdenes para corregir un programa entregado. Si pasa aquí, " +
    "pasa allí.",
  "learn.sweep.hint1":
    "Una definición puede llamar a otra: barrer una línea es un WHILE " +
    "front-is-clear alrededor de «avanza y vacía esta esquina».",
  "learn.sweep.hint2":
    "Termina al final de la segunda línea, que es justo donde tiene que " +
    "quedar la pila: no hace falta volver.",
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
