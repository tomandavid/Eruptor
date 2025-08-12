import * as THREE from 'three';

export const createRealisticLavaShader = (
  lavaTex: THREE.DataTexture,
  time: THREE.Uniform<number>
): THREE.ShaderMaterial => {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: {
      lavaTex: { value: lavaTex },
      time: time,
      liftHeight: { value: 2.0 },
      glowIntensity: { value: 3.0 },
      flowSpeed: { value: 0.5 },
      temperatureScale: { value: 1.0 },
      crustThickness: { value: 0.1 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;
      uniform float liftHeight;
      uniform sampler2D lavaTex;
      
      void main() {
        vUv = uv;
        vNormal = normal;
        
        // Sample lava data for vertex displacement
        vec4 lavaData = texture2D(lavaTex, uv);
        float thickness = lavaData.r / 255.0;
        
        // Displace vertices based on lava thickness
        vec3 displaced = position + normal * thickness * liftHeight;
        vPosition = displaced;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;
      
      uniform sampler2D lavaTex;
      uniform float time;
      uniform float glowIntensity;
      uniform float flowSpeed;
      uniform float temperatureScale;
      uniform float crustThickness;
      
      // Color temperature mapping for realistic lava
      vec3 temperatureToColor(float temp) {
        // Temperature in range 0-1 (20°C to 1200°C)
        temp = clamp(temp, 0.0, 1.0);
        
        if (temp < 0.1) {
          // Cool/solid lava - dark grey/black
          return mix(vec3(0.05, 0.05, 0.05), vec3(0.2, 0.1, 0.1), temp * 10.0);
        } else if (temp < 0.3) {
          // Cooling lava - dark red
          return mix(vec3(0.2, 0.1, 0.1), vec3(0.6, 0.2, 0.1), (temp - 0.1) * 5.0);
        } else if (temp < 0.6) {
          // Warm lava - red to orange
          return mix(vec3(0.6, 0.2, 0.1), vec3(1.0, 0.4, 0.1), (temp - 0.3) * 3.33);
        } else if (temp < 0.8) {
          // Hot lava - orange to yellow
          return mix(vec3(1.0, 0.4, 0.1), vec3(1.0, 0.8, 0.2), (temp - 0.6) * 5.0);
        } else {
          // Very hot lava - yellow to white
          return mix(vec3(1.0, 0.8, 0.2), vec3(1.0, 1.0, 0.8), (temp - 0.8) * 5.0);
        }
      }
      
      // Perlin-like noise for surface texture
      float noise(vec2 uv) {
        return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
      }
      
      float fbm(vec2 uv) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        
        for (int i = 0; i < 4; i++) {
          value += amplitude * noise(uv * frequency);
          amplitude *= 0.5;
          frequency *= 2.0;
        }
        return value;
      }
      
      void main() {
        // Apply coordinate transformation to match legacy system
        vec2 transformedUV = vec2(vUv.x, 1.0 - vUv.y);
        vec4 lavaData = texture2D(lavaTex, transformedUV);
        
        // Extract data from texture channels
        float thickness = lavaData.r / 255.0;
        float temperature = lavaData.g / 255.0;
        float velocity = lavaData.b / 255.0;
        float isSolid = 1.0 - (lavaData.a / 255.0);
        
        // Handle both realistic and legacy data
        // If no realistic data, treat as legacy (single channel thickness)
        if (temperature < 0.01 && velocity < 0.01) {
          // Legacy mode: use red channel as simple thickness
          thickness = lavaData.r / 255.0;
          temperature = thickness > 0.003 ? 0.9 : 0.0; // Assume very hot if present
          isSolid = 0.0; // Assume flowing
        }
        
        // Early discard for empty areas
        if (thickness < 0.003) discard;
        
        // Create animated flow texture
        vec2 flowUV = vUv + vec2(
          sin(time * flowSpeed + vUv.x * 10.0) * 0.02,
          cos(time * flowSpeed * 0.7 + vUv.y * 15.0) * 0.015
        );
        
        // Add surface texture variation
        float surfaceNoise = fbm(flowUV * 20.0 + time * 0.1);
        float crackPattern = fbm(vUv * 50.0) * 0.3;
        
        // Calculate base color from temperature
        vec3 baseColor = temperatureToColor(temperature * temperatureScale);
        
        // Modify color based on flow state
        if (isSolid > 0.5) {
          // Solid lava - darker with cracks
          baseColor *= 0.3 + crackPattern * 0.4;
          baseColor = mix(baseColor, vec3(0.1, 0.05, 0.05), 0.7);
        } else {
          // Flowing lava - animated surface
          baseColor *= 0.8 + surfaceNoise * 0.4;
          
          // Add velocity-based flow lines
          if (velocity > 0.1) {
            float flowLines = sin(vUv.x * 100.0 + time * velocity * 10.0) * 0.1;
            baseColor += vec3(flowLines * temperature);
          }
        }
        
        // Emission intensity based on temperature and thickness
        float emission = temperature * thickness * glowIntensity;
        
        // Add thermal glow around edges
        float edgeGlow = 1.0 - smoothstep(0.0, 0.1, thickness);
        emission += edgeGlow * temperature * 2.0;
        
        // Fresnel effect for realistic surface reflection
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        float fresnel = pow(1.0 - abs(dot(viewDirection, vNormal)), 2.0);
        
        // Final color with emission and fresnel
        vec3 finalColor = baseColor * emission + fresnel * baseColor * 0.3;
        
        // Alpha based on thickness and temperature
        float alpha = clamp(thickness * 2.0 + temperature * 0.5, 0.1, 1.0);
        
        // Reduce alpha for very thin or cool lava
        if (isSolid > 0.5) {
          alpha *= 0.7;
        }
        
        gl_FragColor = vec4(finalColor, alpha);
      }
    `
  });
};

// Enhanced terrain shader that shows lava deformation
export const createTerrainShader = (
  terrainTex: THREE.Texture,
  lavaTex: THREE.DataTexture
): THREE.ShaderMaterial => {
  return new THREE.ShaderMaterial({
    uniforms: {
      terrainTex: { value: terrainTex },
      lavaTex: { value: lavaTex },
      lavaInfluence: { value: 0.3 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;
      
      void main() {
        vUv = uv;
        vPosition = position;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;
      
      uniform sampler2D terrainTex;
      uniform sampler2D lavaTex;
      uniform float lavaInfluence;
      
      void main() {
        vec4 terrainColor = texture2D(terrainTex, vUv);
        vec4 lavaData = texture2D(lavaTex, vUv);
        
        float lavaThickness = lavaData.r / 255.0;
        float temperature = lavaData.g / 255.0;
        float isSolid = 1.0 - (lavaData.a / 255.0);
        
        // Base terrain color
        vec3 finalColor = terrainColor.rgb;
        
        // Modify terrain color where lava has affected it
        if (lavaThickness > 0.01) {
          if (isSolid > 0.5) {
            // Solidified lava creates dark volcanic rock
            vec3 volcanicRock = vec3(0.15, 0.1, 0.1);
            finalColor = mix(finalColor, volcanicRock, lavaThickness * lavaInfluence);
          } else {
            // Hot lava creates heat distortion and color change
            vec3 heatedGround = mix(finalColor, vec3(0.4, 0.2, 0.1), temperature * 0.5);
            finalColor = mix(finalColor, heatedGround, lavaInfluence);
          }
        }
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `
  });
};
