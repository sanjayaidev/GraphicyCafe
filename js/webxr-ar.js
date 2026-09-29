// Advanced AR — Three.js + WebXR
// Handheld AR only works on Chrome/Android right now (iOS Safari has no
// WebXR support at all — that's a browser limitation, not something this
// module can work around). Capability is checked before this ever runs.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = 'https://modelviewer.dev/shared-assets/models/Astronaut.glb';
const MIN_SCALE = 0.15;
const MAX_SCALE = 1.5;
const BASE_SCALE = 0.35;

let renderer, scene, camera, reticle, controller;
let hitTestSource = null;
let hitTestSourceRequested = false;
let framesSinceReady = 0;
let framesWithHit = 0;
let placedModel = null;
let loadedGltfTemplate = null;
let session = null;
let currentModelUrl = null;
let mixer = null;
let clock = new THREE.Clock();

// Stable world-locking: an XRAnchor (when the device supports it) tracks a
// physical point and gets corrected by the device's own tracking system as
// it refines its understanding of the room — a plain fixed position does
// not get these corrections and can visibly drift/swim as you walk around.
// anchorGroup is what actually follows the anchor's pose each frame;
// placedModel is parented to it so user rotate/pan gestures (applied as
// placedModel's LOCAL transform) survive anchor corrections untouched.
let anchor = null;
let anchorGroup = null;
let lastHitTestResult = null; // the current frame's raw hit-test result, needed to create an anchor at tap time

// Enhanced tracking stabilization with adaptive smoothing
const reticleSmoothed = { 
  position: new THREE.Vector3(), 
  quaternion: new THREE.Quaternion(), 
  velocity: new THREE.Vector3(),
  initialized: false 
};
const RETICLE_SMOOTHING_BASE = 0.25; // Lower = smoother but more lag
const RETICLE_SMOOTHING_MAX = 0.6;   // Higher = snappier but more jitter
const POSITION_THRESHOLD = 0.001;    // Ignore micro-movements below this
const OUTLIER_REJECTION_DIST = 0.05; // Reject jumps larger than this

// Improved plane detection: track consecutive hits to confirm stable surface
let consecutiveHits = 0;
const MIN_CONSECUTIVE_HITS = 1; // Require only 1 frame with hit for instant surface detection
let lastHitPosition = null;

// Baseplate for visual grounding and one-finger drag control
let baseplate = null;
const BASEPLATE_RADIUS = 0.15;
const BASEPLATE_COLOR = 0xe3a63d;
const BASEPLATE_OPACITY = 0.3;

// Drag inertia for natural motion
const DRAG_INERTIA = 0.92; // 0 = no inertia, 0.98 = very slippery
let dragVelocity = new THREE.Vector3();
let rotationVelocity = 0;
const ROTATION_INERTIA = 0.90;

// Lighting estimation state
let lightEstimationEnabled = false;
let estimatedLightIntensity = 1.0;
let estimatedLightColor = new THREE.Color(0xffffff);

let canvas, overlayEl, hintEl, exitBtn, cartBtn;
let onExitCallback = null;
let onErrorCallback = null;
let startupInProgress = false;
let cleanupComplete = true;

// Touch gesture state with improved separation
const touch = { 
  mode: null, 
  lastX: 0, 
  lastY: 0, 
  lastDist: 0,
  startTime: 0,
  startX: 0,
  startY: 0,
  tapThreshold: 10, // pixels - if movement < this, it's a tap
  longPressTimer: null,
  isLongPress: false
};

