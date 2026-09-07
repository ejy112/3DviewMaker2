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
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  LoadedPart,
  MaterialKey,
  ModelDimensions,
  ResolutionOption,
  SnapDirection,
  ThemeMode,
  ViewerSettings,
  HdriManifestItem,
} from '../types';
import {
  Loader2,
  UploadCloud,
  Upload,
  Cloud,
  Sparkles,
  LayoutGrid,
  X,
  Scissors,
  Boxes,
  Image as ImageIcon,
  Contrast as ContrastIcon,
  Wand2,
  CloudSun,
  Lightbulb,
  Globe,
  Box,
  Square,
  Focus,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

export const DEFAULT_HDRI_PRESETS: HdriManifestItem[] = [
  { id: 'studio', name: 'Studio Neutral (Key & Fill)', file: 'hdri/studio-a.hdr', category: 'Studio' },
  { id: 'studio_contrast', name: 'Studio Contrast (Rim Kickers)', file: 'hdri/studio-b.hdr', category: 'Studio' },
  { id: 'warm_studio', name: 'Warm Studio (Amber Glow)', file: 'hdri/warm-studio.hdr', category: 'Studio' },
  { id: 'dark_studio', name: 'Dark Workshop (Moody Spot)', file: 'hdri/dark-studio.hdr', category: 'Studio' },
  { id: 'wood_studio', name: 'Wood Lounge (Warm Interior)', file: 'hdri/wood-studio.hdr', category: 'Studio' },
  { id: 'outdoor', name: 'Daylight (Pure Sun & Sky)', file: 'hdri/day.hdr', category: 'Outdoor' },
  { id: 'sunset', name: 'Golden Hour Sunset', file: 'hdri/golden.hdr', category: 'Outdoor' },
  { id: 'clearing_mist', name: 'Clearing Mist (Overcast Soft)', file: 'hdri/clearing-mist.hdr', category: 'Outdoor' },
  { id: 'interior', name: 'Interior Grand Hall', file: 'hdri/interior.hdr', category: 'Interior' },
];

export const deduplicateHdris = (items: HdriManifestItem[]): HdriManifestItem[] => {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const seenFiles = new Set<string>();
  const result: HdriManifestItem[] = [];
  for (const item of items) {
    const normId = item.id.toLowerCase().trim();
    const normName = item.name.toLowerCase().trim();
    const normFile = item.file.toLowerCase().trim();
    if (!seenIds.has(normId) && !seenNames.has(normName) && !seenFiles.has(normFile)) {
      seenIds.add(normId);
      seenNames.add(normName);
      seenFiles.add(normFile);
      result.push(item);
    }
  }
  return result;
};

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
  deleteHiddenParts: () => void;
  selectPart: (index: number | null) => void;
  toggleSelectedOrHoveredVisibility: () => void;
  toggleIsolateHoveredPart: () => void;
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
  isFullscreen?: boolean;
  // Fires whenever isolate mode (hover a part, press I) is entered or exited, with the isolated
  // part's display name, or null once exited — lets the sidebar show/disable accordingly.
  onIsolateChanged?: (isolatedPartName: string | null) => void;
  // Click-to-select a mesh in the viewport (blue bounding-box highlight). Controlled from the
  // parent so a click in the Loaded Meshes list can select/deselect the same part.
  selectedPartIndex?: number | null;
  onSelectPart?: (index: number | null) => void;
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
      isFullscreen,
      onIsolateChanged,
      selectedPartIndex,
      onSelectPart,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('Loading Model...');
    const [isDragOver, setIsDragOver] = useState(false);
    // Which floating viewport panel (if any) is currently open — only one at a time, matching
    // the rail's one-click-toggles-and-reveals pattern for Grid, Clipping Planes, Exploded View,
    // Background, Contrast, Post-Processing, and Shadows.
    const [openRailPanel, setOpenRailPanel] = useState<
      | 'grid'
      | 'lookdev'
      | 'env'
      | 'ortho'
      | 'clip'
      | 'explode'
      | 'bg'
      | 'contrast'
      | 'post'
      | 'shadows'
      | null
    >(null);
    const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
    const [partCount, setPartCount] = useState(0);
    const isFullscreenRef = useRef(false);

    // Isolate mode (hover a part, press I — see toggleIsolateHoveredPart). isolatedPartIndexRef
    // is which part is currently solo'd, used both to know we're isolated and to restrict
    // Fit to View to that part's own bounds. preIsolateVisibilityRef snapshots every part's
    // .visible flag from the moment isolate was entered, so exiting restores exactly what was
    // hidden/shown before — never just "show everything".
    const isolatedPartIndexRef = useRef<number | null>(null);
    const preIsolateVisibilityRef = useRef<boolean[] | null>(null);
    const [isolatedPartName, setIsolatedPartName] = useState<string | null>(null);
    // Whichever part the pointer is currently over — kept live by the canvas's own pointermove
    // handler (see the hover tooltip in the JSX below) via a continuous raycast, not just tracked
    // on demand. The I and H hotkeys (which fire on window, not the canvas) read
    // hoveredPartIndexRef directly rather than raycasting fresh from the last known pointer
    // position, since this is already being kept current for the tooltip anyway.
    const [hoveredPart, setHoveredPart] = useState<{ index: number; name: string; x: number; y: number } | null>(
      null
    );
    const hoveredPartIndexRef = useRef<number | null>(null);
    hoveredPartIndexRef.current = hoveredPart ? hoveredPart.index : null;
    const isolateRaycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
    // Click-to-select: which part is selected (blue THREE.BoxHelper outline, see selectPart) and
    // where the pointer went down, so a click-drag orbit isn't mistaken for a click-to-select.
    const selectedPartIndexRef = useRef<number | null>(null);
    const selectionHelperRef = useRef<THREE.BoxHelper | null>(null);
    const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
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

    // Environments: real HDR files (from /public/hdri + this manifest) take priority per preset,
    // falling back to a procedural PMREM-baked scene (buildEnvironmentScene) when no HDR matches
    // or fails to load. envSourceFileRef tracks which source (a specific .hdr file, or
    // 'procedural') is actually cached under envTexturesRef[preset] so a manifest refresh or a
    // newly-uploaded custom HDR correctly invalidates a stale cache entry instead of reusing it.
    const envTexturesRef = useRef<Partial<Record<string, THREE.Texture>>>({});
    const envSourceFileRef = useRef<Record<string, string>>({});
    const customHdriTextureRef = useRef<THREE.Texture | null>(null);
    const [hdriList, setHdriList] = useState<HdriManifestItem[]>(DEFAULT_HDRI_PRESETS);
    const hdriListRef = useRef<HdriManifestItem[]>(DEFAULT_HDRI_PRESETS);
    hdriListRef.current = hdriList;
    const [isHdriLoading, setIsHdriLoading] = useState<boolean>(false);

    // Lets a maintainer add more HDRs to public/hdri/manifest.json post-deploy (a static-hosting
    // friendly alternative to rebuilding the whole app) without touching this component's code —
    // merged with and deduplicated against the baked-in defaults so the manifest can't break the
    // built-in presets by omitting them.
    const loadHdriManifest = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}hdri/manifest.json?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.hdris) && data.hdris.length > 0) {
            const merged = deduplicateHdris([...data.hdris, ...DEFAULT_HDRI_PRESETS]);
            setHdriList(merged);
            hdriListRef.current = merged;
            envTexturesRef.current = {};
            envSourceFileRef.current = {};
          }
        }
      } catch (err) {
        console.warn('Could not load HDRI manifest:', err);
      }
    };

    useEffect(() => {
      loadHdriManifest();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Batch-loaded parts (for exploded view). basePosition is each part's resting local
    // position — (0,0,0) for batch-loaded files (each keeps its own baked-in origin and is
    // simply added to the group), but often non-zero for a single GLB's own child nodes (e.g. a
    // figure's Head/Arm/Base nodes are already offset from the model's local origin). Explode
    // must displace FROM that resting position, not overwrite it — see applyExplode.
    const batchPartsRef = useRef<
      { object: THREE.Object3D; localCenter: THREE.Vector3; basePosition: THREE.Vector3 }[]
    >([]);
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
    // Per-part clip planes while Exploded View is active — each part's own copy of the base
    // planes, shifted by that part's current explosion displacement, so a clip keeps cutting
    // through the model's resting/assembled geometry (locked to the part) instead of through
    // wherever empty space the part has since moved to. Cleared in cleanupScene — a plain Map
    // holds strong references to its keys, so old parts would otherwise never be released.
    const batchPartPlanesRef = useRef<Map<THREE.Object3D, THREE.Plane[]>>(new Map());

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

    // "Normal Map High-Color" LookDev material. Standard normal-encoding (normal*0.5+0.5, as
    // THREE.MeshNormalMaterial does it) inherently looks pastel/washed out on any mostly-flat
    // surface: a forward-facing normal encodes to (0.5, 0.5, 1.0), a pale lavender-blue, since
    // the X/Y channels sit at their neutral midpoint. Boosting HSV saturation after that encode
    // — rather than changing the encoding itself — keeps it recognizable as a normal map while
    // making both the flat-area base color and the curved-edge color transitions much more vivid.
    const vividNormalMaterialRef = useRef<THREE.ShaderMaterial>(
      new THREE.ShaderMaterial({
        uniforms: {
          uSaturationBoost: { value: 2.4 },
        },
        vertexShader: `
          varying vec3 vNormal;

          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uSaturationBoost;
          varying vec3 vNormal;

          vec3 rgb2hsv(vec3 c) {
            vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
          }

          vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }

          void main() {
            vec3 norm = normalize(vNormal);
            if (!gl_FrontFacing) norm = -norm;
            vec3 baseColor = norm * 0.5 + 0.5;

            vec3 hsv = rgb2hsv(baseColor);
            hsv.y = clamp(hsv.y * uSaturationBoost, 0.0, 1.0);
            gl_FragColor = vec4(hsv2rgb(hsv), 1.0);
          }
        `,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );

    // Volume / watertightness (unscaled — multiplied by scaleFactor^3 on demand)
    const unscaledVolumeCm3Ref = useRef<number>(0);
    const isWatertightRef = useRef<boolean>(true);

    // Bounds & Calculations
    const unscaledModelSizeRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));
    const unscaledCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
    const modelRadiusRef = useRef<number>(1);
    // Current world-space center of the bounding box recalculateBounds() last computed — distinct
    // from unscaledCenterRef (the unscaled model's own local-space center, used when reapplying
    // scale/rotation). Deleting a part shifts the assembly's true center away from the origin the
    // model was originally loaded centered on, so Fit to View / preset views must orbit around
    // this, not a hardcoded (0,0,0), or the remaining geometry ends up off-frame.
    const modelCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
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
      normal: THREE.ShaderMaterial;
      wireframe: THREE.MeshBasicMaterial;
      sketch: THREE.ShaderMaterial;
      matcapZebra: THREE.MeshMatcapMaterial;
    }>({
      grey: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.1 }),
      custom: new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95, metalness: 0.0 }),
      normal: vividNormalMaterialRef.current,
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
      batchPartPlanesRef.current.clear();
      if (selectedPartIndexRef.current !== null) selectPart(null);
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

    // While isolate mode is active, Fit to View / preset views should frame only the isolated
    // part — everything else's bounds ignored, even though it's still "loaded" and hidden the
    // same way an individually-unchecked Loaded Mesh is. Outside isolate mode this still covers
    // the whole model regardless of per-part visibility (Box3.setFromObject doesn't check
    // .visible), matching the existing "frame what's loaded, not just what's currently shown"
    // behavior for ordinary hidden parts.
    const recalculateBounds = () => {
      if (!currentModelRef.current) return;
      const isolatedIndex = isolatedPartIndexRef.current;
      const isolatedObject =
        isolatedIndex !== null ? batchPartsRef.current[isolatedIndex]?.object : null;
      const box = new THREE.Box3().setFromObject(isolatedObject || currentModelRef.current);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      modelRadiusRef.current = sphere.radius || 1;
      box.getCenter(modelCenterRef.current);
    };

    // Distance from modelCenterRef at which a sphere of modelRadiusRef fits inside the current
    // camera's view, with a little padding to match the ~3% margin updateOrthoFrustum uses. For
    // a perspective camera this MUST scale with the vertical FOV (which tracks focal length via
    // setFocalLength) — a fixed radius-based distance looks zoomed way out at wide focal lengths
    // (wide FOV) and cropped at long ones (narrow FOV), since the same distance subtends a very
    // different angular size depending on FOV. Orthographic framing doesn't depend on distance
    // at all (updateOrthoFrustum sets the frustum directly), so any reasonable clearance works.
    const computeFitDistance = (cam: THREE.Camera): number => {
      const radius = modelRadiusRef.current || 1;
      const persp = cam as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera) {
        const halfFovRad = THREE.MathUtils.degToRad(persp.fov) / 2;
        return (radius * 1.03) / Math.sin(halfFovRad);
      }
      return radius * 3.0;
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
    // Radial-gradient softbox card — used as a plane's map so it reads as a soft glowing studio
    // light panel in specular reflections, rather than a harsh flat rectangle.
    const createSoftboxTexture = (width = 256, height = 256, r = 1.0, g = 1.0, b = 1.0): THREE.CanvasTexture => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.48;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 1.0)`);
        grad.addColorStop(0.5, `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.92)`);
        grad.addColorStop(0.82, `rgba(${Math.round(r * 240)}, ${Math.round(g * 245)}, ${Math.round(b * 255)}, 0.35)`);
        grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    // Vertical gradient sky panorama — used as a sphere's inward-facing map for outdoor/sunset
    // presets so reflections show a natural sky gradient instead of one flat color.
    const createGradientSkyTexture = (topColor: string, midColor: string, bottomColor: string): THREE.CanvasTexture => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, topColor);
        grad.addColorStop(0.52, midColor);
        grad.addColorStop(1.0, bottomColor);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 512);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    // Procedural fallback used only when no real HDR file matches a preset, or one fails to
    // load — baked into a PMREM reflection map the same way a loaded HDR is, never rendered as a
    // visible backdrop. Softbox/sky-gradient cards read as smooth, natural-looking reflections
    // instead of the harsh flat-color panels the previous version used.
    const buildEnvironmentScene = (preset: string): THREE.Scene => {
      const envScene = new THREE.Scene();

      if (preset === 'outdoor') {
        const skyTex = createGradientSkyTexture('#1a65b8', '#8ec0eb', '#eef6fc');
        const skyGeo = new THREE.SphereGeometry(60, 32, 24);
        const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide });
        envScene.add(new THREE.Mesh(skyGeo, skyMat));

        const groundGeo = new THREE.CircleGeometry(60, 32);
        const groundMat = new THREE.MeshBasicMaterial({ color: 0x485a3c });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -6;
        envScene.add(ground);

        const sunTex = createSoftboxTexture(256, 256, 1.0, 0.98, 0.9);
        const sunMat = new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, side: THREE.DoubleSide });
        const sun = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), sunMat);
        sun.position.set(22, 30, 20);
        sun.lookAt(0, 0, 0);
        envScene.add(sun);

        const cloudTex = createSoftboxTexture(256, 256, 0.9, 0.95, 1.0);
        const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
        const cloud1 = new THREE.Mesh(new THREE.PlaneGeometry(32, 20), cloudMat);
        cloud1.position.set(-25, 22, -18);
        cloud1.lookAt(0, 0, 0);
        envScene.add(cloud1);

        const sunLight = new THREE.DirectionalLight(0xfffaed, 3.5);
        sunLight.position.set(22, 30, 20);
        envScene.add(sunLight);
      } else if (preset === 'interior') {
        const roomGeo = new THREE.BoxGeometry(60, 40, 60);
        const roomMat = new THREE.MeshBasicMaterial({ color: 0x2e2722, side: THREE.BackSide });
        envScene.add(new THREE.Mesh(roomGeo, roomMat));

        const floorGeo = new THREE.PlaneGeometry(60, 60);
        const floorMat = new THREE.MeshBasicMaterial({ color: 0x3d3024 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -19.9;
        envScene.add(floor);

        const ceilingLightTex = createSoftboxTexture(128, 128, 1.0, 0.94, 0.82);
        const ceilingMat = new THREE.MeshBasicMaterial({ map: ceilingLightTex, transparent: true, side: THREE.DoubleSide });
        for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), ceilingMat);
          panel.position.set(x, 19.8, z);
          panel.rotation.x = Math.PI / 2;
          envScene.add(panel);
        }

        const windowTex = createSoftboxTexture(256, 256, 0.92, 0.96, 1.0);
        const windowMat = new THREE.MeshBasicMaterial({ map: windowTex, transparent: true, side: THREE.DoubleSide });
        const win = new THREE.Mesh(new THREE.PlaneGeometry(26, 32), windowMat);
        win.position.set(29.8, 2, 0);
        win.rotation.y = -Math.PI / 2;
        envScene.add(win);
      } else if (preset === 'sunset') {
        const skyTex = createGradientSkyTexture('#1d1738', '#992d5c', '#ff8426');
        const skyGeo = new THREE.SphereGeometry(60, 32, 24);
        const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide });
        envScene.add(new THREE.Mesh(skyGeo, skyMat));

        const groundGeo = new THREE.CircleGeometry(60, 32);
        const groundMat = new THREE.MeshBasicMaterial({ color: 0x1f1619 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -6;
        envScene.add(ground);

        const sunTex = createSoftboxTexture(256, 256, 1.0, 0.88, 0.55);
        const sunMat = new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, side: THREE.DoubleSide });
        const sun = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), sunMat);
        sun.position.set(-30, 8, -20);
        sun.lookAt(0, 0, 0);
        envScene.add(sun);

        const rimTex = createSoftboxTexture(128, 128, 1.0, 0.55, 0.2);
        const rimMat = new THREE.MeshBasicMaterial({ map: rimTex, transparent: true, side: THREE.DoubleSide });
        const rim = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), rimMat);
        rim.position.set(20, 6, 25);
        rim.lookAt(0, 0, 0);
        envScene.add(rim);
      } else {
        // Studio (default) — multi-bank softbox setup: key, fill, overhead strip, rear kickers
        const backdropGeo = new THREE.SphereGeometry(60, 32, 24);
        const backdropMat = new THREE.MeshBasicMaterial({ color: 0x16191f, side: THREE.BackSide });
        envScene.add(new THREE.Mesh(backdropGeo, backdropMat));

        const floorGeo = new THREE.CircleGeometry(50, 32);
        const floorMat = new THREE.MeshBasicMaterial({ color: 0x1e222b });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -8;
        envScene.add(floor);

        const keySoftTex = createSoftboxTexture(256, 256, 1.0, 1.0, 1.0);
        const keySoftMat = new THREE.MeshBasicMaterial({ map: keySoftTex, transparent: true, side: THREE.DoubleSide });
        const keyPanel = new THREE.Mesh(new THREE.PlaneGeometry(22, 28), keySoftMat);
        keyPanel.position.set(20, 22, 20);
        keyPanel.lookAt(0, 0, 0);
        envScene.add(keyPanel);

        const fillSoftTex = createSoftboxTexture(256, 256, 0.88, 0.94, 1.0);
        const fillSoftMat = new THREE.MeshBasicMaterial({ map: fillSoftTex, transparent: true, side: THREE.DoubleSide });
        const fillPanel = new THREE.Mesh(new THREE.PlaneGeometry(18, 24), fillSoftMat);
        fillPanel.position.set(-22, 14, 18);
        fillPanel.lookAt(0, 0, 0);
        envScene.add(fillPanel);

        const overheadTex = createSoftboxTexture(256, 128, 1.0, 0.98, 0.92);
        const overheadMat = new THREE.MeshBasicMaterial({ map: overheadTex, transparent: true, side: THREE.DoubleSide });
        const overheadPanel = new THREE.Mesh(new THREE.PlaneGeometry(36, 10), overheadMat);
        overheadPanel.position.set(0, 30, -10);
        overheadPanel.lookAt(0, 0, 0);
        envScene.add(overheadPanel);

        const kickerTex = createSoftboxTexture(128, 256, 1.0, 0.95, 0.9);
        const kickerMat = new THREE.MeshBasicMaterial({ map: kickerTex, transparent: true, side: THREE.DoubleSide });
        const kickerLeft = new THREE.Mesh(new THREE.PlaneGeometry(8, 26), kickerMat);
        kickerLeft.position.set(-24, 8, -16);
        kickerLeft.lookAt(0, 0, 0);
        envScene.add(kickerLeft);

        const kickerRight = new THREE.Mesh(new THREE.PlaneGeometry(8, 26), kickerMat);
        kickerRight.position.set(24, 8, -16);
        kickerRight.lookAt(0, 0, 0);
        envScene.add(kickerRight);
      }

      return envScene;
    };

    // Rotates the HDR/PMREM environment map itself, independent of any directional light —
    // scene.environmentRotation/backgroundRotation are plain Euler properties three.js re-samples
    // the environment through on every frame, so this is cheap and never needs a texture reload.
    const applyHdrRotation = () => {
      if (!sceneRef.current) return;
      const rad = (((settingsRef.current.hdrRotationDeg || 0) % 360) * Math.PI) / 180;
      const scene = sceneRef.current as unknown as {
        environmentRotation?: THREE.Euler;
        backgroundRotation?: THREE.Euler;
      };
      scene.environmentRotation?.set(0, rad, 0);
      scene.backgroundRotation?.set(0, rad, 0);
      requestRender();
    };

    // Environment reflection/IBL strength. Deliberately scoped to scene.environmentIntensity
    // alone — NOT ambientLightRef (owned by contrastPercent, see the Contrast effect) and NOT
    // per-material envMapIntensity (which multiplies with scene.environmentIntensity rather than
    // replacing it, so setting both to the same factor would fade reflections quadratically).
    const applyEnvironmentIntensity = () => {
      if (!sceneRef.current) return;
      const envFactor = Math.max(0, settingsRef.current.envIntensity ?? 100) / 100;
      (sceneRef.current as unknown as { environmentIntensity?: number }).environmentIntensity = envFactor;
      requestRender();
    };

    // Resolves the current environment map in priority order — a user-uploaded custom HDR first,
    // then a real HDR file matching the selected preset (loaded + PMREM-baked once and cached),
    // finally the procedural buildEnvironmentScene fallback if no HDR matches or one fails to
    // load. Real HDR paths are prefixed with BASE_URL so they resolve correctly once deployed
    // under a sub-path (e.g. GitHub Pages), not just at the site root during local dev.
    const applyEnvironment = () => {
      if (!sceneRef.current || !rendererRef.current) return;
      const preset = settingsRef.current.environmentPreset || 'studio';

      if (customHdriTextureRef.current && settingsRef.current.customHdriFileName) {
        sceneRef.current.environment = customHdriTextureRef.current;
        applyHdrRotation();
        applyEnvironmentIntensity();
        return;
      }

      // "No Environment" — skip IBL/reflection map entirely rather than loading or building one.
      // The scene's own directional/ambient lighting rig (unaffected by scene.environment) still
      // lights the model normally; this just removes the environment reflections/contribution,
      // equivalent to intensity 0 but without touching the Environment Intensity slider itself.
      if (preset === 'none') {
        sceneRef.current.environment = null;
        requestRender();
        return;
      }

      const matchedHdri = hdriListRef.current.find(
        (h) => h.id.toLowerCase() === preset.toLowerCase() || h.name.toLowerCase() === preset.toLowerCase()
      );
      const targetSource = matchedHdri ? matchedHdri.file : 'procedural';

      if (envTexturesRef.current[preset] && envSourceFileRef.current[preset] === targetSource) {
        sceneRef.current.environment = envTexturesRef.current[preset]!;
        applyHdrRotation();
        applyEnvironmentIntensity();
        return;
      }

      const applyProceduralFallback = () => {
        if (!rendererRef.current || !sceneRef.current) return;
        const pmrem = new THREE.PMREMGenerator(rendererRef.current);
        const envScene = buildEnvironmentScene(preset);
        const tex = pmrem.fromScene(envScene, 0.04).texture;
        pmrem.dispose();
        envTexturesRef.current[preset] = tex;
        envSourceFileRef.current[preset] = 'procedural';
        sceneRef.current.environment = tex;
        applyHdrRotation();
        applyEnvironmentIntensity();
      };

      if (matchedHdri && matchedHdri.file) {
        setIsHdriLoading(true);
        const loader = new RGBELoader();
        loader.load(
          `${import.meta.env.BASE_URL}${matchedHdri.file}`,
          (hdrTexture) => {
            setIsHdriLoading(false);
            if (!rendererRef.current || !sceneRef.current) {
              hdrTexture.dispose();
              return;
            }
            hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
            const pmrem = new THREE.PMREMGenerator(rendererRef.current);
            pmrem.compileEquirectangularShader();
            const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
            hdrTexture.dispose();
            pmrem.dispose();
            envTexturesRef.current[preset] = envMap;
            envSourceFileRef.current[preset] = matchedHdri.file;
            if (settingsRef.current.environmentPreset === preset && !settingsRef.current.customHdriFileName) {
              sceneRef.current.environment = envMap;
              applyHdrRotation();
              applyEnvironmentIntensity();
            }
          },
          undefined,
          (err) => {
            console.warn(`Could not load HDR from ${matchedHdri.file}, falling back to procedural:`, err);
            setIsHdriLoading(false);
            applyProceduralFallback();
          }
        );
        return;
      }

      applyProceduralFallback();
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
      updateGridOrientation(cam);
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

    // Build one square of grid line segments in the local XY plane (z=0 locally) — this is a
    // flat card meant to be billboarded to face the camera, not a ground plane.
    const buildGridLineSegments = (
      halfExtent: number,
      spacing: number,
      color: THREE.ColorRepresentation,
      opacity: number
    ): THREE.LineSegments => {
      const positions: number[] = [];
      const start = -Math.ceil(halfExtent / spacing) * spacing;
      for (let x = start; x <= halfExtent + 1e-6; x += spacing) {
        positions.push(x, -halfExtent, 0, x, halfExtent, 0);
      }
      for (let y = start; y <= halfExtent + 1e-6; y += spacing) {
        positions.push(-halfExtent, y, 0, halfExtent, y, 0);
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

    // Background backdrop grid — a flat card, billboarded every frame (see updateGridOrientation)
    // to always face whichever camera is currently rendering, positioned behind the model. This
    // replaced an earlier world/model-aligned ground-plane grid, which was seen edge-on (and so
    // effectively invisible) from front/back/left/right views — exactly the views a backdrop
    // scale reference matters most for. Billboarding here is cheap (just a position/quaternion
    // copy, no geometry rebuild) so it's safe to do every frame, including during orbiting or a
    // turntable spin, unlike an older camera-facing grid that rebuilt its geometry per frame and
    // visibly popped.
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

      // Sized from the model's bounding radius (not a single axis) since the card can face any
      // direction depending on the current camera angle.
      recalculateBounds();
      const halfExtent = Math.max(modelRadiusRef.current * 1.8, minorSpacing * 8);

      const minorColor = settingsRef.current.gridMinorColorHex || '#334155';
      const majorColor = settingsRef.current.gridMajorColorHex || '#38bdf8';

      const group = new THREE.Group();
      group.add(buildGridLineSegments(halfExtent, minorSpacing, minorColor, 0.55));
      if (majorSpacing > minorSpacing * 1.5) {
        group.add(buildGridLineSegments(halfExtent, majorSpacing, majorColor, 0.85));
      }

      // Center cross-hair, drawn brightest, tied to the major grid color
      const axisGeom = new THREE.BufferGeometry();
      axisGeom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [-halfExtent, 0, 0, halfExtent, 0, 0, 0, -halfExtent, 0, 0, halfExtent, 0],
          3
        )
      );
      const axisMat = new THREE.LineBasicMaterial({ color: majorColor, transparent: false });
      group.add(new THREE.LineSegments(axisGeom, axisMat));

      gridHelperRef.current = group;
      sceneRef.current.add(group);
      updateGridOrientation(activeCameraRef.current);
      requestRender();
    };

    // Faces the grid card toward `cam` and tucks it behind the model (relative to that camera).
    // Uses world origin as the model's center rather than controls.target, so this works
    // equally well for the live OrbitControls camera and the standalone cameras used for
    // turnaround-image and turntable-video export, which don't share those controls.
    // Cheap enough to call every render — no geometry touched.
    const updateGridOrientation = (cam: THREE.Camera | null) => {
      const group = gridHelperRef.current;
      if (!group || !cam) return;
      const dirToTarget = cam.position.clone().negate();
      if (dirToTarget.lengthSq() < 1e-10) return;
      dirToTarget.normalize();

      const rad = modelRadiusRef.current || 1;
      group.position.copy(dirToTarget).multiplyScalar(rad * 1.5);
      group.quaternion.copy(cam.quaternion);
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

      const clippingActive = activeClipPlanes.length > 0;
      const isExploded = batchPartsRef.current.length > 1 && (settingsRef.current.explodeAmount || 0) > 0;
      const rot = currentModelRef.current ? currentModelRef.current.rotation : new THREE.Euler();
      const scale = dimensionsRef.current.scaleFactor || 1;

      if (isExploded && clippingActive) {
        // Pre-exploded per-object clipping: the slice is defined relative to the model's resting
        // assembly. Each part gets its own copy of the base planes, shifted by that part's current
        // world explosion displacement, so the cut stays locked to the part's pre-explosion
        // geometry as it travels — exactly as if it had been sliced before exploding, not
        // re-sliced against a plane sitting fixed in empty space.
        batchPartsRef.current.forEach((part) => {
          const localDelta = part.object.position.clone().sub(part.basePosition);
          const worldDelta = localDelta.applyEuler(rot).multiplyScalar(scale);

          let partPlanes = batchPartPlanesRef.current.get(part.object);
          if (!partPlanes || partPlanes.length !== activeClipPlanes.length) {
            partPlanes = activeClipPlanes.map(() => new THREE.Plane());
            batchPartPlanesRef.current.set(part.object, partPlanes);
          }

          for (let i = 0; i < activeClipPlanes.length; i++) {
            const basePlane = activeClipPlanes[i];
            partPlanes[i].normal.copy(basePlane.normal);
            // C_part = C_base - dot(normal, worldDelta)
            partPlanes[i].constant = basePlane.constant - basePlane.normal.dot(worldDelta);
          }

          part.object.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
              mats.forEach((m) => {
                const clipPlanesChanged = m.clippingPlanes !== partPlanes;
                m.clippingPlanes = partPlanes!;
                m.clipShadows = true;
                applyClipSideToMaterial(m, true);
                if (countChanged || clipPlanesChanged) {
                  m.needsUpdate = true;
                }
              });
            }
          });
        });
      } else if (currentModelRef.current) {
        currentModelRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
            mats.forEach((m) => {
              const clipPlanesChanged = m.clippingPlanes !== nextClippingPlanes;
              m.clippingPlanes = nextClippingPlanes;
              m.clipShadows = true;
              applyClipSideToMaterial(m, clippingActive);
              if (countChanged || clipPlanesChanged) {
                m.needsUpdate = true;
              }
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
      // The traversal above unconditionally set every mesh's clippingPlanes to the shared
      // (non-exploded) array — while Exploded View is active, that stomps over the per-part
      // compensated planes updateClippingPlanes() just built. Re-run it to put those back.
      if (batchPartsRef.current.length > 1 && (settingsRef.current.explodeAmount || 0) > 0) {
        updateClippingPlanes();
      }
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
      const center = modelCenterRef.current;
      const dir = new THREE.Vector3().subVectors(cam.position, controlsRef.current.target).normalize();
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);

      controlsRef.current.target.copy(center);
      cam.position.copy(center).addScaledVector(dir, computeFitDistance(cam));
      cam.lookAt(center);

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
      const cam = activeCameraRef.current;
      const center = modelCenterRef.current;
      const dist = computeFitDistance(cam);
      controlsRef.current.target.copy(center);

      const offset = new THREE.Vector3();
      switch (dir) {
        case 'front':
          offset.set(0, 0, dist);
          break;
        case 'back':
          offset.set(0, 0, -dist);
          break;
        case 'left':
          offset.set(dist, 0, 0);
          break;
        case 'right':
          offset.set(-dist, 0, 0);
          break;
        case 'top':
          offset.set(0, dist, 0.0001);
          break;
        case 'bottom':
          offset.set(0, -dist, 0.0001);
          break;
        case 'isofl':
          offset.set(dist * 0.707, dist * 0.5, dist * 0.707);
          break;
        case 'isofr':
          offset.set(-dist * 0.707, dist * 0.5, dist * 0.707);
          break;
      }
      cam.position.copy(center).add(offset);

      cam.lookAt(center);
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
            batchPartsRef.current.push({
              object: obj,
              localCenter: new THREE.Vector3(),
              basePosition: obj.position.clone(),
            });
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

    // Push each part away from the group's shared center, scaled by explodeAmount (0-1), offset
    // from its own resting basePosition — not from world origin, which snapped GLB child nodes
    // (whose authored local position is already non-zero) to the wrong place once explode came
    // back down to 0 instead of restoring their real layout.
    const applyExplode = () => {
      if (batchPartsRef.current.length === 0) return;
      const amount = Math.max(0, Math.min(1, settingsRef.current.explodeAmount || 0));
      const magnitude = (unscaledModelSizeRef.current.length() || 1) * 0.6;
      const center = batchGroupCenterRef.current;
      batchPartsRef.current.forEach((part) => {
        const dir = part.localCenter.clone().sub(center);
        if (dir.lengthSq() < 1e-8) {
          part.object.position.copy(part.basePosition);
          return;
        }
        dir.normalize().multiplyScalar(amount * magnitude);
        part.object.position.copy(part.basePosition).add(dir);
      });
      // Synchronize clipping planes with exploded part positions (slices pre-exploded, then carried along)
      updateClippingPlanes();
    };

    // Populates batchPartsRef from a freshly-loaded single GLB/glTF's own top-level nodes, so
    // Explode/Loaded-Meshes work for any multi-part model, not only files brought in through the
    // dedicated multi-file Batch Load flow. A part must have at least one mesh descendant to
    // count (skips empty transform/helper nodes); fewer than 2 such nodes means there's nothing
    // separable at that level, so two fallbacks are tried before giving up: unwrap a single
    // top-level wrapper group one level deeper (common when an exporter nests everything under
    // one root transform node), then fall back to every individual mesh in the file as its own
    // part (finest-grained — still lets Isolate/click-select/Loaded-Meshes work on a flat GLB
    // with no named sub-groups at all).
    const detectExplodableParts = (root: THREE.Object3D) => {
      const hasMeshDescendant = (obj: THREE.Object3D) => {
        let found = false;
        obj.traverse((n) => {
          if ((n as THREE.Mesh).isMesh) found = true;
        });
        return found;
      };

      let candidates = root.children.filter(hasMeshDescendant);
      if (candidates.length === 1 && candidates[0].children.filter(hasMeshDescendant).length >= 2) {
        candidates = candidates[0].children.filter(hasMeshDescendant);
      }
      if (candidates.length < 2) {
        const meshNodes: THREE.Mesh[] = [];
        root.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) meshNodes.push(child as THREE.Mesh);
        });
        if (meshNodes.length >= 2) {
          candidates = meshNodes;
        } else {
          batchPartsRef.current = [];
          return;
        }
      }

      root.updateMatrixWorld(true);
      batchPartsRef.current = candidates.map((object) => ({
        object,
        localCenter: new THREE.Vector3(),
        basePosition: object.position.clone(),
      }));
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
      setPartCount(batchPartsRef.current.length);
      onPartsChanged?.(
        batchPartsRef.current.map((part, i) => ({
          name: getPartName(part.object, i),
          visible: part.object.visible,
        }))
      );
    };

    // Click-to-select a part: draws a blue bounding-box outline around it and notifies the
    // parent (Sidebar highlights the matching Loaded Meshes row). Passing null (or clicking empty
    // space / the same part again) clears the selection.
    const selectPart = (index: number | null) => {
      selectedPartIndexRef.current = index;
      onSelectPart?.(index);
      if (selectionHelperRef.current) {
        const part = index !== null ? batchPartsRef.current[index] : null;
        if (part && part.object.visible) {
          selectionHelperRef.current.setFromObject(part.object);
          selectionHelperRef.current.visible = true;
        } else {
          selectionHelperRef.current.visible = false;
        }
      }
      requestRender();
    };

    const togglePartVisibility = (index: number) => {
      const part = batchPartsRef.current[index];
      if (!part) return;
      part.object.visible = !part.object.visible;
      if (!part.object.visible && selectedPartIndexRef.current === index) {
        selectPart(null);
      } else if (part.object.visible && selectedPartIndexRef.current === index) {
        selectPart(index);
      }
      notifyPartsChanged();
      requestRender();
    };

    // Walks up from a raycast hit (a mesh, possibly nested inside a part's own group) to find
    // which top-level tracked part owns it.
    const getPartIndexFromObject = (obj: THREE.Object3D): number | null => {
      let node: THREE.Object3D | null = obj;
      while (node) {
        const idx = batchPartsRef.current.findIndex((part) => part.object === node);
        if (idx !== -1) return idx;
        node = node.parent;
      }
      return null;
    };

    // Restores exactly the visibility each part had the moment isolate was entered — never just
    // "show everything" — since some parts may have already been individually hidden beforehand.
    const exitIsolate = () => {
      const snapshot = preIsolateVisibilityRef.current;
      if (snapshot) {
        batchPartsRef.current.forEach((part, i) => {
          part.object.visible = snapshot[i] ?? true;
        });
      }
      isolatedPartIndexRef.current = null;
      preIsolateVisibilityRef.current = null;
      setIsolatedPartName(null);
      onIsolateChanged?.(null);
      notifyPartsChanged();
      recenterView();
    };

    // I, hovering a part: solos it (hides every other loaded part) and snapshots the prior
    // visibility of all of them so a second I press — regardless of what's hovered by then,
    // per spec — restores precisely that, not a blanket "show all". No-op if there's nothing to
    // isolate (single-part model) or nothing under the cursor. hoveredPartIndexRef is kept live
    // by the canvas's own pointermove handler (see the hover tooltip), so this just reads it.
    const toggleIsolateHoveredPart = () => {
      if (isolatedPartIndexRef.current !== null) {
        exitIsolate();
        return;
      }

      const hitIndex = hoveredPartIndexRef.current;
      if (batchPartsRef.current.length <= 1 || hitIndex === null || !batchPartsRef.current[hitIndex]) {
        return;
      }

      preIsolateVisibilityRef.current = batchPartsRef.current.map((part) => part.object.visible);
      isolatedPartIndexRef.current = hitIndex;
      batchPartsRef.current.forEach((part, i) => {
        part.object.visible = i === hitIndex;
      });

      const name = getPartName(batchPartsRef.current[hitIndex].object, hitIndex);
      setIsolatedPartName(name);
      onIsolateChanged?.(name);
      notifyPartsChanged();
      recenterView();
    };

    // H: toggle visibility of whichever part is currently selected (click-to-select), or failing
    // that whatever's currently hovered.
    const toggleSelectedOrHoveredVisibility = () => {
      if (selectedPartIndexRef.current !== null) {
        togglePartVisibility(selectedPartIndexRef.current);
        return;
      }
      const hitIndex = hoveredPartIndexRef.current;
      if (hitIndex === null || !batchPartsRef.current[hitIndex]) return;
      togglePartVisibility(hitIndex);
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

    // Removes one part's object from the scene graph and frees its geometry — the cheap, O(part
    // size) half of a delete. Collects materials the part *might* have exclusively owned into
    // candidateMaterials without disposing them yet, since a sibling part elsewhere in the model
    // (still to be checked) may share the same material instance. Deliberately excludes the
    // O(whole model) work (material-still-used scan, bounds, volume/watertight) so a caller
    // removing several parts at once can batch all of that into one pass afterward instead of
    // repeating it per part — see settleAfterPartRemoval.
    const removePartCore = (index: number, candidateMaterials: Set<THREE.Material>) => {
      const part = batchPartsRef.current[index];
      if (!part) return;

      // Deleting while isolated would leave isolatedPartIndexRef and the visibility snapshot
      // pointing at indices that no longer match after the splice below — exit cleanly first
      // (the sidebar already disables delete while isolated; this is a defensive backstop).
      // A no-op on every call after the first, once isolatedPartIndexRef is already cleared.
      if (isolatedPartIndexRef.current !== null) exitIsolate();

      // Same reasoning for the click-to-select index: clear it if the deleted part was selected,
      // or shift it down if a part before it in the list is being removed.
      if (selectedPartIndexRef.current === index) {
        selectPart(null);
      } else if (selectedPartIndexRef.current !== null && selectedPartIndexRef.current > index) {
        selectPart(selectedPartIndexRef.current - 1);
      }

      collectMeshMaterials(part.object, candidateMaterials);

      part.object.parent?.remove(part.object);
      batchPartsRef.current.splice(index, 1);

      part.object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry?.dispose();
      });
    };

    // The O(whole remaining model) settle pass after one or more removePartCore calls: frees
    // materials no longer referenced anywhere, recomputes bounds/grid, and refreshes volume
    // stats. Callers should batch every removal they can into a single candidateMaterials set
    // and call this once at the end, not per part — computeVolumeAndWatertight in particular
    // walks every triangle of the remaining model, so repeating it per part turns an N-part
    // batch delete into an O(N * triangles) stall.
    const settleAfterPartRemoval = (candidateMaterials: Set<THREE.Material>) => {
      if (currentModelRef.current) {
        const stillUsed = new Set<THREE.Material>();
        collectMeshMaterials(currentModelRef.current, stillUsed);
        candidateMaterials.forEach((m) => {
          if (!stillUsed.has(m)) m.dispose();
        });

        recalculateBounds();
        updateGrid();
      } else {
        candidateMaterials.forEach((m) => m.dispose());
      }
      notifyPartsChanged();
      requestRender();

      // Defer the triangle-walk to the next frame so the deletion itself (mesh gone, list
      // updated, viewport repainted) is what the click feels like — the volume/weight/cost
      // panel catches up a beat later instead of the whole interaction stalling on it.
      requestAnimationFrame(() => {
        if (!currentModelRef.current) return;
        const { meshCount } = computeVolumeAndWatertight(currentModelRef.current);
        const partCount = batchPartsRef.current.length > 0 ? batchPartsRef.current.length : 1;
        refreshVolumeStats(Math.max(partCount, meshCount > 0 ? 1 : 0));
      });
    };

    const deletePart = (index: number) => {
      const candidateMaterials = new Set<THREE.Material>();
      removePartCore(index, candidateMaterials);
      settleAfterPartRemoval(candidateMaterials);
    };

    // Purges every currently-hidden part from the scene/memory in one action. Batches every
    // removal's material bookkeeping into one set and runs the expensive settle pass (material
    // GC scan, bounds, volume/watertight) exactly once at the end instead of once per part — see
    // removePartCore/settleAfterPartRemoval. Runs highest-index-first so earlier splices don't
    // shift the indices still queued for removal.
    const deleteHiddenParts = () => {
      const hiddenIndices = batchPartsRef.current
        .map((part, i) => (!part.object.visible ? i : -1))
        .filter((i) => i !== -1);
      if (hiddenIndices.length === 0) return;

      const candidateMaterials = new Set<THREE.Material>();
      for (let i = hiddenIndices.length - 1; i >= 0; i--) {
        removePartCore(hiddenIndices[i], candidateMaterials);
      }
      settleAfterPartRemoval(candidateMaterials);
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
      // recalculateBounds() above may have just recentered modelCenterRef away from the world
      // origin (deleting parts or isolating one shifts the remaining geometry's bounding center) —
      // every view position/look-at below must pivot around that center, not (0, 0, 0), or a
      // model whose center has drifted renders outside the frustum on axes it drifted along.
      const exportCenter = modelCenterRef.current.clone();
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
        exportCam.position.copy(exportCenter).add(v.pos);
        exportCam.lookAt(exportCenter);
        exportCam.updateProjectionMatrix();

        updateLights(exportCam);

        if (includeGrid) {
          if (!gridHelperRef.current) updateGrid();
          if (gridHelperRef.current) gridHelperRef.current.visible = true;
          updateGridOrientation(exportCam);
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
    // Restores the live-view resolution/state after either export path finishes (or bails out) —
    // shared so Path A (WebCodecs) and Path B (MediaRecorder) can't drift into inconsistent
    // cleanup as they're each edited over time.
    const restoreLiveViewAfterExport = (origW: number, origH: number, cam: THREE.Camera) => {
      if (!rendererRef.current) return;
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

    // Turntable video export, with two paths:
    //
    // Path A — WebCodecs VideoEncoder + mp4-muxer, used whenever format is 'mp4' and the browser
    // supports it (all Chromium browsers — the large majority of usage). MediaRecorder's own
    // 'video/mp4' output is unreliable: MediaRecorder.isTypeSupported('video/mp4') returns false
    // in stock Chrome/Edge entirely (silently falling back to webm despite the button saying
    // "Export MP4"), and even where a browser does report mp4 support, MediaRecorder-produced
    // containers can be poorly structured (e.g. moov placement) and fail to play in stricter
    // players. Path A sidesteps all of that by manually encoding each frame into a real,
    // standards-compliant MP4 container itself — not dependent on what the browser's recorder
    // happens to support.
    //
    // Path B — MediaRecorder, used for webm, and as the fallback for browsers without WebCodecs
    // (Firefox, older Safari) or where Path A throws for any reason.
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

      onProgress('Initializing video encoder...');
      recalculateBounds();

      // Temporarily render at a higher fixed resolution for a cleaner, less compressed-looking
      // capture than whatever the on-screen canvas size happens to be. H.264 encoders (Path A,
      // and most MediaRecorder mp4/h264 backends too) strictly require even width/height.
      const origW = containerRef.current?.clientWidth || canvasRef.current.width;
      const origH = containerRef.current?.clientHeight || canvasRef.current.height;
      const aspect = origW / origH;
      const targetLongEdge = 1600;
      let exportW = Math.round(aspect >= 1 ? targetLongEdge : targetLongEdge * aspect);
      let exportH = Math.round(aspect >= 1 ? targetLongEdge / aspect : targetLongEdge);
      if (exportW % 2 !== 0) exportW += 1;
      if (exportH % 2 !== 0) exportH += 1;
      rendererRef.current.setPixelRatio(1);
      rendererRef.current.setSize(exportW, exportH, true);
      if (composerRef.current) composerRef.current.setSize(exportW, exportH);
      if (cameraPerspRef.current) {
        cameraPerspRef.current.aspect = exportW / exportH;
        cameraPerspRef.current.updateProjectionMatrix();
      }
      updateOrthoFrustum();

      // Rotation math shared by both paths — identical to the live turntable loop and the
      // export's own preview, just driven by a frame index (Path A) or wall-clock elapsed time
      // (Path B) instead of requestAnimationFrame deltas.
      const fps = 30;
      const speedSetting = settingsRef.current.turntableSpeed || 'normal';
      const durationMs = speedSetting === 'slow' ? 8000 : speedSetting === 'fast' ? 2000 : 4000;
      const totalFrames = Math.round((durationMs / 1000) * fps);
      const dirSign = (settingsRef.current.turntableDirection || 'cw') === 'ccw' ? -1 : 1;
      const useEasing = !!settingsRef.current.videoEasing;
      const cam = activeCameraRef.current;
      const target = controlsRef.current?.target || new THREE.Vector3();
      const relX0 = cam.position.x - target.x;
      const relZ0 = cam.position.z - target.z;
      const radius = Math.sqrt(relX0 ** 2 + relZ0 ** 2) || modelRadiusRef.current * 3.0;
      const camY = cam.position.y;
      const initialAngle = Math.atan2(relX0, relZ0);
      const easeProgress = (progress: number) =>
        useEasing
          ? progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2
          : progress;
      const cleanName = (loadedFileName || 'model').replace(/\.[^/.]+$/, '');

      // Path A: real MP4 via WebCodecs + mp4-muxer
      if (format === 'mp4' && typeof VideoEncoder !== 'undefined') {
        let supportedCodec: string | null = null;
        for (const codec of ['avc1.42001f', 'avc1.4d002a', 'avc1.64002a', 'avc1.42E01E']) {
          try {
            const res = await VideoEncoder.isConfigSupported({
              codec,
              width: exportW,
              height: exportH,
              bitrate: 12_000_000,
              framerate: fps,
            });
            if (res?.supported) {
              supportedCodec = codec;
              break;
            }
          } catch {
            // try the next candidate
          }
        }

        if (supportedCodec) {
          try {
            onProgress('Rendering MP4: 0%...');
            const muxer = new Muxer({
              target: new ArrayBufferTarget(),
              video: { codec: 'avc', width: exportW, height: exportH },
              fastStart: 'in-memory',
            });

            let encoderError: Error | null = null;
            const encoder = new VideoEncoder({
              output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
              error: (err) => {
                console.error('VideoEncoder error', err);
                encoderError = err;
              },
            });
            encoder.configure({ codec: supportedCodec, width: exportW, height: exportH, bitrate: 12_000_000, framerate: fps });

            for (let i = 0; i < totalFrames; i++) {
              if (encoderError) throw encoderError;
              const progress = i / totalFrames;
              const angle = initialAngle + dirSign * (easeProgress(progress) * Math.PI * 2);

              cam.position.x = target.x + radius * Math.sin(angle);
              cam.position.z = target.z + radius * Math.cos(angle);
              cam.position.y = camY;
              cam.lookAt(target);

              updateLights(cam);
              renderFrame(cam, false);

              const timestampMicros = Math.round(i * (1_000_000 / fps));
              const frame = new VideoFrame(canvasRef.current, { timestamp: timestampMicros });
              encoder.encode(frame, { keyFrame: i % 30 === 0 });
              frame.close();

              onProgress(`Rendering MP4: ${Math.round(progress * 100)}% (${i + 1}/${totalFrames})...`);
              if (i % 6 === 0) await new Promise((r) => requestAnimationFrame(r));
            }

            onProgress('Finalizing MP4...');
            await encoder.flush();
            muxer.finalize();
            encoder.close();

            const mp4Blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
            onComplete(mp4Blob, `${cleanName}_Turnaround.mp4`);
            restoreLiveViewAfterExport(origW, origH, cam);
            return;
          } catch (webCodecsErr) {
            console.warn('WebCodecs MP4 export failed, falling back to MediaRecorder:', webCodecsErr);
          }
        }
      }

      // Path B: MediaRecorder fallback (webm, or mp4 on browsers without usable WebCodecs)
      onProgress('Testing encoder...');
      let selectedMimeType = getSupportedVideoMimeType(format);
      if (!selectedMimeType) selectedMimeType = getSupportedVideoMimeType('webm');
      if (!selectedMimeType) {
        restoreLiveViewAfterExport(origW, origH, cam);
        throw new Error('Video recording is not supported in this browser.');
      }

      const works = await testCanvasRecording(selectedMimeType, canvasRef.current);
      if (!works && format === 'mp4') {
        selectedMimeType = getSupportedVideoMimeType('webm');
      }

      onProgress('Recording 360° turntable...');

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
            onComplete(blob, `${cleanName}_Turnaround.${ext}`);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        recorder.onerror = (e: any) => reject(e.error || new Error('MediaRecorder error'));
      });

      recorder.start(100);

      const startTime = performance.now();
      await new Promise<void>((resolve) => {
        const renderStep = (now: number) => {
          if (!rendererRef.current || !sceneRef.current) return;
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / durationMs, 1.0);
          const angle = initialAngle + dirSign * (easeProgress(progress) * Math.PI * 2);

          cam.position.x = target.x + radius * Math.sin(angle);
          cam.position.z = target.z + radius * Math.cos(angle);
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

      restoreLiveViewAfterExport(origW, origH, cam);
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
      deleteHiddenParts,
      selectPart,
      toggleSelectedOrHoveredVisibility,
      toggleIsolateHoveredPart,
    }));

    // Sync external selectedPartIndex (e.g. a click on the Loaded Meshes list) into the
    // internal ref/BoxHelper state that drives the viewport highlight.
    useEffect(() => {
      if (selectedPartIndex !== undefined && selectedPartIndex !== selectedPartIndexRef.current) {
        selectPart(selectedPartIndex);
      }
    }, [selectedPartIndex]);

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

      // Click-to-select outline — a plain BoxHelper re-fit to the clicked part each time
      // selectPart runs; hidden until something is actually selected.
      const selectionHelper = new THREE.BoxHelper(new THREE.Mesh(), 0x38bdf8);
      selectionHelper.visible = false;
      scene.add(selectionHelper);
      selectionHelperRef.current = selectionHelper;

      const handlePointerDown = (event: PointerEvent) => {
        pointerDownPosRef.current = { x: event.clientX, y: event.clientY };
        if (viewHelperRef.current && !isFullscreenRef.current) {
          viewHelperRef.current.handleClick(event);
          requestRender();
        }
      };
      canvas.addEventListener('pointerdown', handlePointerDown);

      // Click-to-select: a pointerup within a small radius of the matching pointerdown counts as
      // a click (not a drag-orbit release); it raycasts against the loaded model and selects
      // whichever tracked part owns the hit mesh, toggling off on a second click of the same part.
      const handlePointerUp = (event: PointerEvent) => {
        const dx = Math.abs(event.clientX - pointerDownPosRef.current.x);
        const dy = Math.abs(event.clientY - pointerDownPosRef.current.y);
        if (dx > 6 || dy > 6) return;
        if (!activeCameraRef.current || !currentModelRef.current) return;

        const rect = canvas.getBoundingClientRect();
        const ndc = {
          x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
        };
        isolateRaycasterRef.current.setFromCamera(ndc as THREE.Vector2, activeCameraRef.current);
        const hits = isolateRaycasterRef.current.intersectObjects(currentModelRef.current.children, true);
        const hit = hits.find((h) => h.object.visible);

        if (hit) {
          const matchedIdx = getPartIndexFromObject(hit.object);
          selectPart(matchedIdx !== null && selectedPartIndexRef.current !== matchedIdx ? matchedIdx : null);
        } else {
          selectPart(null);
        }
      };
      canvas.addEventListener('pointerup', handlePointerUp);

      // Continuous hover tracking, for the tooltip and as the source the I/H hotkeys read from.
      // Skipped while any mouse button is held (event.buttons !== 0) — mid-orbit-drag isn't
      // "hovering" a part, and re-raycasting on every drag tick would just be wasted work.
      const handlePointerMove = (event: PointerEvent) => {
        if (event.buttons !== 0 || !activeCameraRef.current || !currentModelRef.current) {
          if (hoveredPartIndexRef.current !== null) setHoveredPart(null);
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const ndc = {
          x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
        };
        isolateRaycasterRef.current.setFromCamera(ndc as THREE.Vector2, activeCameraRef.current);
        const hits = isolateRaycasterRef.current.intersectObjects(currentModelRef.current.children, true);
        const hit = hits.find((h) => h.object.visible);

        if (hit) {
          const matchedIdx = getPartIndexFromObject(hit.object);
          if (matchedIdx !== null && batchPartsRef.current[matchedIdx]) {
            setHoveredPart({
              index: matchedIdx,
              name: getPartName(batchPartsRef.current[matchedIdx].object, matchedIdx),
              x: event.clientX,
              y: event.clientY,
            });
            return;
          }
        }
        if (hoveredPartIndexRef.current !== null) setHoveredPart(null);
      };
      canvas.addEventListener('pointermove', handlePointerMove);

      const handlePointerLeave = () => setHoveredPart(null);
      canvas.addEventListener('pointerleave', handlePointerLeave);

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
          const speedSettingLive = settingsRef.current.turntableSpeed || 'normal';
          const speedMultLive =
            speedSettingLive === 'slow' ? 0.5 : speedSettingLive === 'fast' ? 2.0 : 1.0;
          const dirSignLive = (settingsRef.current.turntableDirection || 'cw') === 'ccw' ? -1 : 1;
          const speed = 0.008 * speedMultLive * dirSignLive;
          const cam = activeCameraRef.current;
          const target = controlsRef.current.target;
          // Rotate relative to the orbit target, not world origin — recenterView/snapView can
          // now put that target away from (0,0,0) (see modelCenterRef), and orbiting around the
          // origin instead of the actual model center would send the camera drifting off-model.
          // The +speed sign here (sin(θ+speed) via a(+),b(+) angle-sum expansion) is chosen to
          // match exportTurntableVideo's `angle = initialAngle + progress*2π` convention — the
          // two used to rotate in OPPOSITE directions (the recorded video spun backwards from
          // what the live preview showed) because this loop's old x*cos-z*sin form is actually
          // sin(θ-speed), decreasing θ while the export increases it.
          const relX = cam.position.x - target.x;
          const relZ = cam.position.z - target.z;
          cam.position.x = target.x + (relX * Math.cos(speed) + relZ * Math.sin(speed));
          cam.position.z = target.z + (-relX * Math.sin(speed) + relZ * Math.cos(speed));
          cam.lookAt(target);

          // The grid backdrop re-orients every render (see renderFrame/updateGridOrientation)
          // by just copying position/quaternion — no geometry rebuild — so billboarding it
          // through a turntable spin stays smooth instead of popping.
          needsRenderRef.current = true;
        }

        if (needsRenderRef.current || cameraMoved) {
          if (activeCameraRef.current) {
            updateLights(activeCameraRef.current);
            renderFrame(activeCameraRef.current, !isFullscreenRef.current);
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
        canvas.removeEventListener('pointerup', handlePointerUp);
        canvas.removeEventListener('pointermove', handlePointerMove);
        canvas.removeEventListener('pointerleave', handlePointerLeave);
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
    }, [
      settings.showGrid,
      settings.gridSquareSizeInches,
      settings.gridMajorEveryInches,
      settings.gridMinorColorHex,
      settings.gridMajorColorHex,
    ]);

    // Fullscreen — hides the icon rail/panels (via the component's own conditional render) and
    // the corner axis gizmo (by skipping ViewHelper rendering/hit-testing in the main loop).
    useEffect(() => {
      isFullscreenRef.current = !!isFullscreen;
      if (!isFullscreen) setOpenRailPanel(null);
      requestRender();
    }, [isFullscreen]);

    // Environment preset / custom HDR (PMREM lookups are cached per-preset, so this is cheap
    // after first use — real reload work only happens the first time a given preset is selected).
    useEffect(() => {
      applyEnvironment();
      requestRender();
    }, [settings.environmentPreset, settings.customHdriFileName]);

    // HDR rotation — deliberately its OWN effect, never bundled into the reload effect above.
    // Rotation is a cheap Euler update on the already-loaded texture (see applyHdrRotation), not
    // a reason to re-check the cache or re-trigger a network load, and — this is the actual fix
    // for the reported "rotation doesn't update" bug — putting it in its own effect means its own
    // dependency can never accidentally be left out of a longer, unrelated list.
    useEffect(() => {
      applyHdrRotation();
    }, [settings.hdrRotationDeg]);

    // Environment reflection/IBL intensity — same reasoning: cheap scalar update, own effect.
    useEffect(() => {
      applyEnvironmentIntensity();
    }, [settings.envIntensity]);

    // Post-processing (SSAO / antialiasing)
    useEffect(() => {
      syncPostProcessing();
      requestRender();
    }, [settings.ssaoEnabled, settings.ssaoRadius, settings.ssaoIntensity, settings.ssaoBias, settings.antialiasMode]);

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

    // Accepts .hdr, .exr, or a plain equirectangular panorama image — whichever the user has to
    // hand — and PMREM-bakes it exactly like a manifest HDR, then makes it the active environment.
    const handleUploadHdri = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !rendererRef.current) return;
      const fileName = file.name;
      const ext = fileName.split('.').pop()?.toLowerCase();
      const objectUrl = URL.createObjectURL(file);

      const onTextureReady = (texture: THREE.Texture) => {
        if (!rendererRef.current || !sceneRef.current) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        const pmrem = new THREE.PMREMGenerator(rendererRef.current);
        const envMap = pmrem.fromEquirectangular(texture).texture;
        texture.dispose();
        pmrem.dispose();
        URL.revokeObjectURL(objectUrl);

        if (customHdriTextureRef.current) customHdriTextureRef.current.dispose();
        customHdriTextureRef.current = envMap;
        onUpdateSettings({ customHdriFileName: fileName });
      };

      if (ext === 'hdr') {
        new RGBELoader().load(objectUrl, onTextureReady, undefined, (err) => {
          console.error('Failed to load HDR file', err);
          URL.revokeObjectURL(objectUrl);
        });
      } else if (ext === 'exr') {
        new EXRLoader().load(objectUrl, onTextureReady, undefined, (err) => {
          console.error('Failed to load EXR file', err);
          URL.revokeObjectURL(objectUrl);
        });
      } else {
        new THREE.TextureLoader().load(
          objectUrl,
          (tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            tex.colorSpace = THREE.SRGBColorSpace;
            onTextureReady(tex);
          },
          undefined,
          (err) => {
            console.error('Failed to load image panorama', err);
            URL.revokeObjectURL(objectUrl);
          }
        );
      }
      e.target.value = '';
    };

    const handleClearCustomHdri = () => {
      if (customHdriTextureRef.current) {
        customHdriTextureRef.current.dispose();
        customHdriTextureRef.current = null;
      }
      onUpdateSettings({ customHdriFileName: undefined });
    };

    const railBtnClass = (isOn: boolean) =>
      `p-2 rounded-lg border shadow-lg backdrop-blur-md cursor-pointer transition-colors ${
        isOn
          ? 'bg-sky-600 border-sky-400 text-white'
          : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:bg-slate-800'
      }`;
    const railPanelClass =
      'w-56 p-3 rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md text-xs text-slate-200 flex flex-col gap-2.5';
    const railPanelHeader = (title: string) => (
      <div className="flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider text-slate-400 text-[10px]">{title}</span>
        <button onClick={() => setOpenRailPanel(null)} className="cursor-pointer text-slate-500 hover:text-slate-300">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );

    const anyClipEnabled =
      settings.clipping.x.enabled || settings.clipping.y.enabled || settings.clipping.z.enabled;

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

        {/* Floating viewport control rail. Every icon follows the same one-click pattern: click
            toggles that control on/off AND opens/closes its settings panel; the panel's own X
            only closes the panel, leaving the setting as-is. Grouped into Geometry (Grid,
            Clipping Planes, Exploded View) and Look & Lighting (Background, Contrast,
            Post-Processing, Shadows) with a spacer, not a label, between them. The whole rail
            (and the corner axis gizmo, gated elsewhere via isFullscreenRef) hides in fullscreen. */}
        {loadedFileName && !isFullscreen && (
          <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
            {/* Grid */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  const next = !settings.showGrid;
                  onUpdateSettings({ showGrid: next });
                  setOpenRailPanel(next ? 'grid' : null);
                }}
                className={railBtnClass(settings.showGrid)}
                title={settings.showGrid ? 'Grid: On (click to turn off) — G' : 'Grid: Off (click to turn on) — G'}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              {openRailPanel === 'grid' && settings.showGrid && (
                <div className={railPanelClass}>
                  {railPanelHeader('Grid')}
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
                    <span>Minor Color:</span>
                    <input
                      type="color"
                      value={settings.gridMinorColorHex}
                      onChange={(e) => onUpdateSettings({ gridMinorColorHex: e.target.value })}
                      className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Major Every (in):</span>
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
                  <div className="flex items-center justify-between">
                    <span>Major Color:</span>
                    <input
                      type="color"
                      value={settings.gridMajorColorHex}
                      onChange={(e) => onUpdateSettings({ gridMajorColorHex: e.target.value })}
                      className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* LookDev — material + its dependent controls. No on/off (a material is always
                in effect), so the icon just opens/closes the panel; it stays highlighted
                whenever the panel is open. */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => setOpenRailPanel(openRailPanel === 'lookdev' ? null : 'lookdev')}
                className={railBtnClass(openRailPanel === 'lookdev')}
                title="LookDev material"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <defs>
                    <radialGradient id="lookdevSphereGradient" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stopColor="#f1f5f9" />
                      <stop offset="45%" stopColor="#94a3b8" />
                      <stop offset="100%" stopColor="#334155" />
                    </radialGradient>
                  </defs>
                  <circle cx="12" cy="12" r="9" fill="url(#lookdevSphereGradient)" />
                </svg>
              </button>
              {openRailPanel === 'lookdev' && (
                <div className={railPanelClass}>
                  {railPanelHeader('LookDev')}
                  <select
                    value={settings.material}
                    onChange={(e) => onUpdateSettings({ material: e.target.value as MaterialKey })}
                    className="w-full py-1.5 px-2 rounded-md border text-xs outline-hidden bg-[#1e293b] border-slate-600 text-white"
                  >
                    <option value="original">Mapped/Vertex Color</option>
                    <option value="grey">Grey Clay (50% Roughness)</option>
                    <option value="custom">Custom</option>
                    <option value="normal">Normal Map High-Color</option>
                    <option value="wireframe">Wireframe</option>
                    <option value="sketch">Sketch / Cel-Shaded</option>
                    <option value="matcapZebra">Matcap Zebra</option>
                    <option value="thickness">Wall Thickness Checker</option>
                  </select>

                  {settings.material === 'wireframe' && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Wireframe Color</span>
                      <input
                        type="color"
                        value={settings.wireframeColorHex}
                        onChange={(e) => onUpdateSettings({ wireframeColorHex: e.target.value })}
                        className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                      />
                    </div>
                  )}

                  {settings.material === 'custom' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Color</span>
                        <input
                          type="color"
                          value={settings.customColorHex}
                          onChange={(e) => onUpdateSettings({ customColorHex: e.target.value })}
                          className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-slate-400">
                          <span>Roughness</span>
                          <span className="font-mono text-sky-400">{settings.customRoughnessPercent}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={settings.customRoughnessPercent}
                          onChange={(e) => onUpdateSettings({ customRoughnessPercent: Number(e.target.value) })}
                          className="w-full accent-sky-500 cursor-pointer"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-slate-400">
                          <span>Metalness</span>
                          <span className="font-mono text-sky-400">{settings.customMetalnessPercent}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={settings.customMetalnessPercent}
                          onChange={(e) => onUpdateSettings({ customMetalnessPercent: Number(e.target.value) })}
                          className="w-full accent-sky-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  )}

                  {settings.material === 'sketch' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Highlight Color</span>
                        <input
                          type="color"
                          value={settings.sketchHighlightColorHex}
                          onChange={(e) => onUpdateSettings({ sketchHighlightColorHex: e.target.value })}
                          className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Midtone Color</span>
                        <input
                          type="color"
                          value={settings.sketchColorHex}
                          onChange={(e) => onUpdateSettings({ sketchColorHex: e.target.value })}
                          className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Shadow Color</span>
                        <input
                          type="color"
                          value={settings.sketchShadowColorHex}
                          onChange={(e) => onUpdateSettings({ sketchShadowColorHex: e.target.value })}
                          className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-1 pt-1 border-t border-slate-700/60">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Ghost / Opacity</span>
                      <span className="font-mono text-sky-400">{settings.opacityPercent}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={settings.opacityPercent}
                      onChange={(e) => onUpdateSettings({ opacityPercent: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>

                  {settings.material === 'thickness' && (
                    <div className="flex flex-col gap-2 p-2.5 rounded-md border bg-red-950/20 border-red-500/30 text-slate-200">
                      <div className="flex items-center justify-between font-medium">
                        <span className="text-red-400 font-semibold">Highlight under:</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.005"
                            min="0.001"
                            value={settings.minThicknessInches}
                            onChange={(e) =>
                              onUpdateSettings({ minThicknessInches: parseFloat(e.target.value) || 0.08 })
                            }
                            className="w-16 text-right py-1 px-1.5 font-mono font-bold rounded-md border bg-[#1e293b] border-slate-600 text-sky-400"
                          />
                          <span className="text-slate-400">in.</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-slate-700/40 text-[11px]">
                        <span className="flex items-center gap-1.5 font-medium text-red-400">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
                          &lt; {settings.minThicknessInches.toFixed(3)}&quot; (Thin Wall)
                        </span>
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block"></span>
                          &ge; Safe
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Environment / Lighting preset */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => setOpenRailPanel(openRailPanel === 'env' ? null : 'env')}
                className={railBtnClass(openRailPanel === 'env')}
                title="Environment lighting"
              >
                <Globe className="w-4 h-4" />
              </button>
              {openRailPanel === 'env' && (
                <div className={`${railPanelClass} w-64 max-h-[85vh] overflow-y-auto pr-1`}>
                  {railPanelHeader('Environment')}

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        HDRI Environment
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          setIsHdriLoading(true);
                          envTexturesRef.current = {};
                          envSourceFileRef.current = {};
                          await loadHdriManifest();
                          applyEnvironment();
                          setIsHdriLoading(false);
                        }}
                        className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer transition-colors"
                        title="Reload public/hdri/manifest.json and re-apply the environment"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isHdriLoading ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    <select
                      value={settings.customHdriFileName ? 'custom_upload' : settings.environmentPreset}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'custom_upload') return;
                        if (settings.customHdriFileName) handleClearCustomHdri();
                        onUpdateSettings({ environmentPreset: val });
                      }}
                      className="w-full py-1.5 px-2 rounded-md border text-xs outline-hidden bg-[#1e293b] border-slate-600 text-white cursor-pointer"
                    >
                      {settings.customHdriFileName && (
                        <option value="custom_upload">★ Custom: {settings.customHdriFileName}</option>
                      )}
                      <option value="none">No Environment (Default Lighting)</option>
                      {(['Studio', 'Outdoor', 'Interior'] as const).map((category) => {
                        const items = deduplicateHdris(hdriList).filter(
                          (h) => (h.category || 'Studio').toLowerCase() === category.toLowerCase()
                        );
                        if (items.length === 0) return null;
                        return (
                          <optgroup key={category} label={`${category} HDRIs`}>
                            {items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>

                    <div className="flex items-center justify-between text-[9px] text-slate-400 px-0.5">
                      <span>{deduplicateHdris(hdriList).length} HDRs ready</span>
                      {isHdriLoading && <span className="text-sky-400">Loading…</span>}
                    </div>
                  </div>

                  {/* Custom HDRI Upload / Clear */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-700 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">
                        Custom HDRI Map
                      </span>
                      {settings.customHdriFileName && (
                        <button
                          type="button"
                          onClick={handleClearCustomHdri}
                          className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {settings.customHdriFileName ? (
                      <div
                        className="px-2 py-1 rounded bg-sky-950/60 border border-sky-500/40 text-sky-300 text-[11px] font-mono truncate"
                        title={settings.customHdriFileName}
                      >
                        ✓ Active: {settings.customHdriFileName}
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1 px-2 rounded-md border border-dashed border-slate-600 hover:border-sky-500 bg-slate-800/40 hover:bg-slate-800 text-[11px] text-slate-300 cursor-pointer transition-colors">
                        <Upload className="w-3.5 h-3.5 text-sky-400" />
                        <span>Browse .HDR / .EXR</span>
                        <input type="file" accept=".hdr,.exr,.png,.jpg,.jpeg" onChange={handleUploadHdri} className="hidden" />
                      </label>
                    )}

                    <a
                      href="https://polyhaven.com/hdris"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 py-1 px-2 rounded-md border border-slate-700 hover:border-sky-500/50 bg-slate-800/30 hover:bg-slate-800 text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                      title="Open Poly Haven HDRIs library in a new browser window"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Browse free HDRs on Poly Haven</span>
                    </a>
                  </div>

                  {/* Environment Intensity */}
                  <div className="flex flex-col gap-1 pt-2 border-t border-slate-700 text-xs">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-medium">Environment</span>
                      <span className="font-mono text-sky-400">{settings.envIntensity}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="300"
                      value={settings.envIntensity}
                      onChange={(e) => onUpdateSettings({ envIntensity: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>

                  {/* Rotate HDR — independent of the key/fill directional lights */}
                  <div className="flex flex-col gap-1 pt-2 border-t border-slate-700 text-xs">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-medium">Rotate HDR</span>
                      <span className="font-mono text-sky-400">{settings.hdrRotationDeg ?? 0}°</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={settings.hdrRotationDeg ?? 0}
                      onChange={(e) => onUpdateSettings({ hdrRotationDeg: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Orthographic / Perspective — the icon itself swaps between a flat square
                (Orthographic) and a 3D-looking box (Perspective) to show the current mode.
                Perspective is the only one with a setting worth exposing (Focal Length), so
                the panel only opens for it. */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  const nextOrtho = !settings.isOrtho;
                  onUpdateSettings({ isOrtho: nextOrtho });
                  setOpenRailPanel(nextOrtho ? null : 'ortho');
                }}
                className={railBtnClass(!settings.isOrtho)}
                title={settings.isOrtho ? 'View: Orthographic (click for Perspective)' : 'View: Perspective (click for Orthographic) — O'}
              >
                {settings.isOrtho ? <Square className="w-4 h-4" /> : <Box className="w-4 h-4" />}
              </button>
              {openRailPanel === 'ortho' && !settings.isOrtho && (
                <div className={railPanelClass}>
                  {railPanelHeader('Perspective')}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Focal Length</span>
                      <span className="font-mono text-sky-400">{settings.focalLength}mm</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="300"
                      value={settings.focalLength}
                      onChange={(e) => onUpdateSettings({ focalLength: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Clipping Planes */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  if (anyClipEnabled) {
                    onUpdateSettings({
                      clipping: {
                        x: { ...settings.clipping.x, enabled: false },
                        y: { ...settings.clipping.y, enabled: false },
                        z: { ...settings.clipping.z, enabled: false },
                      },
                    });
                    setOpenRailPanel(null);
                  } else {
                    onUpdateSettings({
                      clipping: { ...settings.clipping, x: { ...settings.clipping.x, enabled: true } },
                    });
                    setOpenRailPanel('clip');
                  }
                }}
                className={railBtnClass(anyClipEnabled)}
                title={anyClipEnabled ? 'Clipping Planes: On (click to turn off)' : 'Clipping Planes: Off (click to turn on)'}
              >
                <Scissors className="w-4 h-4" />
              </button>
              {openRailPanel === 'clip' && anyClipEnabled && (
                <div className={railPanelClass}>
                  {railPanelHeader('Clipping Planes')}
                  {(['x', 'y', 'z'] as const).map((axis) => {
                    const label = axis === 'x' ? 'Left / Right' : axis === 'y' ? 'Top / Bottom' : 'Front / Back';
                    const c = settings.clipping[axis];
                    // Offset is stored as % of the model's own bounding-box extent on this axis
                    // (scale-independent — stays correctly placed whether the model is 1" or
                    // 100" across), with offsetInches kept alongside purely for display.
                    const axisSizeInches = axis === 'x' ? dimensions.widthInches : axis === 'y' ? dimensions.heightInches : dimensions.depthInches;
                    const halfInches = Math.max((axisSizeInches || 1) * 0.5, 0.001);
                    const pct = c.offsetPercent ?? 0;
                    const curInches = (pct / 100) * halfInches;
                    return (
                      <div key={axis} className="flex flex-col gap-1">
                        <label className="flex items-center justify-between cursor-pointer">
                          <span>{label}</span>
                          <input
                            type="checkbox"
                            checked={c.enabled}
                            onChange={(e) =>
                              onUpdateSettings({
                                clipping: { ...settings.clipping, [axis]: { ...c, enabled: e.target.checked } },
                              })
                            }
                            className="accent-sky-500 w-4 h-4 cursor-pointer"
                          />
                        </label>
                        {c.enabled && (
                          <div className="flex flex-col gap-1 pl-2 border-l-2 border-slate-600">
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span className="font-mono">
                                {pct === 0 ? (
                                  <span className="text-emerald-400 font-bold">0% (Center)</span>
                                ) : (
                                  <span className="text-sky-300">
                                    {pct > 0 ? `+${pct}%` : `${pct}%`} ({curInches >= 0 ? `+${curInches.toFixed(2)}` : curInches.toFixed(2)}")
                                  </span>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateSettings({
                                    clipping: { ...settings.clipping, [axis]: { ...c, offsetPercent: 0, offsetInches: 0 } },
                                  })
                                }
                                className="text-[10px] text-sky-400 hover:text-sky-300 hover:underline cursor-pointer"
                                title="Reset plane to exact model center (0%)"
                              >
                                Center
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                value={pct}
                                onChange={(e) => {
                                  let val = Number(e.target.value);
                                  if (Math.abs(val) <= 3) val = 0; // magnetic snap to center
                                  const inchVal = Number(((val / 100) * halfInches).toFixed(3));
                                  onUpdateSettings({
                                    clipping: {
                                      ...settings.clipping,
                                      [axis]: { ...c, offsetPercent: val, offsetInches: inchVal },
                                    },
                                  });
                                }}
                                onDoubleClick={() =>
                                  onUpdateSettings({
                                    clipping: { ...settings.clipping, [axis]: { ...c, offsetPercent: 0, offsetInches: 0 } },
                                  })
                                }
                                className="flex-1 accent-sky-500 cursor-pointer"
                                title="Drag -100% to +100% of the model's bounding box. Double-click to snap to center."
                              />
                              <button
                                onClick={() =>
                                  onUpdateSettings({
                                    clipping: { ...settings.clipping, [axis]: { ...c, flip: !c.flip } },
                                  })
                                }
                                className={`text-xs font-semibold px-1.5 py-0.5 rounded cursor-pointer ${
                                  c.flip ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'
                                }`}
                                title="Flip which side is cut away"
                              >
                                Flip
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Exploded View — only relevant once the model actually has separable parts.
                Unlike the other toggles, the panel's open/closed state is independent of the
                slider value: clicking the icon just opens/closes the panel, so scrubbing the
                slider down to 0% (or up to 100%) never closes it out from under you. Only the
                panel's own X, or clicking the icon again, closes it. */}
            {partCount > 1 && (
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={() => setOpenRailPanel(openRailPanel === 'explode' ? null : 'explode')}
                  className={railBtnClass(settings.explodeAmount > 0 || openRailPanel === 'explode')}
                  title={settings.explodeAmount > 0 ? 'Exploded View: On (click to open/close panel)' : 'Exploded View: Off (click to open/close panel)'}
                >
                  <Boxes className="w-4 h-4" />
                </button>
                {openRailPanel === 'explode' && (
                  <div className={railPanelClass}>
                    {railPanelHeader('Exploded View')}
                    <div className="flex items-center justify-between">
                      <span>{partCount} parts</span>
                      <span className="font-mono text-sky-400">
                        {Math.round(settings.explodeAmount * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(settings.explodeAmount * 100)}
                      onChange={(e) => onUpdateSettings({ explodeAmount: Number(e.target.value) / 100 })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Spacer between the Geometry and Look & Lighting clusters — spacing, not a label */}
            <div className="h-2" />

            {/* Background + Vignette */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  const next = !settings.vignetteEnabled;
                  onUpdateSettings({ vignetteEnabled: next });
                  setOpenRailPanel(next ? 'bg' : null);
                }}
                className={railBtnClass(settings.vignetteEnabled)}
                title={settings.vignetteEnabled ? 'Vignette: On (click to turn off)' : 'Vignette: Off (click to turn on)'}
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              {openRailPanel === 'bg' && settings.vignetteEnabled && (
                <div className={railPanelClass}>
                  {railPanelHeader('Background')}
                  <div className="flex items-center justify-between">
                    <span>Background Color</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={settings.backgroundColorHex}
                        onChange={(e) => onUpdateSettings({ backgroundColorHex: e.target.value })}
                        className="w-7 h-7 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                      />
                      <input
                        type="text"
                        value={settings.backgroundColorHex.toUpperCase()}
                        onChange={(e) => {
                          let hex = e.target.value.trim();
                          if (!hex.startsWith('#')) hex = '#' + hex;
                          if (/^#[0-9A-F]{6}$/i.test(hex)) onUpdateSettings({ backgroundColorHex: hex });
                        }}
                        className="w-20 text-center py-1 px-1 font-mono text-xs font-bold rounded-md border bg-[#1e293b] border-slate-600 text-sky-400"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-700/60">
                    <span className="text-slate-400">Vignette Color</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={settings.vignetteColorHex}
                        onChange={(e) => onUpdateSettings({ vignetteColorHex: e.target.value })}
                        className="w-5 h-5 p-0 border border-slate-600 rounded cursor-pointer bg-transparent"
                      />
                      <input
                        type="text"
                        value={settings.vignetteColorHex.toUpperCase()}
                        onChange={(e) => {
                          let hex = e.target.value.trim();
                          if (!hex.startsWith('#')) hex = '#' + hex;
                          if (/^#[0-9A-F]{6}$/i.test(hex)) onUpdateSettings({ vignetteColorHex: hex });
                        }}
                        className="w-16 text-center py-0.5 px-1 font-mono rounded border bg-[#1e293b] border-slate-600 text-sky-400"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Intensity</span>
                      <span className="font-mono text-sky-400">{settings.vignetteIntensityPercent}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.vignetteIntensityPercent}
                      onChange={(e) =>
                        onUpdateSettings({ vignetteIntensityPercent: Number(e.target.value) })
                      }
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Contrast — like Exploded View, the panel's open/closed state is independent of
                the slider value: clicking the icon just opens/closes the panel, so dragging back
                to 100% (or anywhere else) never closes it out from under you and never resets
                the value on its own. Only the panel's own X, or clicking the icon again, closes
                it, and the last value dragged to is always what's kept. */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => setOpenRailPanel(openRailPanel === 'contrast' ? null : 'contrast')}
                className={railBtnClass(settings.contrastPercent !== 100 || openRailPanel === 'contrast')}
                title={
                  settings.contrastPercent !== 100
                    ? `Contrast: ${settings.contrastPercent}% (click to open/close panel)`
                    : 'Contrast: 100% (click to open/close panel)'
                }
              >
                <ContrastIcon className="w-4 h-4" />
              </button>
              {openRailPanel === 'contrast' && (
                <div className={railPanelClass}>
                  {railPanelHeader('Contrast')}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span>Contrast</span>
                      <span className="font-mono text-sky-400">{settings.contrastPercent}%</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="300"
                      value={settings.contrastPercent}
                      onChange={(e) => onUpdateSettings({ contrastPercent: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Post-Processing: SSAO + Anti-aliasing */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  const next = !settings.ssaoEnabled;
                  onUpdateSettings({ ssaoEnabled: next });
                  setOpenRailPanel(next ? 'post' : null);
                }}
                className={railBtnClass(settings.ssaoEnabled)}
                title={settings.ssaoEnabled ? 'Post-Processing: On (click to turn off)' : 'Post-Processing: Off (click to turn on)'}
              >
                <Wand2 className="w-4 h-4" />
              </button>
              {openRailPanel === 'post' && settings.ssaoEnabled && (
                <div className={railPanelClass}>
                  {railPanelHeader('Post-Processing')}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>AO Radius</span>
                      <span className="font-mono text-sky-400">{settings.ssaoRadius}%</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={settings.ssaoRadius}
                      onChange={(e) => onUpdateSettings({ ssaoRadius: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>AO Intensity</span>
                      <span className="font-mono text-sky-400">{settings.ssaoIntensity}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={settings.ssaoIntensity}
                      onChange={(e) => onUpdateSettings({ ssaoIntensity: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>AO Bias</span>
                      <span className="font-mono text-sky-400">{settings.ssaoBias}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.ssaoBias}
                      onChange={(e) => onUpdateSettings({ ssaoBias: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-700/60">
                    <span>Anti-aliasing</span>
                    <select
                      value={settings.antialiasMode}
                      onChange={(e) => onUpdateSettings({ antialiasMode: e.target.value as any })}
                      className="py-1 px-2 rounded-md border text-xs outline-hidden bg-[#1e293b] border-slate-600 text-white"
                    >
                      <option value="none">Off</option>
                      <option value="fxaa">FXAA (fast)</option>
                      <option value="smaa">SMAA (higher quality)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Shadows — Lock Lights lives here now, as a toggle under the sliders, instead of
                being its own icon */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  const next = !settings.castShadows;
                  onUpdateSettings({ castShadows: next });
                  setOpenRailPanel(next ? 'shadows' : null);
                }}
                className={railBtnClass(settings.castShadows)}
                title={settings.castShadows ? 'Shadows: On (click to turn off)' : 'Shadows: Off (click to turn on)'}
              >
                <CloudSun className="w-4 h-4" />
              </button>
              {openRailPanel === 'shadows' && settings.castShadows && (
                <div className={railPanelClass}>
                  {railPanelHeader('Shadows')}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Softness</span>
                      <span className="font-mono text-sky-400">{settings.shadowSoftness}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.shadowSoftness}
                      onChange={(e) => onUpdateSettings({ shadowSoftness: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Darkness</span>
                      <span className="font-mono text-sky-400">{settings.shadowDarkness}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.shadowDarkness}
                      onChange={(e) => onUpdateSettings({ shadowDarkness: Number(e.target.value) })}
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Map Resolution</span>
                    <select
                      value={settings.shadowMapResolution}
                      onChange={(e) =>
                        onUpdateSettings({ shadowMapResolution: Number(e.target.value) as 1024 | 2048 | 4096 })
                      }
                      className="py-1 px-1.5 rounded-md border text-xs outline-hidden bg-[#1e293b] border-slate-600 text-white"
                    >
                      <option value={1024}>1024</option>
                      <option value={2048}>2048</option>
                      <option value={4096}>4096</option>
                    </select>
                  </div>
                  <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-slate-700/60">
                    <span className="flex items-center gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-sky-400" />
                      Lock Lights to Camera
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.lockLightsToCamera}
                      onChange={(e) => onUpdateSettings({ lockLightsToCamera: e.target.checked })}
                      className="accent-sky-500 w-4 h-4 cursor-pointer"
                    />
                  </label>
                </div>
              )}
            </div>
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

        {/* Isolate Mode HUD — hover a part and press I to solo it; press I again (from
            anywhere) or click here to restore exactly what was hidden/shown before. */}
        {isolatedPartName && (
          <div
            id="isolateModeHud"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-sky-500/50 shadow-xl backdrop-blur-md text-xs"
          >
            <Focus className="w-4 h-4 text-sky-400" />
            <span className="font-medium text-slate-200">
              Isolated: <span className="text-sky-400 font-semibold">{isolatedPartName}</span>
            </span>
            <button
              onClick={() => toggleIsolateHoveredPart()}
              title="Exit isolate mode (I)"
              className="p-0.5 rounded text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Hover Part Tooltip — follows the cursor while hovering a mesh, naming it and noting
            the two hotkeys that act on whatever's hovered (H to hide, I to isolate). */}
        {hoveredPart && (
          <div
            className="fixed z-40 px-2.5 py-1.5 rounded-lg bg-slate-900/95 text-white text-[11px] font-medium border border-sky-500/50 shadow-xl pointer-events-none flex items-center gap-2 backdrop-blur-sm transform -translate-x-1/2 -translate-y-full mb-3"
            style={{ left: hoveredPart.x, top: hoveredPart.y }}
          >
            <span className="font-semibold text-sky-400">{hoveredPart.name}</span>
            <span className="text-[10px] text-slate-400 border-l border-slate-700 pl-2 flex items-center gap-1.5">
              <span>
                Click to select • <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono">H</kbd> to hide
              </span>
              <span>
                • <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono">I</kbd> to isolate
              </span>
            </span>
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
