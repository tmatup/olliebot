# Interactive Applets

The agent can generate interactive applets that run directly in the chat interface. Applets are HTML/JavaScript applications that execute in a sandboxed iframe, providing isolation from the main application while still allowing full JavaScript execution.

## How to Create an Applet

Use a fenced code block with the `applet` or `interactive` language tag:

~~~markdown
```applet
<canvas id="canvas" width="400" height="300"></canvas>
<script>
  // Your JavaScript code here
</script>
```
~~~

## Security Model

Applets run in an iframe with `sandbox="allow-scripts"` which provides:
- Full JavaScript execution capability
- Isolation from the parent page's DOM
- No access to parent page cookies or localStorage
- No ability to navigate the parent page
- No form submission to parent

## Example: Conway's Game of Life

```applet
<canvas id="canvas"></canvas>
<script>
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Configuration
const cellSize = 8;
const cols = Math.floor(window.innerWidth / cellSize);
const rows = Math.floor(window.innerHeight / cellSize);
canvas.width = cols * cellSize;
canvas.height = rows * cellSize;

// Create grid
let grid = Array(rows).fill().map(() =>
  Array(cols).fill().map(() => Math.random() > 0.7 ? 1 : 0)
);

// Colors
const deadColor = '#1a1a2e';
const aliveColor = '#4caf50';

function countNeighbors(grid, x, y) {
  let sum = 0;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      const row = (y + i + rows) % rows;
      const col = (x + j + cols) % cols;
      sum += grid[row][col];
    }
  }
  return sum;
}

function nextGeneration() {
  const newGrid = grid.map(arr => [...arr]);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const neighbors = countNeighbors(grid, x, y);
      const cell = grid[y][x];

      if (cell === 1 && (neighbors < 2 || neighbors > 3)) {
        newGrid[y][x] = 0;
      } else if (cell === 0 && neighbors === 3) {
        newGrid[y][x] = 1;
      }
    }
  }

  grid = newGrid;
}

function draw() {
  ctx.fillStyle = deadColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = aliveColor;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] === 1) {
        ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
      }
    }
  }
}

function loop() {
  nextGeneration();
  draw();
  requestAnimationFrame(loop);
}

draw();
setTimeout(loop, 500);
</script>
```

## Example: Tetris Clone

```applet
<canvas id="canvas"></canvas>
<div id="score" style="position:absolute;top:10px;left:10px;color:#fff;font-family:monospace;font-size:16px;">Score: 0</div>
<div id="controls" style="position:absolute;bottom:10px;left:10px;color:#666;font-family:monospace;font-size:12px;">Arrow keys to play</div>
<script>
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');

// Configuration
const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = Math.min(
  Math.floor((window.innerWidth - 40) / COLS),
  Math.floor((window.innerHeight - 60) / ROWS)
);
canvas.width = COLS * BLOCK_SIZE;
canvas.height = ROWS * BLOCK_SIZE;

// Center canvas
canvas.style.margin = 'auto';
canvas.style.display = 'block';
canvas.style.marginTop = '20px';

// Tetromino shapes
const SHAPES = [
  [[1,1,1,1]],                    // I
  [[1,1],[1,1]],                  // O
  [[0,1,1],[1,1,0]],              // S
  [[1,1,0],[0,1,1]],              // Z
  [[1,0,0],[1,1,1]],              // L
  [[0,0,1],[1,1,1]],              // J
  [[0,1,0],[1,1,1]]               // T
];

const COLORS = ['#00f0f0', '#f0f000', '#00f000', '#f00000', '#f0a000', '#0000f0', '#a000f0'];

// Game state
let board = Array(ROWS).fill().map(() => Array(COLS).fill(0));
let score = 0;
let piece = null;
let pieceX = 0;
let pieceY = 0;
let pieceColor = 0;
let gameOver = false;
let dropInterval = 500;
let lastDrop = 0;

function newPiece() {
  const idx = Math.floor(Math.random() * SHAPES.length);
  piece = SHAPES[idx].map(row => [...row]);
  pieceColor = idx;
  pieceX = Math.floor((COLS - piece[0].length) / 2);
  pieceY = 0;

  if (collision()) {
    gameOver = true;
  }
}

function collision(px = pieceX, py = pieceY, p = piece) {
  for (let y = 0; y < p.length; y++) {
    for (let x = 0; x < p[y].length; x++) {
      if (p[y][x]) {
        const newX = px + x;
        const newY = py + y;
        if (newX < 0 || newX >= COLS || newY >= ROWS) return true;
        if (newY >= 0 && board[newY][newX]) return true;
      }
    }
  }
  return false;
}

function merge() {
  for (let y = 0; y < piece.length; y++) {
    for (let x = 0; x < piece[y].length; x++) {
      if (piece[y][x] && pieceY + y >= 0) {
        board[pieceY + y][pieceX + x] = pieceColor + 1;
      }
    }
  }
}

function clearLines() {
  let lines = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y].every(cell => cell !== 0)) {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(0));
      lines++;
      y++;
    }
  }
  if (lines > 0) {
    score += lines * 100 * lines;
    scoreEl.textContent = 'Score: ' + score;
  }
}

function rotate() {
  const rotated = piece[0].map((_, i) => piece.map(row => row[i]).reverse());
  if (!collision(pieceX, pieceY, rotated)) {
    piece = rotated;
  }
}

function move(dx) {
  if (!collision(pieceX + dx, pieceY)) {
    pieceX += dx;
  }
}

function drop() {
  if (!collision(pieceX, pieceY + 1)) {
    pieceY++;
  } else {
    merge();
    clearLines();
    newPiece();
  }
}

function hardDrop() {
  while (!collision(pieceX, pieceY + 1)) {
    pieceY++;
  }
  drop();
}

function draw() {
  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.strokeStyle = '#2a2a4e';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * BLOCK_SIZE, 0);
    ctx.lineTo(x * BLOCK_SIZE, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * BLOCK_SIZE);
    ctx.lineTo(canvas.width, y * BLOCK_SIZE);
    ctx.stroke();
  }

  // Board
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (board[y][x]) {
        ctx.fillStyle = COLORS[board[y][x] - 1];
        ctx.fillRect(x * BLOCK_SIZE + 1, y * BLOCK_SIZE + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
      }
    }
  }

  // Current piece
  if (piece) {
    ctx.fillStyle = COLORS[pieceColor];
    for (let y = 0; y < piece.length; y++) {
      for (let x = 0; x < piece[y].length; x++) {
        if (piece[y][x]) {
          ctx.fillRect(
            (pieceX + x) * BLOCK_SIZE + 1,
            (pieceY + y) * BLOCK_SIZE + 1,
            BLOCK_SIZE - 2,
            BLOCK_SIZE - 2
          );
        }
      }
    }
  }

  // Game over
  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
    ctx.font = '14px monospace';
    ctx.fillText('Press R to restart', canvas.width / 2, canvas.height / 2 + 30);
  }
}

function loop(timestamp) {
  if (!gameOver) {
    if (timestamp - lastDrop > dropInterval) {
      drop();
      lastDrop = timestamp;
    }
  }
  draw();
  requestAnimationFrame(loop);
}

// Keyboard controls
document.addEventListener('keydown', (e) => {
  if (gameOver) {
    if (e.key === 'r' || e.key === 'R') {
      board = Array(ROWS).fill().map(() => Array(COLS).fill(0));
      score = 0;
      scoreEl.textContent = 'Score: 0';
      gameOver = false;
      newPiece();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowLeft': move(-1); break;
    case 'ArrowRight': move(1); break;
    case 'ArrowDown': drop(); break;
    case 'ArrowUp': rotate(); break;
    case ' ': hardDrop(); break;
  }
  e.preventDefault();
});

// Start game
newPiece();
requestAnimationFrame(loop);
</script>
```

