import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import { AppConfig, TestLogEntry } from './types';
import { DEFAULT_VALUES, MOBILE_VALUES } from './constants';
import Sidebar from './components/Sidebar';
import Viewport from './components/Viewport';

function App() {
  // Mobile state (check early for initial config)
  const initialIsMobile = window.innerWidth <= 768;

  // App configuration state with mobile optimizations
  const [config, setConfig] = useState<AppConfig>({
    resolution: initialIsMobile ? MOBILE_VALUES.RESOLUTION : DEFAULT_VALUES.RESOLUTION,
    zoom: initialIsMobile ? MOBILE_VALUES.ZOOM : DEFAULT_VALUES.ZOOM,
    exaggeration: DEFAULT_VALUES.EXAGGERATION,
    seaLevel: DEFAULT_VALUES.SEA_LEVEL,
    showWater: false,
    autoNormals: true,
    aoToggle: false,
    sunAzimuth: DEFAULT_VALUES.SUN_AZIMUTH,
    sunAltitude: DEFAULT_VALUES.SUN_ALTITUDE,
    envIntensity: DEFAULT_VALUES.ENV_INTENSITY,
    injectionAmount: DEFAULT_VALUES.INJECTION_AMOUNT,
    injectionRadius: DEFAULT_VALUES.INJECTION_RADIUS,
    flowRate: DEFAULT_VALUES.FLOW_RATE,
    viscosity: DEFAULT_VALUES.VISCOSITY,
    cooling: DEFAULT_VALUES.COOLING,
  });

  // Test log state
  const [testLog, setTestLog] = useState<TestLogEntry[]>([]);
  const [coordinates, setCoordinates] = useState<string>(DEFAULT_VALUES.DEFAULT_COORDINATES);

  // Viewport reference for direct access to Three.js methods
  const [viewportRef, setViewportRef] = useState<any>(null);

  // Mobile state
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= 768);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Log function for tests and diagnostics
  const log = useCallback((message: string, type: 'ok' | 'fail' | '' = '') => {
    setTestLog(prev => [...prev, { message, type }]);
  }, []);

  // Mobile detection and resize handler
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) {
        setIsSidebarOpen(false); // Close sidebar when switching to desktop
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Toggle mobile sidebar
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(!isSidebarOpen);
  }, [isSidebarOpen]);

  // Event handlers for configuration changes
  const handleConfigChange = useCallback(<K extends keyof AppConfig>(
    key: K,
    value: AppConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  // Specific event handlers
  const eventHandlers = {
    onResolutionChange: (value: number) => {
      handleConfigChange('resolution', value);
      log('Mesh resolution changed - reloading terrain...', 'ok');
      viewportRef?.reload();
    },
    onZoomChange: (value: number) => {
      handleConfigChange('zoom', value);
      log('Tile zoom changed - reloading terrain...', 'ok');
      viewportRef?.reload();
    },
    onExaggerationChange: (value: number) => {
      handleConfigChange('exaggeration', value);
      viewportRef?.updateExaggeration(value);
    },
    onSeaLevelChange: (value: number) => {
      handleConfigChange('seaLevel', value);
      viewportRef?.updateWater();
    },
    onWaterToggle: (checked: boolean) => {
      handleConfigChange('showWater', checked);
      viewportRef?.updateWater();
    },
    onAutoNormalsToggle: (checked: boolean) => {
      handleConfigChange('autoNormals', checked);
      viewportRef?.updateNormals();
    },
    onAOToggle: (checked: boolean) => {
      handleConfigChange('aoToggle', checked);
    },
    onSunAzimuthChange: (value: number) => {
      handleConfigChange('sunAzimuth', value);
      viewportRef?.setSun(value, config.sunAltitude, config.envIntensity);
    },
    onSunAltitudeChange: (value: number) => {
      handleConfigChange('sunAltitude', value);
      viewportRef?.setSun(config.sunAzimuth, value, config.envIntensity);
    },
    onEnvIntensityChange: (value: number) => {
      handleConfigChange('envIntensity', value);
      viewportRef?.setSun(config.sunAzimuth, config.sunAltitude, value);
    },
    onInjectionAmountChange: (value: number) => {
      handleConfigChange('injectionAmount', value);
    },
    onInjectionRadiusChange: (value: number) => {
      handleConfigChange('injectionRadius', value);
    },
    onFlowRateChange: (value: number) => {
      handleConfigChange('flowRate', value);
    },
    onViscosityChange: (value: number) => {
      handleConfigChange('viscosity', value);
    },
    onCoolingChange: (value: number) => {
      handleConfigChange('cooling', value);
    },
    onPlaceFlag: (coords: string) => {
      const parts = coords.trim().split(',');
      if (parts.length !== 2) {
        log('Please use format: lat, lon', 'fail');
        return;
      }
      
      const lat = parseFloat(parts[0].trim());
      const lon = parseFloat(parts[1].trim());
      
      if (isNaN(lat) || isNaN(lon)) {
        log('Invalid coordinates. Use numbers only.', 'fail');
        return;
      }
      
      if (lat < 28.0 || lat > 28.7 || lon < -17.0 || lon > -16.0) {
        log('Coordinates outside Tenerife area.', 'fail');
        return;
      }
      
      viewportRef?.placeFlag(lat, lon);
    },
    onClearFlags: () => {
      viewportRef?.clearFlags();
      log('All flags cleared.', 'ok');
    },
    onClearLava: () => {
      viewportRef?.clearLava();
      log('Cleared all lava and vents.', 'ok');
    },
    onToggleLava: () => {
      const paused = viewportRef?.toggleLavaSimulation();
      log(paused ? 'Simulation paused.' : 'Simulation resumed.', 'ok');
    },
    onTogglePersistentFlow: () => {
      const result = viewportRef?.togglePersistentFlow();
      if (result) {
        log(result.enabled 
          ? `Enabled ${result.count} persistent vents.` 
          : `Disabled ${result.count} persistent vents.`, 'ok');
      }
    },
    onExportPNG: () => {
      viewportRef?.exportPNG();
    },
    onExportOBJ: () => {
      viewportRef?.exportOBJ();
    },
    onRunTests: () => {
      setTestLog([]);
      viewportRef?.runTests(log);
    },
    onResetCamera: () => {
      viewportRef?.resetCamera();
      log('Camera view reset to default.', 'ok');
    },
    onTestSaveCamera: () => {
      viewportRef?.saveCameraPosition();
      log('Camera position manually saved - check console for details.', 'ok');
    },
  };

  // Test coordinate presets
  const testCoordinates = {
    center: () => {
      setCoordinates('28.35, -16.5');
      eventHandlers.onPlaceFlag('28.35, -16.5');
    },
    peakTeide: () => {
      setCoordinates('28.2722, -16.6431');
      eventHandlers.onPlaceFlag('28.2722, -16.6431');
    },
    coast: () => {
      setCoordinates('28.4, -16.2');
      eventHandlers.onPlaceFlag('28.4, -16.2');
    },
  };

  return (
    <div className="app">
      {/* Mobile toggle button */}
      {isMobile && (
        <button className="mobile-toggle" onClick={toggleSidebar}>
          ☰
        </button>
      )}
      
      <Sidebar
        config={config}
        coordinates={coordinates}
        onCoordinatesChange={setCoordinates}
        testLog={testLog}
        eventHandlers={eventHandlers}
        testCoordinates={testCoordinates}
        isMobile={isMobile}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <Viewport
        config={config}
        onRef={setViewportRef}
        log={log}
        isMobile={isMobile}
      />
      <div className="help">
        {isMobile 
          ? "Touch: rotate/zoom • Two fingers: pan • Tap/hold: spawn lava • Double tap: place vent"
          : "Mouse: orbit/zoom • Shift+drag: pan • Left click/hold: spawn lava • Right click: place persistent vent"
        }
      </div>
    </div>
  );
}

export default App;
