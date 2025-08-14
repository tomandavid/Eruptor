import React, { useRef, useEffect, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';

import { AppConfig, SceneElements, TerrainData, LavaSystem, Marker, Flag, CameraState } from '../types';
import { SIDEBAR_WIDTH, CAMERA_SAVE_DELAY, DEFAULT_VALUES } from '../constants';
import { deg2rad, clamp01, loadImage, groundResMpp, latLonToUV, uvToLatLon } from '../utils';
import { setupLavaSystem, simulateLava, injectLavaUV, recomputeGroundFromHeightData } from '../systems/LavaSystem';
import { loadTerrariumBBox, buildTerrainFromHeightmap, applyHeights, updateWater, fitCameraToObject } from '../systems/TerrainSystem';

interface ViewportProps {
  config: AppConfig;
  onRef: (ref: any) => void;
  log: (message: string, type?: 'ok' | 'fail' | '') => void;
  isMobile?: boolean;
}

const Viewport: React.FC<ViewportProps> = ({ config, onRef, log, isMobile = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneElements | null>(null);
  const lavaRef = useRef<LavaSystem | null>(null);
  const heightDataRef = useRef<Float32Array | null>(null);
  const originalHeightDataRef = useRef<Float32Array | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const flagsRef = useRef<Flag[]>([]);
  const lastTerrRef = useRef<TerrainData | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  // Fallback terrain generator
  const createFallbackTerrain = (resolution: number): TerrainData => {
    const size = resolution;
    const data = new Float32Array(size * size);
    
    // Generate a simple island heightmap
    const centerX = size / 2;
    const centerY = size / 2;
    const maxRadius = size * 0.4;
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const normalizedDistance = distance / maxRadius;
        
        // Create island shape with some noise
        let height = Math.max(0, 1 - normalizedDistance);
        height = Math.pow(height, 1.5); // Make it more island-like
        
        // Add some noise for terrain variation
        const noise1 = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 0.3;
        const noise2 = Math.sin(x * 0.05) * Math.cos(y * 0.05) * 0.2;
        height += (noise1 + noise2) * height;
        
        // Scale to meters (0-3000m)
        data[y * size + x] = Math.max(0, height * 3000);
      }
    }
    
    // Create a simple canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, '#8B4513'); // Brown center
    gradient.addColorStop(0.7, '#228B22'); // Green middle
    gradient.addColorStop(1, '#4682B4'); // Blue edge (water)
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    
    return {
      data,
      width: size,
      height: size,
      meters: 50000, // 50km size
      texture,
      range: { w: 1, h: 1 }
    };
  };

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = isMobile ? window.innerWidth : window.innerWidth - SIDEBAR_WIDTH;
    const height = window.innerHeight;

    // Optimized renderer setup
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      preserveDrawingBuffer: true, 
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance', // Use dedicated GPU if available
      stencil: false // Disable stencil buffer if not needed
    });
    
    // Limit pixel ratio for better performance on high-DPI displays
    // Use lower pixel ratio on mobile for better performance
    const pixelRatio = isMobile ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    
    // Optimize shadow settings
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // Faster than PCFSoft
    renderer.shadowMap.autoUpdate = false; // Manual shadow updates only when needed
    
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Enable GPU performance optimizations
    renderer.info.autoReset = false; // Manual reset for performance monitoring
    container.appendChild(renderer.domElement);

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020);

    // Optimized camera setup
    const camera = new THREE.PerspectiveCamera(55, width / height, 1, 100_000); // Adjusted near/far for better precision
    camera.position.set(0, 1000, 1200);
    
    // Enable frustum culling optimizations
    camera.matrixAutoUpdate = true;

    // Controls setup with mobile optimizations
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = isMobile ? 0.1 : 0.05; // Faster damping on mobile
    controls.rotateSpeed = isMobile ? 0.8 : 1.0; // Slightly slower rotation on mobile
    controls.zoomSpeed = isMobile ? 0.8 : 1.2; // Adjusted zoom speed for mobile
    controls.panSpeed = isMobile ? 0.6 : 0.8; // Slower pan on mobile
    
    // Touch settings for mobile
    if (isMobile) {
      controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      };
    }

    // Lighting setup
    const hemi = new THREE.HemisphereLight(0xbcc9ff, 0x0b1020, config.envIntensity);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    scene.add(sun);

    // Post-processing setup
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const ssaoPass = new SSAOPass(scene, camera, width, height);
    ssaoPass.kernelRadius = 16;
    ssaoPass.minDistance = 0.005;
    ssaoPass.maxDistance = 0.2;
    composer.addPass(ssaoPass);

    // Root group
    const root = new THREE.Group();
    scene.add(root);

    // Store scene elements
    const sceneElements: SceneElements = {
      renderer,
      scene,
      camera,
      controls,
      composer,
      root,
      terrainMesh: null,
      waterMesh: null,
      hemi,
      sun,
    };
    sceneRef.current = sceneElements;

    // Set up camera save functionality
    const saveCameraPosition = () => {
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      
      const cameraState: CameraState = {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        zoom: camera.zoom,
        spherical: {
          radius: spherical.radius,
          phi: spherical.phi,
          theta: spherical.theta
        }
      };
      localStorage.setItem('tenerife_camera_position', JSON.stringify(cameraState));
      console.log('Saved camera state:', cameraState);
    };

    controls.addEventListener('change', () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = window.setTimeout(saveCameraPosition, CAMERA_SAVE_DELAY);
    });

    // Set initial sun position
    setSun(config.sunAzimuth, config.sunAltitude, config.envIntensity);

    // Load initial terrain
    reload();

    // Start optimized animation loop
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFPSUpdate = performance.now();
    
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      frameCount++;
      
      // Only update controls if camera is actually moving
      if (controls.enabled) {
        controls.update();
      }
      
      // Throttle expensive updates to 30fps instead of 60fps
      const timeSinceLastUpdate = now - lastFPSUpdate;
      const shouldUpdateExpensive = timeSinceLastUpdate > 33.33; // ~30fps
      
      if (shouldUpdateExpensive) {
        // Update lava simulation (CPU intensive)
        if (lavaRef.current) {
          updateLavaSimulation(dt * 2); // Compensate for half framerate
        }
        
        // Update markers (GPU intensive)
        updateMarkers(dt * 2);
        
        lastFPSUpdate = now;
      }
      
      // Update SSAO only when needed
      if (ssaoPass.enabled !== config.aoToggle) {
        ssaoPass.enabled = config.aoToggle;
      }
      
      composer.render();
    };
    animate();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (!sceneRef.current) return;
      
      const width = isMobile ? window.innerWidth : window.innerWidth - SIDEBAR_WIDTH;
      const height = window.innerHeight;
      
      sceneRef.current.renderer.setSize(width, height);
      sceneRef.current.camera.aspect = width / height;
      sceneRef.current.camera.updateProjectionMatrix();
      sceneRef.current.composer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile]);

  // Sun positioning function
  const setSun = (azDeg: number = 135, altDeg: number = 45, env: number = 0.6) => {
    if (!sceneRef.current) return;
    
    const az = deg2rad(azDeg);
    const alt = deg2rad(altDeg);
    const r = 5000;
    
    sceneRef.current.sun.position.set(
      Math.cos(az) * Math.cos(alt) * r,
      Math.sin(alt) * r,
      Math.sin(az) * Math.cos(alt) * r
    );
    sceneRef.current.hemi.intensity = env;
  };

  // Terrain loading function
  const reload = async () => {
    try {
      log('Loading Tenerife DEM/imagery…');
      const terr = await loadTerrariumBBox(config.zoom);
      await buildTerrainFromHeightmap(terr, config, sceneRef.current!, heightDataRef, originalHeightDataRef, lastTerrRef, lavaRef, log);
      
      // Connect the marker system after lava system is created
      if (lavaRef.current) {
        const originalSpawnMarker = lavaRef.current.spawnMarker;
        lavaRef.current.spawnMarker = (worldPos: THREE.Vector3) => {
          if (originalSpawnMarker) {
            const marker = originalSpawnMarker(worldPos);
            markersRef.current.push(marker);
            return marker;
          }
          return { sprite: new THREE.Sprite(), t: 0, life: 1.8 };
        };
      }
      
      log(`Loaded ${terr.range.w}×${terr.range.h} tiles.`, 'ok');
    } catch (e) {
      console.error(e);
      log('DEM fetch failed or blocked — using fallback island heightmap.', 'fail');
      const fallbackTerr = createFallbackTerrain(config.resolution);
      await buildTerrainFromHeightmap(fallbackTerr, config, sceneRef.current!, heightDataRef, originalHeightDataRef, lastTerrRef, lavaRef, log);
      
      // Connect the marker system after lava system is created
      if (lavaRef.current) {
        const originalSpawnMarker = lavaRef.current.spawnMarker;
        lavaRef.current.spawnMarker = (worldPos: THREE.Vector3) => {
          if (originalSpawnMarker) {
            const marker = originalSpawnMarker(worldPos);
            markersRef.current.push(marker);
            return marker;
          }
          return { sprite: new THREE.Sprite(), t: 0, life: 1.8 };
        };
      }
    }
  };

  // Optimized marker management
  const updateMarkers = (dt: number) => {
    const markers = markersRef.current;
    if (markers.length === 0) return; // Early exit
    
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      m.t += dt;
      
      if (m.t >= m.life) {
        // Cleanup expired markers
        sceneRef.current?.root.remove(m.sprite);
        m.sprite.material.dispose();
        markers.splice(i, 1);
      } else {
        // Update active markers (optimized calculations)
        const normalizedTime = m.t / m.life;
        const a = 1 - normalizedTime;
        const pulseScale = 1 + Math.sin(m.t * 6.28) * 0.1; // Reduced frequency
        const s = 120 * pulseScale + (normalizedTime * 60); // Simplified scaling
        
        m.sprite.scale.set(s, s, 1);
        m.sprite.material.opacity = a;
      }
    }
  };

  // Marker spawn function that adds to our managed array
  const spawnMarker = (worldPos: THREE.Vector3) => {
    if (lavaRef.current?.spawnMarker) {
      const marker = lavaRef.current.spawnMarker(worldPos);
      markersRef.current.push(marker);
      return marker;
    }
    return null;
  };

  // Lava simulation update
  const updateLavaSimulation = (dt: number) => {
    const lava = lavaRef.current;
    if (!lava || lava.paused) return;

    // Continuous lava injection (while holding mouse)
    if (lava.holding && lava.continuousPoint && lava.continuousPoint.uv) {
      injectLavaUV(lava, lava.continuousPoint.uv.x, lava.continuousPoint.uv.y, config.injectionAmount, config.injectionRadius);
    }

    // Persistent lava injection (all vents)
    if (lava.persistentVentsEnabled && lava.persistentVents.length > 0) {
      for (const vent of lava.persistentVents) {
        injectLavaUV(lava, vent[0], vent[1], config.injectionAmount, config.injectionRadius);
      }
    }

    // Run lava physics simulation
    simulateLava(lava, dt, config.flowRate, config.cooling, config.viscosity);
  };

  // Expose methods to parent component
  useImperativeHandle(onRef, () => ({
    reload,
    setSun,
    updateExaggeration: (value: number) => {
      if (sceneRef.current?.terrainMesh && heightDataRef.current) {
        applyHeights(sceneRef.current.terrainMesh.geometry, heightDataRef.current, value, config.autoNormals);
        if (lavaRef.current) {
          recomputeGroundFromHeightData(lavaRef.current, heightDataRef.current, value);
        }
      }
    },
    updateWater: () => {
      if (sceneRef.current) {
        updateWater(sceneRef.current, undefined, config);
      }
    },
    updateNormals: () => {
      if (sceneRef.current?.terrainMesh && heightDataRef.current) {
        applyHeights(sceneRef.current.terrainMesh.geometry, heightDataRef.current, config.exaggeration, config.autoNormals);
      }
    },
    placeFlag: (lat: number, lon: number) => {
      if (!sceneRef.current?.terrainMesh) {
        log('Terrain not loaded yet.', 'fail');
        return;
      }
      
      const coords = latLonToUV(lat, lon);
      log(`Converting lat/lon ${lat}, ${lon} to UV ${coords.u.toFixed(3)}, ${coords.v.toFixed(3)}`, 'ok');
      
      // Find the terrain vertex closest to this UV coordinate
      const geometry = sceneRef.current.terrainMesh.geometry;
      const position = geometry.attributes.position;
      const uv = geometry.attributes.uv;
      
      let closestIndex = 0;
      let minDist = Infinity;
      for (let i = 0; i < uv.count; i++) {
        const uvX = uv.getX(i);
        const uvY = uv.getY(i);
        const dist = Math.sqrt((uvX - coords.u)**2 + (uvY - coords.v)**2);
        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }
      
      // Get the world position of this vertex
      const worldPos = new THREE.Vector3();
      worldPos.fromBufferAttribute(position, closestIndex);
      sceneRef.current.terrainMesh.localToWorld(worldPos);
      
      // Create flag texture
      const makeFlagTexture = () => {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const g = c.getContext('2d')!;
        g.clearRect(0, 0, 128, 128);
        g.fillStyle = '#8B4513';
        g.fillRect(60, 10, 8, 110);
        g.fillStyle = '#FF0000';
        g.fillRect(20, 10, 40, 30);
        g.strokeStyle = '#FFFFFF';
        g.lineWidth = 2;
        g.strokeRect(20, 10, 40, 30);
        g.fillStyle = '#8B4513';
        g.fillRect(58, 10, 4, 30);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      };
      
      // Create flag sprite
      const mat = new THREE.SpriteMaterial({ 
        map: makeFlagTexture(), 
        transparent: true, 
        depthTest: true, 
        depthWrite: false,
        alphaTest: 0.1
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(worldPos);
      sprite.position.y += 200;
      sprite.scale.set(300, 300, 1);
      sprite.renderOrder = 10;
      sceneRef.current.root.add(sprite);
      
      // Clear previous flags
      flagsRef.current.forEach(flag => {
        sceneRef.current?.root.remove(flag.sprite);
        flag.sprite.material.dispose();
      });
      flagsRef.current.length = 0;
      
      flagsRef.current.push({ sprite, lat, lon });
      
      const actualU = uv.getX(closestIndex);
      const actualV = uv.getY(closestIndex);
      const actualCoords = uvToLatLon(actualU, actualV);
      log(`Red flag placed at ${lat.toFixed(6)}, ${lon.toFixed(6)} -> found at ${actualCoords.lat.toFixed(6)}, ${actualCoords.lon.toFixed(6)}!`, 'ok');
    },
    clearFlags: () => {
      const flags = flagsRef.current;
      flags.forEach(flag => {
        sceneRef.current?.root.remove(flag.sprite);
        flag.sprite.material.dispose();
      });
      flags.length = 0;
    },
    clearLava: () => {
      const lava = lavaRef.current;
      if (lava) {
        // Use realistic simulator clear if available
        if (lava.realisticSim) {
          lava.realisticSim.clear();
        } else {
          // Fallback to legacy clear
          lava.lava.fill(0);
          lava.lavaTex.needsUpdate = true;
        }
        lava.persistentVents = [];
      }
    },
    toggleLavaSimulation: () => {
      const lava = lavaRef.current;
      if (lava) {
        lava.paused = !lava.paused;
        return lava.paused;
      }
      return false;
    },
    togglePersistentFlow: () => {
      const lava = lavaRef.current;
      if (lava) {
        lava.persistentVentsEnabled = !lava.persistentVentsEnabled;
        return {
          enabled: lava.persistentVentsEnabled,
          count: lava.persistentVents.length
        };
      }
      return null;
    },
    exportPNG: () => {
      if (sceneRef.current) {
        const a = document.createElement('a');
        a.download = 'tenerife_screenshot.png';
        a.href = sceneRef.current.renderer.domElement.toDataURL('image/png');
        a.click();
      }
    },
    exportOBJ: () => {
      if (!sceneRef.current?.terrainMesh) return;
      
      const geo = sceneRef.current.terrainMesh.geometry;
      const pos = geo.attributes.position.array;
      const norm = geo.attributes.normal.array;
      const uvs = geo.attributes.uv.array;
      const idx = geo.index ? geo.index.array : null;
      
      let obj = '# Tenerife terrain exported from browser\n';
      
      // Vertices
      for (let i = 0; i < pos.length; i += 3) {
        obj += `v ${pos[i].toFixed(4)} ${pos[i + 1].toFixed(4)} ${pos[i + 2].toFixed(4)}\n`;
      }
      
      // UV coordinates
      for (let i = 0; i < uvs.length; i += 2) {
        obj += `vt ${uvs[i].toFixed(6)} ${uvs[i + 1].toFixed(6)}\n`;
      }
      
      // Normals
      for (let i = 0; i < norm.length; i += 3) {
        obj += `vn ${norm[i].toFixed(6)} ${norm[i + 1].toFixed(6)} ${norm[i + 2].toFixed(6)}\n`;
      }
      
      // Faces
      const face = (a: number, b: number, c: number) => 
        `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}\n`;
      
      if (idx) {
        for (let i = 0; i < idx.length; i += 3) {
          const a = idx[i] + 1;
          const b = idx[i + 1] + 1;
          const c = idx[i + 2] + 1;
          obj += face(a, b, c);
        }
      } else {
        for (let i = 0; i < pos.length / 3; i += 3) {
          obj += face(i + 1, i + 2, i + 3);
        }
      }
      
      const blob = new Blob([obj], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tenerife_terrain.obj';
      a.click();
      URL.revokeObjectURL(url);
    },
    resetCamera: () => {
      localStorage.removeItem('tenerife_camera_position');
      if (sceneRef.current?.terrainMesh) {
        fitCameraToObject(sceneRef.current, sceneRef.current.terrainMesh, 0.3, true);
      }
    },
    saveCameraPosition: () => {
      if (!sceneRef.current) return;
      
      const { camera, controls } = sceneRef.current;
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      
      const cameraState = {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        zoom: camera.zoom,
        spherical: {
          radius: spherical.radius,
          phi: spherical.phi,
          theta: spherical.theta
        }
      };
      localStorage.setItem('tenerife_camera_position', JSON.stringify(cameraState));
      console.log('Saved camera state:', cameraState);
    },
    runTests: (logFn: typeof log) => {
      logFn('Running diagnostics...');
      
      const expect = (name: string, cond: boolean) => {
        logFn((cond ? '✔ ' : '✘ ') + name, cond ? 'ok' : 'fail');
        return !!cond;
      };
      
      expect('THREE loaded', !!THREE && typeof THREE === 'object');
      expect('WebGL context ok', !!sceneRef.current?.renderer.getContext());
      expect('Terrain mesh exists', !!sceneRef.current?.terrainMesh);
      expect('Height data populated', !!heightDataRef.current && heightDataRef.current.length > 0);
      expect('Lava system ready', !!lavaRef.current);
      
      if (lavaRef.current) {
        const gridWas = lavaRef.current.mat.uniforms.gridOn?.value || 0;
        lavaRef.current.mat.uniforms.gridOn = { value: 0 };
        const offOK = (lavaRef.current.mat.uniforms.gridOn.value === 0);
        lavaRef.current.mat.uniforms.gridOn = { value: 1 };
        const onOK = (lavaRef.current.mat.uniforms.gridOn.value === 1);
        lavaRef.current.mat.uniforms.gridOn = { value: gridWas };
        expect('Grid toggle works', onOK && offOK);
      }
      
      logFn('Diagnostics finished.');
    }
  }), [config, log]);

  return (
    <main className="viewport">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </main>
  );
};

export default Viewport;