async function isSupported() {
  if (!('xr' in navigator)) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

function setupScene(rendererInstance) {
  scene = new THREE.Scene();

  // Plain THREE lights alone leave PBR materials (metalness/roughness)
  // looking flat and dull — this is the actual reason Simple AR (which
  // uses model-viewer's built-in neutral HDR environment map) looks so
  // much better than Advanced AR did. Generating a PMREM environment map
  // and assigning it to scene.environment gives the model real image-based
  // lighting and reflections, the same trick model-viewer uses under the
  // hood, without adding a visible background (scene.background stays
  // null so the camera passthrough still shows through).
  const pmremGenerator = new THREE.PMREMGenerator(rendererInstance);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  // Kept as a gentle fill/key light on top of the environment map — mostly
  // helps the reticle and adds a bit of directionality, but the environment
  // map above is now doing the heavy lifting for the model itself.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 2, 1);
  scene.add(dirLight);

  // Enhanced reticle with better visibility and baseplate
  const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
  const reticleMat = new THREE.MeshBasicMaterial({ 
    color: 0xe3a63d,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide
  });
  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.visible = false;
  scene.add(reticle);

  // Baseplate: visual grounding disc that appears when model is placed
  // Provides clear reference for drag interaction and helps user understand
  // where the model sits relative to the surface
  const baseplateGeo = new THREE.CircleGeometry(BASEPLATE_RADIUS, 32).rotateX(-Math.PI / 2);
  const baseplateMat = new THREE.MeshBasicMaterial({
    color: BASEPLATE_COLOR,
    transparent: true,
    opacity: BASEPLATE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending
  });
  baseplate = new THREE.Mesh(baseplateGeo, baseplateMat);
  baseplate.visible = false;
  scene.add(baseplate);
}

function loadModel(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      // Extract and store animations if present
      if (gltf.animations && gltf.animations.length > 0) {
        model.userData.animations = gltf.animations;
      }
      resolve(model);
    }, undefined, reject);
  });
}

async function placeModel() {
  if (!loadedGltfTemplate || !reticle.visible || placedModel) return;

  // Build the pivot hierarchy: anchorGroup follows the tracked anchor pose
  // every frame (or just stays put if anchors aren't supported), and
  // placedModel's position/rotation are always LOCAL to it — so user
  // gestures and anchor corrections never fight each other.
  anchorGroup = new THREE.Group();
  anchorGroup.position.copy(reticleSmoothed.position);
  anchorGroup.quaternion.copy(reticleSmoothed.quaternion);
  scene.add(anchorGroup);

  placedModel = loadedGltfTemplate.clone(true);
  placedModel.scale.setScalar(BASE_SCALE);
  anchorGroup.add(placedModel);

  // Setup animation mixer if model has animations
  // Note: clone() doesn't copy userData.animations, so we check the original template
  if (loadedGltfTemplate.userData.animations && loadedGltfTemplate.userData.animations.length > 0) {
    mixer = new THREE.AnimationMixer(placedModel);
    const action = mixer.clipAction(loadedGltfTemplate.userData.animations[0]);
    action.play();
  }

  // Position baseplate under the model for visual grounding
  baseplate.position.copy(reticleSmoothed.position);
  baseplate.position.y -= 0.01; // Slightly below the model's feet
  baseplate.quaternion.copy(reticleSmoothed.quaternion);
  baseplate.visible = true;
  anchorGroup.add(baseplate);

  reticle.visible = false;
  hintEl.textContent = 'Drag up/down to move · drag left/right to rotate · pinch to resize';
  cartBtn.hidden = false;

  // Reset plane detection state after successful placement
  consecutiveHits = 0;
  lastHitPosition = null;

  // Try to anchor to this physical point so the object stays visually
  // locked as you walk around it, rather than just sitting at a fixed
  // coordinate that can drift as tracking refines itself. Not all
  // devices/browsers support this yet, so failure here is expected on some
  // hardware — we just fall back to the static (unanchored) placement above.
  if (lastHitTestResult && typeof lastHitTestResult.createAnchor === 'function') {
    try {
      anchor = await lastHitTestResult.createAnchor();
      console.log('[AR] anchor created — model is now world-locked with drift correction');
    } catch (err) {
      console.warn('[AR] anchors not supported on this device, using static placement:', err.message);
      anchor = null;
    }
  } else {
    console.warn('[AR] anchors API unavailable, using static placement');
  }
}

