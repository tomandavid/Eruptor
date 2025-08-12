import * as THREE from 'three';
import { TerrainData, AppConfig, SceneElements, LavaSystem } from '../types';
import { TERRARIUM_URL, OSM_URL, BBOX } from '../constants';
import { loadImage, groundResMpp, deg2rad } from '../utils';
import { setupLavaSystem } from './LavaSystem';

export async function loadTerrariumBBox(zoom: number): Promise<TerrainData> {
  const z = zoom;
  const { w: west, e: east, s: south, n: north } = BBOX;
  const n = 2 ** z;
  
  const xt0 = Math.floor((west + 180) / 360 * n);
  const xt1 = Math.floor((east + 180) / 360 * n);
  
  const latRad = (lat: number) => deg2rad(lat);
  const yt = (lat: number) => Math.floor((1 - Math.log(Math.tan(latRad(lat)) + 1/Math.cos(latRad(lat))) / Math.PI) / 2 * n);
  
  const yt0 = yt(north);
  const yt1 = yt(south);
  
  const x0 = Math.min(xt0, xt1);
  const x1 = Math.max(xt0, xt1);
  const y0 = Math.min(yt0, yt1);
  const y1 = Math.max(yt0, yt1);
  
  const w = (x1 - x0 + 1);
  const h = (y1 - y0 + 1);
  const widthPx = w * 256;
  const heightPx = h * 256;

  // Create canvases for terrain and imagery
  const terrCanvas = document.createElement('canvas');
  terrCanvas.width = widthPx;
  terrCanvas.height = heightPx;
  const terrCtx = terrCanvas.getContext('2d')!;

  const imgCanvas = document.createElement('canvas');
  imgCanvas.width = widthPx;
  imgCanvas.height = heightPx;
  const imgCtx = imgCanvas.getContext('2d')!;

  // Load all tiles
  const promises = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const ox = (tx - x0) * 256;
      const oy = (ty - y0) * 256;
      
      promises.push((async () => {
        const terr = await loadImage(TERRARIUM_URL(z, tx, ty));
        terrCtx.drawImage(terr, ox, oy);
        
        try {
          const osm = await loadImage(OSM_URL(z, tx, ty));
          imgCtx.drawImage(osm, ox, oy);
        } catch (_) {
          // Optional satellite imagery
        }
      })());
    }
  }
  
  await Promise.all(promises);

  // Process height data from terrarium
  const { data } = terrCtx.getImageData(0, 0, widthPx, heightPx);
  const out = new Float32Array(widthPx * heightPx);
  
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    const meters = (R * 256 + G + B / 256) - 32768;
    out[p] = meters;
  }

  // Create optimized texture from satellite imagery
  const tex = new THREE.CanvasTexture(imgCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  
  // GPU memory optimization
  const maxAnisotropy = Math.min(8, 16); // Reduced from 16 for better performance
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.center.set(0.5, 0.5);
  tex.generateMipmaps = true;
  
  // Optimize texture compression
  tex.format = THREE.RGBAFormat; // Keep RGBA format for compatibility

  // Calculate real-world size
  const centerLat = (north + south) / 2;
  const mpp = groundResMpp(centerLat, z);
  const sizeMeters = widthPx * mpp;

  return {
    data: out,
    width: widthPx,
    height: heightPx,
    meters: sizeMeters,
    texture: tex,
    range: { w, h }
  };
}

export async function buildTerrainFromHeightmap(
  terr: TerrainData,
  config: AppConfig,
  sceneElements: SceneElements,
  heightDataRef: React.MutableRefObject<Float32Array | null>,
  originalHeightDataRef: React.MutableRefObject<Float32Array | null>,
  lastTerrRef: React.MutableRefObject<TerrainData | null>,
  lavaRef: React.MutableRefObject<LavaSystem | null>,
  log: (message: string, type?: 'ok' | 'fail' | '') => void
) {
  lastTerrRef.current = terr;
  const { data, width, height, meters, texture } = terr;
  const resN = config.resolution;

  // Sample heightmap to mesh resolution
  const sampled = new Float32Array(resN * resN);
  for (let y = 0; y < resN; y++) {
    const v = y / (resN - 1);
    for (let x = 0; x < resN; x++) {
      const u = x / (resN - 1);
      const sx = Math.floor(u * (width - 1));
      const sy = Math.floor(v * (height - 1));
      sampled[y * resN + x] = data[sy * width + sx];
    }
  }
  
  heightDataRef.current = sampled;
  if (!originalHeightDataRef.current) {
    originalHeightDataRef.current = sampled.slice();
  }

  const size = meters || 50000;
  const geo = new THREE.PlaneGeometry(size, size, resN - 1, resN - 1);
  geo.rotateX(-Math.PI / 2);
  applyHeights(geo, sampled, config.exaggeration, config.autoNormals);

  // Remove existing terrain
  if (sceneElements.terrainMesh) {
    sceneElements.root.remove(sceneElements.terrainMesh);
    sceneElements.terrainMesh.geometry.dispose();
    if (sceneElements.terrainMesh.material instanceof THREE.Material) {
      sceneElements.terrainMesh.material.dispose();
    }
  }

  // Create new terrain material and mesh
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.0,
    map: texture || null
  });

  sceneElements.terrainMesh = new THREE.Mesh(geo, mat);
  sceneElements.root.add(sceneElements.terrainMesh);

  // Setup lava system
  if (sceneElements.terrainMesh) {
    lavaRef.current = setupLavaSystem(sceneElements, size, heightDataRef.current, config, log);
  }

  // Update water
  updateWater(sceneElements, size, config);

  // Fit camera to terrain
  fitCameraToObject(sceneElements, sceneElements.terrainMesh, 0.3);
}

