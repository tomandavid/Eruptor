import * as THREE from 'three';
import { LavaSystem, SceneElements, AppConfig, Marker } from '../types';
import { DEFAULT_VALUES, SQRT2_INV } from '../constants';
import { clamp01, latLonToUV, uvToLatLon } from '../utils';
import { RealisticLavaSimulator } from './RealisticLavaSystem';
import { createRealisticLavaShader, createTerrainShader } from '../shaders/RealisticLavaShader';

export function setupLavaSystem(
  sceneElements: SceneElements,
  size: number,
  heightData: Float32Array,
  config: AppConfig,
  log: (message: string, type?: 'ok' | 'fail' | '') => void
): LavaSystem {
  // Clean up existing lava system
  const existingLava = sceneElements.root.children.find(child => 
    child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial
  );
  if (existingLava) {
    sceneElements.root.remove(existingLava);
    (existingLava as THREE.Mesh).geometry.dispose();
    ((existingLava as THREE.Mesh).material as THREE.Material).dispose();
  }

  const flowN = DEFAULT_VALUES.LAVA_FLOW_N;
  
  // Create simple lava data and texture for immediate visibility
  const lava = new Uint8Array(flowN * flowN);
  const lavaF = new Float32Array(flowN * flowN);
  const ground = new Float32Array(flowN * flowN);
  
  const lavaTex = new THREE.DataTexture(lava, flowN, flowN, THREE.RedFormat, THREE.UnsignedByteType);
  lavaTex.needsUpdate = true;
  lavaTex.wrapS = lavaTex.wrapT = THREE.ClampToEdgeWrapping;
  lavaTex.minFilter = THREE.LinearFilter;
  lavaTex.magFilter = THREE.LinearFilter;
  
  // Create realistic lava simulator (for future enhancement)
  const realisticSim = new RealisticLavaSimulator(sceneElements, size, heightData, config, flowN);

  // Create simple, working lava shader
  const timeUniform = new THREE.Uniform(0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
    uniforms: {
      lavaTex: { value: lavaTex },
      time: timeUniform,
      lift: { value: 5.0 },
      glow: { value: 2.6 },
      alphaScale: { value: 1.1 }
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float lift;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += lift;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D lavaTex;
      uniform float alphaScale;
      uniform float glow;
      uniform float time;
      
      void main() {
        // Apply coordinate transformation to match original system
        vec2 transformedUV = vec2(vUv.x, 1.0 - vUv.y);
        float t = texture2D(lavaTex, transformedUV).r;
        if (t <= 0.003) discard;
        
        // Simple hot lava colors
        vec3 cold = vec3(0.45, 0.10, 0.04);
        vec3 hot = vec3(1.0, 0.55, 0.12);
        float heat = smoothstep(0.0, 0.8, t);
        vec3 col = mix(cold, hot, heat) * glow;
        
        // Add some animation
        float pulse = 1.0 + sin(time * 3.0) * 0.2;
        col *= pulse;
        
        float a = clamp(t * alphaScale, 0.10, 0.98);
        gl_FragColor = vec4(col, a);
      }
    `
  });

  // Create lava mesh using terrain geometry
  const lavaMesh = new THREE.Mesh(sceneElements.terrainMesh!.geometry, mat);
  lavaMesh.renderOrder = 2;
  sceneElements.root.add(lavaMesh);

  const lavaSystem: LavaSystem = {
    size,
    flowN,
    lava,
    lavaF,
    lavaTex,
    mat,
    mesh: lavaMesh,
    ground,
    paused: false,
    holding: false,
    lastUV: [0, 0],
    continuousPoint: null,
    persistentVentsEnabled: true,
    persistentVents: [],
    // Add realistic simulator reference
    realisticSim: realisticSim,
    timeUniform: timeUniform
  };

  // Compute ground heights from heightData
  recomputeGroundFromHeightData(lavaSystem, heightData, config.exaggeration);

  // Attach click handlers
  attachClickSpawner(sceneElements, lavaSystem, log);

  log('Lava system ready (slope‑capacity). Click to inject.', 'ok');
  return lavaSystem;
}

export function recomputeGroundFromHeightData(
  lavaSystem: LavaSystem,
  heightData: Float32Array | null,
  exaggeration: number
) {
  if (!heightData) return;
  
  const { flowN, ground } = lavaSystem;
  const resN = Math.sqrt(heightData.length) | 0;
  
  for (let j = 0; j < flowN; j++) {
    const v = j / (flowN - 1);
    for (let i = 0; i < flowN; i++) {
      const u = i / (flowN - 1);
      ground[j * flowN + i] = sampleHeightBilinear(heightData, u, v, resN) * exaggeration;
    }
  }
}

function sampleHeightBilinear(
  heightData: Float32Array,
  u: number,
  v: number,
  resN: number
): number {
  const x = u * (resN - 1);
  const y = v * (resN - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, resN - 1);
  const y1 = Math.min(y0 + 1, resN - 1);
  const sx = x - x0;
  const sy = y - y0;
  
  const h00 = heightData[y0 * resN + x0];
  const h10 = heightData[y0 * resN + x1];
  const h01 = heightData[y1 * resN + x0];
  const h11 = heightData[y1 * resN + x1];
  
  const h0 = h00 * (1 - sx) + h10 * sx;
  const h1 = h01 * (1 - sx) + h11 * sx;
  
  return h0 * (1 - sy) + h1 * sy;
}

function attachClickSpawner(
  sceneElements: SceneElements,
  lavaSystem: LavaSystem,
  log: (message: string, type?: 'ok' | 'fail' | '') => void
) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  
  // Double tap detection for mobile
  let lastTapTime = 0;
  let tapTimeout: number | null = null;
  const DOUBLE_TAP_DELAY = 300; // milliseconds

  const createMarkerTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grd = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
    grd.addColorStop(0, 'rgba(255,200,80,1)');
    grd.addColorStop(0.4, 'rgba(255,90,0,0.9)');
    grd.addColorStop(1, 'rgba(255,90,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const markerTex = createMarkerTexture();

  // Store the spawnMarker function on the lavaSystem so it can be called from outside
  lavaSystem.spawnMarker = (worldPos: THREE.Vector3) => {
    const mat = new THREE.SpriteMaterial({ 
      map: markerTex, 
      transparent: true, 
      depthTest: false, 
      depthWrite: false 
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(worldPos);
    sprite.position.y += 6;
    sprite.scale.set(120, 120, 1);
    sprite.renderOrder = 3;
    sceneElements.root.add(sprite);
    
    // Return the marker object so it can be managed externally
    return { sprite, t: 0, life: 1.8 };
  };

  const spawnAt = (hit: THREE.Intersection) => {
    if (!hit.uv) return;
    
    const uv = hit.uv;
    lavaSystem.lastUV = [uv.x, uv.y];
    injectLavaUV(lavaSystem, uv.x, uv.y);
    
    // Use the external marker system
    if (lavaSystem.spawnMarker) {
      lavaSystem.spawnMarker(hit.point!.clone());
    }
    
    // Debug: show what lat/lon this UV corresponds to
    const coords = uvToLatLon(uv.x, uv.y);
    log(`Click at UV(${uv.x.toFixed(3)}, ${uv.y.toFixed(3)}) = Lat/Lon(${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)})`, 'ok');
  };

  const placeVent = (hit: THREE.Intersection, method: string = 'interaction') => {
    if (!hit.uv) return;
    
    const uv = hit.uv;
    lavaSystem.lastUV = [uv.x, uv.y];
    lavaSystem.persistentVents.push([uv.x, uv.y]);
    log(`Persistent vent #${lavaSystem.persistentVents.length} placed via ${method}.`, 'ok');
    
    // Use the external marker system
    if (lavaSystem.spawnMarker) {
      lavaSystem.spawnMarker(hit.point!.clone());
    }
  };

  const onDown = (e: PointerEvent) => {
    if (!lavaSystem || !sceneElements.terrainMesh) return;
    
    const rect = sceneElements.renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, sceneElements.camera);
    const hits = raycaster.intersectObject(sceneElements.terrainMesh, false);
    const hit = hits[0];
    
    if (hit && hit.uv) {
      // Check for double tap on touch devices (mobile)
      const currentTime = Date.now();
      const isTouchEvent = e.pointerType === 'touch';
      
      if (isTouchEvent && e.button === 0) {
        const timeDiff = currentTime - lastTapTime;
        
        if (timeDiff < DOUBLE_TAP_DELAY && timeDiff > 50) {
          // Double tap detected - place persistent vent
          e.preventDefault();
          placeVent(hit, 'double-tap');
          
          // Stop any ongoing lava flow from first tap
          lavaSystem.holding = false;
          lavaSystem.continuousPoint = null;
          
          // Clear any pending single tap timeout
          if (tapTimeout) {
            clearTimeout(tapTimeout);
            tapTimeout = null;
          }
          
          // Reset tap time to prevent triple tap issues
          lastTapTime = 0;
          return;
        } else {
          // Single tap - immediately start lava flow, but set up double tap detection
          lastTapTime = currentTime;
          
          // Immediately start lava flow for single tap
          lavaSystem.holding = true;
          lavaSystem.continuousPoint = hit;
          spawnAt(hit);
          
          return;
        }
      }
      
      // Non-touch events (mouse) - original behavior
      if (e.button === 2) { // Right click
        e.preventDefault();
        placeVent(hit, 'right-click');
      } else if (e.button === 0) { // Left click
        lavaSystem.holding = true;
        lavaSystem.continuousPoint = hit;
        spawnAt(hit);
      }
    }
  };

  const onMove = (e: PointerEvent) => {
    if (!lavaSystem || !lavaSystem.holding) return;
    
    const rect = sceneElements.renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, sceneElements.camera);
    const hits = raycaster.intersectObject(sceneElements.terrainMesh!, false);
    const hit = hits[0];
    
    if (hit && hit.uv) {
      lavaSystem.continuousPoint = hit;
    }
  };

  const onUp = () => {
    if (lavaSystem) {
      lavaSystem.holding = false;
      lavaSystem.continuousPoint = null;
    }
  };

  const onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  sceneElements.renderer.domElement.addEventListener('pointerdown', onDown);
  sceneElements.renderer.domElement.addEventListener('pointermove', onMove);
  sceneElements.renderer.domElement.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('pointerup', onUp);
}

