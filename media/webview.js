/**
 * Karel World viewer — pure renderer, no controls.
 *
 * Runs inside the .klm custom editor. Receives { type: "world" } and
 * { type: "status" } messages, renders the world on a theme-aware,
 * retina-aware canvas that auto-fits the available space, and persists its
 * last state so the view survives tab hides. The only message it sends is
 * { type: "ready" }.
 */

(function () {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById("worldCanvas");
  const ctx = canvas.getContext("2d");

  const WALL_WIDTH = 4;
  const AXIS_MARGIN = 25;
  const MIN_CELL = 16;
  const MAX_CELL = 72;
  const FIT_PADDING = 8;

  let world = null;
  let status = { state: "idle", message: "" };

  const statusText = document.getElementById("statusText");
  const errorBanner = document.getElementById("errorBanner");
  const emptyState = document.getElementById("emptyState");

  // ---------- state persistence (survives hide) ----------

  const saved = vscode.getState();
  if (saved) {
    world = saved.world || null;
    status = saved.status || status;
    // A persisted "running"/"stepping" state belongs to a session that died
    // with the previous window — restore as idle, keeping the world.
    if (status.state === "running" || status.state === "stepping") {
      status = { state: "idle" };
    }
    render();
    updateInfo();
    updateStatus();
  }

  function persist() {
    vscode.setState({ world, status });
  }

  // ---------- messaging ----------

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "world") {
      world = message.data;
      render();
      updateInfo();
      persist();
    } else if (message.type === "status") {
      status = message;
      updateStatus();
      render(); // Karel's color depends on the error state
      persist();
    }
  });

  vscode.postMessage({ type: "ready" });

  // Re-render when the color theme changes (VS Code swaps body classes).
  new MutationObserver(() => render()).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });

  window.addEventListener("resize", () => render());

  // ---------- rendering ----------

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  }

  function palette() {
    const fg = cssVar("--vscode-editor-foreground", "#cccccc");
    return {
      background: cssVar("--vscode-editor-background", "#1e1e1e"),
      axis: cssVar("--vscode-descriptionForeground", "#999999"),
      grid: cssVar("--vscode-editorIndentGuide-background", "rgba(128,128,128,0.35)"),
      wall: fg,
      border: cssVar("--vscode-panel-border", fg),
      beeper: "#e8b93e",
      beeperText: "#3b2f04",
      karel: cssVar("--vscode-charts-blue", "#4080f0"),
      karelError: cssVar("--vscode-errorForeground", "#f44747"),
    };
  }

  /**
   * Cell size that fits the world into the available container space,
   * clamped so tiny panels stay readable and huge panels don't look absurd.
   */
  function fitCellSize(width, height) {
    const container = canvas.parentElement;
    const availW = container.clientWidth - FIT_PADDING * 2 - AXIS_MARGIN - WALL_WIDTH * 2;
    const availH = container.clientHeight - FIT_PADDING * 2 - AXIS_MARGIN - WALL_WIDTH * 2;
    const fit = Math.floor(Math.min(availW / width, availH / height));
    return Math.max(MIN_CELL, Math.min(fit, MAX_CELL));
  }

  function render() {
    if (!world) {
      canvas.classList.remove("visible");
      emptyState.classList.remove("hidden");
      return;
    }
    canvas.classList.add("visible");
    emptyState.classList.add("hidden");

    const colors = palette();
    const { width, height } = world.dimensions;
    const cell = fitCellSize(width, height);

    const logicalWidth = AXIS_MARGIN + width * cell + WALL_WIDTH * 2;
    const logicalHeight = AXIS_MARGIN + height * cell + WALL_WIDTH * 2;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(logicalWidth * dpr);
    canvas.height = Math.round(logicalHeight * dpr);
    canvas.style.width = logicalWidth + "px";
    canvas.style.height = logicalHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const gridOffsetX = AXIS_MARGIN;
    const gridOffsetY = 0;

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    // Axis labels
    ctx.fillStyle = colors.axis;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let x = 1; x <= width; x++) {
      ctx.fillText(
        String(x),
        gridOffsetX + WALL_WIDTH + (x - 0.5) * cell,
        logicalHeight - AXIS_MARGIN / 2
      );
    }
    for (let y = 1; y <= height; y++) {
      ctx.fillText(String(y), AXIS_MARGIN / 2, gridOffsetY + WALL_WIDTH + (height - y + 0.5) * cell);
    }

    // Grid
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x++) {
      ctx.beginPath();
      ctx.moveTo(gridOffsetX + WALL_WIDTH + x * cell, gridOffsetY + WALL_WIDTH);
      ctx.lineTo(gridOffsetX + WALL_WIDTH + x * cell, gridOffsetY + WALL_WIDTH + height * cell);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y++) {
      ctx.beginPath();
      ctx.moveTo(gridOffsetX + WALL_WIDTH, gridOffsetY + WALL_WIDTH + y * cell);
      ctx.lineTo(gridOffsetX + WALL_WIDTH + width * cell, gridOffsetY + WALL_WIDTH + y * cell);
      ctx.stroke();
    }

    // Beepers
    for (const beeper of world.beepers) {
      const cx = gridOffsetX + WALL_WIDTH + (beeper.x - 0.5) * cell;
      const cy = gridOffsetY + WALL_WIDTH + (height - beeper.y + 0.5) * cell;

      ctx.fillStyle = colors.beeper;
      ctx.beginPath();
      ctx.arc(cx, cy, cell / 4, 0, Math.PI * 2);
      ctx.fill();

      if (beeper.count > 1) {
        ctx.fillStyle = colors.beeperText;
        ctx.font = "bold " + Math.max(10, Math.round(cell * 0.3)) + "px sans-serif";
        ctx.fillText(String(beeper.count), cx, cy);
      }
    }

    // Walls
    ctx.strokeStyle = colors.wall;
    ctx.lineWidth = WALL_WIDTH;
    ctx.lineCap = "round";
    for (const wall of world.walls) {
      const { from, to } = wall;
      ctx.beginPath();
      if (from.x === to.x) {
        const wallY = Math.max(from.y, to.y);
        const screenX = gridOffsetX + WALL_WIDTH + (from.x - 1) * cell;
        const screenY = gridOffsetY + WALL_WIDTH + (height - wallY + 1) * cell;
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(screenX + cell, screenY);
      } else {
        const wallX = Math.max(from.x, to.x);
        const screenX = gridOffsetX + WALL_WIDTH + (wallX - 1) * cell;
        const screenY = gridOffsetY + WALL_WIDTH + (height - from.y) * cell;
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(screenX, screenY + cell);
      }
      ctx.stroke();
    }

    // Border walls
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = WALL_WIDTH;
    ctx.strokeRect(
      gridOffsetX + WALL_WIDTH / 2,
      gridOffsetY + WALL_WIDTH / 2,
      width * cell + WALL_WIDTH,
      height * cell + WALL_WIDTH
    );

    drawKarel(world.karel, height, cell, gridOffsetX, gridOffsetY, colors);
  }

  function drawKarel(karel, worldHeight, cell, gridOffsetX, gridOffsetY, colors) {
    const cx = gridOffsetX + WALL_WIDTH + (karel.x - 0.5) * cell;
    const cy = gridOffsetY + WALL_WIDTH + (worldHeight - karel.y + 0.5) * cell;
    const size = cell * 0.7;

    ctx.save();
    ctx.translate(cx, cy);

    const rotations = {
      north: 0,
      west: -Math.PI / 2,
      south: Math.PI,
      east: Math.PI / 2,
    };
    ctx.rotate(rotations[karel.facing] || 0);

    ctx.fillStyle = status.state === "error" ? colors.karelError : colors.karel;
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(-size / 3, size / 3);
    ctx.lineTo(size / 3, size / 3);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = colors.background;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  // ---------- read-only status line ----------

  function updateInfo() {
    if (!world) {
      return;
    }
    document.getElementById("position").textContent =
      "(" + world.karel.x + ", " + world.karel.y + ")";
    const facing = world.karel.facing;
    document.getElementById("facing").textContent =
      "· facing " + facing.charAt(0).toUpperCase() + facing.slice(1);
    document.getElementById("beepers").textContent = String(world.karel.beepers);
  }

  function updateStatus() {
    const labels = {
      idle: "Ready",
      running: "Running…",
      stepping: "Step mode",
      error: "Error",
      done: "Done",
    };
    let text = labels[status.state] || "Ready";
    if (status.state === "stepping" && status.line) {
      text += " (line " + status.line + ")";
    }
    statusText.textContent = text;
    statusText.className = "status-state " + status.state;

    if (status.state === "error" && status.message) {
      const where = status.line ? " (line " + status.line + ")" : "";
      errorBanner.textContent = status.message + where;
      errorBanner.classList.remove("hidden");
    } else {
      errorBanner.classList.add("hidden");
    }
  }
})();
