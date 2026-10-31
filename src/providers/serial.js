// Stub provider for the MPU6050 tilt controller, using the Web Serial API. Untested on hardware.
//
// Wire format: one ASCII line per sample at ~50 Hz, 115200 baud, degrees:
//   "pitch,roll\n"     e.g.  "12.5,-3.0\n"
//   pitch > 0 = tilted forward, roll > 0 = tilted right. If the board is mounted differently,
//   flip the signs in INVERT below rather than touching gameplay.
//
// To use it: change the provider line in ../input.js to `serialProvider`.
//
// Browser rules: Web Serial needs Chrome/Edge on a secure context (localhost qualifies), and
// the FIRST connection needs a user gesture, because requestPort() opens a chooser. So init()
// silently reconnects to a port granted earlier and otherwise waits for one click or key press.
// That same gesture also unlocks browser audio. After that, the game is tilt-only.
const BAUD_RATE = 115200;
const STALE_AFTER_S = 0.5; // no data for this long -> report level, so the UFO glides to a stop
const INVERT = { pitch: 1, roll: 1 };

const latest = { pitch: 0, roll: 0 };
const tilt = { pitch: 0, roll: 0 };
let age = Infinity;
let started = false;

// Parses one "pitch,roll" line. Returns { pitch, roll } or null for anything malformed:
// serial streams start mid-line and drop bytes, so bad lines must be skipped, never thrown.
export function parseLine(line) {
  const parts = line.trim().split(',');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null;
  const pitch = Number(parts[0]);
  const roll = Number(parts[1]);
  if (!Number.isFinite(pitch) || !Number.isFinite(roll)) return null;
  if (Math.abs(pitch) > 180 || Math.abs(roll) > 180) return null;
  return { pitch, roll };
}

async function readLoop(port) {
  await port.open({ baudRate: BAUD_RATE });
  const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep the unfinished tail for the next chunk
    for (const line of lines) {
      const sample = parseLine(line);
      if (!sample) continue;
      latest.pitch = sample.pitch * INVERT.pitch;
      latest.roll = sample.roll * INVERT.roll;
      age = 0;
    }
  }
}

async function connect() {
  const [known] = await navigator.serial.getPorts();
  if (known) return readLoop(known);
  const ask = async () => {
    removeEventListener('pointerdown', ask);
    removeEventListener('keydown', ask);
    readLoop(await navigator.serial.requestPort()).catch((e) => console.error('Serial:', e));
  };
  addEventListener('pointerdown', ask);
  addEventListener('keydown', ask);
}

export const serialProvider = {
  selfCentering: false,
  hint: 'Tilt the controller',
  init() {
    if (started) return;
    started = true;
    if (!navigator.serial) {
      console.error('Web Serial is unavailable: use Chrome or Edge on http://localhost.');
      return;
    }
    connect().catch((e) => console.error('Serial:', e));
  },
  update(dt) {
    age += dt;
  },
  read() {
    const fresh = age < STALE_AFTER_S;
    tilt.pitch = fresh ? latest.pitch : 0;
    tilt.roll = fresh ? latest.roll : 0;
    return tilt;
  },
};
