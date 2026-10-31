// Keyboard stand-in for the tilt controller. WASD / arrow keys choose a target angle and the
// reported tilt eases towards it on a damped spring, so it feels like tipping a controller.
const MAX_TILT_DEG = 25;
const STIFFNESS = 42; // higher = reaches the target angle sooner
const DAMPING = 13;

const keys = new Set();
const axis = { pitch: { x: 0, v: 0 }, roll: { x: 0, v: 0 } };
const tilt = { pitch: 0, roll: 0 };
const BINDINGS = {
  KeyW: ['pitch', 1], ArrowUp: ['pitch', 1], KeyS: ['pitch', -1], ArrowDown: ['pitch', -1],
  KeyD: ['roll', 1], ArrowRight: ['roll', 1], KeyA: ['roll', -1], ArrowLeft: ['roll', -1],
};
let listening = false;

function targetFor(name) {
  let t = 0;
  for (const code of keys) if (BINDINGS[code][0] === name) t += BINDINGS[code][1];
  return Math.sign(t) * MAX_TILT_DEG;
}

export const keyboardProvider = {
  selfCentering: true,
  hint: 'WASD / Arrows to tilt',
  init() {
    if (listening) return;
    listening = true;
    addEventListener('keydown', (e) => {
      if (!BINDINGS[e.code]) return;
      keys.add(e.code);
      e.preventDefault();
    });
    addEventListener('keyup', (e) => keys.delete(e.code));
    addEventListener('blur', () => keys.clear());
  },
  update(dt) {
    for (const name of ['pitch', 'roll']) {
      const a = axis[name];
      a.v += (STIFFNESS * (targetFor(name) - a.x) - DAMPING * a.v) * dt;
      a.x += a.v * dt;
    }
  },
  read() {
    tilt.pitch = axis.pitch.x;
    tilt.roll = axis.roll.x;
    return tilt;
  },
};
