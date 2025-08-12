import * as THREE from 'three';
import { LavaSystem, SceneElements, AppConfig } from '../types';
import { clamp01 } from '../utils';

// Physical constants for realistic lava simulation
const LAVA_PHYSICS = {
  // Temperature-dependent viscosity (Pa·s)
  VISCOSITY_HOT: 10,      // ~1200°C basaltic lava
  VISCOSITY_COOL: 10000,  // ~900°C cooling lava
  VISCOSITY_SOLID: 1e6,   // Solidified lava
  
  // Thermal properties
  INITIAL_TEMP: 1200,     // Initial lava temperature (°C)
  AMBIENT_TEMP: 20,       // Ambient air temperature (°C)
  SOLIDIFICATION_TEMP: 700, // Temperature below which lava solidifies
  
  // Flow properties
  DENSITY: 2500,          // Lava density (kg/m³)
  YIELD_STRENGTH: 100,    // Bingham plastic yield strength (Pa)
  SURFACE_TENSION: 0.4,   // Surface tension effects
  
  // Cooling rates
  RADIATIVE_COOLING: 0.8, // Radiative heat loss coefficient
  CONDUCTIVE_COOLING: 0.3, // Heat conduction to ground
  CONVECTIVE_COOLING: 0.5, // Convective cooling from air
  
  // Terrain interaction
  EROSION_RATE: 0.001,    // Rate at which hot lava erodes terrain
  DEPOSITION_RATE: 0.5,   // Rate of lava accumulation when cooling
};

// Enhanced lava cell structure with thermal properties
interface LavaCell {
  thickness: number;      // Lava thickness (m)
  temperature: number;    // Temperature (°C)
  velocity: [number, number]; // Flow velocity [x, z] (m/s)
  viscosity: number;      // Dynamic viscosity (Pa·s)
  age: number;           // Time since eruption (s)
  solid: boolean;        // Whether lava has solidified
  crust: number;         // Crust thickness for cooling lava
}

// Terrain modification system
interface TerrainModification {
  elevation: number;      // Height modification from lava deposition
  baseElevation: number; // Original terrain height
  lavaThickness: number; // Accumulated lava thickness
}

export class RealisticLavaSimulator {
  private flowN: number;
  private lavaField: LavaCell[][];
  private terrainMods: TerrainModification[][];
  private heightData: Float32Array;
  private originalHeightData: Float32Array;
  private lavaTex!: THREE.DataTexture;
  private tempTex!: THREE.DataTexture;
  private sceneElements: SceneElements;
  private config: AppConfig;
  
  // Thermal visualization textures
  private thermalData!: Uint8Array;
  private velocityField!: Float32Array;
  
  constructor(
    sceneElements: SceneElements,
    size: number,
    heightData: Float32Array,
    config: AppConfig,
    flowN: number = 1280
  ) {
    this.flowN = flowN;
    this.sceneElements = sceneElements;
    this.config = config;
    this.heightData = heightData;
    this.originalHeightData = new Float32Array(heightData);
    
    // Initialize lava field with thermal properties
    this.lavaField = Array(flowN).fill(null).map(() =>
      Array(flowN).fill(null).map(() => ({
        thickness: 0,
        temperature: LAVA_PHYSICS.AMBIENT_TEMP,
        velocity: [0, 0] as [number, number],
        viscosity: LAVA_PHYSICS.VISCOSITY_SOLID,
        age: 0,
        solid: true,
        crust: 0
      }))
    );
    
    // Initialize terrain modifications
    this.terrainMods = Array(flowN).fill(null).map((_, y) =>
      Array(flowN).fill(null).map((_, x) => ({
        elevation: this.sampleHeightAtUV(x / (flowN - 1), y / (flowN - 1)),
        baseElevation: this.sampleHeightAtUV(x / (flowN - 1), y / (flowN - 1)),
        lavaThickness: 0
      }))
    );
    
    // Create enhanced textures for visualization
    this.createEnhancedTextures();
  }
  
  private createEnhancedTextures() {
    const size = this.flowN;
    
    // Multi-channel lava texture (RGBA)
    // R: thickness, G: temperature (normalized), B: velocity magnitude, A: solidification
    const lavaData = new Uint8Array(size * size * 4);
    this.lavaTex = new THREE.DataTexture(lavaData, size, size, THREE.RGBAFormat);
    this.lavaTex.wrapS = this.lavaTex.wrapT = THREE.ClampToEdgeWrapping;
    this.lavaTex.minFilter = this.lavaTex.magFilter = THREE.LinearFilter;
    
    // Thermal visualization texture (RGBA format)
    this.thermalData = new Uint8Array(size * size * 4);
    this.tempTex = new THREE.DataTexture(this.thermalData, size, size, THREE.RGBAFormat);
    this.tempTex.wrapS = this.tempTex.wrapT = THREE.ClampToEdgeWrapping;
    this.tempTex.minFilter = this.tempTex.magFilter = THREE.LinearFilter;
    
    // Velocity field for flow visualization
    this.velocityField = new Float32Array(size * size * 2);
  }
  
