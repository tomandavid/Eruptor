import { BBOX } from './constants';

// Utility functions
export const deg2rad = (d: number): number => d * Math.PI / 180;
export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function rotUV(u: number, v: number, deg: number): { u: number; v: number } {
  // rotate CW by deg around UV center
  const rad = deg2rad(deg);
  const x = u - 0.5, y = v - 0.5;
  const c = Math.cos(rad), s = Math.sin(rad);
  const xr = c * x + s * y;
  const yr = -s * x + c * y;
  return { u: clamp01(xr + 0.5), v: clamp01(yr + 0.5) };
}

export function groundResMpp(lat: number, z: number): number {
  return Math.cos(deg2rad(lat)) * 2 * Math.PI * 6378137 / (256 * 2 ** z);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

export function latLonToUV(lat: number, lon: number): { u: number; v: number } {
  const { w: west, e: east, s: south, n: north } = BBOX;
  const u = (lon - west) / (east - west);
  const v = (lat - south) / (north - south);
  return { 
    u: Math.max(0, Math.min(1, u)), 
    v: Math.max(0, Math.min(1, v)) 
  };
}

export function uvToLatLon(u: number, v: number): { lat: number; lon: number } {
  const { w: west, e: east, s: south, n: north } = BBOX;
  const lon = west + u * (east - west);
  const lat = south + v * (north - south);
  return { lat, lon };
}
