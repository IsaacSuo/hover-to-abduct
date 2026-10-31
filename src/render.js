// Render pipeline: scene -> depth of field (keyed to the UFO's distance) -> bloom -> tone mapping.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Blur is zero within [focus - NEAR_SHARP, focus + FAR_SHARP] and reaches maximum after the ramps.
const NEAR_SHARP = 2.5;
const NEAR_RAMP = 4.5;
const FAR_SHARP = 13;
const FAR_RAMP = 42;
const MAX_BLUR = 0.014; // blur radius as a fraction of screen height
const BLOOM = { strength: 0.42, radius: 0.65, threshold: 0.92 };

const dofShader = {
  uniforms: {
    tColor: { value: null }, tDepth: { value: null }, near: { value: 0.1 }, far: { value: 100 },
    focus: { value: 20 }, bands: { value: new THREE.Vector4(NEAR_SHARP, NEAR_RAMP, FAR_SHARP, FAR_RAMP) },
    blur: { value: new THREE.Vector2(0.01, 0.01) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
  fragmentShader: `
    #include <packing>
    uniform sampler2D tColor, tDepth; uniform float near, far, focus; uniform vec4 bands; uniform vec2 blur;
    varying vec2 vUv;
    // With MSAA, varyings can overshoot at triangle edges, and pow(negative) is NaN on real GPUs. Bloom
    // would blur a single NaN pixel into a huge black block, so nothing bad gets past this pass.
    // Checks the bits: on Windows the D3D compiler assumes values are never NaN and removes isnan().
    bool finite(float x){ return (floatBitsToUint(x) & 0x7F800000u) != 0x7F800000u; }
    vec3 safe(vec3 c){ return finite(c.r) && finite(c.g) && finite(c.b) ? min(c, vec3(64.)) : vec3(0.); }
    float viewZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
    float coc(float z){
      float d = z - focus;
      return max(smoothstep(bands.x, bands.x + bands.y, -d), smoothstep(bands.z, bands.z + bands.w, d));
    }
    void main(){
      // The empty sky stays crisp (stars would smear into blobs); silhouettes still blur over it.
      bool sky = texture2D(tDepth, vUv).x >= 0.99999;
      float z0 = viewZ(vUv), c0 = sky ? 0. : coc(z0);
      vec3 sum = safe(texture2D(tColor, vUv).rgb); float total = 1.;
      // 28-tap golden-angle disc. A tap counts only if that pixel's own blur reaches this far, and
      // anything behind this pixel can't spread over it, so the sharp UFO keeps a crisp outline.
      for (int i = 1; i <= 28; i++) {
        float r = sqrt(float(i) / 28.), a = float(i) * 2.39996;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * blur;
        float z = viewZ(uv), c = coc(z);
        if (z >= z0) c = min(c, c0 * 1.4);
        float w = smoothstep(r - 0.1, r + 0.1, c);
        if (w <= 0.) continue;
        vec3 col = safe(texture2D(tColor, uv).rgb);
        w *= 1. + 1.5 * max(dot(col, vec3(.3,.6,.1)) - 1.2, 0.);  // bright lamps open into bokeh discs
        sum += col * w; total += w;
      }
      gl_FragColor = vec4(sum / total, 1.);
    }`,
};

export function createPipeline(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const depth = new THREE.DepthTexture(size.x, size.y);
  depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: depth });

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
  const dof = new ShaderPass(dofShader, 'unusedInput');
  dof.uniforms.tColor.value = sceneRT.texture;
  dof.uniforms.tDepth.value = depth;
  dof.uniforms.near.value = camera.near;
  dof.uniforms.far.value = camera.far;
  const bloom = new UnrealBloomPass(size.clone(), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(dof);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const setBlur = () => {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    dof.uniforms.blur.value.set(MAX_BLUR * s.y / s.x, MAX_BLUR);
    return s;
  };
  setBlur();

  return {
    sceneRT,
    render(focusDistance) {
      dof.uniforms.focus.value = focusDistance;
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      composer.render();
    },
    resize() {
      const s = setBlur();
      sceneRT.setSize(s.x, s.y);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(innerWidth, innerHeight);
    },
  };
}
