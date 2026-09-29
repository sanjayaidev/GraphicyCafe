/* ─────────────────────────────────────────────────────────────
   GraphicyCafe – ADVANCED AR (in-page WebXR)

   Contract used by product-details.html:
     await window.AdvancedAR.isSupported()      -> boolean
     window.AdvancedAR.start({ modelUrl, fallbackUrl, onExit,
                               onAddToCart, onError, targetSize })
     window.AdvancedAR.stop()

   What it does (Chrome on an ARCore Android phone, over HTTPS):
     • detects flat surfaces and shows a placement ring
     • live "ghost" preview of the dish on the surface, tap to place
     • drag = rotate, pinch = resize, two-finger twist = rotate
     • real-world size (default ≈ dinner-plate, 28 cm) – pinch to change
     • real lighting from the camera (light estimation) + soft shadow
     • Move / Reset / Add to cart buttons in a DOM overlay

   "Simple AR" is separate: it is <model-viewer>'s native AR button
   (Scene Viewer on Android, Quick Look on iPhone).
   ───────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';

const DEFAULT_SIZE_M = 0.28;      // longest side of the dish, in metres
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';

/** Scale a loaded glTF so its longest side = targetSize metres, centred on X/Z, sitting on y = 0. */
export function normalizeModel(root, targetSize = DEFAULT_SIZE_M) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const wrapper = new THREE.Group();
  if (box.isEmpty()) { wrapper.add(root); return { wrapper, height: 0 }; }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = targetSize / maxDim;
  root.position.x -= center.x;
  root.position.y -= box.min.y;
  root.position.z -= center.z;
  wrapper.add(root);
  wrapper.scale.setScalar(s);
  return { wrapper, height: size.y * s };
}

function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach(m => {
      Object.values(m).forEach(v => { if (v && v.isTexture) v.dispose(); });
      m.dispose();
    });
  });
}