  // Temperature-dependent viscosity calculation (Vogel-Fulcher-Tammann equation)
  private calculateViscosity(temperature: number): number {
    const T = temperature + 273.15; // Convert to Kelvin
    const A = -4.55; // Empirical constants for basaltic lava
    const B = 6270;
    const T0 = 837;
    
    if (temperature < LAVA_PHYSICS.SOLIDIFICATION_TEMP) {
      return LAVA_PHYSICS.VISCOSITY_SOLID;
    }
    
    return Math.exp(A + B / (T - T0)) * 1000; // Convert to Pa·s
  }
  
  // Bingham plastic flow model for lava rheology
  private calculateFlowVelocity(
    cell: LavaCell,
    slope: [number, number],
    neighbors: LavaCell[]
  ): [number, number] {
    if (cell.solid || cell.thickness < 0.01) {
      return [0, 0];
    }
    
    const slopeMagnitude = Math.sqrt(slope[0] * slope[0] + slope[1] * slope[1]);
    if (slopeMagnitude < 1e-6) return [0, 0];
    
    // Bingham plastic model: τ = τ_y + η * γ̇
    const shearStress = LAVA_PHYSICS.DENSITY * 9.81 * cell.thickness * slopeMagnitude;
    
    if (shearStress < LAVA_PHYSICS.YIELD_STRENGTH) {
      return [0, 0]; // No flow below yield stress
    }
    
    // Calculate strain rate
    const excessStress = shearStress - LAVA_PHYSICS.YIELD_STRENGTH;
    const strainRate = excessStress / cell.viscosity;
    
    // Flow velocity proportional to strain rate and slope direction
    const velocity = strainRate * cell.thickness * 0.1; // Scaling factor
    
    return [
      velocity * slope[0] / slopeMagnitude,
      velocity * slope[1] / slopeMagnitude
    ];
  }
  
  // Advanced thermal cooling model
  private updateThermalProperties(cell: LavaCell, dt: number, surfaceArea: number) {
    if (cell.thickness < 0.001) return;
    
    // Stefan-Boltzmann law for radiative cooling
    const T_surface = cell.temperature + 273.15; // Kelvin
    const T_ambient = LAVA_PHYSICS.AMBIENT_TEMP + 273.15;
    const emissivity = 0.95; // Basalt emissivity
    const stefanBoltzmann = 5.67e-8; // W/(m²K⁴)
    
    const radiativeLoss = emissivity * stefanBoltzmann * surfaceArea * 
                         (Math.pow(T_surface, 4) - Math.pow(T_ambient, 4));
    
    // Conductive cooling to ground
    const conductiveLoss = LAVA_PHYSICS.CONDUCTIVE_COOLING * 
                          (cell.temperature - LAVA_PHYSICS.AMBIENT_TEMP) * surfaceArea;
    
    // Convective cooling from air (wind effects)
    const convectiveLoss = LAVA_PHYSICS.CONVECTIVE_COOLING * 
                          Math.sqrt(cell.velocity[0] * cell.velocity[0] + cell.velocity[1] * cell.velocity[1]) *
                          (cell.temperature - LAVA_PHYSICS.AMBIENT_TEMP) * surfaceArea;
    
    // Total heat loss
    const totalHeatLoss = (radiativeLoss + conductiveLoss + convectiveLoss) * dt;
    
    // Specific heat capacity of basalt (~1000 J/(kg·K))
    const specificHeat = 1000;
    const mass = LAVA_PHYSICS.DENSITY * cell.thickness * surfaceArea;
    
    // Temperature change
    const tempChange = totalHeatLoss / (mass * specificHeat);
    cell.temperature = Math.max(LAVA_PHYSICS.AMBIENT_TEMP, cell.temperature - tempChange);
    
    // Update viscosity based on new temperature
    cell.viscosity = this.calculateViscosity(cell.temperature);
    
    // Crust formation for cooling lava
    if (cell.temperature < 900 && !cell.solid) {
      cell.crust += dt * 0.1; // Crust grows over time
    }
    
    // Solidification check
    if (cell.temperature < LAVA_PHYSICS.SOLIDIFICATION_TEMP) {
      cell.solid = true;
      cell.velocity = [0, 0];
    }
    
    cell.age += dt;
  }
  
