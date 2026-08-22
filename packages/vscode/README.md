# VS Karel

Learn programming with **Karel the Robot** in VS Code: write Karel programs, run them, and watch the robot move through its world, with live error checking, step-by-step execution, and worlds you can edit as validated JSON.

## Getting started

1. Install the extension and open a folder.
2. Run **Karel: New Karel Program** (`Ctrl+Shift+P`). It creates `myprogram.kli` and its world `myprogram.klm`, already paired.
3. Press **F5**. The world opens beside your code and Karel moves.

The **Get Started with Karel** walkthrough (Help → Welcome) covers the same steps interactively.

## Everyday flow

| Action                          | How                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Run program                     | `F5`, the ▶ button, or the **▶ Run** link above `BEGINNING-OF-PROGRAM`                                              |
| Step one instruction            | `F10` (current line highlights, world updates in sync)                                                              |
| Stop                            | `Shift+F5`                                                                                                          |
| Reset world                     | `Ctrl+Shift+F5` (`Cmd+Shift+F5` on Mac)                                                                             |
| See the world                   | Just open the `.klm` file: it opens as the drawn world, not JSON                                                   |
| Edit a world                    | Click the `{}` button in the world's title bar to edit the JSON (schema-validated); the drawing updates as you type |
| Change the world a program uses | Click **World: … (change)** above the program, or the globe in the status bar                                       |
| Change speed                    | Click the speed in the status bar (applies live)                                                                    |

A program runs in the world with the same name (`maze.kli` → `maze.klm`), or in the only world of the folder if there is one. Otherwise VS Karel asks once and remembers your choice.

If Karel hits a wall, or picks a beeper that isn't there, execution stops with an **error shutoff**: the offending line turns red and the message explains what happened.

## The Karel language (`.kli`)

```
BEGINNING-OF-PROGRAM
    DEFINE-NEW-INSTRUCTION turnright AS
    BEGIN
        turnleft;
        turnleft;
        turnleft
    END

    BEGINNING-OF-EXECUTION
        move;              // comments run to the end of the line
        turnright;
        ITERATE 3 TIMES
        BEGIN
            move
        END;
        turnoff
    END-OF-EXECUTION
END-OF-PROGRAM
```

- **Built-in instructions:** `move`, `turnleft`, `pickbeeper`, `putbeeper`, `turnoff`
- **Control structures:** `IF <condition> THEN`, `ELSE`, `WHILE <condition> DO`, `ITERATE <n> TIMES`, `DEFINE-NEW-INSTRUCTION <name> AS`
- The body of `THEN`/`ELSE`/`DO`/`TIMES`/`AS` is a `BEGIN … END` block or a single instruction, as in the classic Karel book. `END;` is fine. Keywords are case-insensitive.
- Defined instructions may call each other in any order, including recursively.
- **The 18 conditions:** `front-is-clear`, `front-is-blocked`, `left-is-clear`, `left-is-blocked`, `right-is-clear`, `right-is-blocked`, `next-to-a-beeper`, `not-next-to-a-beeper`, `facing-north`, `not-facing-north`, `facing-south`, `not-facing-south`, `facing-east`, `not-facing-east`, `facing-west`, `not-facing-west`, `beeper-in-bag`, `no-beeper-in-bag`

Errors are underlined as you type (all of them, not just the first), and snippets are available for every construct (`program`, `define`, `if`, `ifelse`, `while`, `iterate`).

## Worlds (`.klm`)

**Opening a `.klm` file shows the world itself** (the grid, walls, beepers and Karel) as its editor. Running a program animates it right there; there is no separate visualizer window. To see or edit the underlying JSON, click the `{}` button in the editor title (or right-click the file → _Open With → Text Editor_).

The JSON has schema-backed **autocomplete and validation**:

```json
{
  "dimensions": { "width": 10, "height": 8 },
  "karel": { "x": 1, "y": 1, "facing": "north", "beepers": 5 },
  "beepers": [{ "x": 3, "y": 3, "count": 2 }],
  "walls": [{ "from": { "x": 4, "y": 3 }, "to": { "x": 4, "y": 4 } }]
}
```

- Coordinates are 1-based with **(1,1) at the bottom-left**; `facing` is `north` / `south` / `east` / `west`.
- Walls block the edge between two **adjacent** cells, in both directions. The world border is always walled.
- The `.klm` file is the **initial state**: running never modifies it (the file never becomes dirty). Edit the JSON and the drawing updates live.

## Commands

All under the **Karel** category in the Command Palette: Run Karel Program, Step Through Program, Stop Execution, Reset World, Open World, Edit World as JSON, Select World for Program, Set Execution Speed, New Karel Program, New Karel World, Toggle Error Highlighting.

## Settings

| Setting                            | Default | Description                                                              |
| ---------------------------------- | ------- | ------------------------------------------------------------------------ |
| `vs-karel.enableErrorHighlighting` | `true`  | Live error underlines in `.kli` files (turn off for classroom exercises) |
| `vs-karel.executionSpeed`          | `500`   | Delay between steps in ms (50–2000)                                      |

## Development

```bash
git clone https://github.com/GH-Jaider/karel.git
cd karel
pnpm install
```

Press `F5` to launch the Extension Development Host. Its build task builds the interpreter and bundles the extension first, so there is nothing to run by hand.

This is a pnpm workspace with two packages:

- **`packages/core`** (`@karel/core`). The interpreter: lexer, parser and execution engine, pure TypeScript with no VS Code dependency and covered by unit tests (`pnpm test`).
- **`packages/vscode`** (this extension). `src/controller.ts` owns all execution state; the status bar, CodeLens, decorations and world editor are thin projections of it.

## License

MIT