export function injectLavaUV(
  lavaSystem: LavaSystem,
  u: number,
  v: number,
  injectionAmount: number = DEFAULT_VALUES.INJECTION_AMOUNT,
  injectionRadius: number = DEFAULT_VALUES.INJECTION_RADIUS
) {
  console.log('Injecting lava at UV:', u, v, 'amount:', injectionAmount);
  
  const { flowN, lava } = lavaSystem;
  
  // Apply same transformation as shader
  const transformedU = u;
  const transformedV = 1.0 - v;
  const rU = clamp01(transformedU);
  const rV = clamp01(transformedV);
  
  // Use proper injection radius based on preset
  const R = Math.max(2, Math.floor(flowN * injectionRadius));
  const cx = Math.floor(rU * (flowN - 1));
  const cy = Math.floor(rV * (flowN - 1));
  const add = Math.floor(injectionAmount);
  
  console.log('Injection details - R:', R, 'center:', cx, cy, 'add:', add);
  
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const ix = cx + x;
      const iy = cy + y;
      if (ix < 0 || iy < 0 || ix >= flowN || iy >= flowN) continue;
      
      const d = (x * x + y * y) / (R * R);
      if (d > 1) continue;
      
      const k = 1 - d;
      const idx = iy * flowN + ix;
      const oldValue = lava[idx];
      lava[idx] = Math.min(255, lava[idx] + Math.floor(add * k));
      
      // Log first few updates
      if (oldValue !== lava[idx] && idx < 10) {
        console.log('Updated lava at idx:', idx, 'from:', oldValue, 'to:', lava[idx]);
      }
    }
  }
  
  console.log('Updating texture...');
  lavaSystem.lavaTex.needsUpdate = true;
}