export function applyHeights(
  geometry: THREE.BufferGeometry,
  heightData: Float32Array,
  exaggeration: number,
  autoNormals: boolean
) {
  const pos = geometry.attributes.position;
  const resN = Math.sqrt(heightData.length) | 0;
  
  for (let i = 0; i < pos.count; i++) {
    const x = i % resN;
    const y = Math.floor(i / resN);
    const h = heightData[y * resN + x];
    pos.setY(i, h * exaggeration);
  }
  
  pos.needsUpdate = true;
  
  if (autoNormals) {
    geometry.computeVertexNormals();
  }
  
  if (geometry.attributes.normal) {
    geometry.attributes.normal.needsUpdate = true;
  }
}

export function updateWater(
  sceneElements: SceneElements,
  sizeOverride?: number,
  config?: AppConfig
) {
  if (!sceneElements.terrainMesh || !config) return;
  
  const size = sizeOverride || (sceneElements.terrainMesh.geometry as THREE.PlaneGeometry).parameters.width;
  const level = config.seaLevel;
  
  if (!config.showWater) {
    if (sceneElements.waterMesh) {
      sceneElements.root.remove(sceneElements.waterMesh);
      sceneElements.waterMesh.geometry.dispose();
      if (sceneElements.waterMesh.material instanceof THREE.Material) {
        sceneElements.waterMesh.material.dispose();
      }
      sceneElements.waterMesh = null;
    }
    return;
  }
  
  if (!sceneElements.waterMesh) {
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a66ff,
      transparent: true,
      opacity: 0.35,
      roughness: 0.6,
      metalness: 0.0,
      transmission: 0.6,
      thickness: 2
    });
    
    const g = new THREE.PlaneGeometry(size * 1.03, size * 1.03, 1, 1);
    g.rotateX(-Math.PI / 2);
    sceneElements.waterMesh = new THREE.Mesh(g, waterMat);
    sceneElements.root.add(sceneElements.waterMesh);
  }
  
  sceneElements.waterMesh.position.y = level;
}

export function fitCameraToObject(
  sceneElements: SceneElements,
  obj: THREE.Object3D,
  pad: number = 1.2,
  forceDefault: boolean = false
) {
  // Try to load saved camera position first
  if (!forceDefault) {
    try {
      const saved = localStorage.getItem('tenerife_camera_position');
      if (saved) {
        const cameraState = JSON.parse(saved);
        console.log('Loading camera state:', cameraState);
        
        // Restore target first
        sceneElements.controls.target.set(
          cameraState.target.x,
          cameraState.target.y,
          cameraState.target.z
        );
        
        // Restore using spherical coordinates if available
        if (cameraState.spherical) {
          const spherical = new THREE.Spherical(
            cameraState.spherical.radius,
            cameraState.spherical.phi,
            cameraState.spherical.theta
          );
          const offset = new THREE.Vector3().setFromSpherical(spherical);
          sceneElements.camera.position.copy(sceneElements.controls.target).add(offset);
        } else {
          // Fallback to direct position restoration
          sceneElements.camera.position.set(
            cameraState.position.x,
            cameraState.position.y,
            cameraState.position.z
          );
        }
        
        // Restore zoom if available
        if (cameraState.zoom !== undefined) {
          sceneElements.camera.zoom = cameraState.zoom;
          sceneElements.camera.updateProjectionMatrix();
        }
        
        sceneElements.controls.update();
        return;
      }
    } catch (e) {
      console.warn('Failed to load camera position:', e);
    }
  }
  
  // Default camera positioning
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = (maxDim * pad) / Math.tan(THREE.MathUtils.degToRad(sceneElements.camera.fov * 0.5));
  
  sceneElements.camera.far = Math.max(sceneElements.camera.far, dist * 6);
  sceneElements.camera.updateProjectionMatrix();
  
  sceneElements.camera.position.set(
    center.x + dist,
    center.y + dist * 0.6,
    center.z + dist
  );
  sceneElements.camera.lookAt(center);
  sceneElements.controls.target.copy(center);
  sceneElements.controls.update();
}
