# Create your first program

Karel is a robot that lives in a grid world. You control it with a tiny language:

```
BEGINNING-OF-PROGRAM
    BEGINNING-OF-EXECUTION
        move;
        pickbeeper;
        turnleft;
        turnoff
    END-OF-EXECUTION
END-OF-PROGRAM
```

- **`.kli` files** hold the program (the instructions).
- **`.klm` files** hold the world (walls, beepers, Karel's start).

Run **Karel: New Karel Program** and it creates both, already paired by name.

Built-in instructions: `move`, `turnleft`, `pickbeeper`, `putbeeper`, `turnoff`.
Type `program`, `if`, `while`, `iterate` or `define` for snippets.
