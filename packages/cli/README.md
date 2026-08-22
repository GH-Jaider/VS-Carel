# karel

**Karel the Robot, headless.** `karel` runs a `.kli` program against a `.klm` world with no
editor and no window, and reports the outcome as an exit code, which means a marker with
sixty submissions can grade them with a `for` loop instead of sixty double-clicks.

Every other Karel (Reeborg, omegaUp, CodeHS, fredoverflow) is a place a student writes a
program. None of them will tell a shell script whether that program was right. That is what
this command is for.

```bash
$ karel run examples/demo-program.kli --world examples/simple-world.klm
demo-program.kli: finished after 13 steps
$ echo $?
0
```

## Installing

The CLI is not on npm yet. It builds to **one file, `karel.mjs`, ~55 KB, with no
dependencies at all**: it imports `node:fs`, `node:path`, `node:util` and
`node:child_process`, and nothing else, so installing it means putting that file somewhere on
your `PATH`.

**From a release.** Every release attaches `karel.mjs`. Put it on your `PATH` and make it
executable; it carries its own `#!/usr/bin/env node` line.

```bash
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/karel \
  https://github.com/GH-Jaider/karel/releases/latest/download/karel.mjs
chmod +x ~/.local/bin/karel
karel --version          # 0.1.0
```

Any directory on your `PATH` will do; `~/.local/bin` is on it by default on most Linux
distributions but not on macOS, where you may need
`export PATH="$HOME/.local/bin:$PATH"` in your shell profile.

**From the repo.** The build needs pnpm, and takes a few seconds from a cold clone.

```bash
git clone https://github.com/GH-Jaider/karel.git
cd karel
pnpm install                       # the root prepare script builds @karel/core
pnpm --filter @karel/cli build     # → packages/cli/dist/karel.mjs

mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/dist/karel.mjs" ~/.local/bin/karel
```

A symlink rather than a copy, so rebuilding the package updates the command in place.

Node 22 or newer, either way. The built file is standalone: copy it to a machine with only
Node installed and it runs there, no `node_modules` beside it.

Everything below is written as `karel …`. Without the symlink, substitute
`node packages/cli/dist/karel.mjs`.

## Running a program

`run` needs a program and the world it runs in.

```bash
$ karel run examples/demo-program.kli --world examples/simple-world.klm
demo-program.kli: finished after 13 steps
```

When the program stops on an error, the reason goes to **stderr** with the line, so
redirecting stdout to a file still leaves the diagnosis on screen:

```bash
$ karel run wall.kli --world examples/simple-world.klm
wall.kli: stopped after 7 steps on line 5: Karel hit a wall: the front is blocked
```

Add `--assert-world` to say what the world should look like when the program is done. This is
the flag that turns `run` into a grader: without it, `karel` only tells you the program did
not crash.

```bash
$ karel run submission.kli --world start.klm --assert-world solved.klm
submission.kli: finished after 3 steps: expected Karel at (2, 1), found (1, 3)
```

`--assert-world` compares the parts of a world a program can change: Karel's position, heading
and bag, and every pile of beepers. The comparison only runs after a clean finish: if the
program walked into a wall, that is the finding worth reporting, not the world state it left
behind.

### Both files must describe the same exercise

Before anything is read, parsed or executed, `karel` checks that the expected world has the
**same dimensions and the same walls** as `--world`. No instruction can move a wall or resize
a grid, and that is exactly why they are worth checking: a difference there cannot be a wrong
answer, so it is proof that the two files came from different problems.

A mismatch therefore exits `64` (bad invocation) and not `1`. Your grading setup is wrong,
not the student's program, and marking a class against the answer key for another exercise is
worth stopping the run over.

```bash
$ karel run submission.kli --world start.klm --assert-world other-exercise.klm
karel: 'other-exercise.klm' describes a different exercise: the world is 10x8 but the expected world is 12x8

Run 'karel --help' for usage.
$ echo $?
64
```