## Message Updates

The agent can update existing messages using the `message_update` WebSocket event. This is useful for:
- Evolving applets that change over time
- Progress updates
- Correcting mistakes without adding new messages

### Revision History

All message revisions are automatically stored and can be retrieved via the API:

```bash
# Get all revisions for a message
GET /api/messages/:messageId/revisions

# Get a specific revision
GET /api/messages/:messageId/revisions/:revisionNumber
```

Each revision includes:
- `id` - Unique revision ID
- `messageId` - Parent message ID
- `revisionNumber` - Sequential revision number (1, 2, 3, ...)
- `content` - The message content at that revision
- `metadata` - Associated metadata
- `createdAt` - Timestamp

### Backend Usage

```typescript
// Update a message (automatically saves current version as revision)
channel.updateMessage(messageId, {
  content: 'Updated content with ```applet code block```',
});
```

## Message Replies

When a message contains an applet, users can send replies to request modifications. The reply system persists all exchanges and displays them compactly below the applet.

### Inline Reply Input

Each applet has an inline input bar where users can type instructions to modify the applet:
1. Type your instructions (e.g., "make the cells blue instead of green")
2. Press Enter or click "Send"
3. The agent processes your request, updates the applet, and the exchange is stored

### Reply History

All replies are stored and can be retrieved via the API:

```bash
# Get all replies for a message
GET /api/messages/:messageId/replies
```

Each reply includes:
- `id` - Unique reply ID
- `messageId` - Parent message ID
- `role` - "user" or "assistant"
- `content` - The reply text
- `metadata` - Associated metadata (e.g., revised code for assistant replies)
- `createdAt` - Timestamp

### WebSocket Events

When a reply is added, the server broadcasts a `message-reply-added` event:

```json
{
  "type": "message-reply-added",
  "messageId": "...",
  "reply": {
    "id": "...",
    "role": "user",
    "content": "Make the cells blue"
  },
  "conversationId": "...",
  "timestamp": "..."
}
```

To send a reply, clients send a `message-reply` event:

```json
{
  "type": "message-reply",
  "messageId": "...",
  "content": "Make the cells blue",
  "conversationId": "..."
}
```

## Best Practices

1. **Size appropriately** - Use relative sizing or check window dimensions
2. **Handle focus** - For keyboard input, ensure the applet can receive focus
3. **Provide controls** - Show keyboard shortcuts or click instructions
4. **Use requestAnimationFrame** - For smooth animations
5. **Clean up** - Stop intervals/timeouts when not needed
6. **Dark theme** - Match the chat interface's dark theme (#1a1a2e background)
