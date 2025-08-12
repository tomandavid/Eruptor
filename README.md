# Tenerife DEM + Gravity Lava Simulator

A React TypeScript application that simulates volcanic lava flows on a 3D terrain model of Tenerife, using real digital elevation model (DEM) data and satellite imagery.

## Features

- **3D Terrain Visualization**: Real-time 3D rendering of Tenerife using elevation data from Terrarium tiles
- **Satellite Imagery**: High-resolution satellite textures overlaid on the terrain
- **Lava Flow Physics**: Realistic gravity-based lava flow simulation with slope-capacity dynamics
- **Interactive Controls**: Click to spawn lava, place persistent vents, adjust physics parameters
- **Real-time Simulation**: Smooth 60fps simulation with configurable parameters
- **Flag Placement**: Place markers at specific latitude/longitude coordinates
- **Export Functions**: Export terrain as OBJ files or take PNG screenshots
- **Camera Memory**: Automatically saves and restores camera position between sessions

## Getting Started

### Prerequisites

- Node.js (version 16 or higher)
- npm or yarn

### Installation

1. Clone or download the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) to view it in the browser

### Building for Production

```bash
npm run build
```

## Usage

### Controls

- **Mouse**: Orbit around the terrain and zoom in/out
- **Shift + Drag**: Pan the camera
- **Left Click/Hold**: Spawn lava at the clicked location
- **Right Click**: Place a persistent lava vent

### Interface Panels

#### Coverage & Quality
- **Mesh Resolution**: Terrain mesh detail (384×384 to 2048×2048)
- **Tile Zoom**: Map tile resolution (z11 fast to z14 highest detail)
- **Vertical Exaggeration**: Terrain height scaling
- **Sea Level**: Water level adjustment
- **Options**: Water rendering, normal recomputation, ambient occlusion

#### Lighting
- **Sun Azimuth**: Sun direction (0-360°)
- **Sun Altitude**: Sun height angle (0-90°)
- **Environment Intensity**: Ambient lighting strength

#### Lava Physics
- **Injection Amount**: Lava volume per click/vent
- **Injection Radius**: Spread area for lava spawning
- **Flow Mobility**: How fast lava moves downhill
- **Viscosity**: Lava spreading/diffusion rate
- **Cooling**: How quickly lava solidifies

#### Coordinates
- **Flag Placement**: Enter lat/lon coordinates to place markers
- **Preset Locations**: Quick access to Tenerife center, Teide Peak, and coast
- **Camera Controls**: Reset view or manually save camera position

#### Export
- **Screenshot PNG**: Save current view as image
- **Export OBJ**: Download terrain mesh as 3D model

#### Diagnostics
- **Run Tests**: Verify system functionality and performance

## Technical Details

### Architecture

The application is built using:
- **React 18** with TypeScript for UI components
- **Three.js** for 3D rendering and scene management
- **WebGL** with post-processing effects (SSAO)
- **Custom shader materials** for lava rendering

### Terrain Loading

1. Fetches Terrarium elevation tiles from AWS S3
2. Downloads corresponding satellite imagery from Google Maps
3. Processes elevation data (Terrarium RGB encoding)
4. Generates high-resolution terrain mesh
5. Falls back to procedural island if network fails

### Lava Simulation

The lava physics uses a slope-capacity flow model:
- Lava flows downhill based on gradient
- Flow rate proportional to slope steepness
- Viscosity creates spreading behavior
- Cooling gradually reduces lava thickness

### Performance

- Optimized for 60fps with configurable LOD
- Efficient GPU-based lava rendering
- Spatial acceleration for physics simulation
- Memory management for large datasets

## Browser Compatibility

- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Full support
- **Mobile**: Limited (desktop recommended for best experience)

## Development

### Project Structure

```
src/
├── components/          # React components
│   ├── App.tsx         # Main application
│   ├── Sidebar.tsx     # Control panel
│   └── Viewport.tsx    # 3D scene container
├── systems/            # Core logic modules
│   ├── TerrainSystem.ts # Terrain loading and rendering
│   └── LavaSystem.ts   # Lava physics and simulation
├── types.ts            # TypeScript interfaces
├── constants.ts        # Configuration constants
├── utils.ts            # Utility functions
└── App.css            # Global styles
```

### Key Technologies

- **Three.js**: 3D graphics library
- **OrbitControls**: Camera interaction
- **EffectComposer**: Post-processing pipeline
- **DataTexture**: GPU-based lava rendering
- **BufferGeometry**: Efficient mesh representation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the MIT License.

## Acknowledgments

- Elevation data from [Terrarium](https://registry.opendata.aws/terrain-tiles/) tiles
- Satellite imagery from Google Maps
- Three.js community for WebGL expertise
- Tenerife's geological features as inspiration