function onTouchStart(e) {
  if (!placedModel) return;
  
  // Clear any existing timers
  if (touch.longPressTimer) {
    clearTimeout(touch.longPressTimer);
    touch.longPressTimer = null;
  }
  touch.isLongPress = false;
  
  if (e.touches.length === 1) {
    touch.mode = 'drag';
    touch.lastX = e.touches[0].clientX;
    touch.lastY = e.touches[0].clientY;
    touch.startX = touch.lastX;
    touch.startY = touch.lastY;
    touch.startTime = Date.now();
    
    // Reset velocities for clean start
    dragVelocity.set(0, 0, 0);
    rotationVelocity = 0;
    
    // Set up long-press timer for alternate action (future: could reset position)
    touch.longPressTimer = setTimeout(() => {
      touch.isLongPress = true;
    }, 500);
  } else if (e.touches.length === 2) {
    const [a, b] = e.touches;
    touch.lastDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    touch.lastX = (a.clientX + b.clientX) / 2;
    touch.lastY = (a.clientY + b.clientY) / 2;
    touch.mode = 'pinchpan';
    
    // Cancel long press on two-finger gesture
    if (touch.longPressTimer) {
      clearTimeout(touch.longPressTimer);
      touch.longPressTimer = null;
    }
  }
}

function onTouchMove(e) {
  if (!placedModel || !touch.mode) return;
  e.preventDefault();

  // Single finger drag: vertical drags move the model, horizontal drags rotate in place
  if (touch.mode === 'drag' && e.touches.length === 1) {
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const deltaX = x - touch.lastX;
    const deltaY = y - touch.lastY;
    
    // Calculate velocity for inertia
    const currentTime = Date.now();
    const deltaTime = Math.max(currentTime - touch.startTime, 1);
    dragVelocity.x = deltaX / deltaTime * 16; // Normalize to ~60fps
    dragVelocity.y = deltaY / deltaTime * 16;
    
    // Determine gesture intent: mostly horizontal = rotate, mostly vertical = pan
    const isHorizontalDrag = Math.abs(deltaX) > Math.abs(deltaY) * 1.5;
    
    if (isHorizontalDrag) {
      // Horizontal drag: rotate in place (no position change)
      if (Math.abs(deltaX) > 2) {
        rotationVelocity = deltaX * 0.008;
        placedModel.rotation.y += rotationVelocity;
      }
      // Reset drag velocity so inertia doesn't cause unwanted panning after rotation
      dragVelocity.set(0, 0, 0);
    } else {
      // Vertical drag: pan/move the model on the horizontal plane
      // Get camera direction for proper world-space movement
      const forward = new THREE.Vector3();
      controller.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      
      // Convert screen delta to world movement (flattened to floor plane)
      // Vertical drag moves forward/back, horizontal drag moves left/right
      const panX = deltaX * 0.004;
      const panY = deltaY * 0.004;
      
      const worldOffset = new THREE.Vector3()
        .addScaledVector(right, panX)
        .addScaledVector(forward, -panY);
      
      // Apply offset in anchorGroup's local space
      if (anchorGroup) {
        const invQuat = anchorGroup.getWorldQuaternion(new THREE.Quaternion()).invert();
        worldOffset.applyQuaternion(invQuat);
      }
      placedModel.position.add(worldOffset);
      // Reset rotation velocity so inertia doesn't cause unwanted spinning after panning
      rotationVelocity = 0;
    }
    
    touch.lastX = x;
    touch.lastY = y;
    touch.startTime = currentTime;
    return;
  }

  // Two-finger pinch to scale and pan
  if (touch.mode === 'pinchpan' && e.touches.length === 2) {
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const scaleDelta = dist / touch.lastDist;
    
    // Smooth scaling with limits
    const newScale = THREE.MathUtils.clamp(
      placedModel.scale.x * scaleDelta,
      MIN_SCALE,
      MAX_SCALE
    );
    placedModel.scale.setScalar(newScale);
    touch.lastDist = dist;

    // Two-finger pan (center point movement)
    const midX = (a.clientX + b.clientX) / 2;
    const midY = (a.clientY + b.clientY) / 2;
    const panX = (midX - touch.lastX) * 0.003;
    const panY = (midY - touch.lastY) * 0.003;

    // Move relative to where the phone is facing, flattened to the floor plane
    const forward = new THREE.Vector3();
    controller.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const worldOffset = new THREE.Vector3()
      .addScaledVector(right, panX)
      .addScaledVector(forward, -panY);

    // placedModel's position is local to anchorGroup, not world space, so
    // the pan delta needs to be rotated into anchorGroup's local frame
    // before being applied — otherwise panning drifts sideways whenever
    // the anchor's tracked orientation isn't perfectly level.
    if (anchorGroup) {
      const invQuat = anchorGroup.getWorldQuaternion(new THREE.Quaternion()).invert();
      worldOffset.applyQuaternion(invQuat);
    }
    placedModel.position.add(worldOffset);

    touch.lastX = midX;
    touch.lastY = midY;
  }
}