const AdvancedAR = (() => {
  let renderer, scene, camera, hemi, dirLight, xrLight, reticle, anchor, els;
  let session = null, hitTestSource = null, viewerSpace = null;
  let modelWrapper = null, modelReady = false, ended = true;
  let placing = true, hasHit = false;
  let opts = {};
  let hintTimer = null;
  let endedByUser = false;

  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const pointers = new Map();
  let pinch = null;

  const $ = id => document.getElementById(id);

  function grabElements() {
    els = {
      canvas: $('xr-canvas'), overlay: $('arOverlay'), hint: $('arHint'),
      exit: $('arExitBtn'), cart: $('arAddToCartBtn'),
      move: $('arRepositionBtn'), reset: $('arResetBtn'),
    };
    if (!els.canvas || !els.overlay) throw new Error('AR markup (#xr-canvas / #arOverlay) not found');
  }

  function setHint(text, ms = 0) {
    if (!els.hint) return;
    clearTimeout(hintTimer);
    els.hint.textContent = text;
    if (ms) hintTimer = setTimeout(() => setHint(currentHint()), ms);
  }
  function currentHint() {
    if (!modelReady) return 'Loading your dish…';
    if (placing) return hasHit ? 'Tap to place your dish' : 'Move your phone slowly to find a flat surface';
    return 'Drag to rotate · pinch to resize';
  }

  function init() {
    if (renderer) return;
    grabElements();

    renderer = new THREE.WebGLRenderer({ canvas: els.canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, 1, 0.01, 20);

    // fallback lighting (replaced by real estimated light when the device supports it)
    hemi = new THREE.HemisphereLight(0xffffff, 0x8b8f99, 1.6);
    scene.add(hemi);

    xrLight = new XREstimatedLight(renderer);
    xrLight.addEventListener('estimationstart', () => {
      scene.add(xrLight); scene.remove(hemi);
      if (xrLight.environment) scene.environment = xrLight.environment;
    });
    xrLight.addEventListener('estimationend', () => {
      scene.remove(xrLight); scene.add(hemi); scene.environment = null;
    });

    // everything the user places/rotates/scales lives in `anchor`
    anchor = new THREE.Group();
    anchor.visible = false;
    scene.add(anchor);

    dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(0.6, 1.6, 0.4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    Object.assign(dirLight.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 4 });
    dirLight.shadow.bias = -0.0005;
    anchor.add(dirLight, dirLight.target);

    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    shadowCatcher.receiveShadow = true;
    anchor.add(shadowCatcher);

    reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.11, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe3a63d, transparent: true, opacity: 0.9 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    wireUi();
  }

  // ── UI + gestures ───────────────────────────────────────────
  function wireUi() {
    const { overlay, exit, cart, move, reset } = els;

    // taps on the overlay must not also be treated as an XR "select"
    overlay.addEventListener('beforexrselect', e => e.preventDefault());

    exit.addEventListener('click', () => stop());
    cart?.addEventListener('click', () => {
      if (opts.onAddToCart) { opts.onAddToCart(); setHint('Added to cart ✓', 1800); }
    });
    move?.addEventListener('click', () => {
      placing = true; hasHit = false;
      move.hidden = true; reset.hidden = true;
      setHint(currentHint());
    });
    reset?.addEventListener('click', () => {
      anchor.scale.setScalar(1);
      anchor.rotation.y = 0;
      setHint('Size and rotation reset', 1500);
    });

    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointercancel', onPointerUp);
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

  function onPointerDown(e) {
    if (e.target.closest('button')) return;
    els.overlay.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d0: dist(a, b) || 1, a0: angle(a, b), s0: anchor.scale.x, r0: anchor.rotation.y };
    }
  }

  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 12) p.moved = true;
    if (placing || !modelReady) return;

    if (pointers.size === 1) {
      anchor.rotation.y += dx * 0.01;                              // drag = rotate
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const s = THREE.MathUtils.clamp(pinch.s0 * (dist(a, b) / pinch.d0), MIN_SCALE, MAX_SCALE);
      anchor.scale.setScalar(s);                                   // pinch = resize
      anchor.rotation.y = pinch.r0 - (angle(a, b) - pinch.a0);     // twist = rotate
    }
  }

  function onPointerUp(e) {
    const p = pointers.get(e.pointerId);
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!p || !wasSingle || e.type === 'pointercancel') return;
    const isTap = !p.moved && performance.now() - p.t < 600;
    if (isTap && placing && hasHit && modelReady) place();
  }

  function place() {
    placing = false;
    reticle.visible = false;
    if (els.move) els.move.hidden = false;
    if (els.reset) els.reset.hidden = false;
    setHint(currentHint());
  }

  // ── per-frame ───────────────────────────────────────────────
  function onFrame(_t, frame) {
    if (frame && hitTestSource && placing) {
      const refSpace = renderer.xr.getReferenceSpace();
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length && refSpace) {
        const pose = hits[0].getPose(refSpace);
        if (pose) {
          reticle.matrix.fromArray(pose.transform.matrix);
          reticle.matrix.decompose(tmpPos, tmpQuat, tmpScale);
          reticle.visible = true;
          anchor.position.copy(tmpPos);                 // ghost preview follows the surface
          anchor.visible = modelReady;
          if (!hasHit) { hasHit = true; setHint(currentHint()); }
        }
      } else {
        reticle.visible = false;
        if (hasHit) { hasHit = false; setHint(currentHint()); }
      }
    }
    renderer.render(scene, camera);
  }

  // ── loading ─────────────────────────────────────────────────
  function makeLoader() {
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
    return new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  }

  async function loadModel(url, fallbackUrl, targetSize) {
    const loader = makeLoader();
    let gltf;
    try {
      gltf = await loader.loadAsync(url);
    } catch (err) {
      if (!fallbackUrl || fallbackUrl === url) throw err;
      console.warn('[AdvancedAR] model failed, using fallback:', url, err);
      gltf = await loader.loadAsync(fallbackUrl);
    }
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return normalizeModel(gltf.scene, targetSize).wrapper;
  }

  // ── lifecycle ───────────────────────────────────────────────
  async function isSupported() {
    try {
      if (!window.isSecureContext || !navigator.xr) return false;
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch { return false; }
  }

  async function start(options = {}) {
    if (session) return true;
    opts = options;
    try {
      init();
      ended = false; endedByUser = false; placing = true; hasHit = false; modelReady = false;
      anchor.visible = false; anchor.scale.setScalar(1); anchor.rotation.y = 0;
      reticle.visible = false;
      if (els.move) els.move.hidden = true;
      if (els.reset) els.reset.hidden = true;
      if (els.cart) els.cart.hidden = !opts.onAddToCart;
      els.overlay.hidden = false;                    // DOM-overlay root must be visible
      setHint('Starting camera…');

      // start downloading the model right away, while the camera opens
      const loading = loadModel(opts.modelUrl, opts.fallbackUrl, opts.targetSize || DEFAULT_SIZE_M);
      loading.catch(() => {});                       // handled below

      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'light-estimation'],
        domOverlay: { root: els.overlay },
      });
      session.addEventListener('end', onSessionEnd);
      await renderer.xr.setSession(session);
      viewerSpace = await session.requestReferenceSpace('viewer');
      hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      renderer.setAnimationLoop(onFrame);
      setHint(currentHint());

      modelWrapper = await loading;
      if (ended) { disposeObject(modelWrapper); modelWrapper = null; return false; }
      anchor.add(modelWrapper);
      modelReady = true;
      setHint(currentHint());
      return true;
    } catch (err) {
      if (endedByUser) return false;               // user left while we were still starting
      console.error('[AdvancedAR] failed to start:', err);
      const msg = /load|fetch|network|gltf/i.test(String(err && err.message))
        ? 'Couldn\'t load the 3D model. Try Simple AR instead.'
        : 'Couldn\'t start Advanced AR. Try Simple AR instead.';
      const s = session;
      cleanup();
      if (s) { try { await s.end(); } catch {} }
      opts.onExit?.();
      opts.onError?.(msg);
      return false;
    }
  }

  function stop() {
    if (session) { session.end().catch(() => {}); } else { cleanup(); }
  }

  function onSessionEnd() {
    endedByUser = true;
    const cb = opts.onExit;
    cleanup();
    cb?.();
  }

  function cleanup() {
    if (ended && !session) return;
    ended = true;
    clearTimeout(hintTimer);
    try { hitTestSource?.cancel(); } catch {}
    hitTestSource = null; viewerSpace = null;
    renderer?.setAnimationLoop(null);
    if (session) { session.removeEventListener('end', onSessionEnd); }
    session = null;
    pointers.clear(); pinch = null;
    if (modelWrapper) { anchor.remove(modelWrapper); disposeObject(modelWrapper); modelWrapper = null; }
    modelReady = false;
    if (anchor) anchor.visible = false;
    if (reticle) reticle.visible = false;
    if (els?.overlay) els.overlay.hidden = true;
  }

  return { isSupported, start, stop };
})();

if (typeof window !== 'undefined') window.AdvancedAR = AdvancedAR;
export default AdvancedAR;