  // Terrain modification from lava deposition and erosion
  private modifyTerrain(x: number, y: number, cell: LavaCell, dt: number) {
    const mod = this.terrainMods[y][x];
    
    if (cell.temperature > 1000 && cell.thickness > 0.1) {
      // Hot lava can erode terrain slightly
      const erosion = LAVA_PHYSICS.EROSION_RATE * dt * (cell.temperature - 1000) / 200;
      mod.baseElevation = Math.max(mod.baseElevation - erosion, mod.baseElevation - 1.0);
    }
    
    if (cell.solid && cell.thickness > 0) {
      // Solidified lava adds to terrain height
      const deposition = LAVA_PHYSICS.DEPOSITION_RATE * cell.thickness;
      mod.lavaThickness = Math.max(mod.lavaThickness, deposition);
    }
    
    // Update total elevation
    mod.elevation = mod.baseElevation + mod.lavaThickness;
    
    // Update heightData for terrain mesh
    const heightIndex = y * Math.sqrt(this.heightData.length) + x * Math.sqrt(this.heightData.length) / this.flowN;
    if (heightIndex < this.heightData.length) {
      this.heightData[heightIndex] = mod.elevation;
    }
  }
  
  // Main simulation step with enhanced physics
  public simulate(dt: number) {
    const cellSize = 1.0; // meters per cell
    const cellArea = cellSize * cellSize;
    
    // Create temporary arrays for new state
    const newLavaField = this.lavaField.map(row => row.map(cell => ({ ...cell })));
    
    for (let y = 1; y < this.flowN - 1; y++) {
      for (let x = 1; x < this.flowN - 1; x++) {
        const cell = this.lavaField[y][x];
        const newCell = newLavaField[y][x];
        
        if (cell.thickness < 0.001) continue;
        
        // Calculate local slope using central differences
        const heightHere = this.terrainMods[y][x].elevation + cell.thickness;
        const heightN = this.terrainMods[y-1][x].elevation + this.lavaField[y-1][x].thickness;
        const heightS = this.terrainMods[y+1][x].elevation + this.lavaField[y+1][x].thickness;
        const heightE = this.terrainMods[y][x+1].elevation + this.lavaField[y][x+1].thickness;
        const heightW = this.terrainMods[y][x-1].elevation + this.lavaField[y][x-1].thickness;
        
        const slope: [number, number] = [
          (heightE - heightW) / (2 * cellSize),
          (heightS - heightN) / (2 * cellSize)
        ];
        
        // Get neighboring cells for flow calculation
        const neighbors = [
          this.lavaField[y-1][x], this.lavaField[y+1][x],
          this.lavaField[y][x-1], this.lavaField[y][x+1]
        ];
        
        // Update thermal properties
        this.updateThermalProperties(newCell, dt, cellArea);
        
        // Calculate flow velocity using Bingham plastic model
        if (!newCell.solid) {
          newCell.velocity = this.calculateFlowVelocity(newCell, slope, neighbors);
          
          // Flow redistribution using flux-based approach
          const velocityMag = Math.sqrt(newCell.velocity[0] * newCell.velocity[0] + 
                                       newCell.velocity[1] * newCell.velocity[1]);
          
          if (velocityMag > 0.01 && newCell.thickness > 0.05) {
            // Calculate flux to neighboring cells
            const flux = Math.min(newCell.thickness * 0.5, velocityMag * dt * newCell.thickness);
            
            // Distribute flux based on velocity direction
            const fluxX = flux * newCell.velocity[0] / velocityMag;
            const fluxY = flux * newCell.velocity[1] / velocityMag;
            
            // Apply flux to neighboring cells
            if (fluxX > 0 && x < this.flowN - 1) {
              newLavaField[y][x+1].thickness += fluxX * 0.5;
              newLavaField[y][x+1].temperature = Math.max(newLavaField[y][x+1].temperature, cell.temperature);
            } else if (fluxX < 0 && x > 0) {
              newLavaField[y][x-1].thickness += Math.abs(fluxX) * 0.5;
              newLavaField[y][x-1].temperature = Math.max(newLavaField[y][x-1].temperature, cell.temperature);
            }
            
            if (fluxY > 0 && y < this.flowN - 1) {
              newLavaField[y+1][x].thickness += fluxY * 0.5;
              newLavaField[y+1][x].temperature = Math.max(newLavaField[y+1][x].temperature, cell.temperature);
            } else if (fluxY < 0 && y > 0) {
              newLavaField[y-1][x].thickness += Math.abs(fluxY) * 0.5;
              newLavaField[y-1][x].temperature = Math.max(newLavaField[y-1][x].temperature, cell.temperature);
            }
            
            newCell.thickness -= Math.abs(fluxX) + Math.abs(fluxY);
            newCell.thickness = Math.max(0, newCell.thickness);
          }
        }
        
        // Modify terrain based on lava interaction
        this.modifyTerrain(x, y, newCell, dt);
      }
    }
    
    // Update the main lava field
    this.lavaField = newLavaField;
    
    // Update visualization textures
    this.updateVisualizationTextures();
  }
  