function onTouchEnd(e) {
  // Apply inertia when finger lifts off during drag
  if (touch.mode === 'drag' && placedModel) {
    // Inertia is applied in the render loop, just flag that we're in inertia phase
    // The render loop will gradually apply the stored dragVelocity and rotationVelocity
  }
  
  if (e.touches.length === 0) {
    touch.mode = null;
    if (touch.longPressTimer) {
      clearTimeout(touch.longPressTimer);
      touch.longPressTimer = null;
    }
  }
}

function cleanupListeners() {
  // Listeners live on overlayEl, not canvas — see start() for why.
  if (!overlayEl) return;
  overlayEl.removeEventListener('touchstart', onTouchStart);
  overlayEl.removeEventListener('touchmove', onTouchMove);
  overlayEl.removeEventListener('touchend', onTouchEnd);
}

function onSessionEnd() {
  if (cleanupComplete) return;
  cleanupComplete = true;
  startupInProgress = false;
  hitTestSourceRequested = false;
  hitTestSource = null;
  placedModel = null;
  loadedGltfTemplate = null;
  anchor = null;
  anchorGroup = null;
  lastHitTestResult = null;
  reticleSmoothed.initialized = false;
  reticleSmoothed.velocity.set(0, 0, 0);
  baseplate = null;
  dragVelocity.set(0, 0, 0);
  rotationVelocity = 0;
  framesSinceReady = 0;
  framesWithHit = 0;
  consecutiveHits = 0;
  lastHitPosition = null;
  mixer = null;
  clock = new THREE.Clock();
  overlayEl.hidden = true;
  cartBtn.hidden = true;
  cleanupListeners();
  if (exitBtn) exitBtn.onclick = null;
  if (cartBtn) cartBtn.onclick = null;
  if (renderer) {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer = null;
  }
  session = null;
  const onExit = onExitCallback;
  onExitCallback = null;
  onErrorCallback = null;
  if (typeof onExit === 'function') onExit();
}

