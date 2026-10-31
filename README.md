# Hover to Abduct

Tilt to fly a UFO over a Halloween farm. Bring it to a hover and the tractor beam switches on by
itself. Reach the target score in 60 seconds. For now it plays on the keyboard; the real input
will be an MPU6050 tilt controller.

## Run

    git clone https://github.com/IsaacSuo/hover-to-abduct.git
    cd hover-to-abduct
    npm install
    npm start        # http://localhost:8137/

WASD or the arrow keys simulate tilt. Audio starts after the first key press (a browser rule).
`tools/gallery.html` shows a contact sheet of every model.

## Where things are

| Path | What |
| --- | --- |
| `src/game.js` | Game logic. **All tuning constants are at the top of this file**, the score table right below them. |
| `src/input.js` | The only input gameplay ever reads: `getTilt()`, `calibrate()`. |
| `src/providers/keyboard.js` | Keyboard provider. |
| `src/providers/serial.js` | Web Serial stub for the controller: `"pitch,roll\n"`, ~50 Hz, 115200 baud. Not tested on hardware. |
| `src/world.js` | Road, terrain, sky and the placement of every prop. |
| `src/render.js` | Depth of field, bloom and their settings. |
| `src/audio.js` | Synthesised sound. |
| `tools/build_assets.py` | Headless Blender script that builds `assets/world.glb`. |

To use the controller, change the one provider line in `src/input.js` to `serialProvider`.
Web Serial needs Chrome or Edge, and the first connection needs one click or key press, because
the browser's port chooser requires a user gesture. After that the game is tilt-only.

## Rebuilding the models

    npm run build:assets

Playing doesn't require this: the built `assets/world.glb` is in the repo. Rebuilding needs
Blender 5 and the two packs below, which aren't in the repo. Download them and unzip the Halloween
kit into `assets_raw/halloween/x/` and the farm pack into `assets_raw/farm/x/`.

## Asset credits

Both packs are CC0. Crediting them is optional but kind.

- [Low Poly Halloween Asset Kit](https://assetquest.itch.io/free-low-poly-halloween-kit) by Asset Quest. The kit's own `License.txt` states CC0; the store page doesn't.
- [LowPoly Farm Buildings](https://quaternius.itch.io/lowpoly-farm-buildings) by Quaternius.
- Font: Creepster by Sideshow (SIL Open Font License), through `@fontsource/creepster`.

The UFO, duck pilot, cockpit, ghosts, farmhouses, animals, cars, scarecrow, wheat, hay and the
round and pine trees are built by `tools/build_assets.py`. The kit's own ghost models are unused.

## License

The code and the custom models are under the [MIT License](LICENSE). The two asset packs stay CC0,
and Creepster stays under the SIL Open Font License.