  // Inject realistic lava with proper thermal properties
  public injectLava(u: number, v: number, amount: number, temperature: number = LAVA_PHYSICS.INITIAL_TEMP) {
    const x = Math.floor(u * (this.flowN - 1));
    const y = Math.floor(v * (this.flowN - 1));
    const radius = 3; // Injection radius in cells
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx >= 0 && nx < this.flowN && ny >= 0 && ny < this.flowN) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= radius) {
            const weight = 1 - distance / radius;
            const cell = this.lavaField[ny][nx];
            
            // Add lava with thermal mixing
            const newThickness = amount * weight * 0.01; // Convert to meters
            const oldMass = cell.thickness * LAVA_PHYSICS.DENSITY;
            const newMass = newThickness * LAVA_PHYSICS.DENSITY;
            
            if (oldMass + newMass > 0) {
              // Thermal mixing
              cell.temperature = (cell.temperature * oldMass + temperature * newMass) / (oldMass + newMass);
              cell.thickness += newThickness;
              cell.solid = false;
              cell.age = 0;
              cell.crust = 0;
              cell.viscosity = this.calculateViscosity(cell.temperature);
            }
          }
        }
      }
    }
  }
  
  // Update visualization textures with enhanced data
  private updateVisualizationTextures() {
    const lavaData = this.lavaTex.image.data;
    
    for (let y = 0; y < this.flowN; y++) {
      for (let x = 0; x < this.flowN; x++) {
        const idx = (y * this.flowN + x) * 4;
        const cell = this.lavaField[y][x];
        
        // R: Lava thickness (normalized)
        lavaData[idx] = Math.min(255, cell.thickness * 100);
        
        // G: Temperature (normalized 0-255 for 20-1200°C)
        lavaData[idx + 1] = Math.max(0, Math.min(255, 
          (cell.temperature - LAVA_PHYSICS.AMBIENT_TEMP) / 
          (LAVA_PHYSICS.INITIAL_TEMP - LAVA_PHYSICS.AMBIENT_TEMP) * 255
        ));
        
        // B: Velocity magnitude
        const velocityMag = Math.sqrt(cell.velocity[0] * cell.velocity[0] + cell.velocity[1] * cell.velocity[1]);
        lavaData[idx + 2] = Math.min(255, velocityMag * 50);
        
        // A: Solidification state (255 = liquid, 0 = solid)
        lavaData[idx + 3] = cell.solid ? 0 : 255;
      }
    }
    
    this.lavaTex.needsUpdate = true;
  }
  
  // Get the enhanced texture for rendering
  public getLavaTexture(): THREE.DataTexture {
    return this.lavaTex;
  }
  
  // Get terrain modification data for mesh updates
  public getTerrainModifications(): Float32Array {
    return this.heightData;
  }
  
  // Helper method to sample height at UV coordinates
  private sampleHeightAtUV(u: number, v: number): number {
    const resN = Math.sqrt(this.originalHeightData.length);
    const x = Math.floor(u * (resN - 1));
    const y = Math.floor(v * (resN - 1));
    const idx = y * resN + x;
    return this.originalHeightData[idx] || 0;
  }
  
  // Clear all lava
  public clear() {
    for (let y = 0; y < this.flowN; y++) {
      for (let x = 0; x < this.flowN; x++) {
        const cell = this.lavaField[y][x];
        cell.thickness = 0;
        cell.temperature = LAVA_PHYSICS.AMBIENT_TEMP;
        cell.velocity = [0, 0];
        cell.solid = true;
        cell.age = 0;
        cell.crust = 0;
        
        // Reset terrain modifications
        const mod = this.terrainMods[y][x];
        mod.elevation = mod.baseElevation;
        mod.lavaThickness = 0;
      }
    }
    
    // Restore original height data
    this.heightData.set(this.originalHeightData);
    this.updateVisualizationTextures();
  }
}
