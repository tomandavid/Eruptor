import * as THREE from 'three';
import { RealisticLavaSimulator } from './systems/RealisticLavaSystem';

// Configuration types
export interface AppConfig {
  resolution: number;
  zoom: number;
  exaggeration: number;
  seaLevel: number;
  showWater: boolean;
  autoNormals: boolean;
  aoToggle: boolean;
  sunAzimuth: number;
  sunAltitude: number;
  envIntensity: number;
  injectionAmount: number;
  injectionRadius: number;
  flowRate: number;
  viscosity: number;
  cooling: number;
}

// Terrain data structure
export interface TerrainData {
  data: Float32Array;
  width: number;
  height: number;
  meters: number;
  texture: THREE.CanvasTexture;
  range: { w: number; h: number };
}

// Lava system structure
export interface LavaSystem {
  size: number;
  flowN: number;
  lava: Uint8Array;
  lavaF: Float32Array;
  lavaTex: THREE.DataTexture;
  mat: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  ground: Float32Array;
  paused: boolean;
  holding: boolean;
  lastUV: [number, number];
  continuousPoint: THREE.Intersection | null;
  persistentVentsEnabled: boolean;
  persistentVents: [number, number][];
  spawnMarker?: (worldPos: THREE.Vector3) => Marker;
  realisticSim?: RealisticLavaSimulator;
  timeUniform?: THREE.Uniform<number>;
}

// Camera state for saving/loading
export interface CameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  zoom: number;
  spherical: {
    radius: number;
    phi: number;
    theta: number;
  };
}

// Marker and flag types
export interface Marker {
  sprite: THREE.Sprite;
  t: number;
  life: number;
}

export interface Flag {
  sprite: THREE.Sprite;
  lat: number;
  lon: number;
}

// Test log entry
export interface TestLogEntry {
  message: string;
  type: 'ok' | 'fail' | '';
}

// Three.js scene elements
export interface SceneElements {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: any; // OrbitControls type
  composer: any; // EffectComposer type
  root: THREE.Group;
  terrainMesh: THREE.Mesh | null;
  waterMesh: THREE.Mesh | null;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
}

// Event handler props
export interface EventHandlers {
  onResolutionChange: (value: number) => void;
  onZoomChange: (value: number) => void;
  onExaggerationChange: (value: number) => void;
  onSeaLevelChange: (value: number) => void;
  onWaterToggle: (checked: boolean) => void;
  onAutoNormalsToggle: (checked: boolean) => void;
  onAOToggle: (checked: boolean) => void;
  onSunAzimuthChange: (value: number) => void;
  onSunAltitudeChange: (value: number) => void;
  onEnvIntensityChange: (value: number) => void;
  onInjectionAmountChange: (value: number) => void;
  onInjectionRadiusChange: (value: number) => void;
  onFlowRateChange: (value: number) => void;
  onViscosityChange: (value: number) => void;
  onCoolingChange: (value: number) => void;
  onPlaceFlag: (coordinates: string) => void;
  onClearFlags: () => void;
  onClearLava: () => void;
  onToggleLava: () => void;
  onTogglePersistentFlow: () => void;
  onExportPNG: () => void;
  onExportOBJ: () => void;
  onRunTests: () => void;
  onResetCamera: () => void;
  onTestSaveCamera: () => void;
}