function render(timestamp, frame) {
  try {
    if (!frame) return;
    const referenceSpace = renderer.xr.getReferenceSpace();
    const xrSession = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true; // set immediately so we never re-enter this branch
      xrSession
        .requestReferenceSpace('viewer')
        .then((viewerSpace) => xrSession.requestHitTestSource({ space: viewerSpace }))
        .then((source) => {
          hitTestSource = source;
          console.log('[AR] hit-test source ready');
        })
        .catch((err) => {
          // Previously this rejection was unhandled, so a failure here left
          // hitTestSource permanently null with no visible error — the
          // reticle would simply never appear and the hint text would stay
          // stuck on "find a surface" forever, looking identical to a
          // real-world tracking issue.
          console.error('[AR] failed to set up hit-test source:', err);
          if (hintEl) hintEl.textContent = 'Hit-test setup failed: ' + err.message;
        });
    }

    if (hitTestSource && !placedModel) {
      const results = frame.getHitTestResults(hitTestSource);
      framesSinceReady++;
      if (results.length > 0) {
        framesWithHit++;
        lastHitTestResult = results[0];
        const pose = results[0].getPose(referenceSpace);
        const rawPosition = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(pose.transform.matrix));
        const rawQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(pose.transform.matrix));

        // Improved plane detection: require consecutive stable hits before showing reticle
        // This prevents false positives from transient detections and ensures we have a real plane
        let positionStable = true;
        if (lastHitPosition) {
          const distFromLast = lastHitPosition.distanceTo(rawPosition);
          // Position should not jump too much between consecutive frames for a stable plane
          positionStable = distFromLast < 0.02; // 2cm threshold for stability
        }
        
        if (positionStable) {
          consecutiveHits = MIN_CONSECUTIVE_HITS; // Immediately ready on first stable hit
        } else {
          // Reset counter if position jumps too much (unstable detection)
          consecutiveHits = 0; // Must get a new stable hit
        }
        lastHitPosition = rawPosition.clone();

        // Only show reticle and allow placement after we have confirmed stable plane detection
        if (consecutiveHits >= MIN_CONSECUTIVE_HITS) {
          // Enhanced stabilization with adaptive smoothing and outlier rejection
          if (!reticleSmoothed.initialized) {
            reticleSmoothed.position.copy(rawPosition);
            reticleSmoothed.quaternion.copy(rawQuaternion);
            reticleSmoothed.velocity.set(0, 0, 0);
            reticleSmoothed.initialized = true;
          } else {
            // Calculate distance from last known position to detect outliers
            const dist = reticleSmoothed.position.distanceTo(rawPosition);
            
            // Reject sudden jumps (outliers) that are likely tracking errors
            if (dist < OUTLIER_REJECTION_DIST) {
              // Adaptive smoothing: use less smoothing when moving fast, more when stable
              const speed = dist * 60; // Approximate frames per second
              const adaptiveSmoothing = THREE.MathUtils.clamp(
                RETICLE_SMOOTHING_BASE + speed * 0.5,
                RETICLE_SMOOTHING_BASE,
                RETICLE_SMOOTHING_MAX
              );
              
              // Only update if movement is above threshold (ignore micro-jitter)
              if (dist > POSITION_THRESHOLD) {
                reticleSmoothed.position.lerp(rawPosition, 1 - adaptiveSmoothing);
                reticleSmoothed.quaternion.slerp(rawQuaternion, 1 - adaptiveSmoothing);
              }
            }
            // If dist >= OUTLIER_REJECTION_DIST, skip this frame's data as unreliable
          }

          reticle.visible = true;
          reticle.position.copy(reticleSmoothed.position);
          reticle.quaternion.copy(reticleSmoothed.quaternion);
        } else {
          // Still scanning - don't show reticle yet, keep user informed
          reticle.visible = false;
        }
      } else {
        // No hits this frame - keep counter as-is (don't reset on brief dropouts)
        lastHitTestResult = null;
        reticle.visible = false;
      }
      // Lightweight on-screen diagnostics: updates roughly once a second so
      // you can see live hit-test activity without a devtools connection.
      if (framesSinceReady % 60 === 0 && hintEl) {
        if (consecutiveHits >= MIN_CONSECUTIVE_HITS) {
          hintEl.textContent = 'Surface found — tap to place';
        } else if (results.length > 0) {
          hintEl.textContent = `Detecting surface... (${consecutiveHits}/${MIN_CONSECUTIVE_HITS})`;
        } else {
          hintEl.textContent = `Scanning for a surface… (${framesWithHit}/${framesSinceReady} frames hit)`;
        }
      }
    }

    // Apply inertia after finger lift-off during drag
    if (placedModel && touch.mode === null && (dragVelocity.lengthSq() > 0.0001 || Math.abs(rotationVelocity) > 0.001)) {
      // Get camera direction for proper world-space movement
      const forward = new THREE.Vector3();
      controller.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      
      // Apply velocity with decay
      const worldOffset = new THREE.Vector3()
        .addScaledVector(right, dragVelocity.x * 0.004)
        .addScaledVector(forward, -dragVelocity.y * 0.004);
      
      if (anchorGroup) {
        const invQuat = anchorGroup.getWorldQuaternion(new THREE.Quaternion()).invert();
        worldOffset.applyQuaternion(invQuat);
      }
      placedModel.position.add(worldOffset);
      placedModel.rotation.y += rotationVelocity;
      
      // Decay velocities (inertia fade-out)
      dragVelocity.multiplyScalar(DRAG_INERTIA);
      rotationVelocity *= ROTATION_INERTIA;
      
      // Stop when negligible
      if (dragVelocity.lengthSq() < 0.0001) dragVelocity.set(0, 0, 0);
      if (Math.abs(rotationVelocity) < 0.001) rotationVelocity = 0;
    }

    // Keep the placed model visually locked to its physical anchor point.
    // Without this, the model just sits at whatever fixed coordinate it was
    // given at placement time, and can appear to drift or swim relative to
    // the real surface as the device's tracking refines itself while you
    // walk around it. anchorGroup carries the corrected pose; placedModel's
    // own position/rotation stay local to it, so gestures aren't affected.
    if (placedModel && anchor && anchorGroup) {
      const anchorPose = frame.getPose(anchor.anchorSpace, referenceSpace);
      if (anchorPose) {
        anchorGroup.position.setFromMatrixPosition(new THREE.Matrix4().fromArray(anchorPose.transform.matrix));
        anchorGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().fromArray(anchorPose.transform.matrix));
        
        // Update baseplate position to follow anchor corrections
        if (baseplate && baseplate.parent === anchorGroup) {
          baseplate.position.copy(placedModel.position);
          baseplate.position.y = -0.01; // Maintain offset from model
        }
      }
    }

    // Update animation mixer if animations are present
    if (mixer && placedModel) {
      const delta = clock.getDelta();
      mixer.update(delta);
    }

    renderer.render(scene, camera);
  } catch (err) {
    console.error('Advanced AR render error:', err);
    if (hintEl) hintEl.textContent = 'AR error: ' + err.message;
    if (session) session.end();
  }
}

