import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Custom first-pass: paints the background/vignette backdrop into the composer's target
// WITHOUT clearing what comes after it, so the 3D scene draws on top and only background
// pixels ever show the vignette (mesh, video, and image output all stay unaffected).
class VignetteBackgroundPass extends Pass {
  quad: FullScreenQuad;
  // true: after this pass writes into `writeBuffer`, the composer swaps its read/write
  // pointers so the NEXT pass (RenderPass) reads from the buffer we just painted into —
  // matching RenderPass's own convention of rendering into "readBuffer" when it isn't the
  // final pass. Leaving this false (as it originally was) meant RenderPass drew the model
  // into the *other* ping-pong buffer, one still holding a previous frame's content that
  // was never cleared (RenderPass.clear is intentionally false so it doesn't erase the
  // vignette) — producing a trail of stale frames ("ghosting") once any post-processing
  // pass was enabled, since only the composer path exercises this buffer chain at all.
  needsSwap: boolean = true;
  renderToScreen: boolean = false;
  constructor(material: THREE.Material) {
    super();
    this.quad = new FullScreenQuad(material);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: any) {
    const target = this.renderToScreen ? null : writeBuffer;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);
    this.quad.render(renderer);
  }
  dispose() {
    this.quad.dispose();
  }
}
import { MeshBVH } from 'three-mesh-bvh';
import {
  LoadedPart,
  MaterialKey,
  ModelDimensions,
  ResolutionOption,
  SnapDirection,
  ThemeMode,
  ViewerSettings,
} from '../types';
import { Loader2, UploadCloud, Upload, Cloud, Sparkles, LayoutGrid, X } from 'lucide-react';

export interface ThreeViewportHandle {
  recenterView: () => void;
  snapView: (dir: SnapDirection) => void;
  loadModelFromFile: (file: File) => void;
  loadModelsFromFiles: (files: File[]) => void;
  loadDemoModel: () => void;
  exportTurnaroundImage: (
    resMultiplier: ResolutionOption,
    onComplete: (blob: Blob, fileName: string) => void,
    onProgress: (status: string) => void
  ) => void;
  exportTurntableVideo: (
    format: 'mp4' | 'webm',
    onComplete: (blob: Blob, fileName: string) => void,
    onProgress: (status: string) => void
  ) => Promise<void>;
  updateDimension: (
    field: 'scale' | 'x' | 'y' | 'z' | 'rotX' | 'rotY' | 'rotZ',
    value: number
  ) => void;
  togglePartVisibility: (index: number) => void;
  deletePart: (index: number) => void;
}

export interface VolumeStats {
  volumeCm3: number;
  weightGrams: number;
  estimatedCost: number;
  isWatertight: boolean;
  partCount: number;
}

interface ThreeViewportProps {
  settings: ViewerSettings;
  onUpdateSettings: (partial: Partial<ViewerSettings>) => void;
  dimensions: ModelDimensions;
  onDimensionsChanged: (dims: ModelDimensions) => void;
  isTurntableActive: boolean;
  theme: ThemeMode;
  onModelLoaded: (fileName: string) => void;
  onOpenLocalUpload: () => void;
  onOpenDriveModal?: () => void;
  onVolumeComputed?: (stats: VolumeStats | null) => void;
  onPartsChanged?: (parts: LoadedPart[]) => void;
}

