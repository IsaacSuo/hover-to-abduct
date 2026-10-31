// The ONLY module gameplay may use for player input:
//   getTilt()    -> { pitch, roll } in degrees, relative to the calibrated zero
//                   (pitch > 0 = tilted forward, roll > 0 = tilted right)
//   calibrate()  -> stores the average tilt over a short window as the new zero
//
// HOW TO SWITCH TO THE MPU6050 CONTROLLER
//   Change the one line below to:  let provider = serialProvider;
//   Everything else (gameplay, UI, calibration) stays the same. See providers/serial.js.
import { keyboardProvider } from './providers/keyboard.js';
import { serialProvider } from './providers/serial.js'; // eslint-disable-line no-unused-vars

let provider = keyboardProvider;

const zero = { pitch: 0, roll: 0 };
const tilt = { pitch: 0, roll: 0 };
let sampling = null;

export function initInput() {
  provider.init();
}

// Called once per game tick; dt is in seconds.
export function updateInput(dt) {
  provider.update(dt);
  if (!sampling) return;
  const raw = provider.read();
  sampling.pitch += raw.pitch;
  sampling.roll += raw.roll;
  sampling.n += 1;
  sampling.left -= dt;
  if (sampling.left > 0) return;
  // A self-centring provider (keyboard) is level by definition. Averaging it would turn a key
  // held during the countdown into a permanent offset, so it only goes through the motions.
  if (!provider.selfCentering) {
    zero.pitch = sampling.pitch / sampling.n;
    zero.roll = sampling.roll / sampling.n;
  }
  const done = sampling.done;
  sampling = null;
  done({ ...zero });
}

export function getTilt() {
  const raw = provider.read();
  tilt.pitch = raw.pitch - zero.pitch;
  tilt.roll = raw.roll - zero.roll;
  return tilt;
}

export function calibrate(seconds = 2.8) {
  return new Promise((done) => {
    sampling = { pitch: 0, roll: 0, n: 0, left: seconds, done };
  });
}

export function inputHint() {
  return provider.hint;
}

// Swaps the provider at runtime (used by the input self-test).
export function useProvider(next) {
  provider = next;
  provider.init();
}
