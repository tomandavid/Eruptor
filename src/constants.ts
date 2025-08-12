// Configuration constants
export const BBOX = { w: -17.0, s: 28.0, e: -16.0, n: 28.7 };
export const TERRARIUM_URL = (z: number, x: number, y: number) => 
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const OSM_URL = (z: number, x: number, y: number) => 
  `https://mt1.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;

// Default values
export const DEFAULT_VALUES = {
  RESOLUTION: 1024,
  ZOOM: 13,
  EXAGGERATION: 1.0,
  SEA_LEVEL: -100,
  SUN_AZIMUTH: 135,
  SUN_ALTITUDE: 45,
  ENV_INTENSITY: 0.6,
  INJECTION_AMOUNT: 255,
  INJECTION_RADIUS: 0.001,
  FLOW_RATE: 2.0,
  VISCOSITY: 0.01,
  COOLING: 0.001,
  LAVA_FLOW_N: 1280,
  DEFAULT_COORDINATES: '28.367996, -16.559606'
};

// UI Constants
export const SIDEBAR_WIDTH = 360;
export const CAMERA_SAVE_DELAY = 500;

// Physics constants
export const SQRT2_INV = 1 / Math.SQRT2;
