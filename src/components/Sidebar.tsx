import React from 'react';
import { AppConfig, EventHandlers, TestLogEntry } from '../types';

interface SidebarProps {
  config: AppConfig;
  coordinates: string;
  onCoordinatesChange: (coords: string) => void;
  testLog: TestLogEntry[];
  eventHandlers: EventHandlers;
  testCoordinates: {
    center: () => void;
    peakTeide: () => void;
    coast: () => void;
  };
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  config,
  coordinates,
  onCoordinatesChange,
  testLog,
  eventHandlers,
  testCoordinates,
  isMobile = false,
  isOpen = false,
  onClose,
}) => {
  // Determine sidebar classes
  const sidebarClasses = `sidebar ${isMobile && isOpen ? 'mobile-open' : ''}`;

  return (
    <aside className={sidebarClasses}>
      {/* Mobile close button */}
      {isMobile && onClose && (
        <button className="mobile-close" onClick={onClose}>
          ✕
        </button>
      )}
      
      <h1>🏝️ Tenerife — DEM + Gravity Lava</h1>
      <p>
        Manual alignment controls + semi‑transparent lava grid. Use these to rotate{' '}
        <strong>topography</strong>, <strong>texture</strong>, and <strong>lava grid</strong>{' '}
        independently and toggle a grid overlay on the lava.
      </p>

      <div className="panel">
        <h2>Coverage & Quality</h2>
        <div className="row">
          <div>
            <label>Mesh resolution</label>
            <select
              value={config.resolution}
              onChange={(e) => eventHandlers.onResolutionChange(parseInt(e.target.value, 10))}
            >
              <option value="384">384×384</option>
              <option value="512">512×512</option>
              <option value="768">768×768</option>
              <option value="1024">1024×1024</option>
              <option value="1536">1536×1536</option>
              <option value="2048">2048×2048</option>
            </select>
          </div>
          <div>
            <label>Tile zoom</label>
            <select
              value={config.zoom}
              onChange={(e) => eventHandlers.onZoomChange(parseInt(e.target.value, 10))}
            >
              <option value="11">z11 (fast)</option>
              <option value="12">z12 (sharper)</option>
              <option value="13">z13 (heavy)</option>
              <option value="14">z14 (highest)</option>
            </select>
          </div>
        </div>
        <label>
          Vertical exaggeration: <span>{config.exaggeration}×</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="6"
          step="0.1"
          value={config.exaggeration}
          onChange={(e) => eventHandlers.onExaggerationChange(parseFloat(e.target.value))}
        />
        <label>
          Sea level (m): <span>{config.seaLevel}</span>
        </label>
        <input
          type="range"
          min="-200"
          max="2500"
          step="10"
          value={config.seaLevel}
          onChange={(e) => eventHandlers.onSeaLevelChange(parseInt(e.target.value, 10))}
        />
        <div className="checkbox-row">
          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={config.showWater}
              onChange={(e) => eventHandlers.onWaterToggle(e.target.checked)}
            />
            Water
          </label>
          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={config.autoNormals}
              onChange={(e) => eventHandlers.onAutoNormalsToggle(e.target.checked)}
            />
            Recompute normals
          </label>
          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={config.aoToggle}
              onChange={(e) => eventHandlers.onAOToggle(e.target.checked)}
            />
            Ambient Occlusion (SSAO)
          </label>
        </div>
      </div>

      <div className="panel">
        <h2>Lighting</h2>
        <label>
          Sun azimuth (°): <span>{config.sunAzimuth}</span>
        </label>
        <input
          type="range"
          min="0"
          max="360"
          step="1"
          value={config.sunAzimuth}
          onChange={(e) => eventHandlers.onSunAzimuthChange(parseInt(e.target.value, 10))}
        />
        <label>
          Sun altitude (°): <span>{config.sunAltitude}</span>
        </label>
        <input
          type="range"
          min="0"
          max="90"
          step="1"
          value={config.sunAltitude}
          onChange={(e) => eventHandlers.onSunAltitudeChange(parseInt(e.target.value, 10))}
        />
        <label>
          Env intensity: <span>{config.envIntensity}</span>
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={config.envIntensity}
          onChange={(e) => eventHandlers.onEnvIntensityChange(parseFloat(e.target.value))}
        />
      </div>

      <div className="panel">
        <h2>Lava Physics</h2>
        <label>
          Injection amount (per click/vent): <span>{config.injectionAmount}</span>
        </label>
        <input
          type="range"
          min="30"
          max="1000"
          step="10"
          value={config.injectionAmount}
          onChange={(e) => eventHandlers.onInjectionAmountChange(parseInt(e.target.value, 10))}
        />
        <label>
          Injection radius: <span>{config.injectionRadius}</span>
        </label>
        <input
          type="range"
          min="0.001"
          max="0.2"
          step="0.001"
          value={config.injectionRadius}
          onChange={(e) => eventHandlers.onInjectionRadiusChange(parseFloat(e.target.value))}
        />
        <label>
          Flow mobility (per sec): <span>{config.flowRate}</span>
        </label>
        <input
          type="range"
          min="0.05"
          max="2.0"
          step="0.05"
          value={config.flowRate}
          onChange={(e) => eventHandlers.onFlowRateChange(parseFloat(e.target.value))}
        />
        <label>
          Viscosity (diffusion): <span>{config.viscosity}</span>
        </label>
        <input
          type="range"
          min="0"
          max="0.2"
          step="0.005"
          value={config.viscosity}
          onChange={(e) => eventHandlers.onViscosityChange(parseFloat(e.target.value))}
        />
        <label>
          Cooling (per sec): <span>{config.cooling}</span>
        </label>
        <input
          type="range"
          min="0"
          max="0.2"
          step="0.005"
          value={config.cooling}
          onChange={(e) => eventHandlers.onCoolingChange(parseFloat(e.target.value))}
        />
        <div className="button-row">
          <button className="btn" onClick={eventHandlers.onClearLava}>
            Clear lava
          </button>
          <button className="btn" onClick={eventHandlers.onToggleLava}>
            Pause / Resume
          </button>
        </div>
        <div style={{ marginTop: '8px' }}>
          <button className="btn" onClick={eventHandlers.onTogglePersistentFlow}>
            Disable all vents
          </button>
        </div>
        <p className="muted">
          Slope‑capacity: volume moved ∝ total downslope, capped by mobility×dt. Faster on steep slopes, slower on flats.
        </p>
      </div>

      <div className="panel">
        <h2>Coordinates</h2>
        <label>Lat, Lon coordinates:</label>
        <input
          type="text"
          value={coordinates}
          onChange={(e) => onCoordinatesChange(e.target.value)}
        />
        <button
          className="btn full-width"
          onClick={() => eventHandlers.onPlaceFlag(coordinates)}
        >
          Place Red Flag
        </button>
        <button className="btn full-width" onClick={eventHandlers.onClearFlags}>
          Clear Flags
        </button>
        <div className="button-row">
          <button className="btn" style={{ fontSize: '11px' }} onClick={testCoordinates.center}>
            Center
          </button>
          <button className="btn" style={{ fontSize: '11px' }} onClick={testCoordinates.peakTeide}>
            Teide Peak
          </button>
          <button className="btn" style={{ fontSize: '11px' }} onClick={testCoordinates.coast}>
            Coast
          </button>
        </div>
        <button className="btn full-width" style={{ fontSize: '11px' }} onClick={eventHandlers.onResetCamera}>
          Reset Camera View
        </button>
        <button className="btn full-width" style={{ fontSize: '11px' }} onClick={eventHandlers.onTestSaveCamera}>
          Test Save Camera
        </button>
      </div>

      <div className="panel">
        <h2>Export</h2>
        <div className="button-row">
          <button className="btn" onClick={eventHandlers.onExportPNG}>
            Screenshot PNG
          </button>
          <button className="btn" onClick={eventHandlers.onExportOBJ}>
            Export OBJ
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Diagnostics</h2>
        <div className="button-row">
          <button className="btn" onClick={eventHandlers.onRunTests}>
            Run tests
          </button>
        </div>
        <div className="test-log">
          {testLog.length === 0 ? (
            '(No tests run yet)'
          ) : (
            testLog.map((entry, index) => (
              <div key={index} className={entry.type}>
                {entry.message}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