Walls are compared as a set of positions, so the order they happen to appear in the file does
not matter, and a wall written from either of its two sides is the same wall.

This is what makes the recommended way to build an answer key,
[running a reference solution and keeping its `world`](#building-an---assert-world), correct
by construction: that output carries the original walls forward with it. A `.klm` typed by
hand with the walls left out will be rejected, however right the beepers in it are.

```bash
$ karel run submission.kli --world start.klm --assert-world hand-written.klm
karel: 'hand-written.klm' describes a different exercise: the world has 5 walls but the expected world has 0
```

### `--ignore-facing`

`--ignore-facing` drops one field from the comparison: the direction Karel ends up looking.
Plenty of exercises are worded like _"walk around the block and come back to the corner you
started from"_ and never say which way to face at the end. A student who gets there facing
south instead of east has solved that problem, and a grader that says otherwise is grading a
requirement nobody set.

The reference solution below happened to finish facing east; the submission leaves the world
in exactly the right state and finishes facing south:

```bash
$ karel run corner.kli -w corner-start.klm -a corner-solved.klm
corner.kli: finished after 13 steps: expected Karel facing east, found south
$ karel run corner.kli -w corner-start.klm -a corner-solved.klm --ignore-facing
corner.kli: finished after 13 steps
```

The default is strict, and stays strict, because a grader should fail closed. A flag that
loosens the check has to be asked for by name, so that nobody discovers after the fact that a
whole class was marked against a comparison that was quietly ignoring something. Turn it on
for the exercises whose statement really is silent about heading, and leave it off otherwise.

## Bounding a run

`--max-steps` bounds the run. The default budget is 100 000 visible instructions; for batch
grading a much lower number turns "this student's `WHILE` never ends" from a hang into an
answer in milliseconds.

```bash
$ karel run loop.kli --world start.klm --max-steps 10000
loop.kli: stopped after 10000 steps on line 5: Program stopped after 10000 steps: it looks like an infinite loop
```

`--timeout <seconds>` bounds the run by the clock instead of by instructions, and expiring has
its own exit code, `4`.

```bash
$ karel run submission.kli --world start.klm --timeout 10
karel: gave up after 10 seconds
$ echo $?
4
```

It is not there for slow programs, because there are none. Exhausting the default budget of
100 000 instructions takes about 35 ms end to end on a laptop, Node's own start-up included,
so a run still going after a second is not computing, it is stuck. What `--timeout` covers is
the part `--max-steps` cannot see: reading the file, tokenizing it and parsing it all happen
before the first instruction is ever counted, and a step budget can do nothing about a hang in
any of them. `--timeout` is the outer bound that holds whichever phase stopped moving.

Enforcing it takes a second process. Every phase of a run is synchronous, so a hang holds the
only thread and a timer scheduled on that thread never gets its turn to fire. When you pass
`--timeout`, `karel` re-runs itself as a child process and watches the clock from the parent,
killing the child with `SIGKILL` if it overruns. The thing being defended against is a
process too busy to handle a signal. The child does the real work and exits with whatever code
it would have had anyway; the parent substitutes `4` only when it had to step in.
`KAREL_SUPERVISED=1` in the child's environment is what keeps this from recursing.

There is no default: nothing spawns a subprocess unless you ask for it. Ask for it in every
batch run. `--max-steps` and `--timeout` together are what make "grade sixty submissions"
a job that is guaranteed to end.

| Flag                        | Short       | Meaning                                                                                       |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `--world <file.klm>`        | `-w`        | The world to run in. Required by `run`.                                                       |
| `--assert-world <file.klm>` | `-a`        | Require this final world; a mismatch exits `1`. Must describe the same exercise as `--world`. |
| `--ignore-facing`           |             | Under `--assert-world`, accept any final heading. Off by default.                             |
| `--max-steps <n>`           | `-m`        | Instruction budget before declaring a loop. Default 100 000.                                  |
| `--timeout <seconds>`       | `-t`        | Wall-clock limit on the whole run; expiring exits `4`. No default.                            |
| `--json`                    |             | Machine-readable result on stdout.                                                            |
| `--help` / `--version`      | `-h` / `-v` | Usage, version.                                                                               |

## Checking a program

`check` parses without executing. No world needed: it answers "does this even compile", which
is the first thing you want to know about a submission and the only thing you can know about
one that does not.

```bash
$ karel check examples/demo-program.kli
demo-program.kli: no errors

$ karel check broken.kli
broken.kli: 3 errors
  3:3 error: Missing semicolon (;) after this instruction
  4:3 error: Unknown instruction 'mve'
  6:1 error: Missing END-OF-EXECUTION after the instructions
```

It reports every error, not just the first, and the same warnings the editor shows, such as
a program that never calls `turnoff`, or an instruction defined twice:

```bash
$ karel check noturnoff.kli
noturnoff.kli: no errors
  4:2 warning: The program never calls 'turnoff'. Karel programs should end with turnoff;
```

Warnings do not fail the check. Errors do.

## Exit codes

The exit code is the real interface. It is deliberately more than pass/fail, because "did not
compile", "never terminates" and "compiles, runs, wrong answer" are three different
conversations to have with a student.

| Code | Name          | What happened                                                                          | What it means for a marker                                                                     |
| ---- | ------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `0`  | `OK`          | The program ran to completion, and matched `--assert-world` if one was given.          | Correct. Award the marks.                                                                      |
| `1`  | `FAILED`      | An error shutoff (wall, missing beeper, empty bag), or the final world did not match.  | The logic is wrong. The message says how.                                                      |
| `2`  | `PARSE_ERROR` | The program did not parse. Nothing was executed.                                       | It does not compile: a syntax problem, not an algorithm one.                                  |
| `3`  | `LIMIT`       | The step budget ran out.                                                               | It does not terminate. Almost always a loop with no exit.                                      |
| `4`  | `TIMEOUT`     | `--timeout` expired and the run was killed.                                            | Nothing was decided either way. Look for the hang, then rerun.                                 |
| `64` | `USAGE`       | Unknown flag, missing file, malformed world, an `--assert-world` for another exercise. | Your grading script is wrong, not the student's program. Investigate before you record a zero. |

Two of these deserve their own branch rather than a general "not zero".

`64` is the BSD `EX_USAGE` convention: a missing submission file, an unreadable world, or an
`--assert-world` that does not describe the same exercise as `--world`. Treating it as a
failure silently scores students for your own broken paths.

`4` only ever appears if you passed `--timeout`, and it is not a verdict on the program: the
run was cut off before it could reach one. `3` says the student wrote a loop with no exit;
`4` says the tool never got far enough to say anything. Retry the submission by hand before
recording anything against it.

## Grading a directory of submissions

This is what the command exists for. Given a folder of `.kli` files, a starting world and the
world a correct solution should produce:

```bash
#!/usr/bin/env bash
for f in submissions/*.kli; do
  if karel run "$f" --world start.klm --assert-world solved.klm \
       --max-steps 10000 --timeout 10 >/dev/null 2>&1; then
    echo "PASS $(basename "$f")"
  else
    echo "FAIL $(basename "$f")"
  fi
done
```

```
PASS ana.kli
FAIL luis.kli
FAIL marta.kli
FAIL pablo.kli
FAIL sara.kli
```

`--max-steps` and `--timeout` are both there on purpose. The step budget catches the loop that
never ends; the clock catches everything a step budget cannot reach, which is every phase
before the first instruction runs. Between them the loop is guaranteed to finish, and that
guarantee is what makes grading in a loop worth doing at all.

That is the whole autograder. But four failures that all say `FAIL` are four students you now
have to open by hand, and the exit code already knows why each one failed. Branch on it:

```bash
#!/usr/bin/env bash
set -euo pipefail

fails=0
for f in submissions/*.kli; do
  status=0
  reason=$(karel run "$f" --world start.klm --assert-world solved.klm \
             --max-steps 10000 --timeout 10 2>&1 >/dev/null) || status=$?
  case $status in
    0)  verdict="PASS" ;;
    1)  verdict="FAIL  wrong result" ;;
    2)  verdict="FAIL  does not compile" ;;
    3)  verdict="FAIL  does not terminate" ;;
    4)  verdict="FAIL  timed out" ;;
    64) verdict="SKIP  could not run" ;;
    *)  verdict="FAIL  unexpected (exit $status)" ;;
  esac
  [ "$status" -eq 0 ] || fails=$((fails + 1))
  printf '%-14s %s\n' "$(basename "$f")" "$verdict"
  if [ -n "$reason" ]; then
    printf '%-14s   %s\n' "" "${reason%%$'\n'*}"
  fi
done
echo "$fails of $(ls submissions/*.kli | wc -l | tr -d ' ') submissions failed"
exit $(( fails > 0 ))
```

Two details this script depends on, both of which bite under `set -e`.

`|| status=$?` is what keeps a failing submission from killing the whole run: under `set -e` a
bare `reason=$(karel …)` aborts the script on the first student who got it wrong, and you
grade one file instead of sixty. For the same reason the diagnosis is printed from an `if`
rather than `[ -n "$reason" ] && printf …`, which fails as the last command in the loop body
whenever `$reason` is empty, that is, on every submission that passed.

`2>&1 >/dev/null`, in that order, keeps karel's explanation and throws away the success
line, so `$reason` is empty for a pass and is the diagnosis for a failure:

```
ana.kli        PASS
luis.kli       FAIL  wrong result
                 luis.kli: finished after 3 steps: expected Karel at (2, 1), found (1, 3)
marta.kli      FAIL  does not compile
                 marta.kli: 3 errors
pablo.kli      FAIL  does not terminate
                 pablo.kli: stopped after 10000 steps on line 5: Program stopped after 10000 steps: it looks like an infinite loop
sara.kli       FAIL  wrong result
                 sara.kli: stopped after 7 steps on line 5: Karel hit a wall: the front is blocked
4 of 5 submissions failed
```

Five students, five verdicts, one command, and a script exit code you can hang a CI job on.
No submission here hit the `4` branch: with `--timeout 10` against runs that finish in
milliseconds, none should. The branch is there for the day one does, so that a hang shows up
as a labelled row instead of a grading script that never returns.

### GitHub Classroom

One submission per repository, graded on push. Drop this in `.github/workflows/grade.yml` of
the assignment template, with the exercise's `start.klm` and `solved.klm` in `grader/`:

```yaml
name: Grade
on: [push, workflow_dispatch]

jobs:
  grade:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      # One file, no dependencies, no npm install.
      - name: Install karel
        run: |
          mkdir -p "$HOME/.local/bin"
          curl -fsSL -o "$HOME/.local/bin/karel" \
            https://github.com/GH-Jaider/karel/releases/latest/download/karel.mjs
          chmod +x "$HOME/.local/bin/karel"
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"

      - name: Grade solution.kli
        run: |
          # Actions runs this under `bash -e`, so capture the code with ||
          # rather than letting a failing run abort the step.
          status=0
          karel run solution.kli \
            --world grader/start.klm \
            --assert-world grader/solved.klm \
            --max-steps 10000 \
            --timeout 30 || status=$?
          case $status in
            0) echo "::notice::solution.kli passed" ;;
            1) echo "::error::solution.kli stopped on an error, or finished with the wrong world" ;;
            2) echo "::error::solution.kli does not compile" ;;
            3) echo "::error::solution.kli never terminates" ;;
            4) echo "::error::solution.kli did not finish inside the time limit" ;;
            *) echo "::error::could not grade solution.kli (exit $status)" ;;
          esac
          exit $(( status != 0 ))
```

karel's own message goes straight to the job log above the annotation, so the student sees
both the category and the line. The step fails the job on anything but `0`, which is what
Classroom reads.

`--timeout 30` is generous for a run that should take milliseconds, and that is the point: it
is a backstop, not a performance budget. Without it a hang burns the job's whole runner
allowance before Actions kills it, and the student gets a red cross with no message attached.

## `--json`

`--json` puts a single JSON object on stdout and nothing else, so it composes with `jq`. The
human-readable failure line still goes to stderr, which means
`karel run p.kli -w w.klm --json > result.json` shows you what went wrong while the file stays
clean.

The objects below are real output from the runs on this page, re-wrapped to fit: karel prints
`JSON.stringify(result, null, 2)`, so the actual bytes put every field on its own line.

**`run`, on a program that finished:**

```json
{
  "status": "ok",
  "steps": 13,
  "world": {
    "dimensions": { "width": 10, "height": 8 },
    "karel": { "x": 2, "y": 1, "facing": "south", "beepers": 4 },
    "beepers": [
      { "x": 3, "y": 3, "count": 2 },
      { "x": 5, "y": 5, "count": 1 },
      { "x": 8, "y": 2, "count": 3 },
      { "x": 2, "y": 3, "count": 1 }
    ],
    "walls": [
      { "from": { "x": 4, "y": 3 }, "to": { "x": 4, "y": 4 } },
      { "from": { "x": 4, "y": 4 }, "to": { "x": 4, "y": 5 } },
      { "from": { "x": 4, "y": 5 }, "to": { "x": 5, "y": 5 } },
      { "from": { "x": 6, "y": 1 }, "to": { "x": 6, "y": 2 } },
      { "from": { "x": 6, "y": 2 }, "to": { "x": 7, "y": 2 } }
    ]
  },
  "diagnostics": []
}
```

**`run`, on a program that stopped:**

```json
{
  "status": "error",
  "kind": "limit",
  "line": 5,
  "message": "Program stopped after 500 steps: it looks like an infinite loop",
  "steps": 500,
  "world": { "...": "elided; same shape as above, holding the world where execution stopped" },
  "diagnostics": []
}
```

**`check`, or a `run` whose program did not parse**: no `world`, no `steps`, because nothing
ran:

```json
{
  "status": "parse-error",
  "diagnostics": [
    {
      "message": "Missing semicolon (;) after this instruction",
      "line": 3,
      "column": 2,
      "endColumn": 6,
      "severity": "error"
    }
  ]
}
```

| Field         | Present on          | Value                                                                                                       |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `status`      | always              | `"ok"`, `"error"` (a run that stopped), or `"parse-error"`                                                  |
| `kind`        | `status: "error"`   | `"blocked"`, `"no-beeper"`, `"empty-bag"`, `"unknown-name"`, `"limit"`, `"internal"`, or `"assert-world"`   |
| `line`        | most errors         | 1-based line the program stopped on                                                                         |
| `message`     | `status: "error"`   | The same sentence the human output prints                                                                   |
| `steps`       | `run` that executed | Visible instructions performed                                                                              |
| `world`       | `run` that executed | The world as execution ended, after a failure too, which is how you see where Karel got stuck              |
| `diagnostics` | always              | Parse findings: `message`, `line`, 0-based `column`, `endColumn`, `severity` (`error` / `warning` / `info`) |

`diagnostics` columns are 0-based, matching the parser; the human output prints them from 1,
matching every editor. Add one when you render them yourself.

`--json` composes with `--timeout`: the child writes straight to the inherited stdout, so the
object arrives on the pipe exactly as it would without supervision. There is no JSON on a
timeout, though, because the process that would have printed it was killed. `4` on an empty stdout is
the whole report.

Some things worth asking it:

```bash
# Where did Karel end up?
karel run reference.kli -w start.klm --json | jq -c '.world.karel'
# → {"x":2,"y":1,"facing":"south","beepers":4}

# Did the program leave a beeper at (2,3)?
karel run reference.kli -w start.klm --json \
  | jq '.world.beepers[] | select(.x==2 and .y==3) | .count'
# → 1

# One TSV row per submission, for a spreadsheet
karel run submission.kli -w start.klm -a solved.klm --json \
  | jq -r '[.status, .kind // "-", .steps, .message // "-"] | @tsv'
# → error	assert-world	3	expected Karel at (2, 1), found (1, 3)

# Just the compile errors, in editor coordinates
karel check broken.kli --json \
  | jq -r '.diagnostics[] | select(.severity=="error") | "\(.line):\(.column+1) \(.message)"'
# → 3:3 Missing semicolon (;) after this instruction
# → 4:3 Unknown instruction 'mve'
# → 6:1 Missing END-OF-EXECUTION after the instructions
```

## Building an `--assert-world`

`--assert-world` takes an ordinary `.klm` file, and you should not write it by hand: it is the
world _after_ a correct program has run, and working that out on paper is exactly the error-prone
step you are trying to automate away.

Write the reference solution instead, run it, and keep the `world` field of the JSON. That
field is a valid `.klm` in its own right:

```bash
karel run reference.kli --world start.klm --json | jq .world > solved.klm
```

Then check the circle closes, because the reference solution must pass its own assertion:

```bash
$ karel run reference.kli --world start.klm --assert-world solved.klm
reference.kli: finished after 13 steps
$ echo $?
0
```

This flow is not just convenient, it is the one the tool is built around. `--assert-world`
requires the expected world to have the same dimensions and walls as `--world`, and `.world`
from a run of that same `start.klm` carries both forward untouched, so the key it produces is
accepted by construction. Write one by hand with only Karel and the beepers in it and the run
stops at exit `64` before it grades anything.

Three cautions.

First, only take `.world` from a run that exited `0`. A failed run still reports the world it
reached, and freezing a half-finished one as the answer key would fail every correct
submission.

Second, generate the key from the same `start.klm` the class will be graded against. A key
built from a different starting world is a key for a different exercise, and `karel` will say
so, which is the good outcome, but only if you notice it before you run the batch.

Third, the key records a heading for Karel whether or not the exercise cares about one. If the
statement only says where to end up, grade with `--ignore-facing` rather than hand-editing the
key: the file stays a faithful record of what the reference solution did, and the looser rule
stays visible on the command line where you can see which exercises use it.

The world it writes opens in [VS Karel](../vscode) as a drawn grid, which is the quick way to
confirm the answer key is the exercise you meant to set.

## Working on it

```bash
pnpm --filter @karel/cli build      # bundle to dist/karel.mjs
pnpm --filter @karel/cli test       # vitest
pnpm --filter @karel/cli typecheck
```

`src/commands.ts` holds the two commands as pure functions over file contents, plus the two
comparisons that decide a grade: `sameExercise`, which asks whether the expected world belongs
to this problem at all, and the beeper-by-beeper check that follows it. Nothing there touches
the filesystem or the process, so what counts as a pass is testable without spawning anything.
`src/exit.ts` is the one place the exit codes are defined, and `src/output.ts` the one place
results are rendered. `src/supervise.ts` is the `--timeout` supervisor, the only code that
spawns a process, and only when the flag is given. `src/main.ts` is the only file that does
I/O.

`tests/` spawns the built `dist/karel.mjs` for real and asserts on exit codes and streams,
because that pair, not any internal function, is the contract this README documents. The
test run rebuilds the bundle first, so it can never pass against a stale one.

The language itself, the world format and the eighteen conditions are documented in the
[extension's README](../vscode/README.md#the-karel-language-kli). `examples/` at the repo root
holds the fixtures used throughout this page.

## License

MIT © GH-Jaider