async function start({ onExit, onAddToCart, onError, modelUrl }) {
  if (startupInProgress || session) return;
  startupInProgress = true;
  cleanupComplete = false;
  onExitCallback = onExit;
  onErrorCallback = onError;

  // Use provided model URL or default to Astronaut
  currentModelUrl = modelUrl || MODEL_URL;
  canvas = document.getElementById('xr-canvas');
  overlayEl = document.getElementById('arOverlay');
  hintEl = document.getElementById('arHint');
  exitBtn = document.getElementById('arExitBtn');
  cartBtn = document.getElementById('arAddToCartBtn');

  overlayEl.hidden = false;
  hintEl.textContent = 'Starting AR...';
  cartBtn.hidden = true;

  let sessionRequest;
  try {
    if (!navigator.xr) throw new Error('WebXR is unavailable in this browser.');

    // requestSession must be invoked from the tap handler, before any awaited work.
    sessionRequest = navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'light-estimation'],
      domOverlay: { root: overlayEl },
    });

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.xr.enabled = true;
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    try {
      if ('requestLightEstimation' in THREE.WebXRManager.prototype) {
        renderer.xr.setRequestLightEstimation(true);
        lightEstimationEnabled = true;
      }
    } catch (err) {
      console.log('[AR] Light estimation unavailable; using default lighting.');
    }

    setupScene(renderer);
    camera = new THREE.PerspectiveCamera();
    renderer.xr.setReferenceSpaceType('local');

    controller = renderer.xr.getController(0);
    controller.addEventListener('select', placeModel);
    scene.add(controller);

    overlayEl.addEventListener('touchstart', onTouchStart, { passive: true });
    overlayEl.addEventListener('touchmove', onTouchMove, { passive: false });
    overlayEl.addEventListener('touchend', onTouchEnd, { passive: true });

    exitBtn.onclick = () => {
      if (session) session.end();
    };

    cartBtn.onclick = () => {
      if (typeof onAddToCart === 'function') onAddToCart();
      cartBtn.textContent = 'Added';
      setTimeout(() => {
        if (cartBtn) cartBtn.textContent = 'Add to cart';
      }, 1400);
    };

    session = await sessionRequest;
    session.addEventListener('end', onSessionEnd, { once: true });
    await renderer.xr.setSession(session);
    renderer.setAnimationLoop(render);

    hintEl.textContent = 'Loading 3D model...';
    loadedGltfTemplate = await loadModel(currentModelUrl);
    if (!session) return;
    hintEl.textContent = 'Move your phone slowly to find a surface, then tap to place.';
  } catch (err) {
    console.error('Failed to start Advanced AR:', err);
    hintEl.textContent = 'AR could not start: ' + err.message;
    const reportError = onErrorCallback;
    if (session) {
      try {
        await session.end();
      } catch (endError) {
        console.warn('Failed to end the AR session cleanly:', endError);
      }
    } else if (sessionRequest) {
      try {
        const pendingSession = await sessionRequest;
        await pendingSession.end();
      } catch (sessionError) {
        // The session request itself may have been rejected.
      }
    }
    onSessionEnd();
    if (typeof reportError === 'function') reportError(err);
  }
}

window.AdvancedAR = { isSupported, start };
