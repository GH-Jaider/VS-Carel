# Edit worlds

**Opening a `.klm` file shows the world itself** — grid, walls, beepers and Karel. Running a program animates it right there.

To change the world, click the **`{}` button** in its title bar (or right-click the file → _Open With → Text Editor_). The JSON is small and has **autocomplete and validation** built in:

```json
{
  "dimensions": { "width": 8, "height": 6 },
  "karel": { "x": 1, "y": 1, "facing": "north", "beepers": 0 },
  "beepers": [{ "x": 3, "y": 3, "count": 2 }],
  "walls": [{ "from": { "x": 4, "y": 3 }, "to": { "x": 4, "y": 4 } }]
}
```

- Coordinates are 1-based; **(1, 1) is the bottom-left corner**.
- Walls block the edge between two **adjacent** cells, in both directions.
- The drawing updates live as you type — the file is always the _initial_ state; running never modifies it.

Create as many worlds as you want with **Karel: New Karel World** and switch
between them from the `World:` link above your program.
