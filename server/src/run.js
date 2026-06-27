// Supervisor: runs the server (index.js) as a child process and restarts it if
// it exits non-zero ("log and restart"). Zero-dependency alternative to pm2 for
// a single-instance deployment. A clean shutdown (SIGINT/SIGTERM or exit 0) is
// not restarted; a burst of rapid crashes gives up rather than spin forever.
const { fork } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'index.js');
const WINDOW_MS = 60 * 1000;   // crash-loop detection window
const MAX_CRASHES = 10;        // ...max crashes within it before giving up
const RESTART_DELAY_MS = 1000;

let child = null;
let stopping = false;
let crashes = [];

function start() {
  child = fork(SCRIPT, { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (stopping || code === 0) {
      process.exit(code || 0);   // intentional shutdown — don't restart
    }

    const now = Date.now();
    crashes = crashes.filter((t) => now - t < WINDOW_MS);
    crashes.push(now);
    if (crashes.length > MAX_CRASHES) {
      console.error(`[supervisor] ${crashes.length} crashes within ${WINDOW_MS / 1000}s — giving up.`);
      process.exit(1);
    }

    console.error(`[supervisor] server exited (code ${code}, signal ${signal}); restarting in ${RESTART_DELAY_MS}ms (#${crashes.length})…`);
    setTimeout(start, RESTART_DELAY_MS);
  });
}

// Forward termination signals so Ctrl+C / `kill` shut the server down cleanly.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill(sig);
  });
}

start();