export function simulateLava(
  lavaSystem: LavaSystem,
  dt: number,
  flowRate: number = DEFAULT_VALUES.FLOW_RATE,
  cooling: number = DEFAULT_VALUES.COOLING,
  viscosity: number = DEFAULT_VALUES.VISCOSITY
) {
  if (lavaSystem.paused) return;
  
  // Update time uniform for shader animation
  if (lavaSystem.timeUniform) {
    lavaSystem.timeUniform.value += dt;
  }
  
  const N = lavaSystem.flowN;
  const lava = lavaSystem.lava;
  const temp = lavaSystem.lavaF;
  const ground = lavaSystem.ground;
  const step = Math.min(0.1, dt);

  // Early exit if no lava to simulate
  let hasActiveLava = false;
  for (let i = 0; i < lava.length; i++) {
    if (lava[i] > 0) {
      hasActiveLava = true;
      break;
    }
  }
  if (!hasActiveLava) return;

  // Convert to float for processing (optimized)
  const inv255 = 1.0 / 255.0;
  for (let i = 0; i < lava.length; i++) {
    temp[i] = lava[i] * inv255;
  }

  const out = new Float32Array(lava.length);
  const H = (i: number) => ground[i] + temp[i];
  const diagK = 1 / Math.SQRT2;

  // Slope-capacity flow simulation
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const hi = H(i);
      const nbrs: number[] = [];

      // Add neighbors with flow weights and height differences
      if (x > 0) {
        const j = i - 1;
        nbrs.push(j, 1.0, Math.max(0.0, hi - H(j)));
      }
      if (x < N - 1) {
        const j = i + 1;
        nbrs.push(j, 1.0, Math.max(0.0, hi - H(j)));
      }
      if (y > 0) {
        const j = i - N;
        nbrs.push(j, 1.0, Math.max(0.0, hi - H(j)));
      }
      if (y < N - 1) {
        const j = i + N;
        nbrs.push(j, 1.0, Math.max(0.0, hi - H(j)));
      }

      // Diagonal neighbors (for more realistic flow)
      if (x > 0 && y > 0) {
        const j = i - N - 1;
        nbrs.push(j, diagK, Math.max(0.0, (hi - H(j)) * diagK));
      }
      if (x < N - 1 && y > 0) {
        const j = i - N + 1;
        nbrs.push(j, diagK, Math.max(0.0, (hi - H(j)) * diagK));
      }
      if (x > 0 && y < N - 1) {
        const j = i + N - 1;
        nbrs.push(j, diagK, Math.max(0.0, (hi - H(j)) * diagK));
      }
      if (x < N - 1 && y < N - 1) {
        const j = i + N + 1;
        nbrs.push(j, diagK, Math.max(0.0, (hi - H(j)) * diagK));
      }

      // Calculate total downhill slope
      let slopeSum = 0.0;
      for (let k = 0; k < nbrs.length; k += 3) {
        slopeSum += nbrs[k + 2];
      }

      const avail = temp[i];
      if (slopeSum > 1e-6 && avail > 0.0) {
        // Flow capacity based on slope and mobility
        const capacity = flowRate * step * slopeSum;
        const moved = Math.min(avail, capacity);
        const stay = avail - moved;
        out[i] += stay;

        // Distribute moved lava to downhill neighbors
        const inv = moved / slopeSum;
        for (let k = 0; k < nbrs.length; k += 3) {
          const j = nbrs[k];
          const w = nbrs[k + 2];
          if (w > 0.0) out[j] += inv * w;
        }
      } else {
        out[i] += avail;
      }
    }
  }

  // Apply viscosity (diffusion) for spreading
  if (viscosity > 1e-6) {
    const diff = new Float32Array(out.length);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        let s = out[i] * -4.0;
        if (x > 0) s += out[i - 1];
        if (x < N - 1) s += out[i + 1];
        if (y > 0) s += out[i - N];
        if (y < N - 1) s += out[i + N];
        diff[i] = s;
      }
    }
    for (let i = 0; i < out.length; i++) {
      out[i] += viscosity * step * diff[i];
    }
  }

  // Apply cooling and convert back to uint8
  for (let i = 0; i < lava.length; i++) {
    let v = Math.max(0, out[i] - cooling * step);
    lava[i] = Math.max(0, Math.min(255, Math.floor(v * 255)));
  }

  lavaSystem.lavaTex.needsUpdate = true;
}