export const ThreeViewport = forwardRef<ThreeViewportHandle, ThreeViewportProps>(
  (
    {
      settings,
      onUpdateSettings,
      dimensions,
      onDimensionsChanged,
      isTurntableActive,
      theme,
      onModelLoaded,
      onOpenLocalUpload,
      onOpenDriveModal,
      onVolumeComputed,
      onPartsChanged,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('Loading Model...');
    const [isDragOver, setIsDragOver] = useState(false);
    const [isGridPanelOpen, setIsGridPanelOpen] = useState(false);
    const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
    const [thicknessProgress, setThicknessProgress] = useState<number | null>(null);
    const thicknessCalculatingRef = useRef<boolean>(false);

    // Three.js internal instances
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraPerspRef = useRef<THREE.PerspectiveCamera | null>(null);
    const cameraOrthoRef = useRef<THREE.OrthographicCamera | null>(null);
    const activeCameraRef = useRef<THREE.Camera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const viewHelperRef = useRef<ViewHelper | null>(null);

    const currentModelRef = useRef<THREE.Object3D | null>(null);
    const gridHelperRef = useRef<THREE.Group | null>(null);

    // Lights
    const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
    const dirLight1Ref = useRef<THREE.DirectionalLight | null>(null);
    const dirLight2Ref = useRef<THREE.DirectionalLight | null>(null);

    // Vignette Backdrop Material (rendered BEHIND the model, background-only, via
    // VignetteBackgroundPass in the composer chain — see renderFrame)
    const vignetteMaterialRef = useRef<THREE.ShaderMaterial | null>(null);

    // Post-processing
    const composerRef = useRef<EffectComposer | null>(null);
    const renderPassRef = useRef<RenderPass | null>(null);
    const aoPassRef = useRef<GTAOPass | null>(null);
    const fxaaPassRef = useRef<ShaderPass | null>(null);
    const smaaPassRef = useRef<SMAAPass | null>(null);

    // Environments (procedural PMREM presets — no external HDR files needed)
    const envTexturesRef = useRef<Partial<Record<string, THREE.Texture>>>({});

    // Batch-loaded parts (for exploded view)
    const batchPartsRef = useRef<{ object: THREE.Object3D; localCenter: THREE.Vector3 }[]>([]);
    const batchGroupCenterRef = useRef<THREE.Vector3>(new THREE.Vector3());

    // Clipping plane objects (reused, mutated in place)
    const clipPlaneXRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));
    const clipPlaneYRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    const clipPlaneZRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    // Which of the three planes are currently active, and the array handed to materials.
    // The active *count* is baked into each material's compiled shader (NUM_CLIPPING_PLANES),
    // so we only need to force a recompile when a plane is added/removed, not when an
    // already-enabled plane's offset/flip is dragged (that's a plain uniform update).
    const activeClipPlanesRef = useRef<THREE.Plane[]>([]);
    const clipSignatureRef = useRef<string>('');

    // Matcap texture (procedurally generated zebra-stripe matcap)
    const matcapZebraTextureRef = useRef<THREE.Texture | null>(null);

    // Volume/weight stats
    const [volumeStats, setVolumeStats] = useState<VolumeStats | null>(null);

    // Thickness Checker Shader Material
    const thicknessMaterialRef = useRef<THREE.ShaderMaterial>(
      new THREE.ShaderMaterial({
        uniforms: {
          uMinThickness: { value: 0.08 },
          uScaleFactor: { value: 1.0 },
          uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.8).normalize() },
          uThinColor: { value: new THREE.Color(0xef4444) },
          uSafeColor: { value: new THREE.Color(0x71717a) },
          uIsReady: { value: 0.0 },
        },
        vertexShader: `
          attribute float wallThickness;
          varying float vThickness;
          varying vec3 vNormal;
          varying vec3 vViewPosition;

          void main() {
            vThickness = wallThickness;
            vNormal = normalize(normalMatrix * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewPosition = -mvPosition.xyz;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uMinThickness;
          uniform float uScaleFactor;
          uniform vec3 uLightDir;
          uniform vec3 uThinColor;
          uniform vec3 uSafeColor;
          uniform float uIsReady;

          varying float vThickness;
          varying vec3 vNormal;
          varying vec3 vViewPosition;

          void main() {
            float currentThickness = vThickness * uScaleFactor;
            vec3 norm = normalize(vNormal);
            if (!gl_FrontFacing) norm = -norm;

            float diff = max(dot(norm, uLightDir), 0.0);
            float hemi = (norm.y * 0.5 + 0.5) * 0.4 + 0.35;
            vec3 viewDir = normalize(vViewPosition);
            float rim = 1.0 - max(dot(norm, viewDir), 0.0);
            rim = pow(clamp(rim, 0.0, 1.0), 3.0) * 0.25;

            float lighting = clamp(hemi + diff * 0.45 + rim, 0.2, 1.0);

            vec3 col;
            if (uIsReady > 0.5 && currentThickness < uMinThickness && currentThickness > 0.00001) {
              col = uThinColor;
            } else {
              col = uSafeColor;
            }

            gl_FragColor = vec4(col * lighting, 1.0);
          }
        `,
        side: THREE.DoubleSide,
      })
    );

    // Cel-shaded (sketch) tri-tone material: hard bands between a shadow, midtone, and
    // highlight color based on N·L, rather than MeshToonMaterial's single-hue gradient map.
    const sketchMaterialRef = useRef<THREE.ShaderMaterial>(
      new THREE.ShaderMaterial({
        uniforms: {
          uBaseColor: { value: new THREE.Color(0x94a3b8) },
          uHighlightColor: { value: new THREE.Color(0xe2e8f0) },
          uShadowColor: { value: new THREE.Color(0x334155) },
          uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.8).normalize() },
        },
        vertexShader: `
          varying vec3 vNormal;

          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uBaseColor;
          uniform vec3 uHighlightColor;
          uniform vec3 uShadowColor;
          uniform vec3 uLightDir;
          varying vec3 vNormal;

          void main() {
            vec3 norm = normalize(vNormal);
            if (!gl_FrontFacing) norm = -norm;
            float ndl = dot(norm, uLightDir);

            vec3 col = mix(uShadowColor, uBaseColor, step(-0.15, ndl));
            col = mix(col, uHighlightColor, step(0.35, ndl));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.FrontSide,
      })
    );

    // Volume / watertightness (unscaled — multiplied by scaleFactor^3 on demand)
    const unscaledVolumeCm3Ref = useRef<number>(0);
    const isWatertightRef = useRef<boolean>(true);

    // Bounds & Calculations
    const unscaledModelSizeRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));
    const unscaledCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
    const modelRadiusRef = useRef<number>(1);
    const needsRenderRef = useRef<boolean>(true);

    const isExportingRef = useRef<boolean>(false);
    const isTurntableActiveRef = useRef<boolean>(isTurntableActive);
    isTurntableActiveRef.current = isTurntableActive;

    const settingsRef = useRef<ViewerSettings>(settings);
    settingsRef.current = settings;

    const dimensionsRef = useRef<ModelDimensions>(dimensions);
    dimensionsRef.current = dimensions;

    const requestRender = () => {
      needsRenderRef.current = true;
    };

    const getConversionToInches = () => 1 / 25.4;

    // Safe lookup into materialsMap for any MaterialKey, including the two keys
    // ('original' / 'thickness') that aren't stored in the map — falls back to grey.
    const getLookdevMaterial = (key: MaterialKey): THREE.Material => {
      if (key === 'original' || key === 'thickness') return materialsMap.current.grey;
      return materialsMap.current[key] || materialsMap.current.grey;
    };

    // Procedurally generate a zebra-stripe matcap sphere texture (no external asset needed)
    const generateZebraMatcap = (): THREE.Texture => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.createImageData(size, size);
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;
          const dx = (x - cx) / r;
          const dy = (y - cy) / r;
          const distSq = dx * dx + dy * dy;
          if (distSq > 1) {
            imgData.data[idx + 3] = 0;
            continue;
          }
          const dz = Math.sqrt(1 - distSq);
          // Fake normal-based lighting
          const lightDir = { x: 0.4, y: 0.6, z: 0.7 };
          const len = Math.hypot(lightDir.x, lightDir.y, lightDir.z);
          const diff = Math.max(0, dx * (lightDir.x / len) + dy * (lightDir.y / len) + dz * (lightDir.z / len));
          const rim = 1 - dz;

          // Zebra stripes based on latitude bands (angle from up axis)
          const angle = Math.atan2(dy, dx);
          const band = Math.sin(angle * 10 + dz * 6) > 0 ? 1 : 0;

          const base = 40 + diff * 180 + rim * 15;
          const stripe = band === 1 ? base * 0.15 : base;

          imgData.data[idx] = Math.min(255, stripe);
          imgData.data[idx + 1] = Math.min(255, stripe);
          imgData.data[idx + 2] = Math.min(255, stripe);
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    // Materials map — LookDev presets. Gold/Chrome/Red Clay/Pearl used to each be their own
    // fixed MeshStandardMaterial/MeshPhysicalMaterial preset; they're all just points on the
    // same color/roughness/metalness space, so they've been consolidated into one "Custom"
    // material the user dials in themselves instead.
    const materialsMap = useRef<{
      grey: THREE.MeshStandardMaterial;
      custom: THREE.MeshStandardMaterial;
      normal: THREE.MeshNormalMaterial;
      wireframe: THREE.MeshBasicMaterial;
      sketch: THREE.ShaderMaterial;
      matcapZebra: THREE.MeshMatcapMaterial;
    }>({
      grey: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.1 }),
      custom: new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95, metalness: 0.0 }),
      normal: new THREE.MeshNormalMaterial({ flatShading: false }),
      wireframe: new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true }),
      sketch: sketchMaterialRef.current,
      matcapZebra: new THREE.MeshMatcapMaterial({ color: 0xffffff }),
    });

    // Cleanup current 3D object to prevent memory leaks
    const cleanupScene = () => {
      thicknessCalculatingRef.current = false;
      setThicknessProgress(null);
      batchPartsRef.current = [];
      batchGroupCenterRef.current.set(0, 0, 0);
      if (thicknessMaterialRef.current) {
        thicknessMaterialRef.current.uniforms.uIsReady.value = 0.0;
      }

      if (currentModelRef.current && sceneRef.current) {
        sceneRef.current.remove(currentModelRef.current);
        currentModelRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.userData.originalMaterial) {
              if (Array.isArray(mesh.userData.originalMaterial)) {
                mesh.userData.originalMaterial.forEach((m: THREE.Material) => m.dispose());
              } else {
                (mesh.userData.originalMaterial as THREE.Material).dispose();
              }
            }
          }
        });
        currentModelRef.current = null;
      }
    };

    const recalculateBounds = () => {
      if (!currentModelRef.current) return;
      const box = new THREE.Box3().setFromObject(currentModelRef.current);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      modelRadiusRef.current = sphere.radius || 1;
    };

    const updateLights = (cam: THREE.Camera) => {
      if (!dirLight1Ref.current || !dirLight2Ref.current || !controlsRef.current) return;
      const isLocked = settingsRef.current.lockLightsToCamera;
      cam.updateMatrixWorld(true);
      const rad = modelRadiusRef.current || 1;

      if (thicknessMaterialRef.current || sketchMaterialRef.current) {
        const lightCamDir = new THREE.Vector3(0.5, 1.0, 0.8).normalize();
        if (isLocked) {
          lightCamDir.applyQuaternion(cam.quaternion);
        }
        thicknessMaterialRef.current?.uniforms.uLightDir.value.copy(lightCamDir);
        sketchMaterialRef.current?.uniforms.uLightDir.value.copy(lightCamDir);
      }

      if (isLocked) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);

        const target = controlsRef.current.target;
        const keyPos = target
          .clone()
          .addScaledVector(forward, -rad * 3.5)
          .addScaledVector(right, rad * 2.0)
          .addScaledVector(up, rad * 2.5);
        const fillPos = target
          .clone()
          .addScaledVector(forward, -rad * 3.5)
          .addScaledVector(right, -rad * 2.0)
          .addScaledVector(up, -rad * 1.5);

        dirLight1Ref.current.position.copy(keyPos);
        dirLight2Ref.current.position.copy(fillPos);
        dirLight1Ref.current.target.position.copy(target);
        dirLight2Ref.current.target.position.copy(target);
      } else {
        dirLight1Ref.current.position.set(rad * 3.0, rad * 5.0, rad * 4.0);
        dirLight2Ref.current.position.set(-rad * 3.0, -rad * 3.0, -rad * 3.0);
        dirLight1Ref.current.target.position.set(0, 0, 0);
        dirLight2Ref.current.target.position.set(0, 0, 0);
      }

      // Fit the shadow frustum tightly to the model so self-shadows have usable resolution
      // instead of spreading the shadow map over empty space (main cause of washed-out/acne shadows).
      const shadowDist = rad * 1.15;
      const shadowCam = dirLight1Ref.current.shadow.camera;
      shadowCam.left = -shadowDist;
      shadowCam.right = shadowDist;
      shadowCam.top = shadowDist;
      shadowCam.bottom = -shadowDist;
      shadowCam.near = Math.max(rad * 0.05, 0.01);
      shadowCam.far = rad * 6;
      shadowCam.updateProjectionMatrix();

      dirLight1Ref.current.target.updateMatrixWorld();
      dirLight2Ref.current.target.updateMatrixWorld();
    };

    // Apply shadow quality settings (softness/darkness/resolution) — self-shadowing only, no ground plane
    const applyShadowSettings = () => {
      if (!dirLight1Ref.current || !rendererRef.current) return;
      const { shadowSoftness, shadowDarkness, shadowMapResolution } = settingsRef.current;
      const light = dirLight1Ref.current;
      const softness = Math.max(0, Math.min(100, shadowSoftness)) / 100;
      const darkness = Math.max(0, Math.min(100, shadowDarkness)) / 100;

      // Softer shadows need a larger PCF radius and a bit more normalBias to avoid light leaking
      light.shadow.radius = 1 + softness * 12;
      light.shadow.blurSamples = 16;
      light.shadow.bias = -0.0003 - softness * 0.0002;
      light.shadow.normalBias = 0.01 + softness * 0.03;
      (light.shadow as any).intensity = darkness;

      if (light.shadow.mapSize.width !== shadowMapResolution) {
        light.shadow.mapSize.set(shadowMapResolution, shadowMapResolution);
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null as any;
        }
      }
    };

    // Procedural environment presets (PMREM-generated, no external .hdr/.exr files required)
    const buildEnvironmentScene = (preset: string): THREE.Scene => {
      const envScene = new THREE.Scene();
      if (preset === 'outdoor') {
        envScene.background = new THREE.Color(0x8fb8e8);
        const sky = new THREE.Mesh(
          new THREE.SphereGeometry(50, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0x8fb8e8, side: THREE.BackSide })
        );
        envScene.add(sky);
        const ground = new THREE.Mesh(
          new THREE.CircleGeometry(50, 32),
          new THREE.MeshBasicMaterial({ color: 0x6b7d5c })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -8;
        envScene.add(ground);
        const sun = new THREE.PointLight(0xfff4e0, 30, 100);
        sun.position.set(15, 20, 10);
        envScene.add(sun);
      } else if (preset === 'interior') {
        envScene.background = new THREE.Color(0x2a231c);
        const warmLight1 = new THREE.PointLight(0xffcf9e, 20, 60);
        warmLight1.position.set(8, 10, 8);
        envScene.add(warmLight1);
        const warmLight2 = new THREE.PointLight(0xffe4c0, 10, 60);
        warmLight2.position.set(-8, 4, -6);
        envScene.add(warmLight2);
        const floor = new THREE.Mesh(
          new THREE.CircleGeometry(40, 32),
          new THREE.MeshBasicMaterial({ color: 0x4a3c2e })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -8;
        envScene.add(floor);
      } else if (preset === 'sunset') {
        envScene.background = new THREE.Color(0xff8a4c);
        const sky = new THREE.Mesh(
          new THREE.SphereGeometry(50, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xff8a4c, side: THREE.BackSide })
        );
        envScene.add(sky);
        const sun = new THREE.PointLight(0xffb066, 35, 100);
        sun.position.set(-20, 6, -15);
        envScene.add(sun);
        const fill = new THREE.PointLight(0x7a4a8f, 8, 60);
        fill.position.set(10, 8, 10);
        envScene.add(fill);
      } else {
        // Studio (default) — reuse Three's neutral RoomEnvironment
        return new RoomEnvironment() as unknown as THREE.Scene;
      }
      return envScene;
    };

    const applyEnvironment = () => {
      if (!sceneRef.current || !rendererRef.current) return;
      const preset = settingsRef.current.environmentPreset || 'studio';
      let tex = envTexturesRef.current[preset];
      if (!tex) {
        const pmrem = new THREE.PMREMGenerator(rendererRef.current);
        const envScene = buildEnvironmentScene(preset);
        tex = pmrem.fromScene(envScene as THREE.Scene, 0.04).texture;
        pmrem.dispose();
        envTexturesRef.current[preset] = tex;
      }
      sceneRef.current.environment = tex;
    };

    // Keep post-processing passes (SSAO, FXAA/SMAA) in sync with settings
    const syncPostProcessing = () => {
      const { ssaoEnabled, ssaoRadius, ssaoIntensity, ssaoBias, antialiasMode } = settingsRef.current;

      if (aoPassRef.current) {
        aoPassRef.current.enabled = ssaoEnabled;

        // GTAO's radius is a raw scene-unit distance, not normalized to the model at all — a
        // fixed number here means the exact same setting looks like fine detail on a model
        // imported in millimeters and one big blurry blob on the same model imported in meters.
        // Scaling it to the model's own bounding radius keeps the slider meaning the same
        // ("% of the object") regardless of the file's native unit scale.
        const modelRadius = modelRadiusRef.current || 1;
        const radiusFrac = Math.max(1, ssaoRadius) / 100;

        // thickness is how far behind a surface a sample can be and still count as an occluder —
        // too thin and fine crevices stop registering, too thick and distant surfaces start
        // occluding things they shouldn't.
        const biasFrac = Math.max(0, Math.min(100, ssaoBias)) / 100;
        const thickness = 0.15 + biasFrac * 1.5;

        // GTAO's raw occlusion values sit close to white (1.0) everywhere except right at real
        // creases — physically correct, but a plain linear blend barely darkens anything (0.7
        // blended at intensity 1 is still a pale 0.7, easy to mistake for "no depth"). `scale`
        // is a pow() contrast exponent applied to the raw value: pow(1.0, n) stays 1.0 no matter
        // what, so flat/open surfaces are untouched, while already-occluded crease values (< 1)
        // get pushed dramatically darker — deepening exactly the cracks, not painting a haze
        // over the whole mesh. blendIntensity is left at 1 (apply the computed result as-is).
        const scale = 0.5 + (Math.max(0, ssaoIntensity) / 100) * 3.5;
        aoPassRef.current.updateGtaoMaterial({
          radius: modelRadius * radiusFrac * 0.5,
          thickness,
          scale,
        });
        aoPassRef.current.blendIntensity = 1.0;
      }

      if (fxaaPassRef.current && containerRef.current && rendererRef.current) {
        fxaaPassRef.current.enabled = antialiasMode === 'fxaa';
        const pixelRatio = rendererRef.current.getPixelRatio();
        fxaaPassRef.current.material.uniforms['resolution'].value.set(
          1 / (containerRef.current.clientWidth * pixelRatio),
          1 / (containerRef.current.clientHeight * pixelRatio)
        );
      }

      if (smaaPassRef.current) {
        smaaPassRef.current.enabled = antialiasMode === 'smaa';
      }
    };

    // Shared frame renderer — used by the live view AND the turntable video exporter so both
    // paths treat the background/vignette backdrop and post-processing identically.
    //
    // Always renders through the EffectComposer, even when SSAO and AA are both off (disabled
    // passes are free — the composer skips them entirely). This used to be an either/or: go
    // through the composer, or render the scene directly with the vignette backdrop drawn as a
    // separate pre-pass. The direct path never ran the final OutputPass, which is what converts
    // the linear-space color math in the vignette shader back to the display's sRGB encoding —
    // so with SSAO and AA both off, the background rendered dark/uncorrected while the model
    // itself (drawn with standard materials that self-encode) looked fine. One always-composer
    // path means OutputPass always runs exactly once, for both the background and the model.
    const renderFrame = (cam: THREE.Camera, withViewHelper: boolean) => {
      const renderer = rendererRef.current;
      const composer = composerRef.current;
      if (!renderer || !composer || !renderPassRef.current) return;

      if (renderPassRef.current.camera !== cam) renderPassRef.current.camera = cam as any;
      if (aoPassRef.current && aoPassRef.current.camera !== cam) {
        aoPassRef.current.camera = cam;
      }
      composer.render();

      if (withViewHelper) {
        renderer.clearDepth();
        if (viewHelperRef.current) viewHelperRef.current.render(renderer);
      }
    };

    const updateOrthoFrustum = () => {
      if (!containerRef.current || !cameraOrthoRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      const aspect = w / h;
      recalculateBounds();
      const baseSize = currentModelRef.current ? modelRadiusRef.current * 1.03 : 5;
      if (aspect >= 1) {
        cameraOrthoRef.current.top = baseSize;
        cameraOrthoRef.current.bottom = -baseSize;
        cameraOrthoRef.current.left = -baseSize * aspect;
        cameraOrthoRef.current.right = baseSize * aspect;
      } else {
        cameraOrthoRef.current.top = baseSize / aspect;
        cameraOrthoRef.current.bottom = -baseSize / aspect;
        cameraOrthoRef.current.left = -baseSize;
        cameraOrthoRef.current.right = baseSize;
      }
      cameraOrthoRef.current.updateProjectionMatrix();
    };

    // Build one square of grid line segments in the XZ plane (y=0 locally)
    const buildGridLineSegments = (
      halfExtent: number,
      spacing: number,
      color: number,
      opacity: number
    ): THREE.LineSegments => {
      const positions: number[] = [];
      const start = -Math.ceil(halfExtent / spacing) * spacing;
      for (let x = start; x <= halfExtent + 1e-6; x += spacing) {
        positions.push(x, 0, -halfExtent, x, 0, halfExtent);
      }
      for (let z = start; z <= halfExtent + 1e-6; z += spacing) {
        positions.push(-halfExtent, 0, z, halfExtent, 0, z);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: false,
      });
      return new THREE.LineSegments(geom, mat);
    };

    const disposeGridGroup = (group: THREE.Group) => {
      group.traverse((obj) => {
        const line = obj as THREE.LineSegments;
        if (line.isLineSegments) {
          line.geometry.dispose();
          const mat = line.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    };

    // World/model-aligned ground grid — bottom of the mesh, centered L/R and F/B. Unlike the
    // old camera-facing "card" grid, this never needs to be rebuilt when the camera orbits or
    // during a turntable spin, which is what caused the old grid-jump bug.
    const updateGrid = () => {
      if (!sceneRef.current) return;
      if (gridHelperRef.current) {
        sceneRef.current.remove(gridHelperRef.current);
        disposeGridGroup(gridHelperRef.current);
        gridHelperRef.current = null;
      }

      const showGrid = settingsRef.current.showGrid;
      if (!showGrid || !currentModelRef.current) {
        requestRender();
        return;
      }

      const minorInches = settingsRef.current.gridSquareSizeInches || 0.125;
      const majorInches = settingsRef.current.gridMajorEveryInches || 1;
      const unitsPerInch = 1 / getConversionToInches();
      const minorSpacing = Math.max(minorInches * unitsPerInch, 0.001);
      const majorSpacing = Math.max(majorInches * unitsPerInch, minorSpacing);

      const box = new THREE.Box3().setFromObject(currentModelRef.current);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      const halfExtent = Math.max(size.x, size.z, minorSpacing * 8) * 1.6;

      const group = new THREE.Group();
      group.add(buildGridLineSegments(halfExtent, minorSpacing, 0x334155, 0.55));
      if (majorSpacing > minorSpacing * 1.5) {
        group.add(buildGridLineSegments(halfExtent, majorSpacing, 0x38bdf8, 0.85));
      }

      // Primary X/Z axis lines through the model's center, in blue, drawn brightest
      const axisGeom = new THREE.BufferGeometry();
      axisGeom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [-halfExtent, 0, 0, halfExtent, 0, 0, 0, 0, -halfExtent, 0, 0, halfExtent],
          3
        )
      );
      const axisMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: false });
      group.add(new THREE.LineSegments(axisGeom, axisMat));

      // Align to the bottom of the mesh, centered on X (L/R) and Z (F/B)
      const liftOffset = Math.max(size.length() * 0.002, 0.01);
      group.position.set(center.x, box.min.y - liftOffset, center.z);

      gridHelperRef.current = group;
      sceneRef.current.add(group);
      requestRender();
    };

    // Cheap, high-frequency-safe: mutates the three clip planes in place from current settings
    // and only reassigns materials (+ forces a shader recompile) when a plane is actually
    // added or removed, never when an already-enabled plane's offset/flip is being dragged.
    // A clip plane only cuts the *outward-facing* surface away; without also drawing backfaces,
    // the hollow interior it exposes has nothing rendered on it (backface culling removes the
    // triangles you'd now be looking at from inside), so the cut looks like it's showing through
    // to nothing. Flip to DoubleSide (with the original side value remembered for restore) only
    // while at least one clip plane is enabled.
    const applyClipSideToMaterial = (mat: THREE.Material, clippingActive: boolean) => {
      if (clippingActive) {
        if (mat.userData.__preClipSide === undefined) {
          mat.userData.__preClipSide = mat.side;
        }
        mat.side = THREE.DoubleSide;
      } else if (mat.userData.__preClipSide !== undefined) {
        mat.side = mat.userData.__preClipSide;
        delete mat.userData.__preClipSide;
      }
    };

    const updateClippingPlanes = () => {
      const { clipping } = settingsRef.current;
      const inchesToUnits = 1 / getConversionToInches();
      const activeClipPlanes: THREE.Plane[] = [];
      if (clipping.x.enabled) {
        clipPlaneXRef.current.normal.set(clipping.x.flip ? -1 : 1, 0, 0);
        clipPlaneXRef.current.constant = -clipping.x.offsetInches * inchesToUnits * (clipping.x.flip ? -1 : 1);
        activeClipPlanes.push(clipPlaneXRef.current);
      }
      if (clipping.y.enabled) {
        clipPlaneYRef.current.normal.set(0, clipping.y.flip ? -1 : 1, 0);
        clipPlaneYRef.current.constant = -clipping.y.offsetInches * inchesToUnits * (clipping.y.flip ? -1 : 1);
        activeClipPlanes.push(clipPlaneYRef.current);
      }
      if (clipping.z.enabled) {
        clipPlaneZRef.current.normal.set(0, 0, clipping.z.flip ? -1 : 1);
        clipPlaneZRef.current.constant = -clipping.z.offsetInches * inchesToUnits * (clipping.z.flip ? -1 : 1);
        activeClipPlanes.push(clipPlaneZRef.current);
      }

      activeClipPlanesRef.current = activeClipPlanes;
      const nextClippingPlanes = activeClipPlanes.length > 0 ? activeClipPlanes : null;
      const signature = `${clipping.x.enabled ? 1 : 0}${clipping.y.enabled ? 1 : 0}${clipping.z.enabled ? 1 : 0}`;
      const countChanged = signature !== clipSignatureRef.current;
      clipSignatureRef.current = signature;

      // GTAOPass computes ambient occlusion from its own override material (a plain
      // MeshNormalMaterial swapped in for every mesh via scene.overrideMaterial), which never
      // saw our per-mesh clippingPlanes assignment below — so without this, AO "sees" and
      // shades the geometry that clipping is supposed to have cut away, showing up as a ghosted
      // blob of occlusion/shadow hanging past the visible cut surface.
      if (aoPassRef.current) {
        aoPassRef.current.normalMaterial.clippingPlanes = nextClippingPlanes;
      }

      if (countChanged && currentModelRef.current) {
        const clippingActive = activeClipPlanes.length > 0;
        currentModelRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
            mats.forEach((m) => {
              m.clippingPlanes = nextClippingPlanes;
              applyClipSideToMaterial(m, clippingActive);
              m.needsUpdate = true;
            });
          }
        });
      }
      requestRender();
    };

    const applyMaterialAndShadows = () => {
      if (!currentModelRef.current) return;
      const {
        material: matKey,
        castShadows,
        minThicknessInches,
        opacityPercent,
        wireframeColorHex,
        customColorHex,
        customRoughnessPercent,
        customMetalnessPercent,
        sketchColorHex,
        sketchHighlightColorHex,
        sketchShadowColorHex,
      } = settingsRef.current;

      if (dirLight1Ref.current) dirLight1Ref.current.castShadow = castShadows;

      if (thicknessMaterialRef.current) {
        thicknessMaterialRef.current.uniforms.uMinThickness.value = minThicknessInches;
        thicknessMaterialRef.current.uniforms.uScaleFactor.value = dimensionsRef.current.scaleFactor;
      }

      // Keep lookdev preset styling in sync with their controls
      materialsMap.current.wireframe.color.set(wireframeColorHex);
      materialsMap.current.custom.color.set(customColorHex);
      materialsMap.current.custom.roughness = Math.max(0, Math.min(100, customRoughnessPercent)) / 100;
      materialsMap.current.custom.metalness = Math.max(0, Math.min(100, customMetalnessPercent)) / 100;
      sketchMaterialRef.current.uniforms.uBaseColor.value.set(sketchColorHex);
      sketchMaterialRef.current.uniforms.uHighlightColor.value.set(sketchHighlightColorHex);
      sketchMaterialRef.current.uniforms.uShadowColor.value.set(sketchShadowColorHex);
      if (!matcapZebraTextureRef.current) {
        matcapZebraTextureRef.current = generateZebraMatcap();
        materialsMap.current.matcapZebra.matcap = matcapZebraTextureRef.current;
      }

      // Make sure clip plane values/array are current before reading activeClipPlanesRef below
      // (cheap — no-op traversal unless the enabled-plane count actually changed).
      updateClippingPlanes();
      const activeClipPlanes = activeClipPlanesRef.current;

      const opacity = Math.max(0, Math.min(1, opacityPercent / 100));
      const isGhost = opacity < 0.999;
      const clippingActive = activeClipPlanes.length > 0;

      currentModelRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (matKey === 'original') {
            if (mesh.userData.originalMaterial) mesh.material = mesh.userData.originalMaterial;
          } else if (matKey === 'thickness') {
            mesh.material = thicknessMaterialRef.current;
            if (!mesh.geometry?.attributes?.wallThickness && currentModelRef.current) {
              computeModelThickness(currentModelRef.current);
            }
          } else {
            mesh.material = materialsMap.current[matKey];
          }
          mesh.castShadow = castShadows;
          mesh.receiveShadow = castShadows;

          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              const mat = m as THREE.Material;
              const nextClippingPlanes = activeClipPlanes.length > 0 ? activeClipPlanes : null;
              const clipPlanesChanged = mat.clippingPlanes !== nextClippingPlanes;
              mat.clippingPlanes = nextClippingPlanes;
              mat.clipShadows = true;
              applyClipSideToMaterial(mat, clippingActive);

              const wasTransparent = mat.transparent;
              if (isGhost) {
                if (mat.userData.__preGhostOpacity === undefined) {
                  mat.userData.__preGhostOpacity = mat.opacity;
                  mat.userData.__preGhostTransparent = mat.transparent;
                }
                mat.transparent = true;
                mat.opacity = opacity;
                mat.depthWrite = false;
              } else if (mat.userData.__preGhostOpacity !== undefined) {
                mat.opacity = mat.userData.__preGhostOpacity;
                mat.transparent = mat.userData.__preGhostTransparent;
                mat.depthWrite = true;
                delete mat.userData.__preGhostOpacity;
                delete mat.userData.__preGhostTransparent;
              }

              // needsUpdate triggers a full shader recompile — only do it when something baked
              // into the compiled program actually changed. Plain opacity drags (already in
              // ghost mode) must never hit this, or every slider tick stalls on a GPU recompile.
              if (mat.transparent !== wasTransparent || clipPlanesChanged) {
                mat.needsUpdate = true;
              }
            });
          }
        }
      });
      requestRender();
    };

    const applyModelTransform = (dims: ModelDimensions) => {
      if (!currentModelRef.current) return;
      const { scaleFactor, rotX, rotY, rotZ } = dims;

      if (thicknessMaterialRef.current) {
        thicknessMaterialRef.current.uniforms.uScaleFactor.value = scaleFactor;
      }

      currentModelRef.current.scale.set(scaleFactor, scaleFactor, scaleFactor);
      currentModelRef.current.rotation.x = THREE.MathUtils.degToRad(rotX);
      currentModelRef.current.rotation.y = THREE.MathUtils.degToRad(rotY);
      currentModelRef.current.rotation.z = THREE.MathUtils.degToRad(rotZ);

      const offset = unscaledCenterRef.current
        .clone()
        .applyEuler(currentModelRef.current.rotation)
        .multiplyScalar(-scaleFactor);
      currentModelRef.current.position.copy(offset);
      currentModelRef.current.updateMatrixWorld(true);

      recalculateBounds();
      requestRender();
    };

    const updateDimension = (
      field: 'scale' | 'x' | 'y' | 'z' | 'rotX' | 'rotY' | 'rotZ',
      value: number
    ) => {
      if (!currentModelRef.current) return;

      const scaleInches = getConversionToInches();
      const baseW = unscaledModelSizeRef.current.x * scaleInches;
      const baseH = unscaledModelSizeRef.current.y * scaleInches;
      const baseD = unscaledModelSizeRef.current.z * scaleInches;

      if (['scale', 'x', 'y', 'z'].includes(field)) {
        if (value <= 0 || isNaN(value)) return;

        let newScale = 1.0;
        if (field === 'scale') {
          newScale = value;
        } else if (field === 'x') {
          if (baseW > 0) newScale = value / baseW;
        } else if (field === 'y') {
          if (baseH > 0) newScale = value / baseH;
        } else if (field === 'z') {
          if (baseD > 0) newScale = value / baseD;
        }

        if (newScale <= 0 || isNaN(newScale)) return;

        const updatedDims: ModelDimensions = {
          ...dimensionsRef.current,
          scaleFactor: parseFloat(newScale.toFixed(4)),
          widthInches: parseFloat((baseW * newScale).toFixed(3)),
          heightInches: parseFloat((baseH * newScale).toFixed(3)),
          depthInches: parseFloat((baseD * newScale).toFixed(3)),
          baseWidthInches: baseW,
          baseHeightInches: baseH,
          baseDepthInches: baseD,
        };

        dimensionsRef.current = updatedDims;
        onDimensionsChanged(updatedDims);

        // Aspect-locked uniform scale on the entire mesh (no stretching or skewing)
        currentModelRef.current.scale.set(newScale, newScale, newScale);
        currentModelRef.current.rotation.x = THREE.MathUtils.degToRad(updatedDims.rotX);
        currentModelRef.current.rotation.y = THREE.MathUtils.degToRad(updatedDims.rotY);
        currentModelRef.current.rotation.z = THREE.MathUtils.degToRad(updatedDims.rotZ);

        const offset = unscaledCenterRef.current
          .clone()
          .applyEuler(currentModelRef.current.rotation)
          .multiplyScalar(-newScale);
        currentModelRef.current.position.copy(offset);
        currentModelRef.current.updateMatrixWorld(true);

        recalculateBounds();
        recenterView();
        updateGrid();
        if (thicknessMaterialRef.current) {
          thicknessMaterialRef.current.uniforms.uScaleFactor.value = newScale;
        }
        requestRender();
      } else {
        // Rotations: rotX, rotY, rotZ
        const rotVal = isNaN(value) ? 0 : value;
        const updatedDims: ModelDimensions = {
          ...dimensionsRef.current,
          [field]: rotVal,
        };

        dimensionsRef.current = updatedDims;
        onDimensionsChanged(updatedDims);

        const scale = updatedDims.scaleFactor;
        currentModelRef.current.scale.set(scale, scale, scale);
        currentModelRef.current.rotation.x = THREE.MathUtils.degToRad(updatedDims.rotX);
        currentModelRef.current.rotation.y = THREE.MathUtils.degToRad(updatedDims.rotY);
        currentModelRef.current.rotation.z = THREE.MathUtils.degToRad(updatedDims.rotZ);

        const offset = unscaledCenterRef.current
          .clone()
          .applyEuler(currentModelRef.current.rotation)
          .multiplyScalar(-scale);
        currentModelRef.current.position.copy(offset);
        currentModelRef.current.updateMatrixWorld(true);

        recalculateBounds();
        recenterView();
        updateGrid();
        requestRender();
      }
    };

    const recenterView = () => {
      if (!currentModelRef.current || !activeCameraRef.current || !controlsRef.current) return;
      recalculateBounds();
      const cam = activeCameraRef.current;
      const dir = new THREE.Vector3().subVectors(cam.position, controlsRef.current.target).normalize();
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);

      controlsRef.current.target.set(0, 0, 0);
      cam.position.copy(dir.multiplyScalar(modelRadiusRef.current * 3.0));
      cam.lookAt(0, 0, 0);

      if (cameraOrthoRef.current) {
        cameraOrthoRef.current.zoom = 1;
      }

      if (settingsRef.current.isOrtho) {
        updateOrthoFrustum();
      } else if (cameraPerspRef.current) {
        cameraPerspRef.current.near = modelRadiusRef.current / 1000;
        cameraPerspRef.current.far = modelRadiusRef.current * 100;
        cameraPerspRef.current.updateProjectionMatrix();
      }

      controlsRef.current.update();
      updateGrid();
      updateLights(cam);
      // SSAO's kernel radius is derived from modelRadiusRef (see syncPostProcessing) so it stays
      // proportional to the model instead of being a fixed, scale-dependent number — re-sync
      // whenever the model's bounds (and therefore its radius) may have just changed.
      syncPostProcessing();
      requestRender();
    };

    const snapView = (dir: SnapDirection) => {
      if (!currentModelRef.current || !activeCameraRef.current || !controlsRef.current) return;
      recalculateBounds();
      const dist = modelRadiusRef.current * 3.0;
      const cam = activeCameraRef.current;
      controlsRef.current.target.set(0, 0, 0);

      switch (dir) {
        case 'front':
          cam.position.set(0, 0, dist);
          break;
        case 'back':
          cam.position.set(0, 0, -dist);
          break;
        case 'left':
          cam.position.set(dist, 0, 0);
          break;
        case 'right':
          cam.position.set(-dist, 0, 0);
          break;
        case 'top':
          cam.position.set(0, dist, 0.0001);
          break;
        case 'bottom':
          cam.position.set(0, -dist, 0.0001);
          break;
        case 'isofl':
          cam.position.set(dist * 0.707, dist * 0.5, dist * 0.707);
          break;
        case 'isofr':
          cam.position.set(-dist * 0.707, dist * 0.5, dist * 0.707);
          break;
      }

      cam.lookAt(0, 0, 0);
      if (cameraOrthoRef.current) cameraOrthoRef.current.zoom = 1;
      if (settingsRef.current.isOrtho) updateOrthoFrustum();

      controlsRef.current.update();
      updateGrid();
      updateLights(cam);
      requestRender();
    };

    const computeModelThickness = (model: THREE.Object3D) => {
      if (thicknessCalculatingRef.current) return;
      const meshes: THREE.Mesh[] = [];
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshes.push(child as THREE.Mesh);
        }
      });

      const uncomputed = meshes.filter((m) => !m.geometry?.attributes?.wallThickness);
      if (uncomputed.length === 0) {
        if (thicknessMaterialRef.current) {
          thicknessMaterialRef.current.uniforms.uIsReady.value = 1.0;
        }
        setThicknessProgress(null);
        requestRender();
        return;
      }

      thicknessCalculatingRef.current = true;
      setThicknessProgress(0);

      const scaleInches = getConversionToInches();
      let meshIdx = 0;

      const processNextMesh = () => {
        if (meshIdx >= uncomputed.length) {
          thicknessCalculatingRef.current = false;
          if (thicknessMaterialRef.current) {
            thicknessMaterialRef.current.uniforms.uIsReady.value = 1.0;
          }
          setThicknessProgress(null);
          requestRender();
          return;
        }

        const mesh = uncomputed[meshIdx];
        const geom = mesh.geometry;
        if (!geom || !geom.attributes.position) {
          meshIdx++;
          processNextMesh();
          return;
        }

        if (!geom.attributes.normal) {
          geom.computeVertexNormals();
        }

        let bvh = (geom as any).boundsTree;
        if (!bvh) {
          try {
            bvh = new MeshBVH(geom);
            (geom as any).boundsTree = bvh;
          } catch (e) {
            console.warn('Could not create BVH for mesh', e);
            meshIdx++;
            processNextMesh();
            return;
          }
        }

        const pos = geom.attributes.position;
        const norm = geom.attributes.normal;
        const count = pos.count;
        const thicknessArr = new Float32Array(count);

        if (!geom.boundingBox) geom.computeBoundingBox();
        const box = geom.boundingBox || new THREE.Box3();
        const diag = box.min.distanceTo(box.max);
        const nudge = Math.max(diag * 0.0002, 0.0005);

        const p = new THREE.Vector3();
        const n = new THREE.Vector3();
        const dir = new THREE.Vector3();
        const ray = new THREE.Ray();

        const BATCH_SIZE = 4000;
        let vIdx = 0;

        const processBatch = () => {
          const limit = Math.min(vIdx + BATCH_SIZE, count);
          for (let i = vIdx; i < limit; i++) {
            p.fromBufferAttribute(pos, i);
            n.fromBufferAttribute(norm, i);

            if (n.lengthSq() < 1e-4) {
              thicknessArr[i] = 999.0;
              continue;
            }

            dir.copy(n).negate().normalize();
            ray.origin.copy(p).addScaledVector(dir, nudge);
            ray.direction.copy(dir);

            const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
            if (hit && hit.distance > 0) {
              thicknessArr[i] = (hit.distance + nudge) * scaleInches;
            } else {
              thicknessArr[i] = 999.0;
            }
          }

          vIdx = limit;
          const totalProgress = Math.round(
            ((meshIdx + vIdx / count) / uncomputed.length) * 100
          );
          setThicknessProgress(totalProgress);

          if (vIdx < count) {
            setTimeout(processBatch, 0);
          } else {
            geom.setAttribute('wallThickness', new THREE.BufferAttribute(thicknessArr, 1));
            meshIdx++;
            setTimeout(processNextMesh, 0);
          }
        };

        processBatch();
      };

      processNextMesh();
    };

    // Compute solid volume (cm³) and a watertightness heuristic, reusing the same per-mesh
    // traversal style as the thickness checker. Runs once per load at scale=1; volume scales
    // by scaleFactor^3 afterward without needing to re-walk the geometry.
    const computeVolumeAndWatertight = (model: THREE.Object3D) => {
      model.updateMatrixWorld(true);
      let totalVolumeMm3 = 0;
      let watertight = true;
      let meshCount = 0;

      const va = new THREE.Vector3();
      const vb = new THREE.Vector3();
      const vc = new THREE.Vector3();

      model.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const geom = mesh.geometry as THREE.BufferGeometry;
        if (!geom || !geom.attributes.position) return;
        meshCount++;

        const pos = geom.attributes.position;
        const index = geom.index;
        const triCount = index ? index.count / 3 : pos.count / 3;

        // Edge-adjacency map (welded by rounded position) for a boundary/watertight heuristic
        const edgeCounts = new Map<string, number>();
        const keyFor = (v: THREE.Vector3) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
        const addEdge = (a: string, b: string) => {
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        };

        let meshVolume = 0;
        for (let t = 0; t < triCount; t++) {
          const i0 = index ? index.getX(t * 3) : t * 3;
          const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

          va.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
          vb.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
          vc.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

          meshVolume += va.dot(vb.clone().cross(vc)) / 6;

          const ka = keyFor(va);
          const kb = keyFor(vb);
          const kc = keyFor(vc);
          addEdge(ka, kb);
          addEdge(kb, kc);
          addEdge(kc, ka);
        }

        totalVolumeMm3 += Math.abs(meshVolume);

        for (const count of edgeCounts.values()) {
          if (count !== 2) {
            watertight = false;
            break;
          }
        }
      });

      unscaledVolumeCm3Ref.current = totalVolumeMm3 / 1000; // mm^3 -> cm^3
      isWatertightRef.current = watertight;

      return { volumeCm3: unscaledVolumeCm3Ref.current, watertight, meshCount };
    };

    // Recompute the displayed volume/weight/cost stats from cached unscaled volume — cheap,
    // safe to call on every scale/density/cost change without re-walking geometry.
    const refreshVolumeStats = (partCount: number) => {
      const scaleFactor = dimensionsRef.current.scaleFactor || 1;
      const scaledVolumeCm3 = unscaledVolumeCm3Ref.current * Math.pow(scaleFactor, 3);
      const density = settingsRef.current.materialDensityGCm3 || 1.04;
      const weightGrams = scaledVolumeCm3 * density;
      const costPerKg = settingsRef.current.costPerKgUSD || 0;
      const estimatedCost = (weightGrams / 1000) * costPerKg;
      const stats: VolumeStats = {
        volumeCm3: scaledVolumeCm3,
        weightGrams,
        estimatedCost,
        isWatertight: isWatertightRef.current,
        partCount,
      };
      setVolumeStats(stats);
      onVolumeComputed?.(stats);
    };

    const onModelLoadedHandler = (name: string) => {
      setIsLoading(false);
      setLoadedFileName(name);
      onModelLoaded(name);

      if (currentModelRef.current) {
        currentModelRef.current.position.set(0, 0, 0);
        currentModelRef.current.rotation.set(0, 0, 0);
        currentModelRef.current.scale.set(1, 1, 1);
        currentModelRef.current.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(currentModelRef.current);
        box.getCenter(unscaledCenterRef.current);
        box.getSize(unscaledModelSizeRef.current);

        const scaleInches = getConversionToInches();
        const baseW = unscaledModelSizeRef.current.x * scaleInches;
        const baseH = unscaledModelSizeRef.current.y * scaleInches;
        const baseD = unscaledModelSizeRef.current.z * scaleInches;

        const initialDims: ModelDimensions = {
          scaleFactor: 1.0,
          widthInches: parseFloat(baseW.toFixed(3)),
          heightInches: parseFloat(baseH.toFixed(3)),
          depthInches: parseFloat(baseD.toFixed(3)),
          rotX: 0,
          rotY: 0,
          rotZ: 0,
          baseWidthInches: baseW,
          baseHeightInches: baseH,
          baseDepthInches: baseD,
        };
        dimensionsRef.current = initialDims;
        onDimensionsChanged(initialDims);
        applyModelTransform(initialDims);
        computeModelThickness(currentModelRef.current);

        const { meshCount } = computeVolumeAndWatertight(currentModelRef.current);
        const partCount = batchPartsRef.current.length > 0 ? batchPartsRef.current.length : 1;
        notifyPartsChanged();
        refreshVolumeStats(Math.max(partCount, meshCount > 0 ? 1 : 0));
      }

      recenterView();
    };

    const parseAndLoadBuffer = (
      name: string,
      contents: ArrayBuffer | string
    ) => {
      if (!sceneRef.current) return;
      cleanupScene();
      const lower = name.toLowerCase();

      try {
        if (lower.endsWith('.stl')) {
          const loader = new STLLoader();
          const geometry = loader.parse(contents as ArrayBuffer);
          geometry.computeVertexNormals();
          geometry.center();
          const mesh = new THREE.Mesh(geometry, getLookdevMaterial(settingsRef.current.material));
          mesh.castShadow = settingsRef.current.castShadows;
          mesh.receiveShadow = settingsRef.current.castShadows;
          currentModelRef.current = mesh;
          sceneRef.current.add(mesh);
          onModelLoadedHandler(name);
        } else if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
          const loader = new GLTFLoader();
          loader.parse(
            contents as ArrayBuffer,
            '',
            (gltf) => {
              currentModelRef.current = gltf.scene;
              currentModelRef.current.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                  const mesh = child as THREE.Mesh;
                  mesh.userData.originalMaterial = mesh.material;
                }
              });
              detectExplodableParts(currentModelRef.current);
              applyMaterialAndShadows();
              if (sceneRef.current) sceneRef.current.add(currentModelRef.current);
              onModelLoadedHandler(name);
            },
            (err) => {
              console.error(err);
              setLoadingMessage('Error parsing GLTF file.');
              setTimeout(() => setIsLoading(false), 2000);
            }
          );
        } else if (lower.endsWith('.obj')) {
          const loader = new OBJLoader();
          const obj = loader.parse(contents as string);
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              if (mesh.geometry && !mesh.geometry.attributes.normal) {
                mesh.geometry.computeVertexNormals();
              }
              mesh.userData.originalMaterial = mesh.material;
            }
          });
          currentModelRef.current = obj;
          applyMaterialAndShadows();
          sceneRef.current.add(obj);
          onModelLoadedHandler(name);
        }
      } catch (err: any) {
        console.error(err);
        setLoadingMessage('Error reading 3D file structure.');
        setTimeout(() => setIsLoading(false), 2000);
      }
    };

    const loadModelFromFile = (file: File) => {
      batchPartsRef.current = [];
      setIsLoading(true);
      setLoadingMessage(`Loading ${file.name}...`);
      setTimeout(() => {
        const reader = new FileReader();
        const lower = file.name.toLowerCase();

        reader.onload = (e) => {
          if (e.target?.result) {
            parseAndLoadBuffer(file.name, e.target.result);
          }
        };

        if (lower.endsWith('.obj')) {
          reader.readAsText(file);
        } else {
          reader.readAsArrayBuffer(file);
        }
      }, 50);
    };

    // Read one file as the buffer type its loader expects
    const readFileAsBuffer = (file: File): Promise<ArrayBuffer | string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as ArrayBuffer | string);
        reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
        if (file.name.toLowerCase().endsWith('.obj')) {
          reader.readAsText(file);
        } else {
          reader.readAsArrayBuffer(file);
        }
      });
    };

    // Parse a file's buffer into a standalone Object3D WITHOUT centering it — used for batch
    // loading, where each part must keep its original origin so multiple STL/OBJ/GLB files
    // exported from the same assembly line back up correctly relative to each other.
    const parseBufferToObject = (name: string, contents: ArrayBuffer | string): Promise<THREE.Object3D | null> => {
      return new Promise((resolve) => {
        const lower = name.toLowerCase();
        try {
          if (lower.endsWith('.stl')) {
            const loader = new STLLoader();
            const geometry = loader.parse(contents as ArrayBuffer);
            geometry.computeVertexNormals();
            const mesh = new THREE.Mesh(geometry, getLookdevMaterial(settingsRef.current.material));
            mesh.userData.originalMaterial = mesh.material;
            mesh.userData.partName = name;
            resolve(mesh);
          } else if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
            const loader = new GLTFLoader();
            loader.parse(
              contents as ArrayBuffer,
              '',
              (gltf) => {
                gltf.scene.traverse((child) => {
                  if ((child as THREE.Mesh).isMesh) {
                    (child as THREE.Mesh).userData.originalMaterial = (child as THREE.Mesh).material;
                  }
                });
                gltf.scene.userData.partName = name;
                resolve(gltf.scene);
              },
              () => resolve(null)
            );
          } else if (lower.endsWith('.obj')) {
            const loader = new OBJLoader();
            const obj = loader.parse(contents as string);
            obj.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry && !mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
                mesh.userData.originalMaterial = mesh.material;
              }
            });
            obj.userData.partName = name;
            resolve(obj);
          } else {
            resolve(null);
          }
        } catch (err) {
          console.error('Failed to parse part', name, err);
          resolve(null);
        }
      });
    };

    // Batch loader — loads multiple STL/OBJ/GLB files as siblings under one group, each keeping
    // its own baked-in origin so a multi-part assembly reassembles correctly. Also feeds the
    // exploded-view system (each file becomes one explodable part).
    const loadModelsFromFiles = async (files: File[]) => {
      if (!sceneRef.current || files.length === 0) return;
      if (files.length === 1) {
        loadModelFromFile(files[0]);
        return;
      }

      setIsLoading(true);
      setLoadingMessage(`Loading ${files.length} parts...`);
      cleanupScene();
      batchPartsRef.current = [];

      const group = new THREE.Group();
      currentModelRef.current = group;
      sceneRef.current.add(group);

      for (const file of files) {
        setLoadingMessage(`Loading ${file.name}...`);
        try {
          const buffer = await readFileAsBuffer(file);
          const obj = await parseBufferToObject(file.name, buffer);
          if (obj) {
            group.add(obj);
            batchPartsRef.current.push({ object: obj, localCenter: new THREE.Vector3() });
          }
        } catch (err) {
          console.error('Failed to load batch part', file.name, err);
        }
      }

      if (batchPartsRef.current.length === 0) {
        setIsLoading(false);
        return;
      }

      applyMaterialAndShadows();

      group.updateMatrixWorld(true);
      const groupBox = new THREE.Box3().setFromObject(group);
      groupBox.getCenter(batchGroupCenterRef.current);
      batchPartsRef.current.forEach((part) => {
        const box = new THREE.Box3().setFromObject(part.object);
        box.getCenter(part.localCenter);
      });

      const cleanNames = files.map((f) => f.name.replace(/\.[^/.]+$/, '')).join(' + ');
      onModelLoadedHandler(`Batch (${files.length} parts): ${cleanNames}`);
    };

    // Push each batch part away from the group's shared center, scaled by explodeAmount (0-1)
    const applyExplode = () => {
      if (batchPartsRef.current.length === 0) return;
      const amount = Math.max(0, Math.min(1, settingsRef.current.explodeAmount || 0));
      const magnitude = (unscaledModelSizeRef.current.length() || 1) * 0.6;
      const center = batchGroupCenterRef.current;
      batchPartsRef.current.forEach((part) => {
        const dir = part.localCenter.clone().sub(center);
        if (dir.lengthSq() < 1e-8) return;
        dir.normalize();
        part.object.position.copy(dir.multiplyScalar(amount * magnitude));
      });
    };

    // Populates batchPartsRef from a freshly-loaded single GLB/glTF's own top-level nodes, so
    // Explode/Loaded-Meshes work for any multi-part model, not only files brought in through the
    // dedicated multi-file Batch Load flow. A part must have at least one mesh descendant to
    // count (skips empty transform/helper nodes); fewer than 2 such nodes means there's nothing
    // separable, so it's left as a single whole model.
    const detectExplodableParts = (root: THREE.Object3D) => {
      const hasMeshDescendant = (obj: THREE.Object3D) => {
        let found = false;
        obj.traverse((n) => {
          if ((n as THREE.Mesh).isMesh) found = true;
        });
        return found;
      };

      const candidates = root.children.filter(hasMeshDescendant);
      if (candidates.length < 2) {
        batchPartsRef.current = [];
        return;
      }

      root.updateMatrixWorld(true);
      batchPartsRef.current = candidates.map((object) => ({ object, localCenter: new THREE.Vector3() }));
      const groupBox = new THREE.Box3().setFromObject(root);
      groupBox.getCenter(batchGroupCenterRef.current);
      batchPartsRef.current.forEach((part) => {
        const box = new THREE.Box3().setFromObject(part.object);
        box.getCenter(part.localCenter);
      });
    };

    const getPartName = (obj: THREE.Object3D, index: number): string =>
      obj.userData.partName || obj.name || `Part ${index + 1}`;

    const notifyPartsChanged = () => {
      onPartsChanged?.(
        batchPartsRef.current.map((part, i) => ({
          name: getPartName(part.object, i),
          visible: part.object.visible,
        }))
      );
    };

    const togglePartVisibility = (index: number) => {
      const part = batchPartsRef.current[index];
      if (!part) return;
      part.object.visible = !part.object.visible;
      notifyPartsChanged();
      requestRender();
    };

    const collectMeshMaterials = (obj: THREE.Object3D, into: Set<THREE.Material>) => {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const original = mesh.userData.originalMaterial;
        if (original) (Array.isArray(original) ? original : [original]).forEach((m) => into.add(m));
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => into.add(m));
      });
    };

    const deletePart = (index: number) => {
      const part = batchPartsRef.current[index];
      if (!part) return;

      // Multiple meshes/parts commonly reference the exact same material (e.g. every part of
      // the demo figurine shares one body material) — only dispose materials this part actually
      // owns exclusively, or a still-visible sibling would lose its material out from under it.
      // Geometry is never shared between separate parts, so that's always safe to free.
      const candidateMaterials = new Set<THREE.Material>();
      collectMeshMaterials(part.object, candidateMaterials);

      part.object.parent?.remove(part.object);
      batchPartsRef.current.splice(index, 1);

      part.object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry?.dispose();
      });

      if (currentModelRef.current) {
        const stillUsed = new Set<THREE.Material>();
        collectMeshMaterials(currentModelRef.current, stillUsed);
        candidateMaterials.forEach((m) => {
          if (!stillUsed.has(m)) m.dispose();
        });

        recalculateBounds();
        updateGrid();
        const { meshCount } = computeVolumeAndWatertight(currentModelRef.current);
        const partCount = batchPartsRef.current.length > 0 ? batchPartsRef.current.length : 1;
        refreshVolumeStats(Math.max(partCount, meshCount > 0 ? 1 : 0));
      } else {
        candidateMaterials.forEach((m) => m.dispose());
      }
      notifyPartsChanged();
      requestRender();
    };

    // Load sample default model
    const loadDemoModel = async () => {
      setIsLoading(true);
      setLoadingMessage('Loading Showcase Demo Model...');

      // First check if user has placed /default-model.glb
      try {
        const checkRes = await fetch(`${import.meta.env.BASE_URL}default-model.glb`);
        if (checkRes.ok) {
          const buf = await checkRes.arrayBuffer();
          if (buf.byteLength > 100) {
            parseAndLoadBuffer('default-model.glb', buf);
            return;
          }
        }
      } catch (err) {
        console.warn('Could not load default-model.glb, falling back to showcase model', err);
      }

      // Generate a stylized 3D display model (artistic figurine showcase)
      cleanupScene();
      const group = new THREE.Group();

      // Stylized Toy Character / Figurine
      const bodyMat = getLookdevMaterial(settingsRef.current.material);

      // Torso
      const torsoGeo = new THREE.CylinderGeometry(14, 18, 36, 32);
      const torso = new THREE.Mesh(torsoGeo, bodyMat);
      torso.position.y = 18;
      torso.name = 'Torso';
      group.add(torso);

      // Head
      const headGeo = new THREE.SphereGeometry(16, 32, 32);
      const head = new THREE.Mesh(headGeo, bodyMat);
      head.position.y = 48;
      head.name = 'Head';
      group.add(head);

      // Ears/Antennae
      const earGeo = new THREE.ConeGeometry(5, 14, 24);
      const earL = new THREE.Mesh(earGeo, bodyMat);
      earL.position.set(-11, 62, 0);
      earL.rotation.z = 0.3;
      earL.name = 'Ear (Left)';
      group.add(earL);

      const earR = new THREE.Mesh(earGeo, bodyMat);
      earR.position.set(11, 62, 0);
      earR.rotation.z = -0.3;
      earR.name = 'Ear (Right)';
      group.add(earR);

      // Limbs
      const armGeo = new THREE.CapsuleGeometry(4.5, 20, 8, 16);
      const armL = new THREE.Mesh(armGeo, bodyMat);
      armL.position.set(-20, 20, 0);
      armL.rotation.z = 0.4;
      armL.name = 'Arm (Left)';
      group.add(armL);

      const armR = new THREE.Mesh(armGeo, bodyMat);
      armR.position.set(20, 20, 0);
      armR.rotation.z = -0.4;
      armR.name = 'Arm (Right)';
      group.add(armR);

      // Base stand
      const baseGeo = new THREE.CylinderGeometry(28, 30, 6, 48);
      const base = new THREE.Mesh(baseGeo, bodyMat);
      base.position.y = -3;
      base.name = 'Base';
      group.add(base);

      group.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = c as THREE.Mesh;
          m.castShadow = settingsRef.current.castShadows;
          m.receiveShadow = settingsRef.current.castShadows;
          m.userData.originalMaterial = m.material;
        }
      });

      detectExplodableParts(group);
      currentModelRef.current = group;
      if (sceneRef.current) sceneRef.current.add(group);
      onModelLoadedHandler('Jazwares_Showcase_Figurine.glb');
    };

    // CRC32 (for injecting a PNG pHYs/DPI chunk) — standard table-based implementation
    const crc32 = (() => {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
      }
      return (bytes: Uint8Array): number => {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
          crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
      };
    })();

    // Embed a pHYs chunk so the PNG opens at true 300 DPI in Photoshop/Illustrator instead of
    // the browser's default 96 DPI (purely metadata — does not touch pixel data).
    const injectPngDpi = async (blob: Blob, dpi: number): Promise<Blob> => {
      try {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const ihdrEnd = 8 + 25; // 8-byte signature + IHDR chunk (4 len + 4 type + 13 data + 4 crc)
        const pixelsPerMeter = Math.round(dpi / 0.0254);

        const typeAndData = new Uint8Array(4 + 9);
        typeAndData.set([0x70, 0x48, 0x59, 0x73], 0); // 'pHYs'
        const tdView = new DataView(typeAndData.buffer);
        tdView.setUint32(4, pixelsPerMeter, false);
        tdView.setUint32(8, pixelsPerMeter, false);
        typeAndData[12] = 1; // unit specifier: meter

        const crc = crc32(typeAndData);
        const chunk = new Uint8Array(4 + 4 + 9 + 4);
        const chunkView = new DataView(chunk.buffer);
        chunkView.setUint32(0, 9, false);
        chunk.set(typeAndData, 4);
        chunkView.setUint32(4 + 13, crc, false);

        const out = new Uint8Array(buf.length + chunk.length);
        out.set(buf.slice(0, ihdrEnd), 0);
        out.set(chunk, ihdrEnd);
        out.set(buf.slice(ihdrEnd), ihdrEnd + chunk.length);
        return new Blob([out], { type: 'image/png' });
      } catch (err) {
        console.warn('Could not embed DPI metadata, exporting without it', err);
        return blob;
      }
    };

    // Lazily load + cache the Jazwares watermark for exported sheets. Loaded from a remote CDN,
    // so this is best-effort: if it fails to load (CORS/network), export continues without it.
    const jazwaresLogoImgRef = useRef<HTMLImageElement | null>(null);
    const getJazwaresLogoImage = (): Promise<HTMLImageElement | null> => {
      return new Promise((resolve) => {
        if (jazwaresLogoImgRef.current) {
          resolve(jazwaresLogoImgRef.current);
          return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeout = setTimeout(() => resolve(null), 2000);
        img.onload = () => {
          clearTimeout(timeout);
          jazwaresLogoImgRef.current = img;
          resolve(img);
        };
        img.onerror = () => {
          clearTimeout(timeout);
          resolve(null);
        };
        img.src =
          'https://cdn.cookielaw.org/logos/fe328015-5ba0-440b-96be-399813ddce55/019ed71b-fe3a-7d09-ab6f-ebb2d6233a0f/8d2a10ff-d963-41d9-8439-7c3ebbbaa2d5/jazwares-logo-squared.png';
      });
    };

    // Non-blocking chunked Turnaround Sheet Image Exporter
    const exportTurnaroundImage = (
      resMultiplier: ResolutionOption,
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (!currentModelRef.current || !rendererRef.current || !sceneRef.current || !containerRef.current) {
        return;
      }
      isExportingRef.current = true;
      if (controlsRef.current) controlsRef.current.enabled = false;

      recalculateBounds();
      const includeGrid = settingsRef.current.showGrid;
      const resMult = resMultiplier;
      const basePanelSize = 1000;
      let panelSize = basePanelSize * resMult;

      const gl = rendererRef.current.getContext();
      const maxHardwareDim = gl ? gl.getParameter(gl.MAX_VIEWPORT_DIMS)?.[0] || 4096 : 4096;
      panelSize = Math.min(panelSize, maxHardwareDim);

      const margin = 20 * resMult;
      const gap = 20 * resMult;
      const headerHeight = 180 * resMult;
      const labelHeight = 60 * resMult;
      const cols = 4;
      const rows = 2;

      const totalWidth = margin * 2 + cols * panelSize + (cols - 1) * gap;
      const totalHeight =
        margin + headerHeight + rows * (panelSize + labelHeight) + (rows - 1) * gap + margin;

      const compCanvas = document.createElement('canvas');
      compCanvas.width = totalWidth;
      compCanvas.height = totalHeight;
      const ctx = compCanvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, totalWidth, totalHeight);

      ctx.fillStyle = '#38bdf8';
      ctx.font = `bold ${52 * resMult}px system-ui, sans-serif`;
      ctx.fillText(
        '3D MODEL ORTHOGRAPHIC TURNAROUND SHEET',
        margin + 20 * resMult,
        margin + 65 * resMult
      );

      ctx.fillStyle = '#94a3b8';
      ctx.font = `${32 * resMult}px system-ui, sans-serif`;
      const scaleInches = getConversionToInches();
      const curScale = dimensionsRef.current.scaleFactor;
      const inX = (unscaledModelSizeRef.current.x * scaleInches * curScale).toFixed(3);
      const inY = (unscaledModelSizeRef.current.y * scaleInches * curScale).toFixed(3);
      const inZ = (unscaledModelSizeRef.current.z * scaleInches * curScale).toFixed(3);
      const dimStr = `File: ${loadedFileName || 'model'}  |  Size: X ${inX}" × Y ${inY}" × Z ${inZ}"`;
      ctx.fillText(dimStr, margin + 20 * resMult, margin + 125 * resMult);

      const origWidth = containerRef.current.clientWidth;
      const origHeight = containerRef.current.clientHeight;

      const dist = modelRadiusRef.current * 3.0;
      const halfFrustum = modelRadiusRef.current * 1.03;
      const exportCam = new THREE.OrthographicCamera(
        -halfFrustum,
        halfFrustum,
        halfFrustum,
        -halfFrustum,
        0.01,
        dist * 10
      );

      sceneRef.current.background = null;
      rendererRef.current.setClearColor(0x000000, 0);
      rendererRef.current.setSize(panelSize, panelSize, true);

      const views = [
        { name: 'FRONT VIEW', pos: new THREE.Vector3(0, 0, dist) },
        { name: 'BACK VIEW', pos: new THREE.Vector3(0, 0, -dist) },
        { name: 'TOP VIEW', pos: new THREE.Vector3(0, dist, 0.0001) },
        { name: 'BOTTOM VIEW', pos: new THREE.Vector3(0, -dist, 0.0001) },
        { name: 'LEFT VIEW', pos: new THREE.Vector3(dist, 0, 0) },
        { name: 'RIGHT VIEW', pos: new THREE.Vector3(-dist, 0, 0) },
        { name: '3/4 FRONT-LEFT', pos: new THREE.Vector3(dist * 0.707, dist * 0.5, dist * 0.707) },
        { name: '3/4 FRONT-RIGHT', pos: new THREE.Vector3(-dist * 0.707, dist * 0.5, dist * 0.707) },
      ];

      let currentViewIdx = 0;

      const renderNextChunk = () => {
        if (!sceneRef.current || !rendererRef.current || !activeCameraRef.current) return;

        if (currentViewIdx >= views.length) {
          sceneRef.current.background = null;
          rendererRef.current.setSize(origWidth, origHeight, true);
          updateGrid();
          updateLights(activeCameraRef.current);

          isExportingRef.current = false;
          if (controlsRef.current) controlsRef.current.enabled = true;
          requestRender();

          // Watermark (best-effort — export still completes if the logo fails to load)
          getJazwaresLogoImage().then((logoImg) => {
            if (logoImg) {
              try {
                const logoW = 130 * resMult;
                const logoH = (logoImg.height / logoImg.width) * logoW;
                ctx.globalAlpha = 0.85;
                ctx.drawImage(
                  logoImg,
                  totalWidth - logoW - margin,
                  margin + 10 * resMult,
                  logoW,
                  logoH
                );
                ctx.globalAlpha = 1.0;
              } catch (err) {
                console.warn('Could not draw watermark on exported sheet', err);
              }
            }

            compCanvas.toBlob(async (blob) => {
              if (blob) {
                const finalBlob = await injectPngDpi(blob, 300);
                const cleanName = (loadedFileName || 'model').replace(/\.[^/.]+$/, '');
                const outName = `${cleanName}_Turnaround_${resMult}x.png`;
                onComplete(finalBlob, outName);
              }
            }, 'image/png');
          });
          return;
        }

        onProgress(`Rendering (${currentViewIdx + 1}/8)...`);

        const v = views[currentViewIdx];
        exportCam.position.copy(v.pos);
        exportCam.lookAt(0, 0, 0);
        exportCam.updateProjectionMatrix();

        updateLights(exportCam);

        // Grid is now a static world/model-aligned ground plane, so it just needs to be
        // shown or hidden per the toggle — no per-view repositioning required anymore.
        if (includeGrid) {
          if (!gridHelperRef.current) updateGrid();
          if (gridHelperRef.current) gridHelperRef.current.visible = true;
        } else if (gridHelperRef.current) {
          gridHelperRef.current.visible = false;
        }

        rendererRef.current.clear();
        rendererRef.current.render(sceneRef.current, exportCam);

        const col = currentViewIdx % cols;
        const row = Math.floor(currentViewIdx / cols);

        const dx = margin + col * (panelSize + gap);
        const dy = margin + headerHeight + row * (panelSize + labelHeight + gap);

        ctx.drawImage(rendererRef.current.domElement, dx, dy, panelSize, panelSize);

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 3 * resMult;
        ctx.strokeRect(dx, dy, panelSize, panelSize);

        ctx.fillStyle = '#f8fafc';
        ctx.font = `bold ${38 * resMult}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(v.name, dx + panelSize / 2, dy + panelSize + 45 * resMult);

        currentViewIdx++;
        requestAnimationFrame(renderNextChunk);
      };

      requestAnimationFrame(renderNextChunk);
    };

    // Video Mime Types & Encoder Probe
    const getSupportedVideoMimeType = (format: 'mp4' | 'webm'): string => {
      if (typeof MediaRecorder === 'undefined') return '';
      if (format === 'mp4') {
        const mp4Candidates = [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=avc1',
          'video/mp4;codecs=h264',
          'video/mp4',
        ];
        for (const type of mp4Candidates) {
          if (MediaRecorder.isTypeSupported(type)) return type;
        }
      }
      const webmCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      for (const type of webmCandidates) {
        if (MediaRecorder.isTypeSupported(type)) return type;
      }
      return '';
    };

    const testCanvasRecording = (type: string, canvas: HTMLCanvasElement): Promise<boolean> => {
      return new Promise((resolve) => {
        try {
          const stream = canvas.captureStream(30);
          const testRecorder = new MediaRecorder(stream, { mimeType: type });
          let hasData = false;

          testRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) hasData = true;
          };

          testRecorder.onstop = () => resolve(hasData);
          testRecorder.onerror = () => resolve(false);

          testRecorder.start(50);
          setTimeout(() => {
            try {
              if (testRecorder.state !== 'inactive') testRecorder.stop();
              else resolve(hasData);
            } catch {
              resolve(false);
            }
          }, 120);
        } catch {
          resolve(false);
        }
      });
    };

    // Turntable Video Exporter
    const exportTurntableVideo = async (
      format: 'mp4' | 'webm',
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (!currentModelRef.current || !canvasRef.current || !rendererRef.current || !sceneRef.current || !activeCameraRef.current) {
        return;
      }

      isExportingRef.current = true;
      if (controlsRef.current) controlsRef.current.enabled = false;

      onProgress('Testing encoder...');
      recalculateBounds();

      let selectedMimeType = getSupportedVideoMimeType(format);
      if (!selectedMimeType) {
        isExportingRef.current = false;
        if (controlsRef.current) controlsRef.current.enabled = true;
        throw new Error('Video recording is not supported in this browser.');
      }

      const works = await testCanvasRecording(selectedMimeType, canvasRef.current);
      if (!works && format === 'mp4') {
        selectedMimeType = getSupportedVideoMimeType('webm');
      }

      onProgress('Recording 360° turntable...');

      // Temporarily render at a higher fixed resolution for a cleaner, less compressed-looking
      // capture than whatever the on-screen canvas size happens to be.
      const origW = containerRef.current?.clientWidth || canvasRef.current.width;
      const origH = containerRef.current?.clientHeight || canvasRef.current.height;
      const aspect = origW / origH;
      const targetLongEdge = 1600;
      const exportW = Math.round(aspect >= 1 ? targetLongEdge : targetLongEdge * aspect);
      const exportH = Math.round(aspect >= 1 ? targetLongEdge / aspect : targetLongEdge);
      rendererRef.current.setPixelRatio(1);
      rendererRef.current.setSize(exportW, exportH, true);
      if (composerRef.current) composerRef.current.setSize(exportW, exportH);
      if (cameraPerspRef.current) {
        cameraPerspRef.current.aspect = exportW / exportH;
        cameraPerspRef.current.updateProjectionMatrix();
      }
      updateOrthoFrustum();

      const stream = canvasRef.current.captureStream(30);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: 60000000,
        });
      } catch {
        recorder = new MediaRecorder(stream);
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      const recordPromise = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => {
          try {
            const blob = new Blob(chunks, { type: selectedMimeType });
            if (blob.size === 0) {
              reject(new Error('Video recording generated 0 bytes.'));
              return;
            }
            const isMp4 = selectedMimeType.includes('mp4');
            const ext = isMp4 ? 'mp4' : 'webm';
            const cleanName = (loadedFileName || 'model').replace(/\.[^/.]+$/, '');
            const outName = `${cleanName}_Turnaround.${ext}`;
            onComplete(blob, outName);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        recorder.onerror = (e: any) => reject(e.error || new Error('MediaRecorder error'));
      });

      recorder.start(100);

      const durationMs = 4000;
      const cam = activeCameraRef.current;
      const radius =
        Math.sqrt(cam.position.x ** 2 + cam.position.z ** 2) || modelRadiusRef.current * 3.0;
      const camY = cam.position.y;
      const initialAngle = Math.atan2(cam.position.x, cam.position.z);
      const startTime = performance.now();

      await new Promise<void>((resolve) => {
        const renderStep = (now: number) => {
          if (!rendererRef.current || !sceneRef.current) return;
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / durationMs, 1.0);
          const angle = initialAngle + progress * Math.PI * 2;

          cam.position.x = radius * Math.sin(angle);
          cam.position.z = radius * Math.cos(angle);
          cam.position.y = camY;
          if (controlsRef.current) cam.lookAt(controlsRef.current.target);

          updateLights(cam);
          renderFrame(cam, false);

          if (progress < 1.0) {
            requestAnimationFrame(renderStep);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(renderStep);
      });

      await new Promise((r) => setTimeout(r, 150));
      if (recorder.state !== 'inactive') recorder.stop();
      await recordPromise;

      // Restore the live-view resolution
      rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      rendererRef.current.setSize(origW, origH, true);
      if (composerRef.current) composerRef.current.setSize(origW, origH);
      if (cameraPerspRef.current) {
        cameraPerspRef.current.aspect = origW / origH;
        cameraPerspRef.current.updateProjectionMatrix();
      }
      updateOrthoFrustum();

      isExportingRef.current = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      if (settingsRef.current.isOrtho && settingsRef.current.showGrid) updateGrid();
      updateLights(cam);
      requestRender();
    };

    useImperativeHandle(ref, () => ({
      recenterView,
      snapView,
      loadModelFromFile,
      loadModelsFromFiles,
      loadDemoModel,
      exportTurnaroundImage,
      exportTurntableVideo,
      updateDimension,
      togglePartVisibility,
      deletePart,
    }));

    // Initialize Three.js scene
    useEffect(() => {
      if (!containerRef.current || !canvasRef.current) return;

      const container = containerRef.current;
      const canvas = canvasRef.current;

      const scene = new THREE.Scene();
      // Background is always painted by the background/vignette backdrop pass (drawn first,
      // behind the model — see VignetteBackgroundPass / render loop), never by scene.background
      // directly, so the model render can never accidentally cover or be covered incorrectly.
      scene.background = null;
      sceneRef.current = scene;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: true,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.localClippingEnabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // Filmic tone mapping compresses HDR environment reflections (metals, clearcoat, the
      // Pearl preset's iridescence) into displayable range instead of hard-clipping them to
      // flat white — without this, any material with a bright specular/env response blows out.
      // Safe to always run through the composer's OutputPass (see renderFrame): three.js only
      // applies tone mapping when rendering straight to the screen, never to the intermediate
      // render targets passes render into, so there's no risk of it compounding per-pass.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      rendererRef.current = renderer;

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;

      const aspect = container.clientWidth / container.clientHeight;
      const cameraPersp = new THREE.PerspectiveCamera(45, aspect, 0.01, 10000);
      cameraPersp.setFocalLength(settings.focalLength);
      cameraPerspRef.current = cameraPersp;

      const cameraOrtho = new THREE.OrthographicCamera(
        -5 * aspect,
        5 * aspect,
        5,
        -5,
        0.01,
        10000
      );
      cameraOrthoRef.current = cameraOrtho;

      const activeCamera = settings.isOrtho ? cameraOrtho : cameraPersp;
      activeCamera.position.set(0, 0, 10);
      activeCameraRef.current = activeCamera;

      const controls = new OrbitControls(activeCamera, renderer.domElement);
      controls.enableDamping = true;
      controls.addEventListener('change', requestRender);
      controlsRef.current = controls;

      const viewHelper = new ViewHelper(activeCamera, renderer.domElement);
      viewHelperRef.current = viewHelper;

      const handlePointerDown = (event: PointerEvent) => {
        if (viewHelperRef.current) {
          viewHelperRef.current.handleClick(event);
          requestRender();
        }
      };
      canvas.addEventListener('pointerdown', handlePointerDown);

      // Background/Vignette backdrop — drawn FIRST (as VignetteBackgroundPass, an opaque
      // full-screen plate smoothstepping from the background color at center to the vignette
      // color at the edges) into the composer's chain. The 3D scene is drawn on top of this
      // with normal depth testing, so the vignette only ever shows through where there is no
      // model geometry — it never darkens or tints the mesh itself.
      const vignetteMaterial = new THREE.ShaderMaterial({
        uniforms: {
          bgColor: { value: new THREE.Color(settings.backgroundColorHex) },
          vigColor: { value: new THREE.Color(settings.vignetteColorHex) },
          intensity: { value: settings.vignetteIntensityPercent / 100 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 bgColor;
          uniform vec3 vigColor;
          uniform float intensity;
          varying vec2 vUv;
          void main() {
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float t = smoothstep(0.3, 1.2, dist) * intensity;
            gl_FragColor = vec4(mix(bgColor, vigColor, t), 1.0);
          }
        `,
        depthWrite: false,
        depthTest: false,
      });
      vignetteMaterialRef.current = vignetteMaterial;

      // Lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
      scene.add(ambientLight);
      ambientLightRef.current = ambientLight;

      const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.5);
      dirLight1.castShadow = settings.castShadows;
      dirLight1.shadow.mapSize.width = settings.shadowMapResolution;
      dirLight1.shadow.mapSize.height = settings.shadowMapResolution;
      scene.add(dirLight1);
      scene.add(dirLight1.target);
      dirLight1Ref.current = dirLight1;

      const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.0);
      scene.add(dirLight2);
      scene.add(dirLight2.target);
      dirLight2Ref.current = dirLight2;

      applyShadowSettings();
      applyEnvironment();

      // Post-processing pipeline: background/vignette backdrop -> scene -> AO -> AA -> output.
      // Always used (see renderFrame) — AO/FXAA/SMAA are simply disabled passes when their
      // setting is off, which the composer skips entirely, so there's no real cost to always
      // running the pipeline, and it guarantees OutputPass always applies correct color-space
      // encoding to the composited result.
      const composer = new EffectComposer(renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(container.clientWidth, container.clientHeight);

      const vignetteBgPass = new VignetteBackgroundPass(vignetteMaterial);
      composer.addPass(vignetteBgPass);

      const renderPass = new RenderPass(scene, activeCamera);
      renderPass.clear = false; // don't wipe what the backdrop pass just drew
      composer.addPass(renderPass);
      renderPassRef.current = renderPass;

      // GTAO (horizon-based) instead of classic SSAO: SSAO's random hemisphere sampling plus
      // its blur pass tended to produce a flat haze over the whole mesh rather than tracing
      // into actual creases. GTAO searches along the true surface horizon per-pixel, which
      // reads as real contact shadow depth in crevices instead of a uniform darkening pass.
      const aoPass = new GTAOPass(scene, activeCamera, container.clientWidth, container.clientHeight);
      aoPass.enabled = settings.ssaoEnabled;
      aoPass.output = GTAOPass.OUTPUT.Default;
      composer.addPass(aoPass);
      aoPassRef.current = aoPass;

      const fxaaPass = new ShaderPass(FXAAShader);
      fxaaPass.enabled = settings.antialiasMode === 'fxaa';
      composer.addPass(fxaaPass);
      fxaaPassRef.current = fxaaPass;

      const smaaPass = new SMAAPass(
        container.clientWidth * renderer.getPixelRatio(),
        container.clientHeight * renderer.getPixelRatio()
      );
      smaaPass.enabled = settings.antialiasMode === 'smaa';
      composer.addPass(smaaPass);
      smaaPassRef.current = smaaPass;

      composer.addPass(new OutputPass());
      composerRef.current = composer;
      syncPostProcessing();

      // Continuous Resize Observer
      const resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current || !rendererRef.current || !cameraPerspRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w === 0 || h === 0) return;

        const newAspect = w / h;
        cameraPerspRef.current.aspect = newAspect;
        cameraPerspRef.current.updateProjectionMatrix();
        updateOrthoFrustum();

        rendererRef.current.setSize(w, h, true);
        if (composerRef.current) composerRef.current.setSize(w, h);
        if (aoPassRef.current) aoPassRef.current.setSize(w, h);
        if (smaaPassRef.current) smaaPassRef.current.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
        syncPostProcessing();
        if (activeCameraRef.current) {
          updateGrid();
          updateLights(activeCameraRef.current);
        }
        requestRender();
      });
      resizeObserver.observe(container);

      // Main Render Loop
      let animationFrameId: number;
      const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        if (isExportingRef.current) return;

        const cameraMoved = controls.update();

        if (isTurntableActiveRef.current && activeCameraRef.current && controlsRef.current) {
          const speed = 0.008;
          const cam = activeCameraRef.current;
          const x = cam.position.x;
          const z = cam.position.z;
          cam.position.x = x * Math.cos(speed) - z * Math.sin(speed);
          cam.position.z = x * Math.sin(speed) + z * Math.cos(speed);
          cam.lookAt(controlsRef.current.target);

          // Grid is world/model-aligned (not camera-facing), so it does not need to be
          // rebuilt every turntable frame — this is also what fixes the old spin glitch.
          needsRenderRef.current = true;
        }

        if (needsRenderRef.current || cameraMoved) {
          if (activeCameraRef.current) {
            updateLights(activeCameraRef.current);
            renderFrame(activeCameraRef.current, true);
          }
          needsRenderRef.current = false;
        }
      };
      animate();

      // Check if a default model exists or auto-load demo
      loadDemoModel();

      return () => {
        cancelAnimationFrame(animationFrameId);
        resizeObserver.disconnect();
        canvas.removeEventListener('pointerdown', handlePointerDown);
        cleanupScene();
        composerRef.current?.dispose();
        renderer.dispose();
      };
    }, []);

    // Each settings effect below has a narrow, primitive dependency list instead of depending
    // on the whole `settings` object. That matters because every slider in the sidebar fires
    // onChange continuously while dragging — with one dependency list on all of `settings`,
    // dragging ANY slider (even one unrelated to materials, like shadow softness) re-ran a full
    // model traversal and forced a shader recompile on every mesh every tick, which is what
    // made the UI feel laggy. Splitting these up means a given slider only ever triggers the
    // handful of cheap operations it actually needs.

    // Background / vignette backdrop
    useEffect(() => {
      if (!vignetteMaterialRef.current) return;
      vignetteMaterialRef.current.uniforms.bgColor.value.set(settings.backgroundColorHex);
      vignetteMaterialRef.current.uniforms.vigColor.value.set(settings.vignetteColorHex);
      vignetteMaterialRef.current.uniforms.intensity.value = settings.vignetteEnabled
        ? settings.vignetteIntensityPercent / 100
        : 0;
      requestRender();
    }, [settings.backgroundColorHex, settings.vignetteColorHex, settings.vignetteEnabled, settings.vignetteIntensityPercent]);

    // Contrast (light intensities only — no mesh/material work)
    useEffect(() => {
      if (!ambientLightRef.current || !dirLight1Ref.current || !dirLight2Ref.current) return;
      const factor = settings.contrastPercent / 100;
      ambientLightRef.current.intensity = 1.2 / (factor * factor);
      dirLight1Ref.current.intensity = 2.5 * factor;
      dirLight2Ref.current.intensity = 1.0 * factor;
      requestRender();
    }, [settings.contrastPercent]);

    // Camera mode (ortho/perspective) & focal length
    useEffect(() => {
      if (!cameraOrthoRef.current || !cameraPerspRef.current || !controlsRef.current || !viewHelperRef.current) return;
      const targetCam = settings.isOrtho ? cameraOrthoRef.current : cameraPerspRef.current;
      const currentCam = activeCameraRef.current;

      if (targetCam !== currentCam && currentCam) {
        targetCam.position.copy(currentCam.position);
        targetCam.quaternion.copy(currentCam.quaternion);

        if (settings.isOrtho) {
          cameraOrthoRef.current.zoom = 1;
          updateOrthoFrustum();
        } else {
          cameraPerspRef.current.setFocalLength(settings.focalLength);
          cameraPerspRef.current.updateProjectionMatrix();
        }

        activeCameraRef.current = targetCam;
        controlsRef.current.object = targetCam;
        viewHelperRef.current.camera = targetCam;
        controlsRef.current.update();
      } else if (!settings.isOrtho) {
        cameraPerspRef.current.setFocalLength(settings.focalLength);
        cameraPerspRef.current.updateProjectionMatrix();
      }
      requestRender();
    }, [settings.isOrtho, settings.focalLength]);

    // Shadow quality (light/shadow-camera settings only — no mesh traversal)
    useEffect(() => {
      if (!dirLight1Ref.current) return;
      applyShadowSettings();
      requestRender();
    }, [settings.castShadows, settings.shadowSoftness, settings.shadowDarkness, settings.shadowMapResolution]);

    // Material, shadow-casting, opacity/ghost, and lookdev-color changes (the heavier,
    // full-model-traversal path — but now only runs for the settings that actually need it)
    useEffect(() => {
      applyMaterialAndShadows();
    }, [
      settings.material,
      settings.castShadows,
      settings.opacityPercent,
      settings.wireframeColorHex,
      settings.customColorHex,
      settings.customRoughnessPercent,
      settings.customMetalnessPercent,
      settings.sketchColorHex,
      settings.sketchHighlightColorHex,
      settings.sketchShadowColorHex,
      settings.minThicknessInches,
    ]);

    // Clipping planes — offset/flip drags just mutate plane values (cheap); only an
    // enabled-plane count change forces a material recompile (see updateClippingPlanes).
    useEffect(() => {
      updateClippingPlanes();
    }, [
      settings.clipping.x.enabled,
      settings.clipping.x.offsetInches,
      settings.clipping.x.flip,
      settings.clipping.y.enabled,
      settings.clipping.y.offsetInches,
      settings.clipping.y.flip,
      settings.clipping.z.enabled,
      settings.clipping.z.offsetInches,
      settings.clipping.z.flip,
    ]);

    // Grid
    useEffect(() => {
      updateGrid();
    }, [settings.showGrid, settings.gridSquareSizeInches, settings.gridMajorEveryInches]);

    // Environment preset (PMREM lookups are cached per-preset, so this is cheap after first use)
    useEffect(() => {
      applyEnvironment();
      requestRender();
    }, [settings.environmentPreset]);

    // Post-processing (SSAO / antialiasing)
    useEffect(() => {
      syncPostProcessing();
      requestRender();
    }, [settings.ssaoEnabled, settings.ssaoRadius, settings.ssaoIntensity, settings.ssaoBias, settings.antialiasMode]);

    // Exploded view
    useEffect(() => {
      applyExplode();
      requestRender();
    }, [settings.explodeAmount]);

    // Lock-lights-to-camera toggle
    useEffect(() => {
      if (activeCameraRef.current) updateLights(activeCameraRef.current);
      requestRender();
    }, [settings.lockLightsToCamera]);

    // Volume/weight/cost recompute (cheap — reuses cached unscaled volume)
    useEffect(() => {
      if (!currentModelRef.current) return;
      const partCount = batchPartsRef.current.length > 0 ? batchPartsRef.current.length : 1;
      refreshVolumeStats(partCount);
    }, [settings.materialDensityGCm3, settings.costPerKgUSD]);

    // Sync dimensions changes
    useEffect(() => {
      applyModelTransform(dimensions);
      updateGrid();
      if (currentModelRef.current) {
        const partCount = batchPartsRef.current.length > 0 ? batchPartsRef.current.length : 1;
        refreshVolumeStats(partCount);
      }
      if (activeCameraRef.current) updateLights(activeCameraRef.current);
    }, [dimensions]);

    // Drag and Drop handlers on Viewport
    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        if (e.dataTransfer.files.length > 1) {
          loadModelsFromFiles(Array.from(e.dataTransfer.files));
        } else {
          loadModelFromFile(e.dataTransfer.files[0]);
        }
      }
    };

    return (
      <div
        ref={containerRef}
        id="viewport"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 relative h-full w-full overflow-hidden select-none"
        style={{ backgroundColor: settings.backgroundColorHex }}
      >
        <canvas ref={canvasRef} id="canvas3d" className="absolute inset-0 w-full h-full block" />

        {/* Grid Controls — relocated here from Settings so they're right next to what they affect */}
        {loadedFileName && (
          <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
            <button
              onClick={() => setIsGridPanelOpen((prev) => !prev)}
              className={`p-2 rounded-lg border shadow-lg backdrop-blur-md cursor-pointer transition-colors ${
                settings.showGrid
                  ? 'bg-sky-600 border-sky-400 text-white'
                  : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:bg-slate-800'
              }`}
              title="Grid Options"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>

            {isGridPanelOpen && (
              <div className="w-56 p-3 rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md text-xs text-slate-200 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                    Grid
                  </span>
                  <button onClick={() => setIsGridPanelOpen(false)} className="cursor-pointer text-slate-500 hover:text-slate-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <label className="flex items-center justify-between cursor-pointer">
                  <span>Show Grid (G)</span>
                  <input
                    type="checkbox"
                    checked={settings.showGrid}
                    onChange={(e) => onUpdateSettings({ showGrid: e.target.checked })}
                    className="accent-sky-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                {settings.showGrid && (
                  <>
                    <div className="flex items-center justify-between">
                      <span>Minor Size (in):</span>
                      <input
                        type="number"
                        value={settings.gridSquareSizeInches}
                        step="0.0625"
                        min="0.001"
                        onChange={(e) =>
                          onUpdateSettings({ gridSquareSizeInches: parseFloat(e.target.value) || 0.125 })
                        }
                        className="w-16 text-right py-1 px-1.5 font-mono font-bold rounded-md border bg-[#1e293b] border-slate-600 text-sky-400"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Major (blue) Every (in):</span>
                      <input
                        type="number"
                        value={settings.gridMajorEveryInches}
                        step="0.25"
                        min="0.001"
                        onChange={(e) =>
                          onUpdateSettings({ gridMajorEveryInches: parseFloat(e.target.value) || 1 })
                        }
                        className="w-16 text-right py-1 px-1.5 font-mono font-bold rounded-md border bg-[#1e293b] border-slate-600 text-sky-400"
                      />
                    </div>
                    <div className="text-[10px] text-sky-400 leading-tight pt-1 border-t border-slate-700/60">
                      Grid sits at the bottom of the mesh, centered — true to scale in{' '}
                      <b>Orthographic View</b>.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Thickness Mode HUD / Progress Indicator */}
        {settings.material === 'thickness' && loadedFileName && (
          <div
            id="thicknessModeHud"
            className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-xl backdrop-blur-md text-xs pointer-events-none"
          >
            {thicknessProgress !== null ? (
              <div className="flex items-center gap-2 text-amber-400 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                <span>Analyzing wall thickness: {thicknessProgress}%</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 font-bold text-red-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse inline-block shadow-xs shadow-red-500/50" />
                  Thin Wall (&lt; {settings.minThicknessInches.toFixed(3)}&quot;)
                </span>
                <span className="text-slate-600">|</span>
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
                  Safe (&ge; {settings.minThicknessInches.toFixed(3)}&quot;)
                </span>
              </div>
            )}
          </div>
        )}

        {/* Loading Overlay */}
        {isLoading && (
          <div
            id="loadingOverlay"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-xs text-sky-400"
          >
            <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-sky-400 animate-spin" />
            <div className="mt-4 font-semibold text-sm tracking-wide">{loadingMessage}</div>
          </div>
        )}

        {/* Drag Over Visual Indicator */}
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-sky-500/10 border-4 border-dashed border-sky-400 backdrop-blur-xs pointer-events-none">
            <UploadCloud className="w-16 h-16 text-sky-400 animate-bounce" />
            <span className="mt-3 text-lg font-bold text-sky-300">
              Drop 3D file to load (.glb, .stl, .obj)
            </span>
          </div>
        )}

        {/* Empty Dropzone Card (when no model loaded yet) */}
        {!loadedFileName && !isLoading && (
          <div
            id="emptyDropzone"
            className="absolute z-10 flex flex-col items-center gap-3.5 p-8 rounded-2xl bg-slate-900/90 border-2 border-dashed border-slate-700 text-slate-300 shadow-2xl backdrop-blur-md text-center max-w-md mx-4"
          >
            <div className="p-3 rounded-full bg-sky-500/10 text-sky-400">
              <UploadCloud className="w-9 h-9" />
            </div>
            <div>
              <div className="text-base font-bold text-white mb-1">Load 3D Model</div>
              <div className="text-xs text-slate-400 max-w-xs leading-relaxed">
                Drag and drop your <strong>.GLB</strong>, <strong>.STL</strong>, or <strong>.OBJ</strong> file anywhere here, or choose an option below:
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2 w-full mt-1">
              <button
                id="btnViewportUpload"
                onClick={onOpenLocalUpload}
                className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs tracking-wide transition-all cursor-pointer shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                <span>Select 3D File</span>
              </button>

              {onOpenDriveModal && (
                <button
                  id="btnViewportDrive"
                  onClick={onOpenDriveModal}
                  className="w-full sm:flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-blue-400 hover:text-blue-300 font-medium text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Cloud className="w-4 h-4 text-blue-400" />
                  <span>Google Drive</span>
                </button>
              )}
            </div>

            <button
              onClick={loadDemoModel}
              className="text-xs text-amber-400 hover:text-amber-300 hover:underline cursor-pointer flex items-center gap-1.5 pt-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Or load sample figurine demo</span>
            </button>
          </div>
        )}
      </div>
    );
  }
);
