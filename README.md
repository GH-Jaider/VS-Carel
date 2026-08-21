# Karel

**Karel the Robot, as a language you can actually build on.** A zero-dependency TypeScript
interpreter for the classic Karel language — the one from _Karel J. Robot_, with
`BEGINNING-OF-PROGRAM`, `DEFINE-NEW-INSTRUCTION` and `ITERATE n TIMES` — and the tools built
on top of it.

[![CI](https://github.com/GH-Jaider/karel/actions/workflows/ci.yml/badge.svg)](https://github.com/GH-Jaider/karel/actions/workflows/ci.yml)

```
BEGINNING-OF-PROGRAM
    DEFINE-NEW-INSTRUCTION turnright AS
    BEGIN
        turnleft; turnleft; turnleft
    END

    BEGINNING-OF-EXECUTION
        move;
        turnright;
        ITERATE 2 TIMES
        BEGIN
            move
        END
        turnoff
    END-OF-EXECUTION
END-OF-PROGRAM
```

## What's here

| Package                              | What it is                                                                                                                                                                                                                                                                                                       | Status  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| [`packages/core`](packages/core)     | `@karel/core` — lexer, parser, interpreter and world model. No dependencies, no platform assumptions: it runs in a browser, in Node, or anywhere else with a timer.                                                                                                                                              | Working |
| [`packages/cli`](packages/cli)       | **karel** — run a program against a world from the command line and check the result, so a class's submissions can be graded in a loop or in CI. A distinct exit code per outcome (wrong, does not compile, does not terminate, timed out), and a `--timeout` so a batch always ends. One file, no dependencies. | Working |
| [`packages/vscode`](packages/vscode) | **VS Karel** — write, run and step through Karel programs inside VS Code, with the world drawn beside the code.                                                                                                                                                                                                  | Working |

The interpreter is deliberately separate from the editor that happens to host it, so the same
language, the same error messages and the same world semantics back every one of them. A
browser playground and a terminal UI are next.

## Working on it

```bash
git clone https://github.com/GH-Jaider/karel.git
cd karel
pnpm install          # also builds @karel/core, which the extension compiles against
pnpm test             # the interpreter's test suite
```

To run the extension: open the repo in VS Code and press <kbd>F5</kbd>. The build task rebuilds
the core first, so a change to the interpreter shows up in the Extension Development Host.

| Command          | What it does                    |
| ---------------- | ------------------------------- |
| `pnpm build`     | Build every package, core first |
| `pnpm test`      | Run the test suites             |
| `pnpm typecheck` | Type-check every package        |
| `pnpm lint`      | Lint the workspace              |

`examples/` holds the fixtures the tests and the docs share: a program (`.kli`) and a world
(`.klm`).

## The language

Programs are `.kli` files; worlds are `.klm` files, which are JSON with a
[schema](packages/vscode/schemas/klm.schema.json). The full reference — the five built-in
instructions, the eighteen conditions, the control structures and the world format — is in
the [extension's README](packages/vscode/README.md#the-karel-language-kli).

## License

MIT © GH-Jaider
