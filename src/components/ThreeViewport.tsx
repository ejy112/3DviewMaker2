import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
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

// Custom Screen Space Reflections pass: computes glossy contact reflections in screen space
// while preserving the composite background + shaded model + GTAO from readBuffer, then blending
// reflections on top using NormalBlending.
class CustomSSRPass extends SSRPass {
  constructor(params: any) {
    super(params);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: any, readBuffer: any, deltaTime?: number, maskActive?: boolean) {
    if (!this.enabled) return;

    // Synchronize camera matrices and near/far boundaries with current active camera
    if (this.camera) {
      const cam = this.camera as any;
      const isPersp = cam.isPerspectiveCamera === true;
      if (this.ssrMaterial.defines.PERSPECTIVE_CAMERA !== isPersp) {
        this.ssrMaterial.defines.PERSPECTIVE_CAMERA = isPersp;
        this.ssrMaterial.needsUpdate = true;
      }
      this.ssrMaterial.uniforms['cameraNear'].value = cam.near || 0.1;
      this.ssrMaterial.uniforms['cameraFar'].value = cam.far || 1000;
      this.ssrMaterial.uniforms['cameraProjectionMatrix'].value.copy(cam.projectionMatrix);
      this.ssrMaterial.uniforms['cameraInverseProjectionMatrix'].value.copy(cam.projectionMatrixInverse);

      if (this.depthRenderMaterial) {
        this.depthRenderMaterial.uniforms['cameraNear'].value = cam.near || 0.1;
        this.depthRenderMaterial.uniforms['cameraFar'].value = cam.far || 1000;
      }
    }

    // 1. Render beauty & depth into beautyRenderTarget
    renderer.setRenderTarget(this.beautyRenderTarget);
    renderer.clear();
    if (this.groundReflector) {
      (this.groundReflector as any).visible = false;
      (this.groundReflector as any).doRender(renderer, this.scene, this.camera);
      (this.groundReflector as any).visible = true;
    }
    renderer.render(this.scene, this.camera);
    if (this.groundReflector) (this.groundReflector as any).visible = false;

    // 2. Render normals into normalRenderTarget
    (this as any)._renderOverride(renderer, this.normalMaterial, this.normalRenderTarget, 0, 0);

    // 3. Render metalness if selective mode
    if (this.selective) {
      (this as any)._renderMetalness(renderer, this.metalnessOnMaterial, this.metalnessRenderTarget, 0, 0);
    }

    // 4. Compute screen-space reflections
    // Pass readBuffer.texture as tDiffuse so reflections reflect the lit, textured scene with AO!
    if (readBuffer && readBuffer.texture) {
      this.ssrMaterial.uniforms['tDiffuse'].value = readBuffer.texture;
    } else {
      this.ssrMaterial.uniforms['tDiffuse'].value = this.beautyRenderTarget.texture;
    }
    this.ssrMaterial.uniforms['opacity'].value = this.opacity;
    this.ssrMaterial.uniforms['maxDistance'].value = this.maxDistance;
    this.ssrMaterial.uniforms['thickness'].value = this.thickness;
    (this as any)._renderPass(renderer, this.ssrMaterial, this.ssrRenderTarget);

    // 5. Blur reflections
    if (this.blur) {
      (this as any)._renderPass(renderer, this.blurMaterial, this.blurRenderTarget);
      (this as any)._renderPass(renderer, this.blurMaterial2, this.blurRenderTarget2);
    }

    // 6. Composite onto writeBuffer:
    // First, copy the existing incoming scene (readBuffer) to writeBuffer with NoBlending
    const baseTexture = readBuffer ? readBuffer.texture : this.beautyRenderTarget.texture;
    this.copyMaterial.uniforms['tDiffuse'].value = baseTexture;
    this.copyMaterial.blending = THREE.NoBlending;
    (this as any)._renderPass(renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer);

    // Second, composite the screen-space reflections on top with NormalBlending
    this.copyMaterial.uniforms['tDiffuse'].value = this.blur ? this.blurRenderTarget2.texture : this.ssrRenderTarget.texture;
    this.copyMaterial.blending = THREE.NormalBlending;
    (this as any)._renderPass(renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer);
  }
}
import { MeshBVH } from 'three-mesh-bvh';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { GIFEncoder, quantize, applyPalette, nearestColorIndex } from 'gifenc';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import {
  LoadedPart,
  MaterialKey,
  ModelDimensions,
  PullDirection,
  BalanceAnalysis,
  ResolutionOption,
  SnapDirection,
  SSRQuality,
  ThemeMode,
  ViewerSettings,
  HdriManifestItem,
  DimensionItem,
  DimensionPoint,
  SelectedPartBounds,
  GifExportOptions,
  ImageExportConfig,
  VideoExportOptions,
  ViewExportId,
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
  Ruler,
  Trash2,
  Move,
  AlertTriangle,
  Scale,
  CheckCircle2,
} from 'lucide-react';
import { detectHardwareAcceleration, HwAccelStatus } from '../utils/hardwareAcceleration';

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
  exportThreeQuarterViewsImage: (
    resMultiplier: ResolutionOption,
    onComplete: (blob: Blob, fileName: string) => void,
    onProgress: (status: string) => void
  ) => void;
  exportAllSeparateImages: (
    resMultiplier: ResolutionOption,
    onComplete: (blob: Blob, fileName: string) => void,
    onProgress: (status: string) => void
  ) => void;
  exportCustomImageViews?: (
    config: ImageExportConfig,
    onComplete: (blob: Blob, fileName: string) => void,
    onProgress: (status: string) => void
  ) => Promise<void>;
  exportTurntableVideo: (
    formatOrOptions: 'mp4' | 'webm' | VideoExportOptions,
    onComplete: (blob: Blob, fileName: string) => void,
    onProgress: (status: string) => void
  ) => Promise<void>;
  exportTurntableGif: (
    options: GifExportOptions,
    onComplete: (blob: Blob, fileName: string) => void,
    onProgress: (progress: { current: number; total: number; stage: string; percent: number }) => void,
    abortSignalRef?: { current: boolean }
  ) => Promise<void>;
  getViewportAspect: () => number;
  updateDimension: (
    field: 'scale' | 'x' | 'y' | 'z' | 'rotX' | 'rotY' | 'rotZ',
    value: number
  ) => void;
  togglePartVisibility: (index: number) => void;
  deletePart: (index: number) => void;
  deleteHiddenParts: () => void;
  selectPart: (index: number | null) => void;
  selectParts: (indices: number[]) => void;
  clearSelection: () => void;
  selectAllVisibleParts: () => void;
  unhideAllParts: () => void;
  toggleSelectedOrHoveredVisibility: () => void;
  toggleIsolateHoveredPart: () => void;
  captureScreenshot: () => string | null;
  toggleDimensionMode: () => void;
  clearDimensions: () => void;
  separateLooseParts?: (index?: number | null) => boolean;
}

export interface VolumeStats {
  volumeCm3: number;
  weightGrams: number;
  estimatedCost: number;
  isWatertight: boolean;
  partCount: number;
  isPartialSelection?: boolean;
  selectedCount?: number;
  totalPartCount?: number;
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
  selectedPartIndices?: number[];
  onSelectPart?: (index: number | null) => void;
  onSelectParts?: (indices: number[]) => void;
  onSelectedPartInfoChanged?: (info: SelectedPartBounds | null) => void;
}

function ThicknessInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (val: number) => void;
}) {
  const [localVal, setLocalVal] = useState<string>(() => String(value));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalVal(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={localVal}
      onFocus={(e) => {
        isFocusedRef.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setLocalVal(raw);
        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && parsed > 0) {
          onChange(parsed);
        }
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        const parsed = parseFloat(localVal);
        if (isNaN(parsed) || parsed <= 0) {
          setLocalVal('0.06');
          onChange(0.06);
        } else {
          setLocalVal(String(parsed));
          onChange(parsed);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-16 text-right py-1 px-1.5 font-mono font-bold rounded-md border bg-[#1e293b] border-slate-600 text-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
    />
  );
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
      selectedPartIndices,
      onSelectPart,
      onSelectParts,
      onSelectedPartInfoChanged,
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
      | 'dimensions'
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
    const [stlSplitNotification, setStlSplitNotification] = useState<{ fileName: string; count: number; message?: string } | null>(null);
    const isFullscreenRef = useRef(false);

    // Auto-dismiss STL component split toast after 7 seconds
    useEffect(() => {
      if (!stlSplitNotification) return;
      const timer = setTimeout(() => {
        setStlSplitNotification(null);
      }, 7000);
      return () => clearTimeout(timer);
    }, [stlSplitNotification]);

    // Dimensioning state & refs (Tier 4: Vertex Dimensioning)
    const [dimensionsList, setDimensionsList] = useState<DimensionItem[]>([]);
    const [dimensionsActive, setDimensionsActive] = useState(false);
    const [dimensionUnit, setDimensionUnit] = useState<'in' | 'mm'>('in');
    const [showDimensionDeltas, setShowDimensionDeltas] = useState(false);
    const [activeDraftStart, setActiveDraftStart] = useState<DimensionPoint | null>(null);
    const [currentDraftDistance, setCurrentDraftDistance] = useState<number | null>(null);
    const [hoveredCursorPos, setHoveredCursorPos] = useState<{ x: number; y: number } | null>(null);
    const [projectedDimensions, setProjectedDimensions] = useState<
      Array<{
        id: string;
        x: number;
        y: number;
        visible: boolean;
        distanceInches: number;
        deltaXInches: number;
        deltaYInches: number;
        deltaZInches: number;
      }>
    >([]);

    const dimensionItemsRef = useRef<DimensionItem[]>([]);
    const dimensionsActiveRef = useRef(false);
    dimensionsActiveRef.current = dimensionsActive;
    const dimensionUnitRef = useRef<'in' | 'mm'>('in');
    dimensionUnitRef.current = dimensionUnit;
    const showDimensionDeltasRef = useRef(false);
    showDimensionDeltasRef.current = showDimensionDeltas;
    const dimensionStartVertexRef = useRef<THREE.Vector3 | null>(null);
    const hoveredVertexRef = useRef<THREE.Vector3 | null>(null);
    const dimensionsGroupRef = useRef<THREE.Group | null>(null);
    const snapMarkerRef = useRef<THREE.Mesh | null>(null);
    const draftLineRef = useRef<THREE.Line | null>(null);
    const draftStartMarkerRef = useRef<THREE.Mesh | null>(null);

    // Dimension string / extension line dragging state
    interface DraggingDimensionState {
      dimId: string;
      startClientX: number;
      startClientY: number;
      initialOffset: THREE.Vector3;
      p1: THREE.Vector3;
      p2: THREE.Vector3;
      dir: THREE.Vector3;
      axisA: THREE.Vector3;
      axisB: THREE.Vector3;
      labelA: string;
      labelB: string;
      activeAxis: 'A' | 'B' | null;
    }
    const draggingDimensionRef = useRef<DraggingDimensionState | null>(null);
    const [draggingDimensionInfo, setDraggingDimensionInfo] = useState<{
      dimId: string;
      axisLabel: string;
      offsetInches: number;
    } | null>(null);
    const recentDimIdRef = useRef<string | null>(null);

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
    // Click-to-select: which parts are selected (multi-select with Shift+click, combined Box3Helper outline)
    // and where the pointer went down, so a click-drag orbit isn't mistaken for a click-to-select.
    const selectedPartIndexRef = useRef<number | null>(null);
    const selectedPartIndicesRef = useRef<number[]>([]);
    const selectionBoxRef = useRef<THREE.Box3>(new THREE.Box3());
    const selectionBoxHelperRef = useRef<THREE.Box3Helper | null>(null);
    const individualHelpersGroupRef = useRef<THREE.Group | null>(null);
    const [selectedPartInfo, setSelectedPartInfo] = useState<SelectedPartBounds | null>(null);
    const selectedPartInfoRef = useRef<SelectedPartBounds | null>(null);
    const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const [thicknessProgress, setThicknessProgress] = useState<number | null>(null);
    const thicknessCalculatingRef = useRef<boolean>(false);

    // Selected Mesh / Assembly Bounding Box Dimensions (visible when view is within 6° perpendicular to an axis)
    const selectionBoxDimensionsGroupRef = useRef<THREE.Group | null>(null);
    const [projectedBoxDimensions, setProjectedBoxDimensions] = useState<
      { id: string; axis: string; label: string; x: number; y: number; visible: boolean }[]
    >([]);

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
    const balanceGroupRef = useRef<THREE.Group | null>(null);
    const [balanceAnalysis, setBalanceAnalysis] = useState<BalanceAnalysis | null>(null);
    const balanceAnalysisRef = useRef<BalanceAnalysis | null>(null);

    // Lights
    const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
    const dirLight1Ref = useRef<THREE.DirectionalLight | null>(null);
    const dirLight2Ref = useRef<THREE.DirectionalLight | null>(null);

    // Vignette Backdrop Material (rendered BEHIND the model, background-only, via
    // VignetteBackgroundPass in the composer chain — see renderFrame)
    const vignetteMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
    const vignetteBgPassRef = useRef<VignetteBackgroundPass | null>(null);

    // Post-processing
    const composerRef = useRef<EffectComposer | null>(null);
    const renderPassRef = useRef<RenderPass | null>(null);
    const aoPassRef = useRef<GTAOPass | null>(null);
    const ssrPassRef = useRef<CustomSSRPass | null>(null);
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

    // Hardware acceleration detection state
    const [hwAccelStatus, setHwAccelStatus] = useState<HwAccelStatus>(() => detectHardwareAcceleration());
    const [dismissHwWarning, setDismissHwWarning] = useState<boolean>(false);
    const [showHwHelp, setShowHwHelp] = useState<boolean>(false);

    useEffect(() => {
      const status = detectHardwareAcceleration();
      setHwAccelStatus(status);
    }, []);

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
      {
        object: THREE.Object3D;
        localCenter: THREE.Vector3;
        basePosition: THREE.Vector3;
        unscaledVolumeMm3?: number;
        isWatertight?: boolean;
      }[]
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
    // Per-mesh exclusive material clones used only while per-part clipping is active. Lookdev
    // materials (materialsMap.current.grey etc.) are ONE shared THREE.Material instance reused
    // across every mesh in the whole app — clippingPlanes lives on the material, not the mesh, so
    // assigning a different per-part plane array to a shared material per part just means
    // whichever part is processed last in the loop "wins" and every other part sharing that
    // material renders with a clip plane meant for a different part entirely (looks exactly like
    // parts drifting through/getting re-cut by a moving plane). Cloning once per mesh here gives
    // each part's mesh its own material to carry its own clippingPlanes without disturbing
    // siblings. Cleared/disposed in cleanupScene.
    const meshClipMaterialsRef = useRef<Map<THREE.Mesh, { sources: THREE.Material[]; clones: THREE.Material[] }>>(
      new Map()
    );

    // Cross-section solid capping with stencil buffer
    const clipCapsGroupRef = useRef<THREE.Group | null>(null);
    const clipStencilGroupsRef = useRef<THREE.Group[]>([]);
    const clipPlaneMeshesRef = useRef<THREE.Mesh[]>([]);
    const hatchTextureRef = useRef<THREE.CanvasTexture | null>(null);

    // Matcap texture (procedurally generated zebra-stripe matcap)
    const matcapZebraTextureRef = useRef<THREE.Texture | null>(null);

    // Volume/weight stats
    const [volumeStats, setVolumeStats] = useState<VolumeStats | null>(null);

    // Thickness Checker Shader Material
    const thicknessMaterialRef = useRef<THREE.ShaderMaterial>(
      new THREE.ShaderMaterial({
        uniforms: {
          uMinThickness: { value: 0.06 },
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

    const getPullDirectionVector = (dir: PullDirection): THREE.Vector3 => {
      switch (dir) {
        case '+Y': return new THREE.Vector3(0, 1, 0);
        case '-Y': return new THREE.Vector3(0, -1, 0);
        case '+Z': return new THREE.Vector3(0, 0, 1);
        case '-Z': return new THREE.Vector3(0, 0, -1);
        case '+X': return new THREE.Vector3(1, 0, 0);
        case '-X': return new THREE.Vector3(-1, 0, 0);
        default: return new THREE.Vector3(0, 1, 0);
      }
    };

    // Draft Angle Analysis (Tooling) Material:
    // Real-time surface classification shader relative to molding pull direction.
    // Green (Positive draft >= safeAngle: Safe demold)
    // Yellow/Amber (Low draft >= warningAngle: Drag risk)
    // Red/Magenta (Undercut / negative draft < warningAngle: Die lock)
    const draftMaterialRef = useRef<THREE.ShaderMaterial>(
      new THREE.ShaderMaterial({
        clipping: true,
        uniforms: {
          uPullDir: { value: new THREE.Vector3(0, 1, 0) },
          uSafeAngle: { value: 3.0 },
          uWarningAngle: { value: 1.0 },
          uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.8).normalize() },
          uSafeColor: { value: new THREE.Color(0x22c55e) },
          uWarningColor: { value: new THREE.Color(0xf59e0b) },
          uUndercutColor: { value: new THREE.Color(0xef4444) },
        },
        vertexShader: `
          varying vec3 vWorldNormal;
          varying vec3 vViewPosition;

          void main() {
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewPosition = -mvPosition.xyz;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 uPullDir;
          uniform float uSafeAngle;
          uniform float uWarningAngle;
          uniform vec3 uLightDir;
          uniform vec3 uSafeColor;
          uniform vec3 uWarningColor;
          uniform vec3 uUndercutColor;

          varying vec3 vWorldNormal;
          varying vec3 vViewPosition;

          void main() {
            vec3 norm = normalize(vWorldNormal);
            if (!gl_FrontFacing) norm = -norm;

            // Surface normal dot pull direction:
            // When norm matches pull dir (dot == 1.0), draft angle is 90 deg.
            // When norm is parallel to pull dir (vertical wall, dot == 0.0), draft angle is 0 deg.
            // When norm points opposite pull dir (dot < 0.0), draft angle is negative (undercut).
            float dotVal = clamp(dot(norm, normalize(uPullDir)), -1.0, 1.0);
            float draftAngleDeg = asin(dotVal) * (180.0 / 3.141592653589793);

            vec3 col;
            if (draftAngleDeg >= uSafeAngle) {
              col = uSafeColor;
            } else if (draftAngleDeg >= uWarningAngle && draftAngleDeg >= 0.0) {
              col = uWarningColor;
            } else {
              col = uUndercutColor;
            }

            float diff = max(dot(norm, uLightDir), 0.0);
            float hemi = (norm.y * 0.5 + 0.5) * 0.35 + 0.4;
            vec3 viewDir = normalize(vViewPosition);
            float rim = 1.0 - max(dot(norm, viewDir), 0.0);
            rim = pow(clamp(rim, 0.0, 1.0), 3.0) * 0.2;
            float lighting = clamp(hemi + diff * 0.4 + rim, 0.3, 1.0);

            gl_FragColor = vec4(col * lighting, 1.0);
          }
        `,
        side: THREE.DoubleSide,
      })
    );

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

    // Safe lookup into materialsMap for any MaterialKey, including the keys
    // ('original' / 'thickness') that aren't stored in the map — falls back to grey.
    const getLookdevMaterial = (key: MaterialKey): THREE.Material => {
      if (key === 'original' || key === 'thickness') return materialsMap.current.grey;
      if (key === 'draft') return draftMaterialRef.current;
      if (key === 'balance') return materialsMap.current.balance;
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
      draft: THREE.ShaderMaterial;
      balance: THREE.MeshStandardMaterial;
    }>({
      grey: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.1 }),
      custom: new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95, metalness: 0.0 }),
      normal: vividNormalMaterialRef.current,
      wireframe: new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true }),
      sketch: sketchMaterialRef.current,
      matcapZebra: new THREE.MeshMatcapMaterial({ color: 0xffffff }),
      draft: draftMaterialRef.current,
      balance: new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0.82,
      }),
    });

    // Cleanup current 3D object to prevent memory leaks
    const cleanupScene = () => {
      thicknessCalculatingRef.current = false;
      setThicknessProgress(null);
      batchPartsRef.current = [];
      batchGroupCenterRef.current.set(0, 0, 0);
      batchPartPlanesRef.current.clear();
      meshClipMaterialsRef.current.forEach((entry) => entry.clones.forEach((c) => c.dispose()));
      meshClipMaterialsRef.current.clear();
      disposeClipCaps();
      if (selectedPartIndexRef.current !== null) selectPart(null);
      if (thicknessMaterialRef.current) {
        thicknessMaterialRef.current.uniforms.uIsReady.value = 0.0;
      }

      if (balanceGroupRef.current && sceneRef.current) {
        sceneRef.current.remove(balanceGroupRef.current);
        balanceGroupRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
            const m = child as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
              if (Array.isArray(m.material)) {
                m.material.forEach((mat) => mat.dispose());
              } else {
                m.material.dispose();
              }
            }
          }
        });
        balanceGroupRef.current = null;
      }
      setBalanceAnalysis(null);
      balanceAnalysisRef.current = null;

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

      if (thicknessMaterialRef.current || sketchMaterialRef.current || draftMaterialRef.current) {
        const lightCamDir = new THREE.Vector3(0.5, 1.0, 0.8).normalize();
        if (isLocked) {
          lightCamDir.applyQuaternion(cam.quaternion);
        }
        thicknessMaterialRef.current?.uniforms.uLightDir.value.copy(lightCamDir);
        sketchMaterialRef.current?.uniforms.uLightDir.value.copy(lightCamDir);
        draftMaterialRef.current?.uniforms.uLightDir.value.copy(lightCamDir);
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
        const loader = new HDRLoader();
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

    // Keep post-processing passes (SSAO, SSR, FXAA/SMAA) in sync with settings
    const syncPostProcessing = () => {
      const { ssaoEnabled, ssaoRadius, ssaoIntensity, ssaoBias, antialiasMode, ssrQuality } = settingsRef.current;

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

      if (ssrPassRef.current) {
        const quality = ssrQuality || 'off';
        const modelRadius = modelRadiusRef.current || 1;

        if (quality === 'off') {
          ssrPassRef.current.enabled = false;
        } else {
          ssrPassRef.current.enabled = true;
          let resScale = 1.0;
          let maxSteps = 128;
          let blur = true;
          let thickness = Math.max(0.005, modelRadius * 0.012);
          let maxDist = modelRadius * 3.5;

          if (quality === 'low') {
            resScale = 0.5;
            maxSteps = 32;
            blur = false;
            thickness = Math.max(0.01, modelRadius * 0.035);
            maxDist = modelRadius * 2.0;
          } else if (quality === 'medium') {
            resScale = 0.75;
            maxSteps = 64;
            blur = true;
            thickness = Math.max(0.008, modelRadius * 0.02);
            maxDist = modelRadius * 2.5;
          } else if (quality === 'high') {
            resScale = 1.0;
            maxSteps = 128;
            blur = true;
            thickness = Math.max(0.005, modelRadius * 0.012);
            maxDist = modelRadius * 3.5;
          }

          if (ssrPassRef.current.resolutionScale !== resScale) {
            ssrPassRef.current.resolutionScale = resScale;
          }
          ssrPassRef.current.ssrMaterial.defines.MAX_STEP = maxSteps;
          ssrPassRef.current.ssrMaterial.needsUpdate = true;
          ssrPassRef.current.blur = blur;
          ssrPassRef.current.thickness = thickness;
          ssrPassRef.current.maxDistance = maxDist;
          ssrPassRef.current.opacity = 0.7;

          const cam = activeCameraRef.current;
          if (cam) {
            ssrPassRef.current.camera = cam;
            const isPersp = (cam as any).isPerspectiveCamera === true;
            if (ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA !== isPersp) {
              ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA = isPersp;
              ssrPassRef.current.ssrMaterial.needsUpdate = true;
            }
          }
        }
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
      if (ssrPassRef.current && ssrPassRef.current.camera !== cam) {
        ssrPassRef.current.camera = cam;
        const isPersp = (cam as any).isPerspectiveCamera === true;
        if (ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA !== isPersp) {
          ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA = isPersp;
          ssrPassRef.current.ssrMaterial.needsUpdate = true;
        }
      }
      updateGridOrientation(cam);
      updateDimensionVisibilityAndLabels(cam);
      composer.render();

      if (withViewHelper) {
        renderer.clearDepth();
        if (viewHelperRef.current) viewHelperRef.current.render(renderer);
      }
    };

    const updateOrthoFrustum = (overrideAspect?: number) => {
      if (!containerRef.current || !cameraOrthoRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      const aspect = overrideAspect !== undefined && overrideAspect > 0 ? overrideAspect : w / h;
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

    // Faces the grid card toward `cam` and tucks it behind the model along the camera's sightline.
    // Anchors to the orbit target / model center rather than world origin (0,0,0), so that during
    // a turntable rotation around the model's center or when the model is panned, the backdrop grid
    // stays perfectly stationary behind the model instead of wobbling or drifting across the viewport.
    // Cheap enough to call every render — no geometry touched.
    const updateGridOrientation = (cam: THREE.Camera | null, targetOverride?: THREE.Vector3) => {
      const group = gridHelperRef.current;
      if (!group || !cam) return;
      const target = targetOverride || controlsRef.current?.target || modelCenterRef.current;
      if (!target) return;

      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      if (forward.lengthSq() < 1e-10) return;

      const rad = modelRadiusRef.current || 1;
      group.position.copy(target).addScaledVector(forward, rad * 1.5);
      group.quaternion.copy(cam.quaternion);
    };

    // Returns the two canonical orthogonal normal axes and labels for a dimension line direction
    const getDimensionOrthogonalAxes = (dir: THREE.Vector3) => {
      const absX = Math.abs(dir.x);
      const absY = Math.abs(dir.y);
      const absZ = Math.abs(dir.z);

      // If predominantly along X (|dir.x| >= 0.75):
      // Orthogonal normal directions are Y (up/down) and Z (front/back)
      if (absX >= 0.75) {
        return {
          axisA: new THREE.Vector3(0, 1, 0),
          axisB: new THREE.Vector3(0, 0, 1),
          labelA: 'Y (Up/Down)',
          labelB: 'Z (Front/Back)',
        };
      }
      // If predominantly along Y (|dir.y| >= 0.75):
      // Orthogonal normal directions are X (left/right) and Z (front/back)
      if (absY >= 0.75) {
        return {
          axisA: new THREE.Vector3(1, 0, 0),
          axisB: new THREE.Vector3(0, 0, 1),
          labelA: 'X (Left/Right)',
          labelB: 'Z (Front/Back)',
        };
      }
      // If predominantly along Z (|dir.z| >= 0.75):
      // Orthogonal normal directions are X (left/right) and Y (up/down)
      if (absZ >= 0.75) {
        return {
          axisA: new THREE.Vector3(1, 0, 0),
          axisB: new THREE.Vector3(0, 1, 0),
          labelA: 'X (Left/Right)',
          labelB: 'Y (Up/Down)',
        };
      }

      // Diagonal / general 3D line: find orthonormal perpendiculars via Gram-Schmidt
      let ref: THREE.Vector3;
      if (absX <= absY && absX <= absZ) ref = new THREE.Vector3(1, 0, 0);
      else if (absY <= absZ) ref = new THREE.Vector3(0, 1, 0);
      else ref = new THREE.Vector3(0, 0, 1);

      const axisA = new THREE.Vector3().crossVectors(dir, ref).normalize();
      const axisB = new THREE.Vector3().crossVectors(dir, axisA).normalize();
      return {
        axisA,
        axisB,
        labelA: 'Normal 1',
        labelB: 'Normal 2',
      };
    };

    const handleGlobalDimensionPointerMove = (event: PointerEvent) => {
      const drag = draggingDimensionRef.current;
      if (!drag || !activeCameraRef.current || !containerRef.current) return;
      const cam = activeCameraRef.current;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w <= 0 || h <= 0) return;

      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;

      // Base midpoint of the un-offset dimension line
      const mid0 = drag.p1.clone().add(drag.p2).multiplyScalar(0.5);
      const midWithInitial = mid0.clone().add(drag.initialOffset);

      // Project midWithInitial to screen
      const ndcMid = midWithInitial.clone().project(cam);
      const screenMid = new THREE.Vector2((ndcMid.x * 0.5 + 0.5) * w, (-ndcMid.y * 0.5 + 0.5) * h);

      // Measure screen step along axisA and axisB
      const step = Math.max((modelRadiusRef.current || 10) * 0.1, 1);
      const ndcA = midWithInitial.clone().addScaledVector(drag.axisA, step).project(cam);
      const screenA = new THREE.Vector2((ndcA.x * 0.5 + 0.5) * w, (-ndcA.y * 0.5 + 0.5) * h);
      const screenDirA = screenA.clone().sub(screenMid);
      const lenA = screenDirA.length();

      const ndcB = midWithInitial.clone().addScaledVector(drag.axisB, step).project(cam);
      const screenB = new THREE.Vector2((ndcB.x * 0.5 + 0.5) * w, (-ndcB.y * 0.5 + 0.5) * h);
      const screenDirB = screenB.clone().sub(screenMid);
      const lenB = screenDirB.length();

      const mouseDelta = new THREE.Vector2(dx, dy);

      // 3D units displacement corresponding to screen mouse movement
      const dotA = mouseDelta.dot(screenDirA);
      const dotB = mouseDelta.dot(screenDirB);

      const unitsA = lenA > 1e-3 ? (dotA / (lenA * lenA)) * step : 0;
      const unitsB = lenB > 1e-3 ? (dotB / (lenB * lenB)) * step : 0;

      const pixDistA = lenA > 1e-3 ? Math.abs(dotA / lenA) : 0;
      const pixDistB = lenB > 1e-3 ? Math.abs(dotB / lenB) : 0;

      // Determine active orthogonal axis (snaps to dominant axis)
      let chosenAxis = drag.activeAxis;
      if (!chosenAxis) {
        if (pixDistA > 6 || pixDistB > 6) {
          chosenAxis = pixDistA >= pixDistB ? 'A' : 'B';
          drag.activeAxis = chosenAxis;
        }
      } else {
        // Allow switching if user clearly drags 2.2x further along the other axis
        if (chosenAxis === 'A' && pixDistB > pixDistA * 2.2 && pixDistB > 20) {
          chosenAxis = 'B';
          drag.activeAxis = 'B';
        } else if (chosenAxis === 'B' && pixDistA > pixDistB * 2.2 && pixDistA > 20) {
          chosenAxis = 'A';
          drag.activeAxis = 'A';
        }
      }

      // Compute new 3D offset strictly in the chosen orthogonal direction
      let newOffset = drag.initialOffset.clone();
      let activeLabel = drag.labelA;
      let offsetDistInches = 0;
      const scaleIn = getConversionToInches();
      const snapThreshold = Math.max((modelRadiusRef.current || 10) * 0.015, 0.02);

      if (chosenAxis === 'A') {
        const initialA = drag.initialOffset.dot(drag.axisA);
        const totalA = initialA + unitsA;
        const snappedA = Math.abs(totalA) < snapThreshold ? 0 : totalA;
        newOffset = drag.axisA.clone().multiplyScalar(snappedA);
        activeLabel = drag.labelA;
        offsetDistInches = snappedA * scaleIn;
      } else if (chosenAxis === 'B') {
        const initialB = drag.initialOffset.dot(drag.axisB);
        const totalB = initialB + unitsB;
        const snappedB = Math.abs(totalB) < snapThreshold ? 0 : totalB;
        newOffset = drag.axisB.clone().multiplyScalar(snappedB);
        activeLabel = drag.labelB;
        offsetDistInches = snappedB * scaleIn;
      }

      // Update dimension item
      const updated = dimensionItemsRef.current.map((d) => {
        if (d.id === drag.dimId) {
          return {
            ...d,
            offset: { x: newOffset.x, y: newOffset.y, z: newOffset.z },
          };
        }
        return d;
      });
      dimensionItemsRef.current = updated;
      setDimensionsList(updated);
      rebuildDimensions3D();
      updateDimensionVisibilityAndLabels(cam);

      setDraggingDimensionInfo({
        dimId: drag.dimId,
        axisLabel: activeLabel,
        offsetInches: offsetDistInches,
      });

      requestRender();
    };

    const handleGlobalDimensionPointerUp = () => {
      window.removeEventListener('pointermove', handleGlobalDimensionPointerMove);
      window.removeEventListener('pointerup', handleGlobalDimensionPointerUp);
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
      draggingDimensionRef.current = null;
      setDraggingDimensionInfo(null);
      requestRender();
    };

    const startDraggingDimension = (clientX: number, clientY: number, dimId: string) => {
      const dim = dimensionItemsRef.current.find((d) => d.id === dimId);
      if (!dim || !activeCameraRef.current) return;

      const p1 = new THREE.Vector3(dim.p1.x, dim.p1.y, dim.p1.z);
      const p2 = new THREE.Vector3(dim.p2.x, dim.p2.y, dim.p2.z);
      const diff = p2.clone().sub(p1);
      if (diff.lengthSq() < 1e-8) return;
      const dir = diff.clone().normalize();

      const { axisA, axisB, labelA, labelB } = getDimensionOrthogonalAxes(dir);
      const initialOffset = dim.offset
        ? new THREE.Vector3(dim.offset.x, dim.offset.y, dim.offset.z)
        : new THREE.Vector3(0, 0, 0);

      let activeAxis: 'A' | 'B' | null = null;
      if (initialOffset.lengthSq() > 1e-5) {
        const dotA = Math.abs(initialOffset.clone().normalize().dot(axisA));
        const dotB = Math.abs(initialOffset.clone().normalize().dot(axisB));
        if (dotA > 0.8) activeAxis = 'A';
        else if (dotB > 0.8) activeAxis = 'B';
      }

      draggingDimensionRef.current = {
        dimId,
        startClientX: clientX,
        startClientY: clientY,
        initialOffset,
        p1,
        p2,
        dir,
        axisA,
        axisB,
        labelA,
        labelB,
        activeAxis,
      };

      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }

      window.addEventListener('pointermove', handleGlobalDimensionPointerMove);
      window.addEventListener('pointerup', handleGlobalDimensionPointerUp);
    };

    // Rebuilds 3D dimension lines, endpoints, tick marks, and extension lines
    const rebuildDimensions3D = () => {
      const group = dimensionsGroupRef.current;
      if (!group) return;
      while (group.children.length > 0) {
        const obj = group.children[0] as any;
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
          else obj.material.dispose();
        }
        group.remove(obj);
      }

      if (!dimensionsActiveRef.current) return;

      const scale = modelRadiusRef.current > 0 ? modelRadiusRef.current : 50;
      const sphereRadius = Math.max(scale * 0.012, 0.35);
      const anchorGeo = new THREE.SphereGeometry(sphereRadius * 0.75, 12, 12);
      const markerMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      const extMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        depthTest: false,
        transparent: true,
        opacity: 0.75,
      });

      dimensionItemsRef.current.forEach((dim) => {
        const dimGroup = new THREE.Group();
        const p1 = new THREE.Vector3(dim.p1.x, dim.p1.y, dim.p1.z);
        const p2 = new THREE.Vector3(dim.p2.x, dim.p2.y, dim.p2.z);
        const diff = p2.clone().sub(p1);
        const len = diff.length();
        if (len < 1e-6) return;
        const dir = diff.clone().normalize();

        const offsetVec = dim.offset
          ? new THREE.Vector3(dim.offset.x, dim.offset.y, dim.offset.z)
          : new THREE.Vector3(0, 0, 0);
        const hasOffset = offsetVec.lengthSq() > 1e-6;

        const p1_off = p1.clone().add(offsetVec);
        const p2_off = p2.clone().add(offsetVec);

        dimGroup.userData = { id: dim.id, dir, p1, p2, p1_off, p2_off };

        // 1. Anchor markers at measured vertices
        const s1 = new THREE.Mesh(anchorGeo, markerMat);
        s1.position.copy(p1);
        s1.renderOrder = 9990;
        s1.userData = { dimId: dim.id };
        dimGroup.add(s1);

        const s2 = new THREE.Mesh(anchorGeo, markerMat);
        s2.position.copy(p2);
        s2.renderOrder = 9990;
        s2.userData = { dimId: dim.id };
        dimGroup.add(s2);

        // 2. Main dimension line (connecting p1_off to p2_off)
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1_off, p2_off]);
        const line = new THREE.Line(lineGeo, lineMat);
        line.renderOrder = 9989;
        line.userData = { dimId: dim.id };
        dimGroup.add(line);

        // 3. Perpendicular end tick marks at p1_off and p2_off
        let perp: THREE.Vector3;
        if (hasOffset) {
          perp = offsetVec.clone().normalize().multiplyScalar(sphereRadius * 2.2);
        } else {
          perp = new THREE.Vector3(0, 1, 0).cross(dir);
          if (perp.lengthSq() < 0.01) perp = new THREE.Vector3(1, 0, 0).cross(dir);
          perp.normalize().multiplyScalar(sphereRadius * 2.2);
        }

        const tick1Geo = new THREE.BufferGeometry().setFromPoints([
          p1_off.clone().add(perp),
          p1_off.clone().sub(perp),
        ]);
        const tick1 = new THREE.Line(tick1Geo, lineMat);
        tick1.renderOrder = 9989;
        tick1.userData = { dimId: dim.id };
        dimGroup.add(tick1);

        const tick2Geo = new THREE.BufferGeometry().setFromPoints([
          p2_off.clone().add(perp),
          p2_off.clone().sub(perp),
        ]);
        const tick2 = new THREE.Line(tick2Geo, lineMat);
        tick2.renderOrder = 9989;
        tick2.userData = { dimId: dim.id };
        dimGroup.add(tick2);

        // 4. Extension lines (witness lines) from vertices to displaced dimension line
        if (hasOffset) {
          const offsetLen = offsetVec.length();
          const offsetDir = offsetVec.clone().normalize();
          const gap = Math.min(sphereRadius * 0.8, offsetLen * 0.12);
          const overshoot = Math.min(sphereRadius * 2.0, offsetLen * 0.22);

          const ext1Geo = new THREE.BufferGeometry().setFromPoints([
            p1.clone().addScaledVector(offsetDir, gap),
            p1_off.clone().addScaledVector(offsetDir, overshoot),
          ]);
          const ext1 = new THREE.Line(ext1Geo, extMat);
          ext1.renderOrder = 9988;
          ext1.userData = { dimId: dim.id };
          dimGroup.add(ext1);

          const ext2Geo = new THREE.BufferGeometry().setFromPoints([
            p2.clone().addScaledVector(offsetDir, gap),
            p2_off.clone().addScaledVector(offsetDir, overshoot),
          ]);
          const ext2 = new THREE.Line(ext2Geo, extMat);
          ext2.renderOrder = 9988;
          ext2.userData = { dimId: dim.id };
          dimGroup.add(ext2);
        }

        group.add(dimGroup);
      });
    };

    // Updates 3D dimension line visibility and computes 2D screen positions.
    // Dimensions aligned parallel to the camera line of sight are automatically hidden.
    const updateDimensionVisibilityAndLabels = (cam: THREE.Camera | null) => {
      if (!cam || !containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      const camDir = cam.getWorldDirection(new THREE.Vector3());

      // Update Bounding Box Dimensions (always active when meshes are selected & perpendicular to an axis within 6 deg)
      updateBoundingBoxDimensions(cam, w, h);

      // Update 3D lines visibility:
      // Parallel to camera line check (|dir · camDir| >= 0.94)
      if (dimensionsGroupRef.current) {
        dimensionsGroupRef.current.visible = dimensionsActiveRef.current;
        if (dimensionsActiveRef.current) {
          dimensionsGroupRef.current.children.forEach((child: any) => {
            if (child.userData?.dir) {
              const dot = Math.abs(child.userData.dir.dot(camDir));
              child.visible = dot < 0.94;
            }
          });
        }
      }

      // Update 2D floating screen labels:
      if (!dimensionsActiveRef.current || dimensionItemsRef.current.length === 0) {
        setProjectedDimensions((prev) => (prev.length > 0 ? [] : prev));
        return;
      }

      const projected = dimensionItemsRef.current.map((dim) => {
        const p1 = new THREE.Vector3(dim.p1.x, dim.p1.y, dim.p1.z);
        const p2 = new THREE.Vector3(dim.p2.x, dim.p2.y, dim.p2.z);
        const diff = p2.clone().sub(p1);
        const dir = diff.clone().normalize();
        const dot = Math.abs(dir.dot(camDir));
        const isParallel = dot >= 0.94;

        const offsetVec = dim.offset
          ? new THREE.Vector3(dim.offset.x, dim.offset.y, dim.offset.z)
          : new THREE.Vector3(0, 0, 0);
        const p1_off = p1.clone().add(offsetVec);
        const p2_off = p2.clone().add(offsetVec);

        const mid = p1_off.clone().add(p2_off).multiplyScalar(0.5);
        const ndc = mid.clone().project(cam);
        const inFront = ndc.z <= 1.0;

        const screenX = (ndc.x * 0.5 + 0.5) * w;
        const screenY = (-ndc.y * 0.5 + 0.5) * h;

        return {
          id: dim.id,
          x: screenX,
          y: screenY,
          visible: inFront && !isParallel,
          distanceInches: dim.distanceInches,
          deltaXInches: dim.deltaXInches,
          deltaYInches: dim.deltaYInches,
          deltaZInches: dim.deltaZInches,
          offset: dim.offset,
        };
      });

      setProjectedDimensions(projected);
    };

    // Computes 3D points and labels for bounding box dimensions when camera is within 6° of perpendicular to an axis.
    // Dimensions are always placed below the bounding box (horizontal) and to its right (vertical).
    // Extension lines extend 1/8" beyond the bounding box, with compensation on wide dimension tags so there is a 1/8" gap to the start of the tag.
    const computeBoundingBoxDimensions = (cam: THREE.Camera, viewportWidth: number, viewportHeight: number) => {
      const box = selectionBoxRef.current;
      if (!box || box.isEmpty() || !selectedPartInfoRef.current) return null;

      const camDir = cam.getWorldDirection(new THREE.Vector3()).normalize();
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
      const camRight = new THREE.Vector3().crossVectors(camDir, camUp).normalize();
      const camDown = camUp.clone().negate().normalize();

      const absX = Math.abs(camDir.x);
      const absY = Math.abs(camDir.y);
      const absZ = Math.abs(camDir.z);
      const COS_6_DEG = 0.9945218953682733; // Math.cos(THREE.MathUtils.degToRad(6))

      if (absZ < COS_6_DEG && absX < COS_6_DEG && absY < COS_6_DEG) {
        // Outside 6° tolerance (e.g. 3/4 views) -> hide dimensions
        return null;
      }

      const scaleInches = getConversionToInches();
      // 1/8" in world units (e.g. 3.175 units in mm mode, 0.125 in inch mode)
      const EXT_1_8 = 0.125 / scaleInches;

      // Calculate units per pixel at bounding box center
      const boxCenter = box.getCenter(new THREE.Vector3());
      let unitsPerPixel = 0.05;
      const ortho = cam as THREE.OrthographicCamera;
      if (ortho.isOrthographicCamera) {
        const frustumW = (ortho.right - ortho.left) / (ortho.zoom || 1);
        unitsPerPixel = frustumW / Math.max(viewportWidth, 1);
      } else {
        const persp = cam as THREE.PerspectiveCamera;
        if (persp.isPerspectiveCamera) {
          const dist = cam.position.distanceTo(boxCenter);
          const vH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2);
          unitsPerPixel = vH / Math.max(viewportHeight, 1);
        }
      }

      // Compensate for wide dimension tags so there is a 1/8" gap from bounding box to start of tag:
      // In screen space, typical badge half-width for "X 3.500"" / "X 123.4 mm" is ~38px, half-height ~11px.
      const tagHalfWidthWorld = 38 * unitsPerPixel;
      const tagHalfHeightWorld = 11 * unitsPerPixel;

      const hOffset = EXT_1_8 + tagHalfHeightWorld;
      const vOffset = EXT_1_8 + tagHalfWidthWorld;

      // Visible gap between selected bounding box and extension line start:
      // Constrained between 1/32" (0.03125") and 1/16" (0.0625") at most, with min 2.5px visibility
      const bboxGap = Math.min(0.0625 / scaleInches, Math.max(0.035 / scaleInches, 2.5 * unitsPerPixel));

      // Extension line overshoot past dimension line
      const extOvershoot = Math.max(0.055 / scaleInches, 4.5 * unitsPerPixel);

      // Dimension line overshoot extending slightly past the extension lines (drafting standard)
      const dimOvershoot = Math.max(0.055 / scaleInches, 4.5 * unitsPerPixel);

      // Small architectural 45° diagonal tick mark across intersection of extension line and dimension line
      const tickHalfLen = Math.max(0.038 / scaleInches, 3.5 * unitsPerPixel);
      const tickVec = camRight.clone().add(camUp).normalize().multiplyScalar(tickHalfLen);

      const formatVal = (axisName: string, lengthModelUnits: number) => {
        const inches = lengthModelUnits * scaleInches;
        const mm = lengthModelUnits;
        return dimensionUnitRef.current === 'mm'
          ? `${axisName} ${mm.toFixed(1)} mm`
          : `${axisName} ${inches.toFixed(3)}"`;
      };

      type DimDetail = {
        axis: string;
        label: string;
        dimStart: THREE.Vector3;
        dimEnd: THREE.Vector3;
        ext1Start: THREE.Vector3;
        ext1End: THREE.Vector3;
        ext2Start: THREE.Vector3;
        ext2End: THREE.Vector3;
        tick1Start: THREE.Vector3;
        tick1End: THREE.Vector3;
        tick2Start: THREE.Vector3;
        tick2End: THREE.Vector3;
        tagMid: THREE.Vector3;
        screenX: number;
        screenY: number;
      };

      const buildDimDetail = (
        axis: string,
        label: string,
        boxP1: THREE.Vector3,
        boxP2: THREE.Vector3,
        extDir: THREE.Vector3,
        dimDir: THREE.Vector3,
        offset: number
      ): DimDetail => {
        // Intersections between extension lines and dimension line
        const int1 = boxP1.clone().addScaledVector(extDir, offset);
        const int2 = boxP2.clone().addScaledVector(extDir, offset);
        const tagMid = int1.clone().add(int2).multiplyScalar(0.5);
        const ndc = tagMid.clone().project(cam);

        return {
          axis,
          label,
          // Dimension line slightly extended past the extension lines on both ends:
          dimStart: int1.clone().addScaledVector(dimDir, -dimOvershoot),
          dimEnd: int2.clone().addScaledVector(dimDir, dimOvershoot),
          // Extension lines with slight gap (1/32" to 1/16") from bounding box, extending past dimension line:
          ext1Start: boxP1.clone().addScaledVector(extDir, bboxGap),
          ext1End: int1.clone().addScaledVector(extDir, extOvershoot),
          ext2Start: boxP2.clone().addScaledVector(extDir, bboxGap),
          ext2End: int2.clone().addScaledVector(extDir, extOvershoot),
          // 45° diagonal tick mark at the intersection of extension line and dimension line:
          tick1Start: int1.clone().sub(tickVec),
          tick1End: int1.clone().add(tickVec),
          tick2Start: int2.clone().sub(tickVec),
          tick2End: int2.clone().add(tickVec),
          tagMid,
          screenX: (ndc.x * 0.5 + 0.5) * viewportWidth,
          screenY: (-ndc.y * 0.5 + 0.5) * viewportHeight,
        };
      };

      let hDim: DimDetail;
      let vDim: DimDetail;

      if (absZ >= COS_6_DEG) {
        // Front / Back view: Z axis is hidden, X is horizontal, Y is vertical
        const lenX = box.max.x - box.min.x;
        const lenY = box.max.y - box.min.y;
        const hLabel = formatVal('X', lenX);
        const vLabel = formatVal('Y', lenY);

        const planeZ = camDir.z < 0 ? box.max.z : box.min.z;
        const leftX = camRight.x > 0 ? box.min.x : box.max.x;
        const rightX = camRight.x > 0 ? box.max.x : box.min.x;
        const bottomY = box.min.y;
        const topY = box.max.y;

        const boxP1 = new THREE.Vector3(leftX, bottomY, planeZ);
        const boxP2 = new THREE.Vector3(rightX, bottomY, planeZ);
        const boxV1 = new THREE.Vector3(rightX, bottomY, planeZ);
        const boxV2 = new THREE.Vector3(rightX, topY, planeZ);

        hDim = buildDimDetail('X', hLabel, boxP1, boxP2, camDown, camRight, hOffset);
        vDim = buildDimDetail('Y', vLabel, boxV1, boxV2, camRight, camUp, vOffset);
      } else if (absX >= COS_6_DEG) {
        // Left / Right view: X axis is hidden, Z is horizontal, Y is vertical
        const lenZ = box.max.z - box.min.z;
        const lenY = box.max.y - box.min.y;
        const hLabel = formatVal('Z', lenZ);
        const vLabel = formatVal('Y', lenY);

        const planeX = camDir.x < 0 ? box.max.x : box.min.x;
        const leftZ = camRight.z > 0 ? box.min.z : box.max.z;
        const rightZ = camRight.z > 0 ? box.max.z : box.min.z;
        const bottomY = box.min.y;
        const topY = box.max.y;

        const boxP1 = new THREE.Vector3(planeX, bottomY, leftZ);
        const boxP2 = new THREE.Vector3(planeX, bottomY, rightZ);
        const boxV1 = new THREE.Vector3(planeX, bottomY, rightZ);
        const boxV2 = new THREE.Vector3(planeX, topY, rightZ);

        hDim = buildDimDetail('Z', hLabel, boxP1, boxP2, camDown, camRight, hOffset);
        vDim = buildDimDetail('Y', vLabel, boxV1, boxV2, camRight, camUp, vOffset);
      } else {
        // Top / Bottom view: Y axis is hidden, X is horizontal, Z is vertical (along camDown)
        const lenX = box.max.x - box.min.x;
        const lenZ = box.max.z - box.min.z;
        const hLabel = formatVal('X', lenX);
        const vLabel = formatVal('Z', lenZ);

        const planeY = camDir.y < 0 ? box.max.y : box.min.y;
        const leftX = camRight.x > 0 ? box.min.x : box.max.x;
        const rightX = camRight.x > 0 ? box.max.x : box.min.x;
        const bottomZ = camDown.z > 0 ? box.max.z : box.min.z;
        const topZ = camDown.z > 0 ? box.min.z : box.max.z;

        const boxP1 = new THREE.Vector3(leftX, planeY, bottomZ);
        const boxP2 = new THREE.Vector3(rightX, planeY, bottomZ);
        const boxV1 = new THREE.Vector3(rightX, planeY, bottomZ);
        const boxV2 = new THREE.Vector3(rightX, planeY, topZ);

        hDim = buildDimDetail('X', hLabel, boxP1, boxP2, camDown, camRight, hOffset);
        vDim = buildDimDetail('Z', vLabel, boxV1, boxV2, camRight, camUp, vOffset);
      }

      return { hDim, vDim };
    };

    // Rebuilds 3D dimension lines for bounding box and updates screen-space badges in the live viewport
    const updateBoundingBoxDimensions = (cam: THREE.Camera, viewportWidth: number, viewportHeight: number) => {
      const data = computeBoundingBoxDimensions(cam, viewportWidth, viewportHeight);
      const group = selectionBoxDimensionsGroupRef.current;

      if (!data) {
        if (group) group.visible = false;
        setProjectedBoxDimensions((prev) => (prev.length > 0 ? [] : prev));
        return;
      }

      if (group) {
        while (group.children.length > 0) {
          const obj = group.children[0] as any;
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
            else obj.material.dispose();
          }
          group.remove(obj);
        }

        const lineMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
        const extMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          depthTest: false,
          transparent: true,
          opacity: 0.75,
        });

        const addSegment = (p1: THREE.Vector3, p2: THREE.Vector3, mat: THREE.Material, order = 9996) => {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), mat);
          line.renderOrder = order;
          group.add(line);
        };

        // Horizontal dimension (below)
        addSegment(data.hDim.dimStart, data.hDim.dimEnd, lineMat);
        addSegment(data.hDim.ext1Start, data.hDim.ext1End, extMat, 9995);
        addSegment(data.hDim.ext2Start, data.hDim.ext2End, extMat, 9995);
        addSegment(data.hDim.tick1Start, data.hDim.tick1End, lineMat);
        addSegment(data.hDim.tick2Start, data.hDim.tick2End, lineMat);

        // Vertical dimension (to the right)
        addSegment(data.vDim.dimStart, data.vDim.dimEnd, lineMat);
        addSegment(data.vDim.ext1Start, data.vDim.ext1End, extMat, 9995);
        addSegment(data.vDim.ext2Start, data.vDim.ext2End, extMat, 9995);
        addSegment(data.vDim.tick1Start, data.vDim.tick1End, lineMat);
        addSegment(data.vDim.tick2Start, data.vDim.tick2End, lineMat);

        group.visible = true;
      }

      setProjectedBoxDimensions([
        {
          id: 'bbox-h',
          axis: data.hDim.axis,
          label: data.hDim.label,
          x: data.hDim.screenX,
          y: data.hDim.screenY,
          visible: true,
        },
        {
          id: 'bbox-v',
          axis: data.vDim.axis,
          label: data.vDim.label,
          x: data.vDim.screenX,
          y: data.vDim.screenY,
          visible: true,
        },
      ]);
    };

    // Draws bounding box dimensions, extension lines, ticks, and text tags onto export canvases
    const drawBoundingBoxDimensionsOnCanvas = (
      targetCtx: CanvasRenderingContext2D,
      cam: THREE.Camera,
      offsetX: number,
      offsetY: number,
      size: number
    ) => {
      const data = computeBoundingBoxDimensions(cam, size, size);
      if (!data) return;

      const layoutScale = Math.max(0.5, size / 1000);
      const toCanvas = (pt: THREE.Vector3) => {
        const ndc = pt.clone().project(cam);
        return {
          x: offsetX + (ndc.x * 0.5 + 0.5) * size,
          y: offsetY + (-ndc.y * 0.5 + 0.5) * size,
        };
      };

      targetCtx.save();
      targetCtx.strokeStyle = '#38bdf8';
      targetCtx.lineWidth = Math.max(1.5, Math.round(2 * layoutScale));
      targetCtx.lineCap = 'round';

      const strokeSeg = (p1: THREE.Vector3, p2: THREE.Vector3, alpha = 0.95, width?: number) => {
        const c1 = toCanvas(p1);
        const c2 = toCanvas(p2);
        targetCtx.globalAlpha = alpha;
        if (width) targetCtx.lineWidth = width;
        targetCtx.beginPath();
        targetCtx.moveTo(c1.x, c1.y);
        targetCtx.lineTo(c2.x, c2.y);
        targetCtx.stroke();
        if (width) targetCtx.lineWidth = Math.max(1.5, Math.round(2 * layoutScale));
      };

      const tickWidth = Math.max(2, Math.round(2.6 * layoutScale));

      // Horizontal dimension
      strokeSeg(data.hDim.dimStart, data.hDim.dimEnd, 0.95);
      strokeSeg(data.hDim.ext1Start, data.hDim.ext1End, 0.75);
      strokeSeg(data.hDim.ext2Start, data.hDim.ext2End, 0.75);
      strokeSeg(data.hDim.tick1Start, data.hDim.tick1End, 1.0, tickWidth);
      strokeSeg(data.hDim.tick2Start, data.hDim.tick2End, 1.0, tickWidth);

      // Vertical dimension
      strokeSeg(data.vDim.dimStart, data.vDim.dimEnd, 0.95);
      strokeSeg(data.vDim.ext1Start, data.vDim.ext1End, 0.75);
      strokeSeg(data.vDim.ext2Start, data.vDim.ext2End, 0.75);
      strokeSeg(data.vDim.tick1Start, data.vDim.tick1End, 1.0, tickWidth);
      strokeSeg(data.vDim.tick2Start, data.vDim.tick2End, 1.0, tickWidth);

      targetCtx.globalAlpha = 1.0;

      // Draw text badge tags
      const drawBadge = (midPt: THREE.Vector3, text: string) => {
        const pos = toCanvas(midPt);
        const fontSize = Math.max(Math.round(13 * layoutScale), 10);
        targetCtx.font = `bold ${fontSize}px "SF Mono", Monaco, Menlo, Consolas, monospace`;
        const m = targetCtx.measureText(text);
        const padX = Math.round(8 * layoutScale);
        const padY = Math.round(4 * layoutScale);
        const bw = m.width + padX * 2;
        const bh = fontSize + padY * 2;
        const minEdge = Math.round(4 * layoutScale);
        const bx = Math.max(offsetX + minEdge, Math.min(offsetX + size - bw - minEdge, pos.x - bw / 2));
        const by = Math.max(offsetY + minEdge, Math.min(offsetY + size - bh - minEdge, pos.y - bh / 2));

        targetCtx.beginPath();
        if (typeof targetCtx.roundRect === 'function') {
          targetCtx.roundRect(bx, by, bw, bh, Math.max(3, Math.round(4 * layoutScale)));
        } else {
          targetCtx.rect(bx, by, bw, bh);
        }
        targetCtx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        targetCtx.fill();
        targetCtx.strokeStyle = '#38bdf8';
        targetCtx.lineWidth = Math.max(1, Math.round(1.5 * layoutScale));
        targetCtx.stroke();

        targetCtx.fillStyle = '#38bdf8';
        targetCtx.textAlign = 'center';
        targetCtx.textBaseline = 'middle';
        targetCtx.fillText(text, bx + bw / 2, by + bh / 2);
      };

      drawBadge(data.hDim.tagMid, data.hDim.label);
      drawBadge(data.vDim.tagMid, data.vDim.label);

      targetCtx.restore();
    };

    const handleDeleteDimension = (id: string) => {
      const updated = dimensionItemsRef.current.filter((d) => d.id !== id);
      dimensionItemsRef.current = updated;
      setDimensionsList(updated);
      rebuildDimensions3D();
      requestRender();
    };

    const handleClearAllDimensions = () => {
      dimensionItemsRef.current = [];
      setDimensionsList([]);
      dimensionStartVertexRef.current = null;
      setActiveDraftStart(null);
      setCurrentDraftDistance(null);
      if (draftStartMarkerRef.current) draftStartMarkerRef.current.visible = false;
      if (draftLineRef.current) draftLineRef.current.visible = false;
      rebuildDimensions3D();
      requestRender();
    };

    // Snapping helper: gets the nearest vertex of the triangle face hit by raycaster
    const getNearestVertexFromHit = (hit: THREE.Intersection): THREE.Vector3 | null => {
      if (!hit.face || !hit.object) return null;
      const mesh = hit.object as THREE.Mesh;
      if (!mesh.geometry) return null;
      const posAttr = mesh.geometry.getAttribute('position');
      if (!posAttr) return null;

      const vA = new THREE.Vector3()
        .fromBufferAttribute(posAttr, hit.face.a)
        .applyMatrix4(mesh.matrixWorld);
      const vB = new THREE.Vector3()
        .fromBufferAttribute(posAttr, hit.face.b)
        .applyMatrix4(mesh.matrixWorld);
      const vC = new THREE.Vector3()
        .fromBufferAttribute(posAttr, hit.face.c)
        .applyMatrix4(mesh.matrixWorld);

      let best = vA;
      let minD = hit.point.distanceToSquared(vA);

      const dB = hit.point.distanceToSquared(vB);
      if (dB < minD) {
        minD = dB;
        best = vB;
      }

      const dC = hit.point.distanceToSquared(vC);
      if (dC < minD) {
        minD = dC;
        best = vC;
      }

      return best;
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

    // Returns material instance(s) this specific mesh can freely set clippingPlanes on without
    // affecting any other mesh — cloning once per mesh (cached, reused across calls as long as
    // the mesh's underlying source material(s) haven't changed) even when the mesh's current
    // material is already exclusive to it, since it's cheap and keeps this function's contract
    // simple: whatever it returns is always safe to mutate per-mesh.
    const getExclusiveClipMaterials = (mesh: THREE.Mesh, sources: THREE.Material[]): THREE.Material[] => {
      const cached = meshClipMaterialsRef.current.get(mesh);
      const sameSource =
        cached && cached.sources.length === sources.length && cached.sources.every((s, i) => s === sources[i]);
      if (sameSource) return cached!.clones;
      if (cached) cached.clones.forEach((c) => c.dispose());
      const clones = sources.map((s) => s.clone());
      meshClipMaterialsRef.current.set(mesh, { sources, clones });
      return clones;
    };

    // Restores a mesh to its shared source material(s) (undoing getExclusiveClipMaterials) —
    // used once per-part clipping is no longer active for this mesh, so it goes back to sharing
    // the same material instance as its siblings (matching what applyMaterialAndShadows assigns)
    // instead of drifting on a frozen clone that stops picking up live material-property edits.
    const revertExclusiveClipMaterial = (mesh: THREE.Mesh) => {
      const cached = meshClipMaterialsRef.current.get(mesh);
      if (!cached) return;
      mesh.material = cached.sources.length === 1 ? cached.sources[0] : cached.sources;
    };

    const getHatchTexture = () => {
      if (hatchTextureRef.current) return hatchTextureRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 64, 64);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 4;
        for (let i = -64; i < 128; i += 16) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + 64, 64);
          ctx.stroke();
        }
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(24, 24);
      hatchTextureRef.current = texture;
      return texture;
    };

    const disposeClipCaps = () => {
      clipStencilGroupsRef.current.forEach((group) => {
        if (group.parent) group.parent.remove(group);
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh;
            if (m.material) {
              if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
              else m.material.dispose();
            }
          }
        });
      });
      clipStencilGroupsRef.current = [];

      if (clipCapsGroupRef.current && sceneRef.current) {
        sceneRef.current.remove(clipCapsGroupRef.current);
        clipCapsGroupRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
              if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
              else m.material.dispose();
            }
          }
        });
        clipCapsGroupRef.current = null;
      }
      clipPlaneMeshesRef.current = [];
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
      if (ssrPassRef.current) {
        ssrPassRef.current.normalMaterial.clippingPlanes = nextClippingPlanes;
      }

      const clippingActive = activeClipPlanes.length > 0;
      const isExploded = batchPartsRef.current.length > 1 && (settingsRef.current.explodeAmount || 0) > 0;
      // The chain between currentModelRef.current and a given part is NOT always a single hop:
      // detectExplodableParts sometimes unwraps one wrapper level, or falls back to raw mesh
      // nodes found anywhere in the hierarchy (see its fallback tiers below), so a part's actual
      // parent can carry its own baked-in rotation/scale that the model group's own transform
      // doesn't capture. Ensure every ancestor's matrixWorld is current before reading it below.
      if (currentModelRef.current) currentModelRef.current.updateMatrixWorld(true);

      if (isExploded && clippingActive) {
        // Pre-exploded per-object clipping: the slice is defined relative to the model's resting
        // assembly. Each part gets its own copy of the base planes, shifted by that part's current
        // world explosion displacement, so the cut stays locked to the part's pre-explosion
        // geometry as it travels — exactly as if it had been sliced before exploding, not
        // re-sliced against a plane sitting fixed in empty space.
        batchPartsRef.current.forEach((part) => {
          // Transform the part's rest and current LOCAL positions through its actual parent's
          // matrixWorld (not a hand-rolled rotation+scale guess) and subtract in world space.
          // This is exact for any parent transform chain — including an intermediate wrapper
          // node's own rotation/non-uniform scale — where a single rotation+uniform-scale
          // shortcut tied to the model group would silently ignore that wrapper's contribution
          // and let the compensation drift further off the longer a part travels while exploded.
          const parent = part.object.parent;
          const worldDelta = parent
            ? part.object.position.clone().applyMatrix4(parent.matrixWorld)
                .sub(part.basePosition.clone().applyMatrix4(parent.matrixWorld))
            : part.object.position.clone().sub(part.basePosition);

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
              const sourceMats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
              if (sourceMats.length === 0) return;
              // Lookdev materials (e.g. materialsMap.current.grey) are ONE shared instance reused
              // across every part in the model — assigning THIS part's compensated planes directly
              // to a shared material would immediately get overwritten by whichever other part
              // using the same material is processed next, so every part sharing it would render
              // with a clip plane meant for someone else. Give this mesh its own exclusive clone
              // to carry its own planes without disturbing siblings.
              const exclusiveMats = getExclusiveClipMaterials(mesh, sourceMats);
              exclusiveMats.forEach((m) => {
                const clipPlanesChanged = m.clippingPlanes !== partPlanes;
                m.clippingPlanes = partPlanes!;
                m.clipShadows = true;
                applyClipSideToMaterial(m, true);
                if (countChanged || clipPlanesChanged) {
                  m.needsUpdate = true;
                }
              });
              mesh.material = exclusiveMats.length === 1 ? exclusiveMats[0] : exclusiveMats;
            }
          });
        });
      } else if (currentModelRef.current) {
        currentModelRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            // Not doing per-part clipping right now — every mesh can safely share one plane
            // array again, so undo any exclusive clone a prior exploded+clipping pass made for
            // this mesh (see getExclusiveClipMaterials) and go back to the shared instance, or a
            // stale clone would silently stop picking up live material-property edits.
            revertExclusiveClipMaterial(mesh);
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

      // Solid cross-section cut capping (stencil buffer)
      const solidCapsEnabled = clippingActive && clipping.solidCaps !== false;
      disposeClipCaps();

      if (solidCapsEnabled && currentModelRef.current && sceneRef.current) {
        const capsGroup = new THREE.Group();
        capsGroup.userData.isCapsGroup = true;
        sceneRef.current.add(capsGroup);
        clipCapsGroupRef.current = capsGroup;

        const capColorHex = clipping.capColor || '#e11d48';
        const capOpacity = Math.min(Math.max(clipping.capOpacity ?? 1.0, 0.05), 1.0);
        const isTransparent = capOpacity < 0.999;
        const useHatch = !!clipping.capHatching;

        // Partition by explodable assembly parts (or the whole model as a single part if no subparts)
        const partsList =
          batchPartsRef.current.length > 0
            ? batchPartsRef.current
            : [
                {
                  object: currentModelRef.current,
                  basePosition: currentModelRef.current.position.clone(),
                  localCenter: new THREE.Vector3(),
                },
              ];

        const allTargetMeshes: THREE.Mesh[] = [];

        partsList.forEach((part, partIdx) => {
          if (!part.object.visible) return;

          // Collect visible meshes belonging specifically to this part
          const partMeshes: THREE.Mesh[] = [];
          part.object.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const m = child as THREE.Mesh;
              if (
                m.visible &&
                !m.userData.isStencilMesh &&
                !m.userData.isHelper &&
                !m.userData.isDimension &&
                m.geometry
              ) {
                partMeshes.push(m);
                allTargetMeshes.push(m);
              }
            }
          });

          if (partMeshes.length === 0) return;

          // Determine the clipping planes specific to this part:
          // When exploded, each part carries its own compensated planes in batchPartPlanesRef.
          // When not exploded, planesForPart is just activeClipPlanes.
          const planesForPart =
            isExploded && clippingActive
              ? batchPartPlanesRef.current.get(part.object) || activeClipPlanes
              : activeClipPlanes;

          // Calculate current world bounding box of this part (takes into account explosion translation)
          const partBBox = new THREE.Box3().setFromObject(part.object);
          if (partBBox.isEmpty()) return;
          const partSize = partBBox.getSize(new THREE.Vector3());
          const partCenter = partBBox.getCenter(new THREE.Vector3());
          const partMaxDim = Math.max(partSize.x, partSize.y, partSize.z, 2);
          const planeSize = Math.max(partMaxDim * 3.5, 25);

          planesForPart.forEach((plane, i) => {
            // Unique renderOrder per part and plane so each part performs its own
            // stencil write -> cap draw -> stencil clear cycle without cross-part artifacts
            const renderOrderBase = (partIdx * activeClipPlanes.length + i) * 2 + 1;

            // 1. Build stencil groups attached to each mesh of THIS part
            partMeshes.forEach((mesh) => {
              const stencilGroup = new THREE.Group();
              stencilGroup.userData.isStencilGroup = true;

              const baseMat = new THREE.MeshBasicMaterial();
              baseMat.depthWrite = false;
              baseMat.depthTest = false;
              baseMat.colorWrite = false;
              baseMat.stencilWrite = true;
              baseMat.stencilFunc = THREE.AlwaysStencilFunc;

              // Back faces: increment stencil (clipped by THIS part's plane)
              const mat0 = baseMat.clone();
              mat0.side = THREE.BackSide;
              mat0.clippingPlanes = [plane];
              mat0.stencilFail = THREE.IncrementWrapStencilOp;
              mat0.stencilZFail = THREE.IncrementWrapStencilOp;
              mat0.stencilZPass = THREE.IncrementWrapStencilOp;

              const mesh0 = new THREE.Mesh(mesh.geometry, mat0);
              mesh0.renderOrder = renderOrderBase;
              mesh0.castShadow = false;
              mesh0.receiveShadow = false;
              mesh0.raycast = () => {};
              mesh0.userData.isStencilMesh = true;
              stencilGroup.add(mesh0);

              // Front faces: decrement stencil (clipped by THIS part's plane)
              const mat1 = baseMat.clone();
              mat1.side = THREE.FrontSide;
              mat1.clippingPlanes = [plane];
              mat1.stencilFail = THREE.DecrementWrapStencilOp;
              mat1.stencilZFail = THREE.DecrementWrapStencilOp;
              mat1.stencilZPass = THREE.DecrementWrapStencilOp;

              const mesh1 = new THREE.Mesh(mesh.geometry, mat1);
              mesh1.renderOrder = renderOrderBase;
              mesh1.castShadow = false;
              mesh1.receiveShadow = false;
              mesh1.raycast = () => {};
              mesh1.userData.isStencilMesh = true;
              stencilGroup.add(mesh1);

              mesh.add(stencilGroup);
              clipStencilGroupsRef.current.push(stencilGroup);
            });

            // 2. Cap Plane for this part: coplanar with this part's cut plane,
            // centered at this part's exploded cut face, and clipped by this part's other planes.
            const otherPlanes = planesForPart.filter((p) => p !== plane);
            const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
            const capMat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(capColorHex),
              roughness: 0.5,
              metalness: 0.1,
              side: THREE.DoubleSide,
              clippingPlanes: otherPlanes,
              stencilWrite: true,
              stencilRef: 0,
              stencilFunc: THREE.NotEqualStencilFunc,
              stencilFail: THREE.ReplaceStencilOp,
              stencilZFail: THREE.ReplaceStencilOp,
              stencilZPass: THREE.ReplaceStencilOp,
              depthWrite: !isTransparent,
              transparent: isTransparent,
              opacity: capOpacity,
              map: useHatch ? getHatchTexture() : null,
            });

            const po = new THREE.Mesh(planeGeom, capMat);
            po.renderOrder = renderOrderBase + 1;
            po.castShadow = false;
            po.receiveShadow = false;
            po.raycast = () => {};
            po.onAfterRender = (renderer) => {
              renderer.clearStencil();
            };

            // Project this part's center directly onto the part's cut plane so the cap moves with the mesh
            plane.projectPoint(partCenter, po.position);
            po.lookAt(
              po.position.x - plane.normal.x,
              po.position.y - plane.normal.y,
              po.position.z - plane.normal.z
            );

            capsGroup.add(po);
            clipPlaneMeshesRef.current.push(po);
          });
        });

        // Set model meshes to render after all stencil and cap passes
        const maxStencilOrder = (partsList.length * activeClipPlanes.length + 1) * 2 + 5;
        const modelRenderOrder = Math.max(100, maxStencilOrder + 10);
        allTargetMeshes.forEach((m) => {
          m.renderOrder = modelRenderOrder;
        });
        currentModelRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && !child.userData.isStencilMesh) {
            (child as THREE.Mesh).renderOrder = modelRenderOrder;
          }
        });
      } else if (currentModelRef.current) {
        currentModelRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && !child.userData.isStencilMesh) {
            child.renderOrder = 0;
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
        draftPullDirection,
        draftSafeAngleDeg,
        draftWarningAngleDeg,
      } = settingsRef.current;

      if (dirLight1Ref.current) dirLight1Ref.current.castShadow = castShadows;

      if (thicknessMaterialRef.current) {
        thicknessMaterialRef.current.uniforms.uMinThickness.value = minThicknessInches;
        thicknessMaterialRef.current.uniforms.uScaleFactor.value = dimensionsRef.current.scaleFactor;
      }

      if (draftMaterialRef.current) {
        const pullVec = getPullDirectionVector(draftPullDirection || '+Y');
        draftMaterialRef.current.uniforms.uPullDir.value.copy(pullVec);
        draftMaterialRef.current.uniforms.uSafeAngle.value = draftSafeAngleDeg ?? 3.0;
        draftMaterialRef.current.uniforms.uWarningAngle.value = draftWarningAngleDeg ?? 1.0;
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
          } else if (matKey === 'draft') {
            mesh.material = draftMaterialRef.current;
          } else if (matKey === 'balance') {
            mesh.material = materialsMap.current.balance;
          } else {
            mesh.material = materialsMap.current[matKey] || materialsMap.current.grey;
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
      if (matKey === 'balance') {
        updateBalanceVisuals();
      } else if (balanceGroupRef.current && sceneRef.current) {
        sceneRef.current.remove(balanceGroupRef.current);
        disposeHierarchy(balanceGroupRef.current);
        balanceGroupRef.current = null;
        setBalanceAnalysis(null);
        balanceAnalysisRef.current = null;
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
      if (selectedPartIndexRef.current !== null) {
        selectPart(selectedPartIndexRef.current);
      }
      if (settingsRef.current.material === 'balance') {
        updateBalanceVisuals();
      }
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

    // Splits a geometry into distinct disconnected solid bodies / connected components.
    // Splits a geometry into distinct disconnected solid bodies / connected components (matching Blender's Separate by Loose Parts).
    // Uses adaptive spatial vertex quantization to resolve identical topological vertices across faces
    // followed by edge-based Disjoint Set Union (Union-Find) on triangle indices so contiguous 2-manifold shells
    // stay completely intact without falsely merging touching CAD assembly parts.
    const splitGeometryIntoConnectedComponents = (geometry: THREE.BufferGeometry): THREE.BufferGeometry[] => {
      const posAttr = geometry.attributes.position;
      if (!posAttr || posAttr.count < 9) {
        return [geometry];
      }

      const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
      const numVertices = nonIndexed.attributes.position.count;
      const triCount = Math.floor(numVertices / 3);
      if (triCount < 2) return [geometry];

      const srcPos = nonIndexed.attributes.position.array as Float32Array;

      // Compute bounding box to determine coordinate scale
      if (!nonIndexed.boundingBox) nonIndexed.computeBoundingBox();
      const bbox = nonIndexed.boundingBox || new THREE.Box3();
      const size = bbox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1e-4);

      // Adaptive precision for vertex welding:
      // In CAD STL files, shared vertices have exact float32 coordinates.
      // Quantizing with a fine tolerance ensures that adjacent triangles sharing a vertex
      // receive identical vertex IDs without erroneously bridging across separate CAD bodies.
      const eps = Math.max(1e-6, Math.min(1e-4, maxDim * 1e-5));
      const invEps = 1 / eps;

      // Spatial quantization hash map for unique vertices
      const vertMap = new Map<string, number>();
      const triVerts = new Int32Array(triCount * 3);
      let uniqueCount = 0;

      for (let i = 0; i < triCount * 3; i++) {
        const i3 = i * 3;
        const x = srcPos[i3];
        const y = srcPos[i3 + 1];
        const z = srcPos[i3 + 2];

        const qx = Math.round(x * invEps);
        const qy = Math.round(y * invEps);
        const qz = Math.round(z * invEps);
        const key = `${qx},${qy},${qz}`;

        let id = vertMap.get(key);
        if (id === undefined) {
          id = uniqueCount++;
          vertMap.set(key, id);
        }
        triVerts[i] = id;
      }

      // Disjoint Set Union (Union-Find) on triangle indices
      const parent = new Int32Array(triCount);
      for (let t = 0; t < triCount; t++) parent[t] = t;

      const find = (i: number): number => {
        let root = i;
        while (root !== parent[root]) root = parent[root];
        let curr = i;
        while (curr !== root) {
          const nxt = parent[curr];
          parent[curr] = root;
          curr = nxt;
        }
        return root;
      };

      const union = (i: number, j: number) => {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      };

      // Edge map with 64-bit BigInt keys:
      // Each triangle has 3 undirected edges: (min(u, v), max(u, v)).
      // Two triangles that share an edge belong to the same connected solid shell.
      const edgeMap = new Map<bigint, number>();

      for (let t = 0; t < triCount; t++) {
        const t3 = t * 3;
        const a = triVerts[t3];
        const b = triVerts[t3 + 1];
        const c = triVerts[t3 + 2];

        const abMin = a < b ? a : b;
        const abMax = a < b ? b : a;
        const e0 = (BigInt(abMin) << 32n) | BigInt(abMax);

        const bcMin = b < c ? b : c;
        const bcMax = b < c ? c : b;
        const e1 = (BigInt(bcMin) << 32n) | BigInt(bcMax);

        const caMin = c < a ? c : a;
        const caMax = c < a ? a : c;
        const e2 = (BigInt(caMin) << 32n) | BigInt(caMax);

        for (const e of [e0, e1, e2]) {
          const prev = edgeMap.get(e);
          if (prev !== undefined) {
            union(t, prev);
          } else {
            edgeMap.set(e, t);
          }
        }
      }

      // Group triangles by connected component root
      const compMap = new Map<number, number[]>();
      for (let t = 0; t < triCount; t++) {
        const root = find(t);
        let list = compMap.get(root);
        if (!list) {
          list = [];
          compMap.set(root, list);
        }
        list.push(t);
      }

      let components = Array.from(compMap.values());
      if (components.length <= 1) return [geometry];

      // Discard tiny degenerate 1-2 triangle artifacts if there are multiple substantial components
      const substantial = components.filter((c) => c.length >= 3);
      if (substantial.length >= 2) {
        components = substantial;
      } else if (components.length <= 1) {
        return [geometry];
      }

      // Sort descending by triangle count (primary parts first)
      components.sort((a, b) => b.length - a.length);

      const srcNormal = nonIndexed.attributes.normal ? (nonIndexed.attributes.normal.array as Float32Array) : null;
      const srcUv = nonIndexed.attributes.uv ? (nonIndexed.attributes.uv.array as Float32Array) : null;
      const srcColor = nonIndexed.attributes.color ? (nonIndexed.attributes.color.array as Float32Array) : null;
      const colorItemSize = nonIndexed.attributes.color ? nonIndexed.attributes.color.itemSize : 3;

      const resultGeometries: THREE.BufferGeometry[] = [];

      for (const triList of components) {
        const partPos = new Float32Array(triList.length * 9);
        const partNorm = srcNormal ? new Float32Array(triList.length * 9) : null;
        const partUv = srcUv ? new Float32Array(triList.length * 6) : null;
        const partColor = srcColor ? new Float32Array(triList.length * colorItemSize * 3) : null;

        for (let i = 0; i < triList.length; i++) {
          const t = triList[i];
          const srcOffset9 = t * 9;
          const dstOffset9 = i * 9;
          for (let k = 0; k < 9; k++) {
            partPos[dstOffset9 + k] = srcPos[srcOffset9 + k];
            if (partNorm && srcNormal) partNorm[dstOffset9 + k] = srcNormal[srcOffset9 + k];
          }
          if (partUv && srcUv) {
            const srcOffset6 = t * 6;
            const dstOffset6 = i * 6;
            for (let k = 0; k < 6; k++) {
              partUv[dstOffset6 + k] = srcUv[srcOffset6 + k];
            }
          }
          if (partColor && srcColor) {
            const stride = colorItemSize * 3;
            const srcOffset = t * stride;
            const dstOffset = i * stride;
            for (let k = 0; k < stride; k++) {
              partColor[dstOffset + k] = srcColor[srcOffset + k];
            }
          }
        }

        const partGeom = new THREE.BufferGeometry();
        partGeom.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
        if (partNorm) {
          partGeom.setAttribute('normal', new THREE.BufferAttribute(partNorm, 3));
        } else {
          partGeom.computeVertexNormals();
        }
        if (partUv) partGeom.setAttribute('uv', new THREE.BufferAttribute(partUv, 2));
        if (partColor) partGeom.setAttribute('color', new THREE.BufferAttribute(partColor, colorItemSize));

        partGeom.computeBoundingBox();
        partGeom.computeBoundingSphere();
        resultGeometries.push(partGeom);
      }

      return resultGeometries;
    };

    // Helper to compute volume (mm³), watertightness heuristic, and mesh count of any Object3D hierarchy
    const computeObjectVolumeMm3 = (obj: THREE.Object3D) => {
      obj.updateMatrixWorld(true);
      let volMm3 = 0;
      let watertight = true;
      let meshCount = 0;

      const va = new THREE.Vector3();
      const vb = new THREE.Vector3();
      const vc = new THREE.Vector3();

      obj.traverse((child) => {
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

        volMm3 += Math.abs(meshVolume);

        for (const count of edgeCounts.values()) {
          if (count !== 2) {
            watertight = false;
            break;
          }
        }
      });

      return { volMm3, watertight, meshCount };
    };

    // Compute solid volume (cm³) and a watertightness heuristic, reusing the same per-mesh
    // traversal style as the thickness checker. Runs once per load at scale=1; volume scales
    // by scaleFactor^3 afterward without needing to re-walk the geometry. Caches unscaled volume
    // on each part so partial selections can instantly report exact selected volume/weight/cost.
    const computeVolumeAndWatertight = (model: THREE.Object3D) => {
      let totalVolumeMm3 = 0;
      let overallWatertight = true;
      let totalMeshCount = 0;

      if (batchPartsRef.current.length > 0) {
        batchPartsRef.current.forEach((part) => {
          const res = computeObjectVolumeMm3(part.object);
          part.unscaledVolumeMm3 = res.volMm3;
          part.isWatertight = res.watertight;
          totalVolumeMm3 += res.volMm3;
          if (!res.watertight) overallWatertight = false;
          totalMeshCount += res.meshCount;
        });
      } else {
        const res = computeObjectVolumeMm3(model);
        totalVolumeMm3 = res.volMm3;
        overallWatertight = res.watertight;
        totalMeshCount = res.meshCount;
      }

      unscaledVolumeCm3Ref.current = totalVolumeMm3 / 1000; // mm^3 -> cm^3
      isWatertightRef.current = overallWatertight;

      return { volumeCm3: unscaledVolumeCm3Ref.current, watertight: overallWatertight, meshCount: totalMeshCount };
    };

    // Recompute the displayed volume/weight/cost stats from cached unscaled volume — cheap,
    // safe to call on every scale/density/cost/selection change without re-walking geometry.
    // If a partial selection is active (1+ but not all loaded meshes), calculates the selected
    // mesh volume/weight/cost and flags isPartialSelection for UI asterisk display.
    const refreshVolumeStats = (partCount?: number) => {
      const scaleFactor = dimensionsRef.current.scaleFactor || 1;
      const density = settingsRef.current.materialDensityGCm3 || 1.1;
      const costPerKg = settingsRef.current.costPerKgUSD || 0;

      const totalParts = batchPartsRef.current.length;
      const selectedIndices = selectedPartIndicesRef.current || [];

      // Check if partial selection: more than 1 loaded mesh, at least one selected, but not all
      const isPartialSelection =
        totalParts > 1 &&
        selectedIndices.length > 0 &&
        selectedIndices.length < totalParts;

      let baseVolumeCm3 = 0;
      let isWatertight = true;
      let count = partCount ?? (totalParts > 0 ? totalParts : 1);

      if (isPartialSelection) {
        let selVolMm3 = 0;
        selectedIndices.forEach((idx) => {
          const part = batchPartsRef.current[idx];
          if (part) {
            if (part.unscaledVolumeMm3 === undefined) {
              const res = computeObjectVolumeMm3(part.object);
              part.unscaledVolumeMm3 = res.volMm3;
              part.isWatertight = res.watertight;
            }
            selVolMm3 += part.unscaledVolumeMm3 || 0;
            if (part.isWatertight === false) isWatertight = false;
          }
        });
        baseVolumeCm3 = selVolMm3 / 1000;
        count = selectedIndices.length;
      } else {
        baseVolumeCm3 = unscaledVolumeCm3Ref.current;
        isWatertight = isWatertightRef.current;
        count = totalParts > 0 ? totalParts : (partCount ?? 1);
      }

      const scaledVolumeCm3 = baseVolumeCm3 * Math.pow(scaleFactor, 3);
      const weightGrams = scaledVolumeCm3 * density;
      const estimatedCost = (weightGrams / 1000) * costPerKg;

      const stats: VolumeStats = {
        volumeCm3: scaledVolumeCm3,
        weightGrams,
        estimatedCost,
        isWatertight,
        partCount: count,
        isPartialSelection,
        selectedCount: selectedIndices.length,
        totalPartCount: totalParts,
      };
      setVolumeStats(stats);
      onVolumeComputed?.(stats);
    };

    // =========================================================================
    // Center of Mass & Balance Check LookDev Analysis Engine & Visuals
    // =========================================================================

    const disposeHierarchy = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
          const m = child as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) {
            if (Array.isArray(m.material)) {
              m.material.forEach((mat) => mat.dispose());
            } else {
              m.material.dispose();
            }
          }
        }
      });
    };

    // Calculate distance from 2D point (px, py) to segment (ax, ay)-(bx, by)
    const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-10) {
        return Math.hypot(px - ax, py - ay);
      }
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      return Math.hypot(px - projX, py - projY);
    };

    // Andrew's Monotone Chain 2D Convex Hull (O(N log N))
    // Andrew's Monotone Chain 2D Convex Hull (O(N log N))
    const compute2DConvexHull = (points: { x: number; z: number }[]): { x: number; z: number }[] => {
      if (points.length <= 2) return [...points];
      const pts = [...points].sort((a, b) => (Math.abs(a.x - b.x) > 1e-7 ? a.x - b.x : a.z - b.z));
      const uniquePts: { x: number; z: number }[] = [];
      for (let i = 0; i < pts.length; i++) {
        if (i === 0 || Math.hypot(pts[i].x - uniquePts[uniquePts.length - 1].x, pts[i].z - uniquePts[uniquePts.length - 1].z) > 1e-5) {
          uniquePts.push(pts[i]);
        }
      }
      if (uniquePts.length <= 2) return uniquePts;

      const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
        (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

      const lower: { x: number; z: number }[] = [];
      for (const p of uniquePts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-7) {
          lower.pop();
        }
        lower.push(p);
      }

      const upper: { x: number; z: number }[] = [];
      for (let i = uniquePts.length - 1; i >= 0; i--) {
        const p = uniquePts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-7) {
          upper.pop();
        }
        upper.push(p);
      }

      lower.pop();
      upper.pop();
      return lower.concat(upper);
    };

    // Geometric Mass Analysis Engine
    const computeBalanceAndFootprint = (model: THREE.Object3D): BalanceAnalysis | null => {
      try {
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) return null;

        const groundY = box.min.y;
        const boxHeight = Math.max(1e-4, box.max.y - box.min.y);
        const boxDepthZ = Math.max(1e-4, box.max.z - box.min.z);
        const boxWidthX = Math.max(1e-4, box.max.x - box.min.x);

        let totalVolume = 0;
        let weightedCm = new THREE.Vector3(0, 0, 0);

        let totalArea = 0;
        let areaWeightedCm = new THREE.Vector3(0, 0, 0);

        const va = new THREE.Vector3();
        const vb = new THREE.Vector3();
        const vc = new THREE.Vector3();
        const edge1 = new THREE.Vector3();
        const edge2 = new THREE.Vector3();
        const triCenter = new THREE.Vector3();

        // 1. Gather mass/volume distribution via tetrahedron decomposition
        model.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh) return;
          const mesh = child as THREE.Mesh;
          const geom = mesh.geometry;
          if (!geom) return;

          const pos = geom.getAttribute('position');
          if (!pos || pos.count === 0) return;

          const index = geom.index;
          const numTriangles = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
          const stride = Math.max(1, Math.floor(numTriangles / 25000));

          for (let i = 0; i < numTriangles; i += stride) {
            const i0 = index ? index.getX(i * 3) : i * 3;
            const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
            const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

            va.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
            vb.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
            vc.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

            // Volume & CM via tetrahedron decomposition with origin
            const tetVol = va.dot(edge1.copy(vb).cross(edge2.copy(vc))) / 6.0;
            const signedVol = Number.isFinite(tetVol) ? tetVol : 0;
            totalVolume += signedVol;

            triCenter.copy(va).add(vb).add(vc).multiplyScalar(0.25);
            weightedCm.addScaledVector(triCenter, signedVol);

            // Surface Area fallback
            edge1.subVectors(vb, va);
            edge2.subVectors(vc, va);
            const area = edge1.cross(edge2).length() * 0.5;
            if (Number.isFinite(area) && area > 0) {
              totalArea += area;
              triCenter.copy(va).add(vb).add(vc).multiplyScalar(1 / 3);
              areaWeightedCm.addScaledVector(triCenter, area);
            }
          }
        });

        // Center of mass determination
        const cm = new THREE.Vector3();
        if (Math.abs(totalVolume) > 1e-6 && Number.isFinite(weightedCm.x)) {
          cm.copy(weightedCm).multiplyScalar(1.0 / totalVolume);
        } else if (totalArea > 1e-6 && Number.isFinite(areaWeightedCm.x)) {
          cm.copy(areaWeightedCm).multiplyScalar(1.0 / totalArea);
        } else {
          box.getCenter(cm);
        }

        if (!Number.isFinite(cm.x) || !Number.isFinite(cm.y) || !Number.isFinite(cm.z)) {
          box.getCenter(cm);
        }

        // 2. High-fidelity contact points collection
        // Precision base tolerance: ~0.18% of model height (prevents elevated/curved geometry from being falsely counted as ground contact)
        const primaryTol = Math.max(0.0002, boxHeight * 0.0018);
        const fallbackTol = Math.max(0.0005, boxHeight * 0.0045);

        const gatherContactPoints = (tol: number) => {
          const spatialMap = new Map<string, { x: number; z: number }>();
          const gridCell = Math.max(0.0005, Math.min(boxWidthX, boxDepthZ) * 0.003);

          model.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) return;
            const mesh = child as THREE.Mesh;
            const geom = mesh.geometry;
            if (!geom) return;
            const pos = geom.getAttribute('position');
            if (!pos || pos.count === 0) return;

            const v = new THREE.Vector3();
            const stride = Math.max(1, Math.floor(pos.count / 15000));
            for (let i = 0; i < pos.count; i += stride) {
              v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
              if (v.y <= groundY + tol) {
                const gx = Math.round(v.x / gridCell);
                const gz = Math.round(v.z / gridCell);
                const key = `${gx},${gz}`;
                if (!spatialMap.has(key)) {
                  spatialMap.set(key, { x: v.x, z: v.z });
                }
              }
            }
          });
          return Array.from(spatialMap.values());
        };

        let contactPoints = gatherContactPoints(primaryTol);
        if (contactPoints.length < 3) {
          contactPoints = gatherContactPoints(fallbackTol);
        }

        let hull: { x: number; z: number }[] = [];
        if (contactPoints.length >= 3) {
          hull = compute2DConvexHull(contactPoints);
        }

        const n = hull.length;
        const scaleInches = getConversionToInches();
        const cmHeight = Math.max(1e-4, cm.y - groundY);
        const cmHeightMm = cmHeight;
        const cmHeightInches = cmHeight * scaleInches;

        const volCm3 = unscaledVolumeCm3Ref.current > 0
          ? unscaledVolumeCm3Ref.current * Math.pow(dimensionsRef.current.scaleFactor, 3)
          : Math.abs(totalVolume) / 1000;

        if (n < 3) {
          // Point or knife-edge contact: completely unstable
          return {
            isStable: false,
            centerOfMass: { x: cm.x, y: cm.y, z: cm.z },
            centerOfMassInches: { x: cm.x * scaleInches, y: cm.y * scaleInches, z: cm.z * scaleInches },
            centerOfMassMm: { x: cm.x, y: cm.y, z: cm.z },
            cmHeightInches,
            cmHeightMm,
            contactPointCount: contactPoints.length,
            stabilityMarginInches: 0,
            stabilityMarginMm: 0,
            groundY,
            volumeCm3: volCm3,
            isWatertight: isWatertightRef.current,
            marginZOverallMm: 0,
            marginZOverallInches: 0,
            marginZFrontMm: 0,
            marginZFrontInches: 0,
            marginZBackMm: 0,
            marginZBackInches: 0,
            criticalPitchAngleDeg: 0,
            isZStable: false,
            tippingZDirection: 'none',
            marginXOverallMm: 0,
            marginXOverallInches: 0,
            marginXLeftMm: 0,
            marginXLeftInches: 0,
            marginXRightMm: 0,
            marginXRightInches: 0,
            criticalRollAngleDeg: 0,
            isXStable: false,
            tippingXDirection: 'none',
            limitingAxis: 'Unstable',
            hullPoints: [],
          };
        }

        // 3. Point-in-polygon test for CM projection (cm.x, cm.z) inside hull
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = hull[i].x, zi = hull[i].z;
          const xj = hull[j].x, zj = hull[j].z;
          const intersect = zi > cm.z !== zj > cm.z && cm.x < ((xj - xi) * (cm.z - zi)) / (zj - zi + 1e-12) + xi;
          if (intersect) inside = !inside;
        }

        // Minimum perpendicular distance to any polygon edge
        let minEdgeDist = Infinity;
        for (let i = 0; i < n; i++) {
          const p1 = hull[i];
          const p2 = hull[(i + 1) % n];
          const d = distToSegment(cm.x, cm.z, p1.x, p1.z, p2.x, p2.z);
          if (d < minEdgeDist) minEdgeDist = d;
        }
        if (!Number.isFinite(minEdgeDist)) minEdgeDist = 0;

        const stabilityMargin = inside ? minEdgeDist : -minEdgeDist;
        const isStable = inside && minEdgeDist > 0.0005;

        // 4. Directional Axis Intersections & Stability Breakdown
        // Find exact intersections of vertical line X = cm.x with the hull polygon (Z-axis / Pitch)
        let zFrontVal = -Infinity;
        let zBackVal = Infinity;
        let zFrontCross = { x: cm.x, z: cm.z };
        let zBackCross = { x: cm.x, z: cm.z };

        for (let i = 0; i < n; i++) {
          const p1 = hull[i];
          const p2 = hull[(i + 1) % n];
          const minX = Math.min(p1.x, p2.x);
          const maxX = Math.max(p1.x, p2.x);
          if (cm.x >= minX - 1e-7 && cm.x <= maxX + 1e-7 && Math.abs(p2.x - p1.x) > 1e-7) {
            const t = (cm.x - p1.x) / (p2.x - p1.x);
            const zInt = p1.z + t * (p2.z - p1.z);
            if (zInt >= cm.z) {
              if (zInt > zFrontVal) {
                zFrontVal = zInt;
                zFrontCross = { x: cm.x, z: zInt };
              }
            } else {
              if (zInt < zBackVal) {
                zBackVal = zInt;
                zBackCross = { x: cm.x, z: zInt };
              }
            }
          }
        }

        const allZ = hull.map((p) => p.z);
        const minHullZ = Math.min(...allZ);
        const maxHullZ = Math.max(...allZ);

        if (!Number.isFinite(zFrontVal)) {
          zFrontVal = maxHullZ;
          zFrontCross = { x: cm.x, z: maxHullZ };
        }
        if (!Number.isFinite(zBackVal)) {
          zBackVal = minHullZ;
          zBackCross = { x: cm.x, z: minHullZ };
        }

        const marginZFront = zFrontVal - cm.z; // positive if CM is behind front edge
        const marginZBack = cm.z - zBackVal;  // positive if CM is in front of back edge
        const marginZOverall = inside ? Math.min(marginZFront, marginZBack) : (marginZFront < 0 ? marginZFront : -marginZBack);
        const isZStable = inside && marginZFront > 0.0005 && marginZBack > 0.0005;
        let tippingZDirection: 'forward' | 'backward' | 'none' = 'none';
        if (marginZFront < 0) tippingZDirection = 'forward';
        else if (marginZBack < 0) tippingZDirection = 'backward';

        const criticalPitchAngleDeg = isZStable
          ? Math.atan2(Math.max(0, Math.min(marginZFront, marginZBack)), cmHeight) * (180 / Math.PI)
          : 0;

        // Find exact intersections of horizontal line Z = cm.z with the hull polygon (X-axis / Roll)
        let xRightVal = -Infinity;
        let xLeftVal = Infinity;
        let xRightCross = { x: cm.x, z: cm.z };
        let xLeftCross = { x: cm.x, z: cm.z };

        for (let i = 0; i < n; i++) {
          const p1 = hull[i];
          const p2 = hull[(i + 1) % n];
          const minZ = Math.min(p1.z, p2.z);
          const maxZ = Math.max(p1.z, p2.z);
          if (cm.z >= minZ - 1e-7 && cm.z <= maxZ + 1e-7 && Math.abs(p2.z - p1.z) > 1e-7) {
            const t = (cm.z - p1.z) / (p2.z - p1.z);
            const xInt = p1.x + t * (p2.x - p1.x);
            if (xInt >= cm.x) {
              if (xInt > xRightVal) {
                xRightVal = xInt;
                xRightCross = { x: xInt, z: cm.z };
              }
            } else {
              if (xInt < xLeftVal) {
                xLeftVal = xInt;
                xLeftCross = { x: xInt, z: cm.z };
              }
            }
          }
        }

        const allX = hull.map((p) => p.x);
        const minHullX = Math.min(...allX);
        const maxHullX = Math.max(...allX);

        if (!Number.isFinite(xRightVal)) {
          xRightVal = maxHullX;
          xRightCross = { x: maxHullX, z: cm.z };
        }
        if (!Number.isFinite(xLeftVal)) {
          xLeftVal = minHullX;
          xLeftCross = { x: minHullX, z: cm.z };
        }

        const marginXRight = xRightVal - cm.x;
        const marginXLeft = cm.x - xLeftVal;
        const marginXOverall = inside ? Math.min(marginXRight, marginXLeft) : (marginXRight < 0 ? marginXRight : -marginXLeft);
        const isXStable = inside && marginXRight > 0.0005 && marginXLeft > 0.0005;
        let tippingXDirection: 'left' | 'right' | 'none' = 'none';
        if (marginXRight < 0) tippingXDirection = 'right';
        else if (marginXLeft < 0) tippingXDirection = 'left';

        const criticalRollAngleDeg = isXStable
          ? Math.atan2(Math.max(0, Math.min(marginXRight, marginXLeft)), cmHeight) * (180 / Math.PI)
          : 0;

        // Determine which axis is limiting stability
        let limitingAxis: 'Z (Pitch)' | 'X (Roll)' | 'Balanced' | 'Unstable' = 'Balanced';
        if (!isStable) {
          limitingAxis = 'Unstable';
        } else if (criticalPitchAngleDeg < criticalRollAngleDeg * 0.75 || marginZOverall < marginXOverall * 0.65) {
          limitingAxis = 'Z (Pitch)';
        } else if (criticalRollAngleDeg < criticalPitchAngleDeg * 0.75 || marginXOverall < marginZOverall * 0.65) {
          limitingAxis = 'X (Roll)';
        } else {
          limitingAxis = 'Balanced';
        }

        return {
          isStable,
          centerOfMass: { x: cm.x, y: cm.y, z: cm.z },
          centerOfMassInches: {
            x: cm.x * scaleInches,
            y: cm.y * scaleInches,
            z: cm.z * scaleInches,
          },
          centerOfMassMm: { x: cm.x, y: cm.y, z: cm.z },
          cmHeightInches,
          cmHeightMm,
          contactPointCount: contactPoints.length,
          stabilityMarginInches: stabilityMargin * scaleInches,
          stabilityMarginMm: stabilityMargin,
          groundY,
          volumeCm3: volCm3,
          isWatertight: isWatertightRef.current,

          marginZOverallMm: marginZOverall,
          marginZOverallInches: marginZOverall * scaleInches,
          marginZFrontMm: marginZFront,
          marginZFrontInches: marginZFront * scaleInches,
          marginZBackMm: marginZBack,
          marginZBackInches: marginZBack * scaleInches,
          criticalPitchAngleDeg,
          isZStable,
          tippingZDirection,

          marginXOverallMm: marginXOverall,
          marginXOverallInches: marginXOverall * scaleInches,
          marginXLeftMm: marginXLeft,
          marginXLeftInches: marginXLeft * scaleInches,
          marginXRightMm: marginXRight,
          marginXRightInches: marginXRight * scaleInches,
          criticalRollAngleDeg,
          isXStable,
          tippingXDirection,

          limitingAxis,
          hullPoints: hull,
          crosshairs: {
            zFront: zFrontCross,
            zBack: zBackCross,
            xLeft: xLeftCross,
            xRight: xRightCross,
          },
        };
      } catch (err) {
        console.error('Failed to compute balance and footprint:', err);
        return null;
      }
    };

    // Update 3D Balance Visuals (Pedestal, CM sphere, Plumb line, Contact target, Support footprint, Axis Tipping Crosshairs)
    const updateBalanceVisuals = () => {
      if (!sceneRef.current || !currentModelRef.current) return;

      // Remove existing balance group
      if (balanceGroupRef.current) {
        sceneRef.current.remove(balanceGroupRef.current);
        disposeHierarchy(balanceGroupRef.current);
        balanceGroupRef.current = null;
      }

      if (settingsRef.current.material !== 'balance') {
        setBalanceAnalysis(null);
        balanceAnalysisRef.current = null;
        return;
      }

      try {
        const analysis = computeBalanceAndFootprint(currentModelRef.current);
        setBalanceAnalysis(analysis);
        balanceAnalysisRef.current = analysis;

        if (!analysis) return;

        const box = new THREE.Box3().setFromObject(currentModelRef.current);
        const boxSize = new THREE.Vector3();
        box.getSize(boxSize);
        const radiusEst = Math.max(0.5, Math.hypot(boxSize.x, boxSize.z) * 0.7);

        const group = new THREE.Group();
        group.name = 'BalanceCheckVisuals';

        const groundY = analysis.groundY;
        const isStable = analysis.isStable;
        const themeColor = isStable ? 0x10b981 : 0xef4444; // emerald vs red

        // 1. Exclusive Ground Pedestal (circular laboratory stage)
        const pedHeight = Math.max(0.05, boxSize.y * 0.04);
        const pedRadius = radiusEst * 1.25;
        const pedGeom = new THREE.CylinderGeometry(pedRadius, pedRadius * 1.02, pedHeight, 64);
        const pedMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a, // dark slate
          roughness: 0.45,
          metalness: 0.25,
        });
        const pedestal = new THREE.Mesh(pedGeom, pedMat);
        pedestal.position.set(
          (box.min.x + box.max.x) * 0.5,
          groundY - pedHeight * 0.5,
          (box.min.z + box.max.z) * 0.5
        );
        pedestal.receiveShadow = true;
        group.add(pedestal);

        // Concentric reference rings on pedestal
        const ringMat = new THREE.LineBasicMaterial({ color: 0x334155, linewidth: 1 });
        [0.35, 0.65, 0.95].forEach((frac) => {
          const r = pedRadius * frac;
          const pts: THREE.Vector3[] = [];
          for (let a = 0; a <= 64; a++) {
            const theta = (a / 64) * Math.PI * 2;
            pts.push(new THREE.Vector3(r * Math.cos(theta), 0.001, r * Math.sin(theta)));
          }
          const ringGeom = new THREE.BufferGeometry().setFromPoints(pts);
          const ringLine = new THREE.Line(ringGeom, ringMat);
          ringLine.position.set(pedestal.position.x, groundY, pedestal.position.z);
          group.add(ringLine);
        });

        // 2. Base Contact Points & Support Footprint (synchronized with analysis)
        const hullPts = analysis.hullPoints || [];

        if (hullPts.length >= 3) {
          // Footprint boundary line
          const linePoints: THREE.Vector3[] = hullPts.map((p) => new THREE.Vector3(p.x, groundY + 0.002, p.z));
          linePoints.push(linePoints[0].clone()); // close loop
          const footprintLineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
          const footprintLineMat = new THREE.LineBasicMaterial({
            color: themeColor,
            linewidth: 2,
          });
          const footprintLine = new THREE.Line(footprintLineGeom, footprintLineMat);
          group.add(footprintLine);

          // Direct 3D triangle fan for convex polygon fill on the ground (distortion-free, no Euler rotation errors)
          try {
            const centerPt = new THREE.Vector2(0, 0);
            hullPts.forEach((p) => {
              centerPt.x += p.x;
              centerPt.y += p.z;
            });
            centerPt.multiplyScalar(1 / hullPts.length);

            const fillVerts: number[] = [];
            for (let i = 0; i < hullPts.length; i++) {
              const p1 = hullPts[i];
              const p2 = hullPts[(i + 1) % hullPts.length];
              fillVerts.push(centerPt.x, groundY + 0.001, centerPt.y);
              fillVerts.push(p1.x, groundY + 0.001, p1.z);
              fillVerts.push(p2.x, groundY + 0.001, p2.z);
            }

            const fillGeom = new THREE.BufferGeometry();
            fillGeom.setAttribute('position', new THREE.Float32BufferAttribute(fillVerts, 3));
            fillGeom.computeVertexNormals();

            const fillMat = new THREE.MeshBasicMaterial({
              color: themeColor,
              transparent: true,
              opacity: 0.22,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const footprintMesh = new THREE.Mesh(fillGeom, fillMat);
            group.add(footprintMesh);
          } catch (fillErr) {
            // Safe fallback
          }
        }

        // 3. Tipping Axis Crosshair Guides (Directional limits on ground)
        if (analysis.crosshairs) {
          const { zFront, zBack, xLeft, xRight } = analysis.crosshairs;
          const isZCritical = analysis.limitingAxis === 'Z (Pitch)';
          const isXCritical = analysis.limitingAxis === 'X (Roll)';
          const tickLen = radiusEst * 0.035;

          // Z-axis tipping line (Front to Back through CM)
          const zLineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(zBack.x, groundY + 0.0025, zBack.z),
            new THREE.Vector3(zFront.x, groundY + 0.0025, zFront.z),
          ]);
          const zLineMat = new THREE.LineBasicMaterial({
            color: isZCritical ? 0xf59e0b : 0x38bdf8, // Amber if limiting tipping axis, sky blue otherwise
            linewidth: isZCritical ? 2 : 1,
          });
          const zLine = new THREE.Line(zLineGeom, zLineMat);
          group.add(zLine);

          // Front tipping limit tick
          const zFrontTickGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(zFront.x - tickLen, groundY + 0.0026, zFront.z),
            new THREE.Vector3(zFront.x + tickLen, groundY + 0.0026, zFront.z),
          ]);
          group.add(new THREE.Line(zFrontTickGeom, zLineMat));

          // Back tipping limit tick
          const zBackTickGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(zBack.x - tickLen, groundY + 0.0026, zBack.z),
            new THREE.Vector3(zBack.x + tickLen, groundY + 0.0026, zBack.z),
          ]);
          group.add(new THREE.Line(zBackTickGeom, zLineMat));

          // X-axis tipping line (Left to Right through CM)
          const xLineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(xLeft.x, groundY + 0.0025, xLeft.z),
            new THREE.Vector3(xRight.x, groundY + 0.0025, xRight.z),
          ]);
          const xLineMat = new THREE.LineBasicMaterial({
            color: isXCritical ? 0xf59e0b : 0x94a3b8,
            linewidth: isXCritical ? 2 : 1,
          });
          const xLine = new THREE.Line(xLineGeom, xLineMat);
          group.add(xLine);

          // Left & Right limit ticks
          const xLeftTickGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(xLeft.x, groundY + 0.0026, xLeft.z - tickLen),
            new THREE.Vector3(xLeft.x, groundY + 0.0026, xLeft.z + tickLen),
          ]);
          group.add(new THREE.Line(xLeftTickGeom, xLineMat));

          const xRightTickGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(xRight.x, groundY + 0.0026, xRight.z - tickLen),
            new THREE.Vector3(xRight.x, groundY + 0.0026, xRight.z + tickLen),
          ]);
          group.add(new THREE.Line(xRightTickGeom, xLineMat));
        }

        // 4. Gravity Plumb Line
        const cmPos = new THREE.Vector3(
          analysis.centerOfMass.x,
          analysis.centerOfMass.y,
          analysis.centerOfMass.z
        );
        const groundHit = new THREE.Vector3(cmPos.x, groundY, cmPos.z);
        const plumbHeight = Math.max(0.01, cmPos.y - groundY);

        const plumbGeom = new THREE.CylinderGeometry(
          Math.max(0.002, radiusEst * 0.008),
          Math.max(0.002, radiusEst * 0.008),
          plumbHeight,
          16
        );
        const plumbMat = new THREE.MeshBasicMaterial({
          color: themeColor,
          transparent: true,
          opacity: 0.85,
        });
        const plumbMesh = new THREE.Mesh(plumbGeom, plumbMat);
        plumbMesh.position.set(cmPos.x, groundY + plumbHeight * 0.5, cmPos.z);
        group.add(plumbMesh);

        // 5. Ground Contact Target Marker (Bullseye)
        const targetRadius = Math.max(0.02, radiusEst * 0.08);
        const bullseyeRing1 = new THREE.RingGeometry(targetRadius * 0.85, targetRadius, 32);
        const bullseyeRing2 = new THREE.RingGeometry(targetRadius * 0.4, targetRadius * 0.55, 32);
        const bullseyeCenter = new THREE.CircleGeometry(targetRadius * 0.2, 32);

        const bullseyeMat = new THREE.MeshBasicMaterial({
          color: themeColor,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        [bullseyeRing1, bullseyeRing2, bullseyeCenter].forEach((g) => {
          const ringMesh = new THREE.Mesh(g, bullseyeMat);
          ringMesh.rotation.x = -Math.PI * 0.5;
          ringMesh.position.copy(groundHit);
          ringMesh.position.y += 0.003;
          group.add(ringMesh);
        });

        // 6. 3D Center of Mass Marker (Sphere + 3 Orthogonal Rings)
        const cmRadius = Math.max(0.02, radiusEst * 0.045);
        const cmSphereGeom = new THREE.SphereGeometry(cmRadius, 32, 16);
        const cmSphereMat = new THREE.MeshStandardMaterial({
          color: themeColor,
          roughness: 0.2,
          metalness: 0.8,
          emissive: themeColor,
          emissiveIntensity: 0.35,
        });
        const cmSphere = new THREE.Mesh(cmSphereGeom, cmSphereMat);
        cmSphere.position.copy(cmPos);
        group.add(cmSphere);

        // Gimbal orthogonal rings
        const ringRadius = cmRadius * 1.6;
        const ringGeom = new THREE.TorusGeometry(ringRadius, cmRadius * 0.12, 16, 48);
        const ringGimbalMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

        // Ring XY
        const ring1 = new THREE.Mesh(ringGeom, ringGimbalMat);
        ring1.position.copy(cmPos);
        group.add(ring1);

        // Ring XZ
        const ring2 = new THREE.Mesh(ringGeom, ringGimbalMat);
        ring2.rotation.x = Math.PI * 0.5;
        ring2.position.copy(cmPos);
        group.add(ring2);

        // Ring YZ
        const ring3 = new THREE.Mesh(ringGeom, ringGimbalMat);
        ring3.rotation.y = Math.PI * 0.5;
        ring3.position.copy(cmPos);
        group.add(ring3);

        sceneRef.current.add(group);
        balanceGroupRef.current = group;
        requestRender();
      } catch (err) {
        console.error('Failed to update balance visuals:', err);
      }
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

          const parts = splitGeometryIntoConnectedComponents(geometry);
          if (parts.length > 1) {
            const group = new THREE.Group();
            group.name = name;
            group.userData.partName = name;
            const cleanBaseName = name.replace(/\.[^/.]+$/, '');
            parts.forEach((partGeom, i) => {
              const partMesh = new THREE.Mesh(partGeom, getLookdevMaterial(settingsRef.current.material));
              partMesh.castShadow = settingsRef.current.castShadows;
              partMesh.receiveShadow = settingsRef.current.castShadows;
              partMesh.userData.originalMaterial = partMesh.material;
              const partTitle = `${cleanBaseName} - Part ${i + 1}`;
              partMesh.userData.partName = partTitle;
              partMesh.name = partTitle;
              group.add(partMesh);
            });
            currentModelRef.current = group;
            detectExplodableParts(currentModelRef.current);
            applyMaterialAndShadows();
            sceneRef.current.add(group);
            onModelLoadedHandler(name);
            setStlSplitNotification({
              fileName: name,
              count: parts.length,
              message: `Auto-separated STL into ${parts.length} loose parts!`,
            });
          } else {
            const mesh = new THREE.Mesh(geometry, getLookdevMaterial(settingsRef.current.material));
            mesh.castShadow = settingsRef.current.castShadows;
            mesh.receiveShadow = settingsRef.current.castShadows;
            mesh.userData.originalMaterial = mesh.material;
            mesh.userData.partName = name;
            mesh.name = name;
            currentModelRef.current = mesh;
            detectExplodableParts(currentModelRef.current);
            applyMaterialAndShadows();
            sceneRef.current.add(mesh);
            onModelLoadedHandler(name);
          }
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
              mesh.userData.partName = mesh.name || name;
            }
          });
          currentModelRef.current = obj;
          detectExplodableParts(currentModelRef.current);
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
            const parts = splitGeometryIntoConnectedComponents(geometry);
            if (parts.length > 1) {
              const subGroup = new THREE.Group();
              subGroup.name = name;
              subGroup.userData.partName = name;
              const cleanBaseName = name.replace(/\.[^/.]+$/, '');
              parts.forEach((partGeom, i) => {
                const partMesh = new THREE.Mesh(partGeom, getLookdevMaterial(settingsRef.current.material));
                partMesh.userData.originalMaterial = partMesh.material;
                const partTitle = `${cleanBaseName} - Part ${i + 1}`;
                partMesh.userData.partName = partTitle;
                partMesh.name = partTitle;
                subGroup.add(partMesh);
              });
              resolve(subGroup);
            } else {
              const mesh = new THREE.Mesh(geometry, getLookdevMaterial(settingsRef.current.material));
              mesh.userData.originalMaterial = mesh.material;
              mesh.userData.partName = name;
              resolve(mesh);
            }
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
            if (obj.children && obj.children.length > 0 && obj.children.some((c) => (c as THREE.Mesh).isMesh)) {
              const children = [...obj.children];
              children.forEach((child) => {
                group.add(child);
                batchPartsRef.current.push({
                  object: child,
                  localCenter: new THREE.Vector3(),
                  basePosition: child.position.clone(),
                });
              });
            } else {
              group.add(obj);
              batchPartsRef.current.push({
                object: obj,
                localCenter: new THREE.Vector3(),
                basePosition: obj.position.clone(),
              });
            }
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

      const cleanNames =
        files.length <= 3
          ? files.map((f) => f.name.replace(/\.[^/.]+$/, '')).join(' + ')
          : `${files[0].name.replace(/\.[^/.]+$/, '')} + ${files[1].name.replace(/\.[^/.]+$/, '')} + ... (+${files.length - 2} more)`;
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
      if (selectedPartIndexRef.current !== null) {
        selectPart(selectedPartIndexRef.current);
      }
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
        if (meshNodes.length >= 1) {
          candidates = meshNodes;
        } else if (candidates.length === 1) {
          // Keep the single candidate
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

    // Updates visual outlines (outer combined Box3Helper and subtle individual part helpers)
    // and recalculates the combined bounding box in both inches and mm.
    const updateSelectionVisuals = () => {
      const validParts = selectedPartIndicesRef.current
        .map((idx) => ({ idx, part: batchPartsRef.current[idx] }))
        .filter((entry) => entry.part && entry.part.object.visible);

      if (validParts.length === 0) {
        if (selectionBoxHelperRef.current) {
          selectionBoxHelperRef.current.visible = false;
        }
        if (selectionBoxDimensionsGroupRef.current) {
          selectionBoxDimensionsGroupRef.current.visible = false;
        }
        setProjectedBoxDimensions([]);
        if (individualHelpersGroupRef.current) {
          while (individualHelpersGroupRef.current.children.length > 0) {
            individualHelpersGroupRef.current.remove(individualHelpersGroupRef.current.children[0]);
          }
        }
        setSelectedPartInfo(null);
        selectedPartInfoRef.current = null;
        onSelectedPartInfoChanged?.(null);
        requestRender();
        return;
      }

      const combinedBox = new THREE.Box3();
      const names: string[] = [];
      const indices: number[] = [];

      validParts.forEach(({ idx, part }) => {
        const partBox = new THREE.Box3().setFromObject(part.object);
        if (!partBox.isEmpty()) {
          combinedBox.union(partBox);
        }
        names.push(getPartName(part.object, idx));
        indices.push(idx);
      });

      if (combinedBox.isEmpty()) {
        if (selectionBoxHelperRef.current) selectionBoxHelperRef.current.visible = false;
        if (selectionBoxDimensionsGroupRef.current) selectionBoxDimensionsGroupRef.current.visible = false;
        setProjectedBoxDimensions([]);
        setSelectedPartInfo(null);
        selectedPartInfoRef.current = null;
        onSelectedPartInfoChanged?.(null);
        requestRender();
        return;
      }

      // Update enclosing cyan Box3Helper
      if (selectionBoxRef.current && selectionBoxHelperRef.current) {
        selectionBoxRef.current.copy(combinedBox);
        selectionBoxHelperRef.current.visible = true;
        selectionBoxHelperRef.current.updateMatrixWorld(true);
      }

      // If multiple parts selected, update subtle individual wireframe outlines
      if (individualHelpersGroupRef.current) {
        while (individualHelpersGroupRef.current.children.length > 0) {
          individualHelpersGroupRef.current.remove(individualHelpersGroupRef.current.children[0]);
        }
        if (validParts.length > 1) {
          validParts.forEach(({ part }) => {
            const pBox = new THREE.Box3().setFromObject(part.object);
            if (!pBox.isEmpty()) {
              const subHelper = new THREE.Box3Helper(pBox, 0x0284c7);
              if (subHelper.material instanceof THREE.Material) {
                subHelper.material.transparent = true;
                subHelper.material.opacity = 0.45;
                subHelper.material.depthTest = false;
              }
              individualHelpersGroupRef.current?.add(subHelper);
            }
          });
        }
      }

      // Compute bounding box dimensions (inches and mm)
      const size = new THREE.Vector3();
      combinedBox.getSize(size);
      const scaleInches = getConversionToInches();
      const wIn = size.x * scaleInches;
      const hIn = size.y * scaleInches;
      const dIn = size.z * scaleInches;
      const wMm = size.x;
      const hMm = size.y;
      const dMm = size.z;

      const count = validParts.length;
      const displayName = count === 1 ? names[0] : `${count} Meshes Selected`;

      const info: SelectedPartBounds = {
        indices,
        index: indices[indices.length - 1],
        name: displayName,
        names,
        count,
        wIn,
        hIn,
        dIn,
        wMm,
        hMm,
        dMm,
      };

      setSelectedPartInfo(info);
      selectedPartInfoRef.current = info;
      onSelectedPartInfoChanged?.(info);
      if (activeCameraRef.current && containerRef.current) {
        updateBoundingBoxDimensions(
          activeCameraRef.current,
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
      requestRender();
    };

    const setSelection = (indices: number[], notify = true) => {
      const unique = Array.from(new Set(indices)).filter(
        (i) => i >= 0 && i < batchPartsRef.current.length
      );
      selectedPartIndicesRef.current = unique;
      selectedPartIndexRef.current =
        unique.length === 1 ? unique[0] : unique.length > 0 ? unique[unique.length - 1] : null;

      if (notify) {
        if (onSelectParts) {
          onSelectParts(unique);
        } else {
          onSelectPart?.(selectedPartIndexRef.current);
        }
      }

      updateSelectionVisuals();
      refreshVolumeStats();
    };

    const togglePartInSelection = (index: number) => {
      const cur = selectedPartIndicesRef.current;
      if (cur.includes(index)) {
        setSelection(cur.filter((i) => i !== index));
      } else {
        setSelection([...cur, index]);
      }
    };

    // Click-to-select a part: draws a bounding-box outline around it and notifies parent.
    // Passing null clears selection.
    const selectPart = (index: number | null, notify = true) => {
      if (index === null) {
        setSelection([], notify);
      } else {
        setSelection([index], notify);
      }
    };

    const selectParts = (indices: number[], notify = true) => {
      setSelection(indices, notify);
    };

    const clearSelection = (notify = true) => {
      setSelection([], notify);
    };

    const selectAllVisibleParts = (notify = true) => {
      const visibleIndices = batchPartsRef.current
        .map((p, idx) => (p.object.visible ? idx : -1))
        .filter((idx) => idx !== -1);

      if (visibleIndices.length === 0) return;

      const cur = selectedPartIndicesRef.current;
      const allAlreadySelected =
        visibleIndices.length === cur.length &&
        visibleIndices.every((idx) => cur.includes(idx));

      if (allAlreadySelected) {
        setSelection([], notify);
      } else {
        setSelection(visibleIndices, notify);
      }
    };

    const togglePartVisibility = (index: number) => {
      const part = batchPartsRef.current[index];
      if (!part) return;
      part.object.visible = !part.object.visible;
      updateSelectionVisuals();
      notifyPartsChanged();
      if (activeClipPlanesRef.current.length > 0) {
        updateClippingPlanes();
      }
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
      const fallbackIdx = batchPartsRef.current.findIndex((part) => {
        let isDescendant = false;
        part.object.traverse((desc) => {
          if (desc === obj) isDescendant = true;
        });
        return isDescendant;
      });
      return fallbackIdx !== -1 ? fallbackIdx : null;
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
      if (activeClipPlanesRef.current.length > 0) {
        updateClippingPlanes();
      }
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
      if (activeClipPlanesRef.current.length > 0) {
        updateClippingPlanes();
      }
      recenterView();
    };

    // H: toggle visibility of whichever parts are currently selected (click-to-select), or failing
    // that whatever's currently hovered.
    const toggleSelectedOrHoveredVisibility = () => {
      if (selectedPartIndicesRef.current.length > 0) {
        selectedPartIndicesRef.current.forEach((idx) => {
          const part = batchPartsRef.current[idx];
          if (part) part.object.visible = !part.object.visible;
        });
        updateSelectionVisuals();
        notifyPartsChanged();
        if (activeClipPlanesRef.current.length > 0) {
          updateClippingPlanes();
        }
        requestRender();
        return;
      }
      const hitIndex = hoveredPartIndexRef.current;
      if (hitIndex === null || !batchPartsRef.current[hitIndex]) return;
      togglePartVisibility(hitIndex);
    };

    // U: unhide all hidden meshes/parts across the scene (exits isolate mode if active).
    const unhideAllParts = () => {
      if (isolatedPartIndexRef.current !== null) {
        isolatedPartIndexRef.current = null;
        preIsolateVisibilityRef.current = null;
        setIsolatedPartName(null);
        onIsolateChanged?.(null);
      }
      let anyChanged = false;
      batchPartsRef.current.forEach((part) => {
        if (!part.object.visible) {
          part.object.visible = true;
          anyChanged = true;
        }
      });
      if (currentModelRef.current) {
        currentModelRef.current.traverse((child) => {
          if (!child.visible) {
            child.visible = true;
            anyChanged = true;
          }
        });
      }
      if (anyChanged || batchPartsRef.current.length > 0) {
        updateSelectionVisuals();
        notifyPartsChanged();
        if (activeClipPlanesRef.current.length > 0) {
          updateClippingPlanes();
        }
        requestRender();
      }
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

      // Same reasoning for the click-to-select indices: clear removed part, shift down subsequent
      const updatedSelection = selectedPartIndicesRef.current
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i));
      setSelection(updatedSelection);

      collectMeshMaterials(part.object, candidateMaterials);

      part.object.parent?.remove(part.object);
      batchPartsRef.current.splice(index, 1);
      batchPartPlanesRef.current.delete(part.object);

      part.object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const clipEntry = meshClipMaterialsRef.current.get(mesh);
          if (clipEntry) {
            clipEntry.clones.forEach((c) => c.dispose());
            meshClipMaterialsRef.current.delete(mesh);
          }
        }
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

    // Splits a mesh (or the currently selected mesh / all loaded meshes) into separate parts if it contains disconnected solid shells
    const separateLooseParts = (targetIndex?: number | null): boolean => {
      if (!sceneRef.current || !currentModelRef.current) return false;

      let targetMesh: THREE.Mesh | null = null;

      if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < batchPartsRef.current.length) {
        const candidate = batchPartsRef.current[targetIndex].object;
        if ((candidate as THREE.Mesh).isMesh) targetMesh = candidate as THREE.Mesh;
      } else if (
        selectedPartIndexRef.current !== null &&
        selectedPartIndexRef.current >= 0 &&
        selectedPartIndexRef.current < batchPartsRef.current.length
      ) {
        const candidate = batchPartsRef.current[selectedPartIndexRef.current].object;
        if ((candidate as THREE.Mesh).isMesh) targetMesh = candidate as THREE.Mesh;
      } else if (batchPartsRef.current.length === 1) {
        const candidate = batchPartsRef.current[0].object;
        if ((candidate as THREE.Mesh).isMesh) targetMesh = candidate as THREE.Mesh;
      } else if ((currentModelRef.current as THREE.Mesh).isMesh) {
        targetMesh = currentModelRef.current as THREE.Mesh;
      }

      // Case 1: A specific mesh was targeted or selected
      if (targetMesh && targetMesh.geometry) {
        const components = splitGeometryIntoConnectedComponents(targetMesh.geometry);
        const baseName = targetMesh.userData.partName || targetMesh.name || 'Part';
        if (components.length <= 1) {
          setStlSplitNotification({
            fileName: baseName,
            count: 1,
            message: `"${baseName}" is already a single solid shell (no loose disconnected parts found).`,
          });
          return false;
        }

        const parent = targetMesh.parent || sceneRef.current;
        const cleanBaseName = baseName.replace(/\.[^/.]+$/, '');

        const newMeshes: THREE.Mesh[] = components.map((compGeom, i) => {
          const mat = targetMesh!.material
            ? Array.isArray(targetMesh!.material)
              ? targetMesh!.material[0]
              : targetMesh!.material
            : getLookdevMaterial(settingsRef.current.material);
          const m = new THREE.Mesh(compGeom, mat);
          m.position.copy(targetMesh!.position);
          m.rotation.copy(targetMesh!.rotation);
          m.scale.copy(targetMesh!.scale);
          m.castShadow = targetMesh!.castShadow;
          m.receiveShadow = targetMesh!.receiveShadow;
          m.userData.originalMaterial = targetMesh!.userData.originalMaterial || mat;
          const title = `${cleanBaseName} - Part ${i + 1}`;
          m.userData.partName = title;
          m.name = title;
          return m;
        });

        parent.remove(targetMesh);

        if (currentModelRef.current === targetMesh) {
          const group = new THREE.Group();
          group.name = targetMesh.name || 'Model';
          group.userData.partName = targetMesh.name || 'Model';
          newMeshes.forEach((m) => group.add(m));
          sceneRef.current.add(group);
          currentModelRef.current = group;
        } else {
          newMeshes.forEach((m) => parent.add(m));
        }

        targetMesh.geometry.dispose();

        detectExplodableParts(currentModelRef.current);
        applyMaterialAndShadows();
        computeVolumeAndWatertight(currentModelRef.current);
        notifyPartsChanged();
        refreshVolumeStats();
        selectPart(null);
        requestRender();

        setStlSplitNotification({
          fileName: baseName,
          count: components.length,
          message: `Separated "${baseName}" into ${components.length} loose parts!`,
        });

        return true;
      }

      // Case 2: No specific mesh targeted - inspect all meshes in the scene/model and separate any with loose parts
      const meshCandidates: THREE.Mesh[] = [];
      currentModelRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
          meshCandidates.push(child as THREE.Mesh);
        }
      });

      if (meshCandidates.length === 0) return false;

      let totalSeparatedNewParts = 0;
      let meshesSeparatedCount = 0;

      for (const mesh of meshCandidates) {
        const comps = splitGeometryIntoConnectedComponents(mesh.geometry);
        if (comps.length > 1) {
          meshesSeparatedCount++;
          totalSeparatedNewParts += comps.length;
          const parent = mesh.parent || sceneRef.current;
          const baseName = mesh.userData.partName || mesh.name || 'Part';
          const cleanBaseName = baseName.replace(/\.[^/.]+$/, '');

          const newMeshes: THREE.Mesh[] = comps.map((compGeom, i) => {
            const mat = mesh.material
              ? Array.isArray(mesh.material)
                ? mesh.material[0]
                : mesh.material
              : getLookdevMaterial(settingsRef.current.material);
            const m = new THREE.Mesh(compGeom, mat);
            m.position.copy(mesh.position);
            m.rotation.copy(mesh.rotation);
            m.scale.copy(mesh.scale);
            m.castShadow = mesh.castShadow;
            m.receiveShadow = mesh.receiveShadow;
            m.userData.originalMaterial = mesh.userData.originalMaterial || mat;
            const title = `${cleanBaseName} - Part ${i + 1}`;
            m.userData.partName = title;
            m.name = title;
            return m;
          });

          parent.remove(mesh);

          if (currentModelRef.current === mesh) {
            const group = new THREE.Group();
            group.name = mesh.name || 'Model';
            group.userData.partName = mesh.name || 'Model';
            newMeshes.forEach((m) => group.add(m));
            sceneRef.current.add(group);
            currentModelRef.current = group;
          } else {
            newMeshes.forEach((m) => parent.add(m));
          }

          mesh.geometry.dispose();
        }
      }

      if (meshesSeparatedCount > 0) {
        detectExplodableParts(currentModelRef.current);
        applyMaterialAndShadows();
        computeVolumeAndWatertight(currentModelRef.current);
        notifyPartsChanged();
        refreshVolumeStats();
        selectPart(null);
        requestRender();

        setStlSplitNotification({
          fileName: currentModelRef.current.name || 'Model',
          count: totalSeparatedNewParts,
          message: `Separated into ${totalSeparatedNewParts} parts across ${meshesSeparatedCount} mesh(es)!`,
        });
        return true;
      } else {
        setStlSplitNotification({
          fileName: currentModelRef.current.name || 'Model',
          count: 1,
          message: 'No loose disconnected parts found. All loaded meshes are single solid shells.',
        });
        return false;
      }
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

    // Produce a clean, safe, cross-platform base filename (no colons, slashes, or special characters,
    // and bounded length to prevent exceeding OS MAX_PATH limits when decompressing ZIPs on Windows/macOS).
    const getSanitizedBaseName = (rawName: string | null): string => {
      if (!rawName) return 'model';

      // Check if it's a batch string: "Batch (40 parts): head + torso + arm..."
      const batchMatch = rawName.match(/^Batch\s*\((\d+)\s*parts?\)/i);
      if (batchMatch) {
        const count = batchMatch[1];
        const colonIdx = rawName.indexOf(':');
        let partHint = '';
        if (colonIdx !== -1) {
          const rest = rawName.slice(colonIdx + 1).trim();
          const first = rest.split(/\s*\+\s*|\s*,\s*/)[0]?.trim();
          if (first) {
            const cleanFirst = first
              .replace(/\.[^/.]+$/, '')
              .replace(/[^\w-]/g, '_')
              .slice(0, 24)
              .replace(/_+$/, '');
            if (cleanFirst) {
              partHint = `_${cleanFirst}`;
            }
          }
        }
        return `Batch_${count}_Parts${partHint}`;
      }

      // Remove extension
      let base = rawName.replace(/\.[^/.]+$/, '');

      // Strip all forbidden characters in Windows/Linux/Mac filesystems and ZIP paths:
      // colons (:), slashes (/ \), angle brackets (< >), quotes ("), pipes (|), question marks (?), asterisks (*), and control characters
      base = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

      // Collapse multiple whitespace / underscores into single underscore
      base = base.replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '');

      // Cap at 48 characters to keep full extraction paths comfortably under 260 chars
      if (base.length > 48) {
        base = base.slice(0, 48).replace(/_+$/, '');
      }

      return base || 'model';
    };

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

    // Helper to render an orthographic export panel view.
    // Keeps background transparent while applying AO and SSR post-processing if enabled in settings.
    const renderExportPanel = (
      exportCam: THREE.Camera,
      panelSize: number,
      usePostProcessing: boolean
    ) => {
      if (!rendererRef.current || !sceneRef.current) return;

      rendererRef.current.setPixelRatio(1);
      rendererRef.current.setViewport(0, 0, panelSize, panelSize);
      rendererRef.current.setScissorTest(false);
      rendererRef.current.setClearColor(0x000000, 0);
      sceneRef.current.background = null;

      if (usePostProcessing && composerRef.current) {
        if (renderPassRef.current) {
          renderPassRef.current.camera = exportCam;
          renderPassRef.current.clear = true;
        }
        if (vignetteBgPassRef.current) {
          vignetteBgPassRef.current.enabled = false;
        }
        if (aoPassRef.current) {
          aoPassRef.current.camera = exportCam;
          const isPersp = (exportCam as any).isPerspectiveCamera === true;
          if (aoPassRef.current.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== (isPersp ? 1 : 0)) {
            aoPassRef.current.gtaoMaterial.defines.PERSPECTIVE_CAMERA = isPersp ? 1 : 0;
            aoPassRef.current.gtaoMaterial.needsUpdate = true;
          }
        }
        if (ssrPassRef.current) {
          ssrPassRef.current.camera = exportCam;
          const isPersp = (exportCam as any).isPerspectiveCamera === true;
          if (ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA !== isPersp) {
            ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA = isPersp;
            ssrPassRef.current.ssrMaterial.needsUpdate = true;
          }
          if (
            ssrPassRef.current.depthRenderMaterial &&
            ssrPassRef.current.depthRenderMaterial.defines.PERSPECTIVE_CAMERA !== (isPersp ? 1 : 0)
          ) {
            ssrPassRef.current.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = isPersp ? 1 : 0;
            ssrPassRef.current.depthRenderMaterial.needsUpdate = true;
          }
        }
        if (fxaaPassRef.current) {
          fxaaPassRef.current.enabled = false;
        }
        if (smaaPassRef.current) {
          smaaPassRef.current.enabled = false;
        }

        try {
          composerRef.current.render();
        } catch (err) {
          console.warn('Post-processing export render failed, falling back to direct render:', err);
          rendererRef.current.clear();
          rendererRef.current.render(sceneRef.current, exportCam);
        }
      } else {
        rendererRef.current.clear();
        rendererRef.current.render(sceneRef.current, exportCam);
      }
    };

    const restoreComposerAndRenderer = (
      origPixelRatio: number,
      origWidth: number,
      origHeight: number
    ) => {
      if (!rendererRef.current || !sceneRef.current || !containerRef.current) return;
      sceneRef.current.background = null;
      rendererRef.current.setPixelRatio(origPixelRatio);
      rendererRef.current.setSize(origWidth, origHeight, true);
      rendererRef.current.setViewport(0, 0, origWidth, origHeight);
      rendererRef.current.setScissorTest(false);
      if (vignetteBgPassRef.current) {
        vignetteBgPassRef.current.enabled = true;
      }
      if (renderPassRef.current && activeCameraRef.current) {
        renderPassRef.current.camera = activeCameraRef.current;
        renderPassRef.current.clear = false;
      }
      if (aoPassRef.current && activeCameraRef.current) {
        aoPassRef.current.camera = activeCameraRef.current;
        const isPersp = (activeCameraRef.current as any).isPerspectiveCamera === true;
        if (aoPassRef.current.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== (isPersp ? 1 : 0)) {
          aoPassRef.current.gtaoMaterial.defines.PERSPECTIVE_CAMERA = isPersp ? 1 : 0;
          aoPassRef.current.gtaoMaterial.needsUpdate = true;
        }
      }
      if (ssrPassRef.current && activeCameraRef.current) {
        ssrPassRef.current.camera = activeCameraRef.current;
        const isPersp = (activeCameraRef.current as any).isPerspectiveCamera === true;
        if (ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA !== isPersp) {
          ssrPassRef.current.ssrMaterial.defines.PERSPECTIVE_CAMERA = isPersp;
          ssrPassRef.current.ssrMaterial.needsUpdate = true;
        }
        if (
          ssrPassRef.current.depthRenderMaterial &&
          ssrPassRef.current.depthRenderMaterial.defines.PERSPECTIVE_CAMERA !== (isPersp ? 1 : 0)
        ) {
          ssrPassRef.current.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = isPersp ? 1 : 0;
          ssrPassRef.current.depthRenderMaterial.needsUpdate = true;
        }
      }
      if (composerRef.current) {
        composerRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        composerRef.current.setSize(origWidth, origHeight);
      }
      if (ssrPassRef.current) {
        ssrPassRef.current.setSize(origWidth, origHeight);
      }
      syncPostProcessing();
      updateGrid();
      if (activeCameraRef.current) {
        updateLights(activeCameraRef.current);
        updateDimensionVisibilityAndLabels(activeCameraRef.current);
        if (selectionBoxDimensionsGroupRef.current && containerRef.current) {
          updateBoundingBoxDimensions(
            activeCameraRef.current,
            containerRef.current.clientWidth,
            containerRef.current.clientHeight
          );
        }
      }
      isExportingRef.current = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      requestRender();
    };

    // Helper to draw dimensional text labels onto export canvases (Composite sheets & separate images)
    const drawDimensionsOnCanvas = (
      targetCtx: CanvasRenderingContext2D,
      cam: THREE.Camera,
      offsetX: number,
      offsetY: number,
      size: number
    ) => {
      if (!dimensionsActiveRef.current || dimensionItemsRef.current.length === 0) return;
      const camDir = cam.getWorldDirection(new THREE.Vector3());
      const layoutScale = size / 1000;

      dimensionItemsRef.current.forEach((dim) => {
        const p1 = new THREE.Vector3(dim.p1.x, dim.p1.y, dim.p1.z);
        const p2 = new THREE.Vector3(dim.p2.x, dim.p2.y, dim.p2.z);
        const diff = p2.clone().sub(p1);
        const dir = diff.clone().normalize();
        const dot = Math.abs(dir.dot(camDir));
        if (dot >= 0.94) return; // Skip if line is parallel to view direction

        // Apply dragged offset so dimension text follows dragged dimension line and extension lines
        const offsetVec = dim.offset
          ? new THREE.Vector3(dim.offset.x, dim.offset.y, dim.offset.z)
          : new THREE.Vector3(0, 0, 0);
        const p1_off = p1.clone().add(offsetVec);
        const p2_off = p2.clone().add(offsetVec);

        // Project the midpoint of the displaced dimension line
        const mid = p1_off.clone().add(p2_off).multiplyScalar(0.5);
        const ndcMid = mid.clone().project(cam);
        if (ndcMid.z > 1.0) return; // Behind camera

        const midX = offsetX + (ndcMid.x * 0.5 + 0.5) * size;
        const midY = offsetY + (-ndcMid.y * 0.5 + 0.5) * size;

        const distStr =
          dimensionUnitRef.current === 'mm'
            ? `${(dim.distanceInches * 25.4).toFixed(2)} mm`
            : `${dim.distanceInches.toFixed(3)}"`;

        let fullLabel = distStr;
        if (showDimensionDeltasRef.current) {
          const dX =
            dimensionUnitRef.current === 'mm'
              ? `${(dim.deltaXInches * 25.4).toFixed(2)}`
              : `${dim.deltaXInches.toFixed(3)}"`;
          const dY =
            dimensionUnitRef.current === 'mm'
              ? `${(dim.deltaYInches * 25.4).toFixed(2)}`
              : `${dim.deltaYInches.toFixed(3)}"`;
          const dZ =
            dimensionUnitRef.current === 'mm'
              ? `${(dim.deltaZInches * 25.4).toFixed(2)}`
              : `${dim.deltaZInches.toFixed(3)}"`;
          fullLabel = `${distStr} (ΔX:${dX} ΔY:${dY} ΔZ:${dZ})`;
        }

        const fontSize = Math.max(Math.round(20 * layoutScale), 12);
        targetCtx.save();
        targetCtx.font = `bold ${fontSize}px "SF Mono", Monaco, Menlo, Consolas, monospace`;
        const textMetrics = targetCtx.measureText(fullLabel);
        const padX = Math.round(10 * layoutScale);
        const padY = Math.round(6 * layoutScale);
        const badgeW = textMetrics.width + padX * 2;
        const badgeH = fontSize + padY * 2;
        const minEdge = Math.round(6 * layoutScale);
        const badgeX = Math.max(offsetX + minEdge, Math.min(offsetX + size - badgeW - minEdge, midX - badgeW / 2));
        const badgeY = Math.max(offsetY + minEdge, Math.min(offsetY + size - badgeH - minEdge, midY - badgeH / 2));

        targetCtx.beginPath();
        if (typeof targetCtx.roundRect === 'function') {
          targetCtx.roundRect(badgeX, badgeY, badgeW, badgeH, Math.max(4, 6 * layoutScale));
        } else {
          targetCtx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        targetCtx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        targetCtx.fill();
        targetCtx.lineWidth = Math.max(2 * layoutScale, 1.5);
        targetCtx.strokeStyle = '#38bdf8';
        targetCtx.stroke();

        targetCtx.fillStyle = '#38bdf8';
        targetCtx.textAlign = 'center';
        targetCtx.textBaseline = 'middle';
        targetCtx.fillText(fullLabel, badgeX + badgeW / 2, badgeY + badgeH / 2);
        targetCtx.restore();
      });
    };

    // Helper to draw selected mesh bounding box overlay badge onto export canvases
    const drawSelectedPartBoundingBoxOnCanvas = (
      targetCtx: CanvasRenderingContext2D,
      cam: THREE.Camera,
      offsetX: number,
      offsetY: number,
      size: number
    ) => {
      const pInfo = selectedPartInfoRef.current;
      if (!pInfo) return;

      const layoutScale = size / 1000;
      const fontSize = Math.max(Math.round(18 * layoutScale), 11);

      targetCtx.save();
      const isMulti = pInfo.count > 1;
      const titleText = isMulti ? `Selected (${pInfo.count} Meshes)` : `Selected Mesh: ${pInfo.name}`;
      const dimText = `${isMulti ? 'Combined Box' : 'Bounding Box'}: X ${pInfo.wIn.toFixed(3)}" × Y ${pInfo.hIn.toFixed(3)}" × Z ${pInfo.dIn.toFixed(3)}" (${pInfo.wMm.toFixed(1)} × ${pInfo.hMm.toFixed(1)} × ${pInfo.dMm.toFixed(1)} mm)`;

      targetCtx.font = `bold ${fontSize}px system-ui, sans-serif`;
      const m1 = targetCtx.measureText(titleText);
      targetCtx.font = `600 ${Math.round(fontSize * 0.85)}px "SF Mono", Monaco, Menlo, Consolas, monospace`;
      const m2 = targetCtx.measureText(dimText);

      const boxW = Math.max(m1.width, m2.width) + Math.round(24 * layoutScale);
      const boxH = Math.round(58 * layoutScale);
      const boxX = offsetX + Math.round(18 * layoutScale);
      const boxY = offsetY + Math.round(18 * layoutScale);

      targetCtx.beginPath();
      if (typeof targetCtx.roundRect === 'function') {
        targetCtx.roundRect(boxX, boxY, boxW, boxH, Math.max(4, 6 * layoutScale));
      } else {
        targetCtx.rect(boxX, boxY, boxW, boxH);
      }
      targetCtx.fillStyle = 'rgba(15, 23, 42, 0.90)';
      targetCtx.fill();
      targetCtx.lineWidth = Math.max(2 * layoutScale, 1.5);
      targetCtx.strokeStyle = '#38bdf8';
      targetCtx.stroke();

      targetCtx.fillStyle = '#38bdf8';
      targetCtx.font = `bold ${fontSize}px system-ui, sans-serif`;
      targetCtx.textAlign = 'left';
      targetCtx.textBaseline = 'top';
      targetCtx.fillText(titleText, boxX + Math.round(12 * layoutScale), boxY + Math.round(8 * layoutScale));

      targetCtx.fillStyle = '#e2e8f0';
      targetCtx.font = `600 ${Math.round(fontSize * 0.85)}px "SF Mono", Monaco, Menlo, Consolas, monospace`;
      targetCtx.fillText(dimText, boxX + Math.round(12 * layoutScale), boxY + Math.round(31 * layoutScale));
      targetCtx.restore();
    };

    interface ExportViewItem {
      name?: string;
      displayName?: string;
      pos: THREE.Vector3;
      up?: THREE.Vector3;
    }

    interface ExportFramingResult {
      halfFrustum: number;
      dist: number;
      viewCenters: THREE.Vector3[];
    }

    // Calculates unified framing across all views in an export set.
    // Preserves identical zoom/scale across every view while recentering each view
    // so oblong models, vertex dimensions, and selected part bounding boxes are never cropped.
    const computeExportViewsFraming = (
      views: ExportViewItem[],
      panelSize: number
    ): ExportFramingResult => {
      const defaultDist = (modelRadiusRef.current || 1) * 3.0;
      const baseHf = (modelRadiusRef.current || 1) * 1.05;
      const cModel = modelCenterRef.current.clone();

      if (!currentModelRef.current) {
        return {
          halfFrustum: baseHf,
          dist: defaultDist,
          viewCenters: views.map(() => cModel.clone()),
        };
      }

      const isolatedIndex = isolatedPartIndexRef.current;
      const isolatedObject =
        isolatedIndex !== null ? batchPartsRef.current[isolatedIndex]?.object : null;
      const modelBox = new THREE.Box3().setFromObject(isolatedObject || currentModelRef.current);
      if (modelBox.isEmpty()) {
        return {
          halfFrustum: baseHf,
          dist: defaultDist,
          viewCenters: views.map(() => cModel.clone()),
        };
      }

      const modelCorners: THREE.Vector3[] = [];
      for (let ix = 0; ix <= 1; ix++) {
        for (let iy = 0; iy <= 1; iy++) {
          for (let iz = 0; iz <= 1; iz++) {
            modelCorners.push(
              new THREE.Vector3(
                ix ? modelBox.max.x : modelBox.min.x,
                iy ? modelBox.max.y : modelBox.min.y,
                iz ? modelBox.max.z : modelBox.min.z
              )
            );
          }
        }
      }

      const scaleInches = getConversionToInches();
      const EXT_1_8 = 0.125 / scaleInches;
      const layoutScale = panelSize / 1000;

      const viewResults = views.map((v) => {
        const camPos = v.pos.clone().normalize().multiplyScalar(defaultDist);
        const camDir = camPos.clone().negate().normalize();
        let camUp = new THREE.Vector3(0, 1, 0);
        if (v.up) {
          camUp.copy(v.up);
        } else if (v.name === 'TOP VIEW' || v.displayName === 'Top View') {
          camUp.set(0, 0, -1);
        } else if (v.name === 'BOTTOM VIEW' || v.displayName === 'Bottom View') {
          camUp.set(0, 0, 1);
        }
        camUp.normalize();
        const camRight = new THREE.Vector3().crossVectors(camDir, camUp).normalize();
        camUp.crossVectors(camRight, camDir).normalize();

        const viewPoints: THREE.Vector3[] = [...modelCorners];

        // 1. If part bounding box is selected, include bounding box extension lines and tags
        if (selectedPartInfoRef.current && selectionBoxRef.current && !selectionBoxRef.current.isEmpty()) {
          const sBox = selectionBoxRef.current;
          const sMin = sBox.min;
          const sMax = sBox.max;
          for (let ix = 0; ix <= 1; ix++) {
            for (let iy = 0; iy <= 1; iy++) {
              for (let iz = 0; iz <= 1; iz++) {
                viewPoints.push(
                  new THREE.Vector3(
                    ix ? sMax.x : sMin.x,
                    iy ? sMax.y : sMin.y,
                    iz ? sMax.z : sMin.z
                  )
                );
              }
            }
          }

          const absX = Math.abs(camDir.x);
          const absY = Math.abs(camDir.y);
          const absZ = Math.abs(camDir.z);
          const COS_6_DEG = 0.9945218953682733;

          if (absZ >= COS_6_DEG || absX >= COS_6_DEG || absY >= COS_6_DEG) {
            let hAxis: 'x' | 'y' | 'z' = 'x';
            let vAxis: 'x' | 'y' | 'z' = 'y';

            if (absZ >= COS_6_DEG) {
              hAxis = 'x';
              vAxis = 'y';
            } else if (absX >= COS_6_DEG) {
              hAxis = 'z';
              vAxis = 'y';
            } else if (absY >= COS_6_DEG) {
              hAxis = 'x';
              vAxis = 'z';
            }

            const estUnitsPerPixel = (2 * baseHf) / Math.max(panelSize, 1);
            const bboxTagHalfW = 48 * estUnitsPerPixel;
            const bboxTagHalfH = 16 * estUnitsPerPixel;
            const hOffset = EXT_1_8 + bboxTagHalfH;
            const vOffset = EXT_1_8 + bboxTagHalfW;

            const otherAxis = (['x', 'y', 'z'] as const).find((a) => a !== hAxis && a !== vAxis)!;

            // Horizontal dimension (bottom)
            const hMid = new THREE.Vector3();
            hMid[hAxis] = (sMin[hAxis] + sMax[hAxis]) / 2;
            hMid[vAxis] = sMin[vAxis];
            hMid[otherAxis] = (sMin[otherAxis] + sMax[otherAxis]) / 2;

            const hTagCenter = hMid.clone().add(camUp.clone().negate().multiplyScalar(hOffset));
            viewPoints.push(
              hTagCenter.clone().add(camRight.clone().multiplyScalar(bboxTagHalfW)),
              hTagCenter.clone().add(camRight.clone().multiplyScalar(-bboxTagHalfW)),
              hTagCenter.clone().add(camUp.clone().multiplyScalar(bboxTagHalfH)),
              hTagCenter.clone().add(camUp.clone().multiplyScalar(-bboxTagHalfH))
            );

            // Vertical dimension (right)
            const vMid = new THREE.Vector3();
            vMid[hAxis] = sMax[hAxis];
            vMid[vAxis] = (sMin[vAxis] + sMax[vAxis]) / 2;
            vMid[otherAxis] = (sMin[otherAxis] + sMax[otherAxis]) / 2;

            const vTagCenter = vMid.clone().add(camRight.clone().multiplyScalar(vOffset));
            viewPoints.push(
              vTagCenter.clone().add(camRight.clone().multiplyScalar(bboxTagHalfW)),
              vTagCenter.clone().add(camRight.clone().multiplyScalar(-bboxTagHalfW)),
              vTagCenter.clone().add(camUp.clone().multiplyScalar(bboxTagHalfH)),
              vTagCenter.clone().add(camUp.clone().multiplyScalar(-bboxTagHalfH))
            );
          }
        }

        // 2. If vertex dimensions are active, include all dimension segments, extension lines, and tags
        if (dimensionsActiveRef.current && dimensionItemsRef.current.length > 0) {
          const estUnitsPerPixel = (2 * baseHf) / Math.max(panelSize, 1);
          const badgeHalfW = Math.max(65 * layoutScale, 50) * estUnitsPerPixel;
          const badgeHalfH = Math.max(20 * layoutScale, 15) * estUnitsPerPixel;

          dimensionItemsRef.current.forEach((dim) => {
            const p1 = new THREE.Vector3(dim.p1.x, dim.p1.y, dim.p1.z);
            const p2 = new THREE.Vector3(dim.p2.x, dim.p2.y, dim.p2.z);
            const offsetVec = dim.offset
              ? new THREE.Vector3(dim.offset.x, dim.offset.y, dim.offset.z)
              : new THREE.Vector3(0, 0, 0);

            const p1_off = p1.clone().add(offsetVec);
            const p2_off = p2.clone().add(offsetVec);
            const mid = p1_off.clone().add(p2_off).multiplyScalar(0.5);

            viewPoints.push(p1, p2, p1_off, p2_off);
            viewPoints.push(
              mid.clone().add(camRight.clone().multiplyScalar(badgeHalfW)),
              mid.clone().add(camRight.clone().multiplyScalar(-badgeHalfW)),
              mid.clone().add(camUp.clone().multiplyScalar(badgeHalfH)),
              mid.clone().add(camUp.clone().multiplyScalar(-badgeHalfH))
            );
          });
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        viewPoints.forEach((pt) => {
          const rel = pt.clone().sub(cModel);
          const x = rel.dot(camRight);
          const y = rel.dot(camUp);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        });

        const center2dX = (minX + maxX) / 2;
        const center2dY = (minY + maxY) / 2;
        const halfSpanX = (maxX - minX) / 2;
        const halfSpanY = (maxY - minY) / 2;

        const viewCenter = cModel
          .clone()
          .add(camRight.clone().multiplyScalar(center2dX))
          .add(camUp.clone().multiplyScalar(center2dY));

        const SAFE_RATIO = 0.85;
        const reqHalfFrustum = Math.max(halfSpanX, halfSpanY) / SAFE_RATIO;

        return {
          viewCenter,
          reqHalfFrustum,
        };
      });

      const globalHalfFrustum = Math.max(
        baseHf,
        ...viewResults.map((r) => r.reqHalfFrustum)
      );

      const dist = Math.max(defaultDist, globalHalfFrustum * 3.0);

      return {
        halfFrustum: globalHalfFrustum,
        dist,
        viewCenters: viewResults.map((r) => r.viewCenter),
      };
    };

    // Generic Non-blocking chunked Orthographic Composite Sheet Exporter
    const renderOrthographicCompositeSheet = (
      sheetTitle: string,
      fileSuffix: string,
      views: { name: string; pos: THREE.Vector3; up?: THREE.Vector3 }[],
      cols: number,
      rows: number,
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

      // Store current display pixel ratio to restore on exit
      const origPixelRatio = rendererRef.current.getPixelRatio();
      const origWidth = containerRef.current.clientWidth;
      const origHeight = containerRef.current.clientHeight;
      // Offscreen rendering to fixed pixel buffer requires pixelRatio = 1 so WebGL viewport
      // exactly matches panel dimensions and is never clamped or offset by high-DPI scaling
      rendererRef.current.setPixelRatio(1);

      const gl = rendererRef.current.getContext();
      const maxViewportDims = gl ? gl.getParameter(gl.MAX_VIEWPORT_DIMS) : null;
      const maxHardwareDim = Math.min(
        maxViewportDims?.[0] || 16384,
        maxViewportDims?.[1] || 16384,
        gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 16384 : 16384,
        gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) || 16384 : 16384
      );

      // Total canvas max dimension across modern browsers is safely bounded to 16,384px to prevent memory allocation crash/freeze
      const MAX_TOTAL_CANVAS_DIM = 16384;
      const MAX_TOTAL_CANVAS_AREA = 16384 * 16384; // 268,435,456 px max standard canvas area

      // Literal 1,000px increments per multiplier:
      // 1k: 1,000 × 1,000 px per panel → 4,100 × 2,360 px sheet (Turnaround)
      // 2k: 2,000 × 2,000 px per panel → 8,200 × 4,720 px sheet
      // 3k: 3,000 × 3,000 px per panel → 12,300 × 7,080 px sheet
      // 4k: 4,000 × 4,000 px per panel → 16,400 × 9,440 px sheet
      // 5k: 5,000 × 5,000 px per panel → 20,500 × 11,800 px sheet
      const resolutionPanelMap: Record<ResolutionOption, number> = {
        1: 1000,
        2: 2000,
        3: 3000,
        4: 4000,
        5: 5000,
      };
      const requestedPanel = resolutionPanelMap[resMult] || (1000 * resMult);

      // Ensure composite sheet dimensions never exceed browser canvas boundaries
      const maxPanelForWidth = Math.floor((MAX_TOTAL_CANVAS_DIM - 200) / cols);
      const maxPanelForHeight = Math.floor((MAX_TOTAL_CANVAS_DIM - 400) / rows);
      const maxPanelForArea = Math.floor(Math.sqrt(MAX_TOTAL_CANVAS_AREA / (cols * rows)));

      const panelSize = Math.min(
        requestedPanel,
        maxHardwareDim,
        maxPanelForWidth,
        maxPanelForHeight,
        maxPanelForArea
      );

      // Layout scale proportional to actual panel size relative to base 1000px
      const layoutScale = panelSize / 1000;
      const margin = Math.round(20 * layoutScale);
      const gap = Math.round(20 * layoutScale);
      const hasSelection = !!selectedPartInfoRef.current;
      const headerHeight = Math.round((hasSelection ? 215 : 175) * layoutScale);
      const labelHeight = Math.round(60 * layoutScale);

      const totalWidth = margin * 2 + cols * panelSize + (cols - 1) * gap;
      const totalHeight =
        margin + headerHeight + rows * (panelSize + labelHeight) + (rows - 1) * gap + margin;

      const compCanvas = document.createElement('canvas');
      compCanvas.width = totalWidth;
      compCanvas.height = totalHeight;
      const ctx = compCanvas.getContext('2d');
      if (!ctx) {
        console.error('Failed to create 2D canvas context for composite sheet export.');
        restoreComposerAndRenderer(origPixelRatio, origWidth, origHeight);
        return;
      }

      ctx.clearRect(0, 0, totalWidth, totalHeight);

      ctx.fillStyle = '#38bdf8';
      ctx.font = `bold ${Math.round(48 * layoutScale)}px system-ui, sans-serif`;
      ctx.fillText(
        sheetTitle,
        margin + Math.round(20 * layoutScale),
        margin + Math.round(58 * layoutScale)
      );

      ctx.fillStyle = '#94a3b8';
      ctx.font = `${Math.round(28 * layoutScale)}px system-ui, sans-serif`;
      const scaleInches = getConversionToInches();
      const curScale = dimensionsRef.current.scaleFactor;
      const inX = (unscaledModelSizeRef.current.x * scaleInches * curScale).toFixed(3);
      const inY = (unscaledModelSizeRef.current.y * scaleInches * curScale).toFixed(3);
      const inZ = (unscaledModelSizeRef.current.z * scaleInches * curScale).toFixed(3);
      const displayFileName =
        loadedFileName && loadedFileName.length > 50
          ? loadedFileName.startsWith('Batch')
            ? loadedFileName.split(':')[0]
            : loadedFileName.slice(0, 47) + '...'
          : loadedFileName || 'model';
      const dimStr = `File: ${displayFileName}  |  Overall Size: X ${inX}" × Y ${inY}" × Z ${inZ}"`;
      ctx.fillText(dimStr, margin + Math.round(20 * layoutScale), margin + Math.round(112 * layoutScale));

      if (hasSelection && selectedPartInfoRef.current) {
        const pInfo = selectedPartInfoRef.current;
        ctx.fillStyle = '#38bdf8';
        ctx.font = `bold ${Math.round(26 * layoutScale)}px system-ui, sans-serif`;
        const isMulti = pInfo.count > 1;
        const selTitle = isMulti ? `Selected (${pInfo.count} Meshes)` : `Selected Mesh: "${pInfo.name}"`;
        const selBoxTitle = isMulti ? 'Combined Bounding Box' : 'Mesh Bounding Box';
        const selStr = `${selTitle}  |  ${selBoxTitle}: X ${pInfo.wIn.toFixed(3)}" × Y ${pInfo.hIn.toFixed(3)}" × Z ${pInfo.dIn.toFixed(3)}"  (${pInfo.wMm.toFixed(1)} × ${pInfo.hMm.toFixed(1)} × ${pInfo.dMm.toFixed(1)} mm)`;
        ctx.fillText(selStr, margin + Math.round(20 * layoutScale), margin + Math.round(162 * layoutScale));
      }

      const framing = computeExportViewsFraming(views, panelSize);
      const halfFrustum = framing.halfFrustum;
      const dist = framing.dist;
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
      // Strictly maintain pixelRatio = 1 and set viewport to exact buffer dimensions
      rendererRef.current.setPixelRatio(1);
      rendererRef.current.setSize(panelSize, panelSize, true);
      rendererRef.current.setViewport(0, 0, panelSize, panelSize);
      rendererRef.current.setScissorTest(false);

      const isAoOn = !!settingsRef.current.ssaoEnabled;
      const isSsrOn = !!(settingsRef.current.ssrQuality && settingsRef.current.ssrQuality !== 'off');
      const usePostProcessing = isAoOn || isSsrOn;

      if (usePostProcessing && composerRef.current) {
        composerRef.current.setPixelRatio(1);
        composerRef.current.setSize(panelSize, panelSize);
        if (ssrPassRef.current) {
          ssrPassRef.current.setSize(panelSize, panelSize);
        }
      }

      let currentViewIdx = 0;

      const renderNextChunk = () => {
        if (!sceneRef.current || !rendererRef.current || !activeCameraRef.current) return;

        if (currentViewIdx >= views.length) {
          restoreComposerAndRenderer(origPixelRatio, origWidth, origHeight);

          // Watermark (best-effort — export still completes if the logo fails to load)
          getJazwaresLogoImage().then((logoImg) => {
            if (logoImg) {
              try {
                const logoW = Math.round(130 * layoutScale);
                const logoH = (logoImg.height / logoImg.width) * logoW;
                ctx.globalAlpha = 0.85;
                ctx.drawImage(
                  logoImg,
                  totalWidth - logoW - margin,
                  margin + Math.round(10 * layoutScale),
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
                const cleanName = getSanitizedBaseName(loadedFileName);
                const outName = `${cleanName}_${fileSuffix}_${resMult}k.png`;
                onComplete(finalBlob, outName);
              }
            }, 'image/png');
          });
          return;
        }

        onProgress(`Rendering (${currentViewIdx + 1}/${views.length})...`);

        const v = views[currentViewIdx];
        const viewCenter = framing.viewCenters[currentViewIdx];
        const viewPos = v.pos.clone().normalize().multiplyScalar(dist);
        if (v.up) {
          exportCam.up.copy(v.up);
        } else if (v.name === 'TOP VIEW') {
          exportCam.up.set(0, 0, -1);
        } else if (v.name === 'BOTTOM VIEW') {
          exportCam.up.set(0, 0, 1);
        } else {
          exportCam.up.set(0, 1, 0);
        }
        exportCam.left = -halfFrustum;
        exportCam.right = halfFrustum;
        exportCam.top = halfFrustum;
        exportCam.bottom = -halfFrustum;
        exportCam.near = 0.01;
        exportCam.far = dist * 10;
        exportCam.position.copy(viewCenter).add(viewPos);
        exportCam.lookAt(viewCenter);
        exportCam.updateProjectionMatrix();

        updateLights(exportCam);

        if (includeGrid) {
          if (!gridHelperRef.current) updateGrid();
          if (gridHelperRef.current) gridHelperRef.current.visible = true;
          updateGridOrientation(exportCam, viewCenter);
        } else if (gridHelperRef.current) {
          gridHelperRef.current.visible = false;
        }

        if (dimensionsGroupRef.current) {
          dimensionsGroupRef.current.visible = dimensionsActiveRef.current;
          if (dimensionsActiveRef.current) {
            const exportCamDir = exportCam.getWorldDirection(new THREE.Vector3());
            dimensionsGroupRef.current.children.forEach((child: any) => {
              if (child.userData?.dir) {
                const dot = Math.abs(child.userData.dir.dot(exportCamDir));
                child.visible = dot < 0.94;
              }
            });
          }
        }

        // Hide live 3D bounding box dimension lines during export panel rendering
        // (export canvases draw crisp 2D dimensions on top via drawBoundingBoxDimensionsOnCanvas)
        if (selectionBoxDimensionsGroupRef.current) {
          selectionBoxDimensionsGroupRef.current.visible = false;
        }

        rendererRef.current.clear(true, true, true);
        renderExportPanel(exportCam, panelSize, usePostProcessing);

        const col = currentViewIdx % cols;
        const row = Math.floor(currentViewIdx / cols);

        const dx = margin + col * (panelSize + gap);
        const dy = margin + headerHeight + row * (panelSize + labelHeight + gap);

        ctx.drawImage(rendererRef.current.domElement, dx, dy, panelSize, panelSize);

        drawDimensionsOnCanvas(ctx, exportCam, dx, dy, panelSize);
        if (selectedPartInfoRef.current) {
          drawBoundingBoxDimensionsOnCanvas(ctx, exportCam, dx, dy, panelSize);
          drawSelectedPartBoundingBoxOnCanvas(ctx, exportCam, dx, dy, panelSize);
        }

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = Math.max(1, Math.round(3 * layoutScale));
        ctx.strokeRect(dx, dy, panelSize, panelSize);

        ctx.fillStyle = '#f8fafc';
        ctx.font = `bold ${Math.round(38 * layoutScale)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(v.name, dx + panelSize / 2, dy + panelSize + Math.round(45 * layoutScale));

        currentViewIdx++;
        requestAnimationFrame(renderNextChunk);
      };

      requestAnimationFrame(renderNextChunk);
    };

    // Non-blocking chunked Turnaround Sheet Image Exporter (8 Orthographic Views)
    const exportTurnaroundImage = (
      resMultiplier: ResolutionOption,
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (!currentModelRef.current) return;
      recalculateBounds();
      const dist = modelRadiusRef.current * 3.0;
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
      renderOrthographicCompositeSheet(
        '3D MODEL ORTHOGRAPHIC TURNAROUND SHEET',
        'Turnaround',
        views,
        4,
        2,
        resMultiplier,
        onComplete,
        onProgress
      );
    };

    // Non-blocking chunked 3/4 Views Exporter (4 Cardinal 3/4 Views rotated 45 deg on Y axis, not elevated)
    const exportThreeQuarterViewsImage = (
      resMultiplier: ResolutionOption,
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (!currentModelRef.current) return;
      recalculateBounds();
      const dist = modelRadiusRef.current * 3.0;
      const views = [
        { name: 'FRONT RIGHT', pos: new THREE.Vector3(-dist * Math.SQRT1_2, 0, dist * Math.SQRT1_2) },
        { name: 'REAR RIGHT', pos: new THREE.Vector3(-dist * Math.SQRT1_2, 0, -dist * Math.SQRT1_2) },
        { name: 'FRONT LEFT', pos: new THREE.Vector3(dist * Math.SQRT1_2, 0, dist * Math.SQRT1_2) },
        { name: 'REAR LEFT', pos: new THREE.Vector3(dist * Math.SQRT1_2, 0, -dist * Math.SQRT1_2) },
      ];
      renderOrthographicCompositeSheet(
        '3D MODEL 3/4 ORTHOGRAPHIC VIEWS',
        '3-4_Views',
        views,
        4,
        1,
        resMultiplier,
        onComplete,
        onProgress
      );
    };

    // Non-blocking chunked Separate Images Exporter (Turnaround + 3/4 Views zipped into a single file)
    const exportAllSeparateImages = async (
      resMultiplier: ResolutionOption,
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (
        !currentModelRef.current ||
        !sceneRef.current ||
        !rendererRef.current ||
        !containerRef.current ||
        !activeCameraRef.current
      ) {
        return;
      }

      recalculateBounds();

      isExportingRef.current = true;
      if (controlsRef.current) controlsRef.current.enabled = false;

      const includeGrid = settingsRef.current.showGrid;
      const origPixelRatio = rendererRef.current.getPixelRatio();
      const origWidth = containerRef.current.clientWidth;
      const origHeight = containerRef.current.clientHeight;

      rendererRef.current.setPixelRatio(1);

      const gl = rendererRef.current.getContext();
      const maxViewportDims = gl ? gl.getParameter(gl.MAX_VIEWPORT_DIMS) : null;
      const maxHardwareDim = Math.min(
        maxViewportDims?.[0] || 16384,
        maxViewportDims?.[1] || 16384,
        gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 16384 : 16384,
        gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) || 16384 : 16384
      );

      const resolutionPanelMap: Record<ResolutionOption, number> = {
        1: 1000,
        2: 2000,
        3: 3000,
        4: 4000,
        5: 5000,
      };
      const requestedPanel = resolutionPanelMap[resMultiplier] || (1000 * resMultiplier);
      const panelSize = Math.min(requestedPanel, maxHardwareDim);

      interface SeparateViewEntry {
        folder: string;
        filename: string;
        displayName: string;
        pos: THREE.Vector3;
        up?: THREE.Vector3;
      }

      const cleanName = getSanitizedBaseName(loadedFileName);

      const viewList: SeparateViewEntry[] = [
        // 8 Turnaround Views
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_01_Front.png`,
          displayName: 'Front View',
          pos: new THREE.Vector3(0, 0, 1),
        },
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_02_Back.png`,
          displayName: 'Back View',
          pos: new THREE.Vector3(0, 0, -1),
        },
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_03_Top.png`,
          displayName: 'Top View',
          pos: new THREE.Vector3(0, 1, 0.0001),
          up: new THREE.Vector3(0, 0, -1),
        },
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_04_Bottom.png`,
          displayName: 'Bottom View',
          pos: new THREE.Vector3(0, -1, 0.0001),
          up: new THREE.Vector3(0, 0, 1),
        },
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_05_Left.png`,
          displayName: 'Left View',
          pos: new THREE.Vector3(1, 0, 0),
        },
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_06_Right.png`,
          displayName: 'Right View',
          pos: new THREE.Vector3(-1, 0, 0),
        },
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_07_3-4_Front_Left.png`,
          displayName: '3/4 Front-Left',
          pos: new THREE.Vector3(0.707, 0.5, 0.707),
        },
        {
          folder: 'Turnaround',
          filename: `${cleanName}_Turn_08_3-4_Front_Right.png`,
          displayName: '3/4 Front-Right',
          pos: new THREE.Vector3(-0.707, 0.5, 0.707),
        },

        // 4 3/4 Views (Eye-level / 45° Y rotation)
        {
          folder: '3-4_Views',
          filename: `${cleanName}_3-4_01_Front_Right.png`,
          displayName: '3/4 Front Right',
          pos: new THREE.Vector3(-Math.SQRT1_2, 0, Math.SQRT1_2),
        },
        {
          folder: '3-4_Views',
          filename: `${cleanName}_3-4_02_Rear_Right.png`,
          displayName: '3/4 Rear Right',
          pos: new THREE.Vector3(-Math.SQRT1_2, 0, -Math.SQRT1_2),
        },
        {
          folder: '3-4_Views',
          filename: `${cleanName}_3-4_03_Front_Left.png`,
          displayName: '3/4 Front Left',
          pos: new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
        },
        {
          folder: '3-4_Views',
          filename: `${cleanName}_3-4_04_Rear_Left.png`,
          displayName: '3/4 Rear Left',
          pos: new THREE.Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2),
        },
      ];

      const framing = computeExportViewsFraming(viewList, panelSize);
      const halfFrustum = framing.halfFrustum;
      const dist = framing.dist;
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
      rendererRef.current.setViewport(0, 0, panelSize, panelSize);
      rendererRef.current.setScissorTest(false);

      const isAoOn = !!settingsRef.current.ssaoEnabled;
      const isSsrOn = !!(settingsRef.current.ssrQuality && settingsRef.current.ssrQuality !== 'off');
      const usePostProcessing = isAoOn || isSsrOn;

      if (usePostProcessing && composerRef.current) {
        composerRef.current.setPixelRatio(1);
        composerRef.current.setSize(panelSize, panelSize);
        if (ssrPassRef.current) {
          ssrPassRef.current.setSize(panelSize, panelSize);
        }
      }

      const zip = new JSZip();
      let currentIdx = 0;

      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = panelSize;
      captureCanvas.height = panelSize;
      const captureCtx = captureCanvas.getContext('2d');

      const cleanupAndRestore = () => {
        restoreComposerAndRenderer(origPixelRatio, origWidth, origHeight);
      };

      const renderNextView = async () => {
        if (!sceneRef.current || !rendererRef.current || !containerRef.current) {
          cleanupAndRestore();
          return;
        }

        if (currentIdx >= viewList.length) {
          cleanupAndRestore();
          onProgress('Compressing ZIP...');
          try {
            const zipBlob = await zip.generateAsync(
              {
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
                platform: 'DOS',
              },
              (metadata) => {
                onProgress(`Compressing (${Math.round(metadata.percent)}%)...`);
              }
            );
            const outZipName = `${cleanName}_Separate_Views_${resMultiplier}k.zip`;
            onComplete(zipBlob, outZipName);
          } catch (err) {
            console.error('Failed to create ZIP archive:', err);
            onProgress('ZIP creation failed');
          }
          return;
        }

        const view = viewList[currentIdx];
        const viewCenter = framing.viewCenters[currentIdx];
        const viewPos = view.pos.clone().normalize().multiplyScalar(dist);
        onProgress(`Rendering (${currentIdx + 1}/${viewList.length}): ${view.displayName}...`);

        if (view.up) {
          exportCam.up.copy(view.up);
        } else {
          exportCam.up.set(0, 1, 0);
        }

        exportCam.left = -halfFrustum;
        exportCam.right = halfFrustum;
        exportCam.top = halfFrustum;
        exportCam.bottom = -halfFrustum;
        exportCam.near = 0.01;
        exportCam.far = dist * 10;
        exportCam.position.copy(viewCenter).add(viewPos);
        exportCam.lookAt(viewCenter);
        exportCam.updateProjectionMatrix();

        updateLights(exportCam);

        if (includeGrid) {
          if (!gridHelperRef.current) updateGrid();
          if (gridHelperRef.current) gridHelperRef.current.visible = true;
          updateGridOrientation(exportCam, viewCenter);
        } else if (gridHelperRef.current) {
          gridHelperRef.current.visible = false;
        }

        if (dimensionsGroupRef.current) {
          dimensionsGroupRef.current.visible = dimensionsActiveRef.current;
          if (dimensionsActiveRef.current) {
            const exportCamDir = exportCam.getWorldDirection(new THREE.Vector3());
            dimensionsGroupRef.current.children.forEach((child: any) => {
              if (child.userData?.dir) {
                const dot = Math.abs(child.userData.dir.dot(exportCamDir));
                child.visible = dot < 0.94;
              }
            });
          }
        }

        // Hide live 3D bounding box dimension lines during export panel rendering
        // (export canvases draw crisp 2D dimensions on top via drawBoundingBoxDimensionsOnCanvas)
        if (selectionBoxDimensionsGroupRef.current) {
          selectionBoxDimensionsGroupRef.current.visible = false;
        }

        renderExportPanel(exportCam, panelSize, usePostProcessing);

        if (captureCtx) {
          captureCtx.clearRect(0, 0, panelSize, panelSize);
          captureCtx.drawImage(rendererRef.current.domElement, 0, 0, panelSize, panelSize);

          drawDimensionsOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
          if (selectedPartInfoRef.current) {
            drawBoundingBoxDimensionsOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
            drawSelectedPartBoundingBoxOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
          }

          captureCanvas.toBlob(async (blob) => {
            if (blob) {
              try {
                const finalBlob = await injectPngDpi(blob, 300);
                const arrayBuffer = await finalBlob.arrayBuffer();
                zip.file(`${view.folder}/${view.filename}`, arrayBuffer, { binary: true });
              } catch (zipErr) {
                console.error(`Error adding view ${view.displayName} to zip:`, zipErr);
              }
            } else {
              console.warn(`Could not capture blob for view ${view.displayName}`);
            }
            currentIdx++;
            requestAnimationFrame(renderNextView);
          }, 'image/png');
        } else {
          currentIdx++;
          requestAnimationFrame(renderNextView);
        }
      };

      requestAnimationFrame(renderNextView);
    };

    // Export views to a 1:1 real-world scaled orthographic PDF document with 5k panel resolution
    const renderCombinedViewsToPdf = async (
      views: {
        id: ViewExportId;
        name: string;
        displayName: string;
        filename: string;
        pos: THREE.Vector3;
        up?: THREE.Vector3;
      }[],
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (
        !currentModelRef.current ||
        !sceneRef.current ||
        !rendererRef.current ||
        !containerRef.current ||
        !activeCameraRef.current
      ) {
        return;
      }

      isExportingRef.current = true;
      if (controlsRef.current) controlsRef.current.enabled = false;

      recalculateBounds();
      const includeGrid = settingsRef.current.showGrid;

      const origPixelRatio = rendererRef.current.getPixelRatio();
      const origWidth = containerRef.current.clientWidth;
      const origHeight = containerRef.current.clientHeight;
      rendererRef.current.setPixelRatio(1);

      // Dedicated 5,000 x 5,000 px panel size for supreme 5K output
      const panelPx = 5000;
      const gl = rendererRef.current.getContext();
      const maxViewportDims = gl ? gl.getParameter(gl.MAX_VIEWPORT_DIMS) : null;
      const maxHardwareDim = Math.min(
        maxViewportDims?.[0] || 16384,
        maxViewportDims?.[1] || 16384,
        gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 16384 : 16384,
        gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) || 16384 : 16384
      );
      const actualPanelPx = Math.min(panelPx, maxHardwareDim);

      const framing = computeExportViewsFraming(views, actualPanelPx);
      const halfFrustum = framing.halfFrustum;
      const dist = framing.dist;

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
      rendererRef.current.setSize(actualPanelPx, actualPanelPx, true);
      rendererRef.current.setViewport(0, 0, actualPanelPx, actualPanelPx);
      rendererRef.current.setScissorTest(false);

      const isAoOn = !!settingsRef.current.ssaoEnabled;
      const isSsrOn = !!(settingsRef.current.ssrQuality && settingsRef.current.ssrQuality !== 'off');
      const usePostProcessing = isAoOn || isSsrOn;

      if (usePostProcessing && composerRef.current) {
        composerRef.current.setPixelRatio(1);
        composerRef.current.setSize(actualPanelPx, actualPanelPx);
        if (ssrPassRef.current) {
          ssrPassRef.current.setSize(actualPanelPx, actualPanelPx);
        }
      }

      // Real world 1:1 scale calculation
      // model 3D frustum width = 2 * halfFrustum in Three.js internal units
      // getConversionToInches() converts Three.js units to inches:
      // scaleInches = 1 / 25.4 (1 mm per Three.js unit)
      // currentScale = dimensionsRef.current.scaleFactor
      const scaleInches = getConversionToInches();
      const currentScale = dimensionsRef.current.scaleFactor;
      const frustumInches = (2 * halfFrustum) * scaleInches * currentScale;
      // In PDF (72 points = 1 inch), each panel represents frustumInches in real world!
      const panelInches = Math.max(0.1, frustumInches);
      const panelPt = panelInches * 72;

      // Map views by selection table layout:
      // Middle row horizontal order: rear_right, right, front_right, front, front_left, left, rear_left, back
      const HORIZ_ORDER: ViewExportId[] = [
        'rear_right',
        'right',
        'front_right',
        'front',
        'front_left',
        'left',
        'rear_left',
        'back',
      ];
      const selectedHoriz = HORIZ_ORDER.filter((id) => views.some((v) => v.id === id));
      const horizCols = Math.max(1, selectedHoriz.length);

      // Determine col indices for top and bottom rows
      // If a view isn't selected, pull outside views closer toward front
      const getHorizColIndex = (targetId: ViewExportId, fallbackDir: 'left' | 'right' | 'center'): number => {
        const exactIdx = selectedHoriz.indexOf(targetId);
        if (exactIdx !== -1) return exactIdx;
        const frontIdx = selectedHoriz.indexOf('front');
        if (frontIdx !== -1) {
          if (fallbackDir === 'center') return frontIdx;
          if (fallbackDir === 'left') return Math.max(0, frontIdx - 1);
          if (fallbackDir === 'right') return Math.min(selectedHoriz.length - 1, frontIdx + 1);
        }
        return 0;
      };

      const viewPlacement = new Map<
        ViewExportId,
        { row: number; col: number; label: string }
      >();

      // Place middle row
      selectedHoriz.forEach((id, colIdx) => {
        const vSpec = views.find((v) => v.id === id);
        viewPlacement.set(id, { row: 1, col: colIdx, label: vSpec ? vSpec.name : id.toUpperCase() });
      });

      // Check if top row views exist
      const hasTopViews = views.some(
        (v) => v.id === 'current' || v.id === 'front_right_quarter' || v.id === 'top' || v.id === 'front_left_quarter'
      );
      // Check if bottom row views exist
      const hasBottomViews = views.some(
        (v) => v.id === 'rear_right_quarter' || v.id === 'bottom' || v.id === 'rear_left_quarter'
      );

      // Top row items
      if (views.some((v) => v.id === 'current')) {
        viewPlacement.set('current', { row: 0, col: 0, label: 'CURRENT VIEWPORT' });
      }
      if (views.some((v) => v.id === 'front_right_quarter')) {
        const c = getHorizColIndex('front_right', 'left');
        viewPlacement.set('front_right_quarter', { row: 0, col: c, label: '3/4 FRONT-RIGHT' });
      }
      if (views.some((v) => v.id === 'top')) {
        const c = getHorizColIndex('front', 'center');
        viewPlacement.set('top', { row: 0, col: c, label: 'TOP VIEW' });
      }
      if (views.some((v) => v.id === 'front_left_quarter')) {
        const c = getHorizColIndex('front_left', 'right');
        viewPlacement.set('front_left_quarter', { row: 0, col: c, label: '3/4 FRONT-LEFT' });
      }

      // Bottom row items
      if (views.some((v) => v.id === 'rear_right_quarter')) {
        const c = getHorizColIndex('front_right', 'left');
        viewPlacement.set('rear_right_quarter', { row: 2, col: c, label: '3/4 REAR-RIGHT' });
      }
      if (views.some((v) => v.id === 'bottom')) {
        const c = getHorizColIndex('front', 'center');
        viewPlacement.set('bottom', { row: 2, col: c, label: 'BOTTOM VIEW' });
      }
      if (views.some((v) => v.id === 'rear_left_quarter')) {
        const c = getHorizColIndex('front_left', 'right');
        viewPlacement.set('rear_left_quarter', { row: 2, col: c, label: '3/4 REAR-LEFT' });
      }

      // Compact row numbers if top or bottom row has no views
      const activeRowSet = new Set<number>();
      viewPlacement.forEach((val) => activeRowSet.add(val.row));
      const sortedActiveRows = Array.from(activeRowSet).sort((a, b) => a - b);
      const rowRemap = new Map<number, number>();
      sortedActiveRows.forEach((r, idx) => rowRemap.set(r, idx));
      const totalActiveRows = Math.max(1, sortedActiveRows.length);

      // Max column used across all placed views
      let maxColUsed = 0;
      viewPlacement.forEach((val) => {
        if (val.col > maxColUsed) maxColUsed = val.col;
      });
      const numCols = Math.max(horizCols, maxColUsed + 1);

      // Spacing in inches (and PDF points: 1" = 72 pt)
      const gapInches = 0.5; // 0.5" margin between panels
      const marginInches = 0.75; // 0.75" outer margin
      const headerInches = 1.6; // 1.6" header space at top
      const labelInches = 0.4; // 0.4" label below each panel

      const gapPt = gapInches * 72;
      const marginPt = marginInches * 72;
      const headerPt = headerInches * 72;
      const labelPt = labelInches * 72;

      const pagePtWidth = marginPt * 2 + numCols * panelPt + (numCols - 1) * gapPt;
      const pagePtHeight =
        marginPt * 2 + headerPt + totalActiveRows * (panelPt + labelPt) + (totalActiveRows - 1) * gapPt;

      const pdf = new jsPDF({
        orientation: pagePtWidth > pagePtHeight ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [pagePtWidth, pagePtHeight],
      });

      // Clean white background
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pagePtWidth, pagePtHeight, 'F');

      // Header: File name(s) (first 3 max) + Overall out-to-out dimensions
      const scaleIn = getConversionToInches();
      const inX = (unscaledModelSizeRef.current.x * scaleIn * currentScale).toFixed(3);
      const inY = (unscaledModelSizeRef.current.y * scaleIn * currentScale).toFixed(3);
      const inZ = (unscaledModelSizeRef.current.z * scaleIn * currentScale).toFixed(3);

      // Get first 3 mesh/model file names
      let meshNamesList: string[] = [];
      if (batchPartsRef.current && batchPartsRef.current.length > 0) {
        meshNamesList = batchPartsRef.current.slice(0, 3).map((p) => p.object.name || 'Part');
      } else if (loadedFileName) {
        if (loadedFileName.includes(':')) {
          const partsStr = loadedFileName.split(':')[1]?.trim() || '';
          meshNamesList = partsStr.split(/\s*\+\s*|\s*,\s*/).slice(0, 3).filter(Boolean);
        } else {
          meshNamesList = [loadedFileName];
        }
      }
      if (meshNamesList.length === 0) meshNamesList = ['Model'];
      const fileNamesText = meshNamesList.join(', ') + (batchPartsRef.current.length > 3 ? '...' : '');

      // Draw header text
      pdf.setTextColor(15, 23, 42); // slate-900
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.text('3D MODEL ORTHOGRAPHIC SPECIFICATION (1:1 SCALE)', marginPt, marginPt + 24);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);
      pdf.setTextColor(71, 85, 105); // slate-600
      pdf.text(
        `Files / Meshes: ${fileNamesText}  |  Out-To-Out Dimensions: X ${inX}" × Y ${inY}" × Z ${inZ}"`,
        marginPt,
        marginPt + 46
      );
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139); // slate-500
      pdf.text(
        `Output Resolution: 5000px per panel  •  Scale: 1:1 True Size (1 inch in CAD = 1 inch on page)  •  Grid: ${includeGrid ? 'Included' : 'Off'}`,
        marginPt,
        marginPt + 64
      );

      // Header divider rule
      pdf.setDrawColor(226, 232, 240); // slate-200
      pdf.setLineWidth(1.5);
      pdf.line(marginPt, marginPt + 76, pagePtWidth - marginPt, marginPt + 76);

      // Watermark logo (best-effort)
      try {
        const logoImg = await getJazwaresLogoImage();
        if (logoImg) {
          const logoCanvas = document.createElement('canvas');
          logoCanvas.width = logoImg.width;
          logoCanvas.height = logoImg.height;
          const lctx = logoCanvas.getContext('2d');
          if (lctx) {
            lctx.drawImage(logoImg, 0, 0);
            const logoDataUrl = logoCanvas.toDataURL('image/png');
            const logoW = 110;
            const logoH = (logoImg.height / logoImg.width) * logoW;
            pdf.addImage(logoDataUrl, 'PNG', pagePtWidth - marginPt - logoW, marginPt + 10, logoW, logoH);
          }
        }
      } catch (err) {
        console.warn('Could not add logo to PDF header', err);
      }

      // Prepare panel render canvas
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = actualPanelPx;
      captureCanvas.height = actualPanelPx;
      const captureCtx = captureCanvas.getContext('2d');

      let currentIdx = 0;

      const renderNextPdfView = async () => {
        if (!sceneRef.current || !rendererRef.current || !activeCameraRef.current) {
          restoreComposerAndRenderer(origPixelRatio, origWidth, origHeight);
          return;
        }

        if (currentIdx >= views.length) {
          restoreComposerAndRenderer(origPixelRatio, origWidth, origHeight);
          onProgress('Generating PDF document...');
          try {
            const pdfBlob = pdf.output('blob');
            const cleanName = getSanitizedBaseName(loadedFileName);
            const outName = `${cleanName}_Combined_Views_1to1.pdf`;
            onComplete(pdfBlob, outName);
          } catch (pdfErr) {
            console.error('Failed to generate PDF document:', pdfErr);
            throw pdfErr;
          }
          return;
        }

        const v = views[currentIdx];
        const placement = viewPlacement.get(v.id);
        const mappedRow = placement ? rowRemap.get(placement.row) ?? 0 : 0;
        const mappedCol = placement ? placement.col : currentIdx % numCols;
        const panelLabel = placement ? placement.label : v.name;

        onProgress(`Rendering 5K view (${currentIdx + 1}/${views.length}): ${v.displayName}...`);

        const viewCenter = framing.viewCenters[currentIdx];
        const viewPos = v.pos.clone().normalize().multiplyScalar(dist);
        if (v.up) {
          exportCam.up.copy(v.up);
        } else if (v.name === 'TOP VIEW' || v.displayName === 'Top View') {
          exportCam.up.set(0, 0, -1);
        } else if (v.name === 'BOTTOM VIEW' || v.displayName === 'Bottom View') {
          exportCam.up.set(0, 0, 1);
        } else {
          exportCam.up.set(0, 1, 0);
        }
        exportCam.left = -halfFrustum;
        exportCam.right = halfFrustum;
        exportCam.top = halfFrustum;
        exportCam.bottom = -halfFrustum;
        exportCam.near = 0.01;
        exportCam.far = dist * 10;
        exportCam.position.copy(viewCenter).add(viewPos);
        exportCam.lookAt(viewCenter);
        exportCam.updateProjectionMatrix();

        updateLights(exportCam);

        if (includeGrid) {
          if (!gridHelperRef.current) updateGrid();
          if (gridHelperRef.current) gridHelperRef.current.visible = true;
          updateGridOrientation(exportCam, viewCenter);
        } else if (gridHelperRef.current) {
          gridHelperRef.current.visible = false;
        }

        if (dimensionsGroupRef.current) {
          dimensionsGroupRef.current.visible = dimensionsActiveRef.current;
          if (dimensionsActiveRef.current) {
            const exportCamDir = exportCam.getWorldDirection(new THREE.Vector3());
            dimensionsGroupRef.current.children.forEach((child: any) => {
              if (child.userData?.dir) {
                const dot = Math.abs(child.userData.dir.dot(exportCamDir));
                child.visible = dot < 0.94;
              }
            });
          }
        }

        if (selectionBoxDimensionsGroupRef.current) {
          selectionBoxDimensionsGroupRef.current.visible = false;
        }

        rendererRef.current.clear(true, true, true);
        renderExportPanel(exportCam, actualPanelPx, usePostProcessing);

        if (captureCtx && rendererRef.current.domElement) {
          captureCtx.clearRect(0, 0, actualPanelPx, actualPanelPx);
          captureCtx.drawImage(rendererRef.current.domElement, 0, 0, actualPanelPx, actualPanelPx);

          drawDimensionsOnCanvas(captureCtx, exportCam, 0, 0, actualPanelPx);
          if (selectedPartInfoRef.current) {
            drawBoundingBoxDimensionsOnCanvas(captureCtx, exportCam, 0, 0, actualPanelPx);
            drawSelectedPartBoundingBoxOnCanvas(captureCtx, exportCam, 0, 0, actualPanelPx);
          }

          const panelDataUrl = captureCanvas.toDataURL('image/png');

          // Place into PDF at computed pt coordinates
          const panelX = marginPt + mappedCol * (panelPt + gapPt);
          const panelY = marginPt + headerPt + mappedRow * (panelPt + labelPt + gapPt);

          // Embed transparent 5K PNG panel into PDF
          pdf.addImage(panelDataUrl, 'PNG', panelX, panelY, panelPt, panelPt, undefined, 'FAST');

          // Border around panel
          pdf.setDrawColor(203, 213, 225); // slate-300
          pdf.setLineWidth(1);
          pdf.rect(panelX, panelY, panelPt, panelPt);

          // Panel title label below
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(11);
          pdf.setTextColor(30, 41, 59); // slate-800
          pdf.text(panelLabel, panelX + panelPt / 2, panelY + panelPt + 16, { align: 'center' });
        }

        currentIdx++;
        requestAnimationFrame(renderNextPdfView);
      };

      requestAnimationFrame(renderNextPdfView);
    };

    // Customizable Image Views Exporter (supports custom selection of views, combine to 1 sheet, combine to 1 PDF, or export separately as PNG / ZIP)
    const exportCustomImageViews = async (
      config: ImageExportConfig,
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (
        !currentModelRef.current ||
        !sceneRef.current ||
        !rendererRef.current ||
        !containerRef.current ||
        !activeCameraRef.current
      ) {
        return;
      }

      const activeViews: ViewExportId[] = config.selectedViews || (config as any).views || [];
      if (!activeViews || activeViews.length === 0) {
        onProgress('No views selected');
        throw new Error('No views selected. Please select at least one view before exporting.');
      }

      const cleanName = getSanitizedBaseName(loadedFileName);
      const resMult = config.resolution;

      const getViewSpec = (id: ViewExportId, index: number) => {
        const padIdx = String(index + 1).padStart(2, '0');
        switch (id) {
          case 'current': {
            const target = controlsRef.current?.target || new THREE.Vector3();
            const relPos = activeCameraRef.current!.position.clone().sub(target);
            return {
              name: 'CURRENT VIEWPORT',
              displayName: 'Current Viewport',
              filename: `${cleanName}_${padIdx}_Current_Viewport.png`,
              pos: relPos.lengthSq() > 0 ? relPos.normalize() : new THREE.Vector3(0, 0, 1),
              up: activeCameraRef.current!.up.clone().normalize(),
            };
          }
          case 'front':
            return {
              name: 'FRONT VIEW',
              displayName: 'Front View',
              filename: `${cleanName}_${padIdx}_Front.png`,
              pos: new THREE.Vector3(0, 0, 1),
            };
          case 'back':
            return {
              name: 'BACK VIEW',
              displayName: 'Back View',
              filename: `${cleanName}_${padIdx}_Back.png`,
              pos: new THREE.Vector3(0, 0, -1),
            };
          case 'top':
            return {
              name: 'TOP VIEW',
              displayName: 'Top View',
              filename: `${cleanName}_${padIdx}_Top.png`,
              pos: new THREE.Vector3(0, 1, 0.0001),
              up: new THREE.Vector3(0, 0, -1),
            };
          case 'bottom':
            return {
              name: 'BOTTOM VIEW',
              displayName: 'Bottom View',
              filename: `${cleanName}_${padIdx}_Bottom.png`,
              pos: new THREE.Vector3(0, -1, 0.0001),
              up: new THREE.Vector3(0, 0, 1),
            };
          case 'left':
            return {
              name: 'LEFT VIEW',
              displayName: 'Left View',
              filename: `${cleanName}_${padIdx}_Left.png`,
              pos: new THREE.Vector3(1, 0, 0),
            };
          case 'right':
            return {
              name: 'RIGHT VIEW',
              displayName: 'Right View',
              filename: `${cleanName}_${padIdx}_Right.png`,
              pos: new THREE.Vector3(-1, 0, 0),
            };
          case 'front_right':
            return {
              name: 'FRONT RIGHT',
              displayName: 'Front Right',
              filename: `${cleanName}_${padIdx}_Front_Right.png`,
              pos: new THREE.Vector3(-Math.SQRT1_2, 0, Math.SQRT1_2),
            };
          case 'rear_right':
            return {
              name: 'REAR RIGHT',
              displayName: 'Rear Right',
              filename: `${cleanName}_${padIdx}_Rear_Right.png`,
              pos: new THREE.Vector3(-Math.SQRT1_2, 0, -Math.SQRT1_2),
            };
          case 'front_left':
            return {
              name: 'FRONT LEFT',
              displayName: 'Front Left',
              filename: `${cleanName}_${padIdx}_Front_Left.png`,
              pos: new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
            };
          case 'rear_left':
            return {
              name: 'REAR LEFT',
              displayName: 'Rear Left',
              filename: `${cleanName}_${padIdx}_Rear_Left.png`,
              pos: new THREE.Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2),
            };
          case 'front_right_quarter':
            return {
              name: '3/4 FRONT-RIGHT',
              displayName: '3/4 Front Right',
              filename: `${cleanName}_${padIdx}_3-4_Front_Right.png`,
              pos: new THREE.Vector3(-0.707, 0.5, 0.707),
            };
          case 'front_left_quarter':
            return {
              name: '3/4 FRONT-LEFT',
              displayName: '3/4 Front Left',
              filename: `${cleanName}_${padIdx}_3-4_Front_Left.png`,
              pos: new THREE.Vector3(0.707, 0.5, 0.707),
            };
          case 'rear_right_quarter':
            return {
              name: '3/4 REAR-RIGHT',
              displayName: '3/4 Rear Right',
              filename: `${cleanName}_${padIdx}_3-4_Rear_Right.png`,
              pos: new THREE.Vector3(-0.707, 0.5, -0.707),
            };
          case 'rear_left_quarter':
            return {
              name: '3/4 REAR-LEFT',
              displayName: '3/4 Rear Left',
              filename: `${cleanName}_${padIdx}_3-4_Rear_Left.png`,
              pos: new THREE.Vector3(0.707, 0.5, -0.707),
            };
          default:
            return {
              name: 'FRONT VIEW',
              displayName: 'Front View',
              filename: `${cleanName}_${padIdx}_Front.png`,
              pos: new THREE.Vector3(0, 0, 1),
            };
        }
      };

      const viewSpecs = activeViews.map((id, idx) => ({
        id,
        ...getViewSpec(id, idx),
      }));

      if (config.exportMode === 'combine_pdf') {
        renderCombinedViewsToPdf(viewSpecs, onComplete, onProgress);
      } else if (config.combineToOne) {
        const total = viewSpecs.length;
        let cols = 4;
        let rows = 2;
        if (total === 1) {
          cols = 1;
          rows = 1;
        } else if (total === 2) {
          cols = 2;
          rows = 1;
        } else if (total === 3) {
          cols = 3;
          rows = 1;
        } else if (total === 4) {
          cols = 2;
          rows = 2;
        } else if (total <= 6) {
          cols = 3;
          rows = Math.ceil(total / 3);
        } else if (total <= 8) {
          cols = 4;
          rows = Math.ceil(total / 4);
        } else if (total <= 12) {
          cols = 4;
          rows = Math.ceil(total / 4);
        } else {
          cols = 5;
          rows = Math.ceil(total / 5);
        }

        let sheetTitle = '3D MODEL CUSTOM VIEWS SHEET';
        if (total === 14) {
          sheetTitle = '3D MODEL ALL TURNS SHEET';
        } else if (
          total === 8 &&
          activeViews.includes('front') &&
          activeViews.includes('back') &&
          activeViews.includes('top') &&
          activeViews.includes('bottom')
        ) {
          sheetTitle = '3D MODEL ORTHOGRAPHIC TURNAROUND SHEET';
        } else if (
          total === 4 &&
          activeViews.includes('front_right') &&
          activeViews.includes('rear_right')
        ) {
          sheetTitle = '3D MODEL 3/4 VIEWS SHEET';
        }

        renderOrthographicCompositeSheet(
          sheetTitle,
          'Custom_Views',
          viewSpecs.map((s) => ({ name: s.name, pos: s.pos, up: s.up })),
          cols,
          rows,
          config.resolution,
          onComplete,
          onProgress
        );
      } else {
        recalculateBounds();
        isExportingRef.current = true;
        if (controlsRef.current) controlsRef.current.enabled = false;

        const origPixelRatio = rendererRef.current.getPixelRatio();
        const origWidth = containerRef.current.clientWidth;
        const origHeight = containerRef.current.clientHeight;
        rendererRef.current.setPixelRatio(1);

        const gl = rendererRef.current.getContext();
        const maxViewportDims = gl ? gl.getParameter(gl.MAX_VIEWPORT_DIMS) : null;
        const maxHardwareDim = Math.min(
          maxViewportDims?.[0] || 16384,
          maxViewportDims?.[1] || 16384,
          gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 16384 : 16384,
          gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) || 16384 : 16384
        );

        const resolutionPanelMap: Record<ResolutionOption, number> = {
          1: 1000,
          2: 2000,
          3: 3000,
          4: 4000,
          5: 5000,
        };
        const requestedPanel = resolutionPanelMap[resMult] || (1000 * resMult);
        const panelSize = Math.min(requestedPanel, maxHardwareDim);

        const framing = computeExportViewsFraming(
          viewSpecs.map((s) => ({
            displayName: s.displayName,
            pos: s.pos,
            up: s.up,
            filename: s.filename,
            folder: 'Views',
          })),
          panelSize
        );
        const halfFrustum = framing.halfFrustum;
        const dist = framing.dist;
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
        rendererRef.current.setViewport(0, 0, panelSize, panelSize);
        rendererRef.current.setScissorTest(false);

        const isAoOn = !!settingsRef.current.ssaoEnabled;
        const isSsrOn = !!(settingsRef.current.ssrQuality && settingsRef.current.ssrQuality !== 'off');
        const usePostProcessing = isAoOn || isSsrOn;

        if (usePostProcessing && composerRef.current) {
          composerRef.current.setPixelRatio(1);
          composerRef.current.setSize(panelSize, panelSize);
          if (ssrPassRef.current) {
            ssrPassRef.current.setSize(panelSize, panelSize);
          }
        }

        const cleanupAndRestore = () => {
          restoreComposerAndRenderer(origPixelRatio, origWidth, origHeight);
        };

        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = panelSize;
        captureCanvas.height = panelSize;
        const captureCtx = captureCanvas.getContext('2d');

        if (viewSpecs.length === 1) {
          const view = viewSpecs[0];
          const viewCenter = framing.viewCenters[0];
          const viewPos = view.pos.clone().normalize().multiplyScalar(dist);
          onProgress(`Rendering: ${view.displayName}...`);

          if (view.up) {
            exportCam.up.copy(view.up);
          } else if (view.name === 'TOP VIEW') {
            exportCam.up.set(0, 0, -1);
          } else if (view.name === 'BOTTOM VIEW') {
            exportCam.up.set(0, 0, 1);
          } else {
            exportCam.up.set(0, 1, 0);
          }
          exportCam.left = -halfFrustum;
          exportCam.right = halfFrustum;
          exportCam.top = halfFrustum;
          exportCam.bottom = -halfFrustum;
          exportCam.position.copy(viewCenter).add(viewPos);
          exportCam.lookAt(viewCenter);
          exportCam.updateProjectionMatrix();

          updateLights(exportCam);

          if (settingsRef.current.showGrid) {
            if (!gridHelperRef.current) updateGrid();
            if (gridHelperRef.current) gridHelperRef.current.visible = true;
            updateGridOrientation(exportCam, viewCenter);
          } else if (gridHelperRef.current) {
            gridHelperRef.current.visible = false;
          }

          if (dimensionsGroupRef.current) {
            dimensionsGroupRef.current.visible = dimensionsActiveRef.current;
            if (dimensionsActiveRef.current) {
              dimensionsGroupRef.current.children.forEach((child) => {
                if (child.name === 'DimensionLabel' || child.name === 'VertexPoint') {
                  child.quaternion.copy(exportCam.quaternion);
                }
              });
            }
          }

          if (selectionBoxDimensionsGroupRef.current) {
            selectionBoxDimensionsGroupRef.current.visible = false;
          }

          rendererRef.current.clear(true, true, true);
          renderExportPanel(exportCam, panelSize, usePostProcessing);

          if (captureCtx && rendererRef.current.domElement) {
            captureCtx.clearRect(0, 0, panelSize, panelSize);
            captureCtx.drawImage(rendererRef.current.domElement, 0, 0, panelSize, panelSize);

            drawDimensionsOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
            if (selectedPartInfoRef.current) {
              drawBoundingBoxDimensionsOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
              drawSelectedPartBoundingBoxOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
            }

            captureCanvas.toBlob(async (blob) => {
              cleanupAndRestore();
              if (blob) {
                const finalBlob = await injectPngDpi(blob, 300);
                onComplete(finalBlob, view.filename);
              }
            }, 'image/png');
          } else {
            cleanupAndRestore();
          }
          return;
        }

        const zip = new JSZip();
        let currentIdx = 0;

        const renderNextView = async () => {
          if (!sceneRef.current || !rendererRef.current || !containerRef.current) {
            cleanupAndRestore();
            return;
          }

          if (currentIdx >= viewSpecs.length) {
            cleanupAndRestore();
            onProgress('Compressing ZIP...');
            try {
              const zipBlob = await zip.generateAsync(
                {
                  type: 'blob',
                  compression: 'DEFLATE',
                  compressionOptions: { level: 6 },
                  platform: 'DOS',
                },
                (metadata) => {
                  onProgress(`Compressing (${Math.round(metadata.percent)}%)...`);
                }
              );
              const outZipName = `${cleanName}_Custom_Views_${resMult}k.zip`;
              onComplete(zipBlob, outZipName);
            } catch (err) {
              console.error('Failed to create ZIP archive:', err);
              onProgress('ZIP creation failed');
            }
            return;
          }

          const view = viewSpecs[currentIdx];
          const viewCenter = framing.viewCenters[currentIdx];
          const viewPos = view.pos.clone().normalize().multiplyScalar(dist);
          onProgress(`Rendering (${currentIdx + 1}/${viewSpecs.length}): ${view.displayName}...`);

          if (view.up) {
            exportCam.up.copy(view.up);
          } else if (view.name === 'TOP VIEW') {
            exportCam.up.set(0, 0, -1);
          } else if (view.name === 'BOTTOM VIEW') {
            exportCam.up.set(0, 0, 1);
          } else {
            exportCam.up.set(0, 1, 0);
          }
          exportCam.left = -halfFrustum;
          exportCam.right = halfFrustum;
          exportCam.top = halfFrustum;
          exportCam.bottom = -halfFrustum;
          exportCam.position.copy(viewCenter).add(viewPos);
          exportCam.lookAt(viewCenter);
          exportCam.updateProjectionMatrix();

          updateLights(exportCam);

          if (settingsRef.current.showGrid) {
            if (!gridHelperRef.current) updateGrid();
            if (gridHelperRef.current) gridHelperRef.current.visible = true;
            updateGridOrientation(exportCam, viewCenter);
          } else if (gridHelperRef.current) {
            gridHelperRef.current.visible = false;
          }

          if (dimensionsGroupRef.current) {
            dimensionsGroupRef.current.visible = dimensionsActiveRef.current;
            if (dimensionsActiveRef.current) {
              dimensionsGroupRef.current.children.forEach((child) => {
                if (child.name === 'DimensionLabel' || child.name === 'VertexPoint') {
                  child.quaternion.copy(exportCam.quaternion);
                }
              });
            }
          }

          if (selectionBoxDimensionsGroupRef.current) {
            selectionBoxDimensionsGroupRef.current.visible = false;
          }

          rendererRef.current.clear(true, true, true);
          renderExportPanel(exportCam, panelSize, usePostProcessing);

          if (captureCtx && rendererRef.current.domElement) {
            captureCtx.clearRect(0, 0, panelSize, panelSize);
            captureCtx.drawImage(rendererRef.current.domElement, 0, 0, panelSize, panelSize);

            drawDimensionsOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
            if (selectedPartInfoRef.current) {
              drawBoundingBoxDimensionsOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
              drawSelectedPartBoundingBoxOnCanvas(captureCtx, exportCam, 0, 0, panelSize);
            }

            captureCanvas.toBlob(async (blob) => {
              if (blob) {
                try {
                  const finalBlob = await injectPngDpi(blob, 300);
                  const arrayBuffer = await finalBlob.arrayBuffer();
                  zip.file(view.filename, arrayBuffer, { binary: true });
                } catch (zipErr) {
                  console.error(`Error adding view ${view.displayName} to zip:`, zipErr);
                }
              }
              currentIdx++;
              requestAnimationFrame(renderNextView);
            }, 'image/png');
          } else {
            currentIdx++;
            requestAnimationFrame(renderNextView);
          }
        };

        requestAnimationFrame(renderNextView);
      }
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
      const dpr = Math.min(window.devicePixelRatio, 2);
      rendererRef.current.setPixelRatio(dpr);
      rendererRef.current.setSize(origW, origH, true);
      if (composerRef.current) {
        composerRef.current.setPixelRatio(dpr);
        composerRef.current.setSize(origW, origH);
      }
      if (aoPassRef.current) aoPassRef.current.setSize(origW, origH);
      if (ssrPassRef.current) ssrPassRef.current.setSize(origW, origH);
      if (smaaPassRef.current) smaaPassRef.current.setSize(origW * dpr, origH * dpr);
      if (cameraPerspRef.current) {
        cameraPerspRef.current.aspect = origW / origH;
        cameraPerspRef.current.updateProjectionMatrix();
      }
      updateOrthoFrustum();
      isExportingRef.current = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      if (settingsRef.current.isOrtho && settingsRef.current.showGrid) updateGrid();
      updateLights(cam);
      if (selectionBoxDimensionsGroupRef.current && containerRef.current) {
        updateBoundingBoxDimensions(
          cam,
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
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
      formatOrOptions: 'mp4' | 'webm' | VideoExportOptions,
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (status: string) => void
    ) => {
      if (!currentModelRef.current || !canvasRef.current || !rendererRef.current || !sceneRef.current || !activeCameraRef.current) {
        return;
      }

      const isConfigObject = typeof formatOrOptions === 'object';
      const format = isConfigObject ? formatOrOptions.format : formatOrOptions;
      const targetRes = isConfigObject ? formatOrOptions.resolution : 1080;
      const targetAspect = isConfigObject ? formatOrOptions.aspectRatio : '16:9';
      const fps = isConfigObject ? formatOrOptions.fps : 30;
      const customDurationSec = isConfigObject ? formatOrOptions.duration : null;
      const useEasing = isConfigObject
        ? !!formatOrOptions.videoEasing
        : !!settingsRef.current.videoEasing;
      const compression = isConfigObject ? formatOrOptions.compression : 'high';

      isExportingRef.current = true;
      if (controlsRef.current) controlsRef.current.enabled = false;
      if (selectionBoxDimensionsGroupRef.current) {
        selectionBoxDimensionsGroupRef.current.visible = false;
      }

      onProgress('Initializing video encoder...');
      recalculateBounds();

      // Temporarily render at a higher fixed resolution for a cleaner, less compressed-looking
      // capture than whatever the on-screen canvas size happens to be. H.264 encoders (Path A,
      // and most MediaRecorder mp4/h264 backends too) strictly require even width/height.
      const origW = containerRef.current?.clientWidth || canvasRef.current.width;
      const origH = containerRef.current?.clientHeight || canvasRef.current.height;

      let exportW = 1920;
      let exportH = 1080;

      if (targetAspect === '1:1') {
        exportW = targetRes;
        exportH = targetRes;
      } else if (targetAspect === '16:9') {
        exportH = targetRes;
        exportW = Math.round(targetRes * (16 / 9));
      } else if (targetAspect === '9:16') {
        exportW = Math.round(targetRes * (9 / 16));
        exportH = targetRes;
      } else {
        // 'viewport'
        const aspect = origW / Math.max(origH, 1);
        exportH = targetRes;
        exportW = Math.round(targetRes * aspect);
      }

      if (exportW % 2 !== 0) exportW += 1;
      if (exportH % 2 !== 0) exportH += 1;

      rendererRef.current.setPixelRatio(1);
      rendererRef.current.setSize(exportW, exportH, true);
      if (composerRef.current) {
        composerRef.current.setPixelRatio(1);
        composerRef.current.setSize(exportW, exportH);
      }
      if (ssrPassRef.current) ssrPassRef.current.setSize(exportW, exportH);
      if (cameraPerspRef.current) {
        cameraPerspRef.current.aspect = exportW / exportH;
        cameraPerspRef.current.updateProjectionMatrix();
      }
      updateOrthoFrustum(exportW / exportH);

      // Rotation math shared by both paths — identical to the live turntable loop and the
      // export's own preview, just driven by a frame index (Path A) or wall-clock elapsed time
      // (Path B) instead of requestAnimationFrame deltas.
      const speedSetting = settingsRef.current.turntableSpeed || 'normal';
      const defaultDurationMs = speedSetting === 'slow' ? 8000 : speedSetting === 'fast' ? 2000 : 4000;
      const durationMs = customDurationSec ? customDurationSec * 1000 : defaultDurationMs;
      const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
      const dirSign = (settingsRef.current.turntableDirection || 'cw') === 'ccw' ? -1 : 1;
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
      const cleanName = getSanitizedBaseName(loadedFileName);

      let baseBitrate = 12_000_000;
      if (targetRes === 2160) baseBitrate = 35_000_000;
      else if (targetRes === 720) baseBitrate = 6_000_000;
      else if (targetRes === 480) baseBitrate = 2_500_000;

      const compMultiplier = compression === 'compact' ? 0.6 : compression === 'balanced' ? 1.0 : 1.5;
      const targetBitrate = Math.round(baseBitrate * compMultiplier);

      // Path A: real MP4 via WebCodecs + mp4-muxer
      if (format === 'mp4' && typeof VideoEncoder !== 'undefined') {
        let supportedCodec: string | null = null;
        const h264Candidates = [
          'avc1.640033', // High Profile Level 5.1 (4K UHD up to 60fps)
          'avc1.640034', // High Profile Level 5.2 (4K UHD)
          'avc1.4d0033', // Main Profile Level 5.1 (4K UHD)
          'avc1.420033', // Baseline Level 5.1 (4K UHD)
          'avc1.64002a', // High Profile Level 4.2 (1080p60)
          'avc1.4d002a', // Main Profile Level 4.2 (1080p60)
          'avc1.42001f', // Baseline Level 3.1
          'avc1.42E01E', // Baseline Level 3.0
        ];
        for (const codec of h264Candidates) {
          try {
            const res = await VideoEncoder.isConfigSupported({
              codec,
              width: exportW,
              height: exportH,
              bitrate: targetBitrate,
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
            encoder.configure({
              codec: supportedCodec,
              width: exportW,
              height: exportH,
              bitrate: targetBitrate,
              framerate: fps,
            });

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
              encoder.encode(frame, { keyFrame: i % Math.round(fps) === 0 });
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

      const stream = canvasRef.current.captureStream(fps);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: targetBitrate,
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

    const exportTurntableGif = async (
      options: GifExportOptions,
      onComplete: (blob: Blob, fileName: string) => void,
      onProgress: (progress: { current: number; total: number; stage: string; percent: number }) => void,
      abortSignalRef?: { current: boolean }
    ) => {
      if (!currentModelRef.current || !canvasRef.current || !rendererRef.current || !sceneRef.current || !activeCameraRef.current) {
        return;
      }

      isExportingRef.current = true;
      if (controlsRef.current) controlsRef.current.enabled = false;
      if (selectionBoxDimensionsGroupRef.current) {
        selectionBoxDimensionsGroupRef.current.visible = false;
      }

      onProgress({
        current: 0,
        total: 100,
        stage: 'Initializing GIF encoder...',
        percent: 0,
      });
      recalculateBounds();

      const origW = containerRef.current?.clientWidth || canvasRef.current.width || 1280;
      const origH = containerRef.current?.clientHeight || canvasRef.current.height || 720;
      const viewportAspect = origW / origH;

      let exportW = 720;
      let exportH = 720;
      if (options.aspectRatio === 'viewport') {
        // Match active 3D viewport framing and proportions exactly (identical to MP4/WebM video export)
        if (viewportAspect >= 1) {
          exportH = options.resolution;
          exportW = Math.round(options.resolution * viewportAspect);
        } else {
          exportW = options.resolution;
          exportH = Math.round(options.resolution / viewportAspect);
        }
      } else if (options.aspectRatio === '1:1') {
        exportW = options.resolution;
        exportH = options.resolution;
      } else {
        // Widescreen 16:9
        if (options.resolution === 480) {
          exportW = 854;
          exportH = 480;
        } else if (options.resolution === 720) {
          exportW = 1280;
          exportH = 720;
        } else {
          exportW = 1920;
          exportH = 1080;
        }
      }
      if (exportW % 2 !== 0) exportW += 1;
      if (exportH % 2 !== 0) exportH += 1;

      const exportAspect = exportW / exportH;

      rendererRef.current.setPixelRatio(1);
      rendererRef.current.setSize(exportW, exportH, false);
      if (composerRef.current) {
        composerRef.current.setPixelRatio(1);
        composerRef.current.setSize(exportW, exportH);
      }
      if (aoPassRef.current) aoPassRef.current.setSize(exportW, exportH);
      if (ssrPassRef.current) ssrPassRef.current.setSize(exportW, exportH);
      if (smaaPassRef.current) smaaPassRef.current.setSize(exportW, exportH);
      if (cameraPerspRef.current) {
        cameraPerspRef.current.aspect = exportAspect;
        cameraPerspRef.current.updateProjectionMatrix();
      }
      updateOrthoFrustum(exportAspect);

      // Configure background plate
      const isTranslucent = options.background === 'translucent';
      if (isTranslucent) {
        if (vignetteBgPassRef.current) vignetteBgPassRef.current.enabled = false;
        if (renderPassRef.current) renderPassRef.current.clear = true;
      } else {
        if (vignetteBgPassRef.current) vignetteBgPassRef.current.enabled = true;
        if (renderPassRef.current) renderPassRef.current.clear = false;
      }

      const totalFrames = Math.round(options.duration * options.fps);
      const delayMs = Math.round(1000 / options.fps);
      const dirSign = (settingsRef.current.turntableDirection || 'cw') === 'ccw' ? -1 : 1;
      const cam = activeCameraRef.current;
      const target = controlsRef.current?.target || new THREE.Vector3();
      const relX0 = cam.position.x - target.x;
      const relZ0 = cam.position.z - target.z;
      const radius = Math.sqrt(relX0 ** 2 + relZ0 ** 2) || modelRadiusRef.current * 3.0;
      const camY = cam.position.y;
      const initialAngle = Math.atan2(relX0, relZ0);
      const repeatVal = options.looping === 'infinite' ? 0 : -1;
      const cleanName = getSanitizedBaseName(loadedFileName);
      const useEasing = options.easing !== undefined ? options.easing : !!settingsRef.current.videoEasing;
      const easeProgress = (progress: number) =>
        useEasing
          ? progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2
          : progress;

      const gif = GIFEncoder();

      // 2D scratch canvas for reading rendered frames
      const scratchCanvas = document.createElement('canvas');
      scratchCanvas.width = exportW;
      scratchCanvas.height = exportH;
      const scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });
      if (!scratchCtx) {
        restoreLiveViewAfterExport(origW, origH, cam);
        if (vignetteBgPassRef.current) vignetteBgPassRef.current.enabled = true;
        if (renderPassRef.current) renderPassRef.current.clear = false;
        throw new Error('Could not create 2D canvas context for GIF capture');
      }

      // Fast Floyd-Steinberg error diffusion for smooth LookDev materials and gradients
      const applyDither = (
        rgba: Uint8ClampedArray,
        width: number,
        height: number,
        palette: number[][]
      ): Uint8Array => {
        const len = width * height;
        const indices = new Uint8Array(len);
        const rBuf = new Float32Array(len);
        const gBuf = new Float32Array(len);
        const bBuf = new Float32Array(len);

        for (let idx = 0; idx < len; idx++) {
          rBuf[idx] = rgba[idx * 4];
          gBuf[idx] = rgba[idx * 4 + 1];
          bBuf[idx] = rgba[idx * 4 + 2];
        }

        const cache = new Int16Array(65536).fill(-1);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const r = Math.max(0, Math.min(255, Math.round(rBuf[idx])));
            const g = Math.max(0, Math.min(255, Math.round(gBuf[idx])));
            const b = Math.max(0, Math.min(255, Math.round(bBuf[idx])));

            const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
            let colorIdx = cache[key];
            if (colorIdx === -1) {
              colorIdx = nearestColorIndex(palette, [r, g, b]);
              cache[key] = colorIdx;
            }

            indices[idx] = colorIdx;
            const palColor = palette[colorIdx];
            const errR = r - palColor[0];
            const errG = g - palColor[1];
            const errB = b - palColor[2];

            if (x + 1 < width) {
              const right = idx + 1;
              rBuf[right] += (errR * 7) / 16;
              gBuf[right] += (errG * 7) / 16;
              bBuf[right] += (errB * 7) / 16;
            }
            if (y + 1 < height) {
              if (x > 0) {
                const bl = (y + 1) * width + (x - 1);
                rBuf[bl] += (errR * 3) / 16;
                gBuf[bl] += (errG * 3) / 16;
                bBuf[bl] += (errB * 3) / 16;
              }
              const bc = (y + 1) * width + x;
              rBuf[bc] += (errR * 5) / 16;
              gBuf[bc] += (errG * 5) / 16;
              bBuf[bc] += (errB * 5) / 16;
              if (x + 1 < width) {
                const br = (y + 1) * width + (x + 1);
                rBuf[br] += (errR * 1) / 16;
                gBuf[br] += (errG * 1) / 16;
                bBuf[br] += (errB * 1) / 16;
              }
            }
          }
        }
        return indices;
      };

      // Fast Floyd-Steinberg error diffusion with 1-bit alpha awareness for transparent GIF export
      const applyDitherWithAlpha = (
        rgba: Uint8ClampedArray,
        width: number,
        height: number,
        palette: number[][],
        transparentIndex: number
      ): Uint8Array => {
        const len = width * height;
        const indices = new Uint8Array(len);
        const rBuf = new Float32Array(len);
        const gBuf = new Float32Array(len);
        const bBuf = new Float32Array(len);

        for (let idx = 0; idx < len; idx++) {
          rBuf[idx] = rgba[idx * 4];
          gBuf[idx] = rgba[idx * 4 + 1];
          bBuf[idx] = rgba[idx * 4 + 2];
        }

        const modelColors = palette.slice(1);
        const cache = new Int16Array(65536).fill(-1);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (rgba[idx * 4 + 3] < 32) {
              indices[idx] = transparentIndex;
              continue;
            }

            const r = Math.max(0, Math.min(255, Math.round(rBuf[idx])));
            const g = Math.max(0, Math.min(255, Math.round(gBuf[idx])));
            const b = Math.max(0, Math.min(255, Math.round(bBuf[idx])));

            const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
            let modelIdx = cache[key];
            if (modelIdx === -1) {
              modelIdx = nearestColorIndex(modelColors, [r, g, b]);
              cache[key] = modelIdx;
            }

            const palIdx = modelIdx + 1;
            indices[idx] = palIdx;
            const palColor = modelColors[modelIdx];
            const errR = r - palColor[0];
            const errG = g - palColor[1];
            const errB = b - palColor[2];

            if (x + 1 < width && rgba[(idx + 1) * 4 + 3] >= 32) {
              const right = idx + 1;
              rBuf[right] += (errR * 7) / 16;
              gBuf[right] += (errG * 7) / 16;
              bBuf[right] += (errB * 7) / 16;
            }
            if (y + 1 < height) {
              if (x > 0 && rgba[((y + 1) * width + (x - 1)) * 4 + 3] >= 32) {
                const bl = (y + 1) * width + (x - 1);
                rBuf[bl] += (errR * 3) / 16;
                gBuf[bl] += (errG * 3) / 16;
                bBuf[bl] += (errB * 3) / 16;
              }
              if (rgba[((y + 1) * width + x) * 4 + 3] >= 32) {
                const bc = (y + 1) * width + x;
                rBuf[bc] += (errR * 5) / 16;
                gBuf[bc] += (errG * 5) / 16;
                bBuf[bc] += (errB * 5) / 16;
              }
              if (x + 1 < width && rgba[((y + 1) * width + (x + 1)) * 4 + 3] >= 32) {
                const br = (y + 1) * width + (x + 1);
                rBuf[br] += (errR * 1) / 16;
                gBuf[br] += (errG * 1) / 16;
                bBuf[br] += (errB * 1) / 16;
              }
            }
          }
        }
        return indices;
      };

      try {
        for (let i = 0; i < totalFrames; i++) {
          if (abortSignalRef?.current) {
            console.log('Turntable GIF export cancelled by user.');
            return;
          }

          const rawProgress = i / totalFrames;
          const progress = easeProgress(rawProgress);
          const angle = initialAngle + dirSign * (progress * Math.PI * 2);

          cam.position.x = target.x + radius * Math.sin(angle);
          cam.position.z = target.z + radius * Math.cos(angle);
          cam.position.y = camY;
          cam.lookAt(target);

          updateLights(cam);
          renderFrame(cam, false);

          scratchCtx.clearRect(0, 0, exportW, exportH);
          scratchCtx.drawImage(canvasRef.current, 0, 0, exportW, exportH);
          const imgData = scratchCtx.getImageData(0, 0, exportW, exportH);

          if (isTranslucent) {
            // High-fidelity quantization: extract only visible model pixels (alpha >= 32)
            // so all 255 palette slots use high-precision RGB565 instead of low-precision rgba4444.
            const rawData = imgData.data;
            const totalPixels = exportW * exportH;
            let visibleCount = 0;
            for (let p = 0; p < totalPixels; p++) {
              if (rawData[p * 4 + 3] >= 32) visibleCount++;
            }

            let modelPal: number[][];
            if (visibleCount > 0) {
              const visibleData = new Uint8Array(visibleCount * 4);
              let vIdx = 0;
              for (let p = 0; p < totalPixels; p++) {
                if (rawData[p * 4 + 3] >= 32) {
                  visibleData[vIdx * 4] = rawData[p * 4];
                  visibleData[vIdx * 4 + 1] = rawData[p * 4 + 1];
                  visibleData[vIdx * 4 + 2] = rawData[p * 4 + 2];
                  visibleData[vIdx * 4 + 3] = 255;
                  vIdx++;
                }
              }
              modelPal = quantize(visibleData, 255, { format: 'rgb565' });
            } else {
              modelPal = quantize(rawData, 255, { format: 'rgb565' });
            }

            const pal: number[][] = [[0, 0, 0], ...modelPal];
            const transparentIndex = 0;

            let indexed: Uint8Array;
            if (options.dithering) {
              indexed = applyDitherWithAlpha(rawData, exportW, exportH, pal, transparentIndex);
            } else {
              indexed = new Uint8Array(totalPixels);
              const cache = new Int16Array(65536).fill(-1);
              for (let idx = 0; idx < totalPixels; idx++) {
                if (rawData[idx * 4 + 3] < 32) {
                  indexed[idx] = transparentIndex;
                } else {
                  const r = rawData[idx * 4];
                  const g = rawData[idx * 4 + 1];
                  const b = rawData[idx * 4 + 2];
                  const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
                  let mIdx = cache[key];
                  if (mIdx === -1) {
                    mIdx = nearestColorIndex(modelPal, [r, g, b]);
                    cache[key] = mIdx;
                  }
                  indexed[idx] = mIdx + 1;
                }
              }
            }

            gif.writeFrame(indexed, exportW, exportH, {
              palette: pal,
              delay: delayMs,
              repeat: repeatVal,
              transparent: true,
              transparentIndex: 0,
              dispose: 2,
            });
          } else {
            const pal = quantize(imgData.data, 256, { format: 'rgb565' });
            let indexed: Uint8Array;
            if (options.dithering) {
              indexed = applyDither(imgData.data, exportW, exportH, pal);
            } else {
              indexed = applyPalette(imgData.data, pal, 'rgb565');
            }
            gif.writeFrame(indexed, exportW, exportH, {
              palette: pal,
              delay: delayMs,
              repeat: repeatVal,
            });
          }

          const pct = Math.round(((i + 1) / totalFrames) * 100);
          onProgress({
            current: i + 1,
            total: totalFrames,
            stage: `Rendering frame ${i + 1} of ${totalFrames}...`,
            percent: pct,
          });

          // Yield to browser event loop
          await new Promise((r) => setTimeout(r, 0));
        }

        onProgress({
          current: totalFrames,
          total: totalFrames,
          stage: 'Finalizing GIF stream...',
          percent: 100,
        });

        gif.finish();
        const bytes = gif.bytes();
        const gifBlob = new Blob([bytes], { type: 'image/gif' });
        onComplete(gifBlob, `${cleanName}_Turnaround.gif`);
      } finally {
        restoreLiveViewAfterExport(origW, origH, cam);
        if (vignetteBgPassRef.current) vignetteBgPassRef.current.enabled = true;
        if (renderPassRef.current) renderPassRef.current.clear = false;
      }
    };

    const captureScreenshot = (): string | null => {
      if (!canvasRef.current || !rendererRef.current || !sceneRef.current || !activeCameraRef.current) {
        return null;
      }
      renderFrame(activeCameraRef.current, false);
      try {
        return canvasRef.current.toDataURL('image/jpeg', 0.85);
      } catch {
        return null;
      }
    };

    useImperativeHandle(ref, () => ({
      recenterView,
      snapView,
      loadModelFromFile,
      loadModelsFromFiles,
      loadDemoModel,
      exportTurnaroundImage,
      exportThreeQuarterViewsImage,
      exportAllSeparateImages,
      exportCustomImageViews,
      exportTurntableVideo,
      exportTurntableGif,
      getViewportAspect: () => {
        const w = containerRef.current?.clientWidth || canvasRef.current?.width || 1280;
        const h = containerRef.current?.clientHeight || canvasRef.current?.height || 720;
        return w / h;
      },
      updateDimension,
      togglePartVisibility,
      deletePart,
      deleteHiddenParts,
      selectPart,
      selectParts,
      clearSelection,
      selectAllVisibleParts,
      unhideAllParts,
      toggleSelectedOrHoveredVisibility,
      toggleIsolateHoveredPart,
      captureScreenshot,
      toggleDimensionMode: () => {
        setDimensionsActive((prev) => {
          const next = !prev;
          dimensionsActiveRef.current = next;
          setOpenRailPanel(next ? 'dimensions' : null);
          rebuildDimensions3D();
          requestRender();
          return next;
        });
      },
      clearDimensions: handleClearAllDimensions,
      separateLooseParts,
    }));

    // Sync external selectedPartIndices / selectedPartIndex into the internal ref/helpers
    useEffect(() => {
      if (selectedPartIndices !== undefined) {
        const cur = selectedPartIndicesRef.current;
        const isSame =
          cur.length === selectedPartIndices.length &&
          cur.every((val, idx) => val === selectedPartIndices[idx]);
        if (!isSame) {
          setSelection(selectedPartIndices, false);
        }
      } else if (selectedPartIndex !== undefined && selectedPartIndex !== selectedPartIndexRef.current) {
        selectPart(selectedPartIndex, false);
      }
    }, [selectedPartIndices, selectedPartIndex]);

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
        stencil: true,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.localClippingEnabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
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

      // Click-to-select outline — outer Box3Helper wrapping the combined bounds of all
      // selected parts (or single part), plus a group for subtle individual wireframes when multi-selecting.
      const selectionBox = new THREE.Box3();
      selectionBoxRef.current = selectionBox;
      const selectionBoxHelper = new THREE.Box3Helper(selectionBox, 0x38bdf8);
      selectionBoxHelper.visible = false;
      if (selectionBoxHelper.material instanceof THREE.Material) {
        selectionBoxHelper.material.depthTest = false;
      }
      scene.add(selectionBoxHelper);
      selectionBoxHelperRef.current = selectionBoxHelper;

      const individualHelpersGroup = new THREE.Group();
      scene.add(individualHelpersGroup);
      individualHelpersGroupRef.current = individualHelpersGroup;

      const selectionBoxDimensionsGroup = new THREE.Group();
      scene.add(selectionBoxDimensionsGroup);
      selectionBoxDimensionsGroupRef.current = selectionBoxDimensionsGroup;

      // Tier 4: Vertex Dimensioning Scene Objects
      const dimensionsGroup = new THREE.Group();
      scene.add(dimensionsGroup);
      dimensionsGroupRef.current = dimensionsGroup;

      const snapMarker = new THREE.Mesh(
        new THREE.SphereGeometry(1, 14, 14),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        })
      );
      snapMarker.visible = false;
      snapMarker.renderOrder = 9999;
      scene.add(snapMarker);
      snapMarkerRef.current = snapMarker;

      const draftStartMarker = new THREE.Mesh(
        new THREE.SphereGeometry(1, 14, 14),
        new THREE.MeshBasicMaterial({
          color: 0x10b981,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        })
      );
      draftStartMarker.visible = false;
      draftStartMarker.renderOrder = 9999;
      scene.add(draftStartMarker);
      draftStartMarkerRef.current = draftStartMarker;

      const draftLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        })
      );
      draftLine.visible = false;
      draftLine.renderOrder = 9998;
      scene.add(draftLine);
      draftLineRef.current = draftLine;

      const handlePointerDown = (event: PointerEvent) => {
        pointerDownPosRef.current = { x: event.clientX, y: event.clientY };
        if (viewHelperRef.current && !isFullscreenRef.current) {
          viewHelperRef.current.handleClick(event);
          requestRender();
        }

        // If dimensioning is active, check if clicking directly on a 3D dimension line/object to drag
        if (dimensionsActiveRef.current && dimensionsGroupRef.current && activeCameraRef.current && event.button === 0) {
          const rect = canvas.getBoundingClientRect();
          const ndc = {
            x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
          };
          const dimRaycaster = new THREE.Raycaster();
          dimRaycaster.params.Line = { threshold: Math.max((modelRadiusRef.current || 10) * 0.025, 0.5) };
          dimRaycaster.setFromCamera(ndc as THREE.Vector2, activeCameraRef.current);
          const dimHits = dimRaycaster.intersectObjects(dimensionsGroupRef.current.children, true);
          const hitObj = dimHits.find((h) => h.object.userData?.dimId);
          if (hitObj && hitObj.object.userData?.dimId) {
            startDraggingDimension(event.clientX, event.clientY, hitObj.object.userData.dimId);
            return;
          }
        }
      };
      canvas.addEventListener('pointerdown', handlePointerDown);

      // Click-to-select & Vertex Dimensioning click:
      const handlePointerUp = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const dx = Math.abs(event.clientX - pointerDownPosRef.current.x);
        const dy = Math.abs(event.clientY - pointerDownPosRef.current.y);
        if (dx > 12 || dy > 12) return;
        if (!activeCameraRef.current || !currentModelRef.current) return;

        // If Vertex Dimensioning mode is active, handle point clicking
        if (dimensionsActiveRef.current) {
          if (hoveredVertexRef.current) {
            if (!dimensionStartVertexRef.current) {
              const start = hoveredVertexRef.current.clone();
              dimensionStartVertexRef.current = start;
              setActiveDraftStart({ x: start.x, y: start.y, z: start.z });
              if (draftStartMarkerRef.current) {
                draftStartMarkerRef.current.position.copy(start);
                const r = modelRadiusRef.current > 0 ? modelRadiusRef.current : 50;
                draftStartMarkerRef.current.scale.setScalar(Math.max(r * 0.016, 0.45));
                draftStartMarkerRef.current.visible = true;
              }
              requestRender();
              return;
            } else {
              const p1 = dimensionStartVertexRef.current;
              const p2 = hoveredVertexRef.current;
              if (p1.distanceTo(p2) > 0.001) {
                const scaleIn = getConversionToInches();
                const distInches = p1.distanceTo(p2) * scaleIn;
                const deltaXInches = Math.abs(p2.x - p1.x) * scaleIn;
                const deltaYInches = Math.abs(p2.y - p1.y) * scaleIn;
                const deltaZInches = Math.abs(p2.z - p1.z) * scaleIn;

                const newDim: DimensionItem = {
                  id: `dim_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  p1: { x: p1.x, y: p1.y, z: p1.z },
                  p2: { x: p2.x, y: p2.y, z: p2.z },
                  distanceInches: distInches,
                  deltaXInches,
                  deltaYInches,
                  deltaZInches,
                };

                const updated = [...dimensionItemsRef.current, newDim];
                dimensionItemsRef.current = updated;
                setDimensionsList(updated);
                recentDimIdRef.current = newDim.id;
                setTimeout(() => {
                  if (recentDimIdRef.current === newDim.id) {
                    recentDimIdRef.current = null;
                    requestRender();
                  }
                }, 4000);
                rebuildDimensions3D();
              }

              dimensionStartVertexRef.current = null;
              setActiveDraftStart(null);
              setCurrentDraftDistance(null);
              if (draftStartMarkerRef.current) draftStartMarkerRef.current.visible = false;
              if (draftLineRef.current) draftLineRef.current.visible = false;
              requestRender();
              return;
            }
          }
          return;
        }

        const rect = canvas.getBoundingClientRect();
        const ndc = {
          x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
        };
        isolateRaycasterRef.current.setFromCamera(ndc as THREE.Vector2, activeCameraRef.current);
        const hits = isolateRaycasterRef.current.intersectObjects([currentModelRef.current], true);
        const hit = hits.find((h) => h.object.visible);

        const isAdditive = event.shiftKey || event.metaKey || event.ctrlKey;

        if (hit) {
          const matchedIdx = getPartIndexFromObject(hit.object);
          if (matchedIdx !== null) {
            if (isAdditive) {
              togglePartInSelection(matchedIdx);
            } else {
              if (
                selectedPartIndicesRef.current.length === 1 &&
                selectedPartIndicesRef.current[0] === matchedIdx
              ) {
                selectPart(null);
              } else {
                selectPart(matchedIdx);
              }
            }
          } else if (!isAdditive) {
            selectPart(null);
          }
        } else if (!isAdditive) {
          selectPart(null);
        }
      };
      canvas.addEventListener('pointerup', handlePointerUp);

      // Continuous hover tracking (part hover tooltip and vertex snapping)
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
        const hits = isolateRaycasterRef.current.intersectObjects([currentModelRef.current], true);
        const hit = hits.find((h) => h.object.visible);

        if (dimensionsActiveRef.current) {
          if (hoveredPartIndexRef.current !== null) setHoveredPart(null);

          if (hit) {
            const nearestV = getNearestVertexFromHit(hit);
            if (nearestV) {
              hoveredVertexRef.current = nearestV;
              if (snapMarkerRef.current) {
                snapMarkerRef.current.position.copy(nearestV);
                const r = modelRadiusRef.current > 0 ? modelRadiusRef.current : 50;
                snapMarkerRef.current.scale.setScalar(Math.max(r * 0.015, 0.4));
                snapMarkerRef.current.visible = true;
              }

              if (dimensionStartVertexRef.current) {
                const p1 = dimensionStartVertexRef.current;
                const p2 = nearestV;
                if (draftLineRef.current) {
                  draftLineRef.current.geometry.setFromPoints([p1, p2]);
                  draftLineRef.current.visible = true;
                }
                const scaleIn = getConversionToInches();
                const distIn = p1.distanceTo(p2) * scaleIn;
                setCurrentDraftDistance(distIn);
              }

              setHoveredCursorPos({ x: event.clientX, y: event.clientY });
              requestRender();
              return;
            }
          }

          hoveredVertexRef.current = null;
          if (snapMarkerRef.current) snapMarkerRef.current.visible = false;
          if (dimensionStartVertexRef.current && draftLineRef.current) {
            draftLineRef.current.visible = false;
            setCurrentDraftDistance(null);
          }
          setHoveredCursorPos(null);
          requestRender();
          return;
        }

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

      const handlePointerLeave = () => {
        setHoveredPart(null);
        if (hoveredVertexRef.current) {
          hoveredVertexRef.current = null;
          if (snapMarkerRef.current) snapMarkerRef.current.visible = false;
          if (dimensionStartVertexRef.current && draftLineRef.current) {
            draftLineRef.current.visible = false;
            setCurrentDraftDistance(null);
          }
          setHoveredCursorPos(null);
          requestRender();
        }
      };
      canvas.addEventListener('pointerleave', handlePointerLeave);

      const handleContextMenu = (e: MouseEvent) => {
        if (dimensionStartVertexRef.current) {
          e.preventDefault();
          dimensionStartVertexRef.current = null;
          setActiveDraftStart(null);
          setCurrentDraftDistance(null);
          if (draftStartMarkerRef.current) draftStartMarkerRef.current.visible = false;
          if (draftLineRef.current) draftLineRef.current.visible = false;
          requestRender();
        }
      };
      canvas.addEventListener('contextmenu', handleContextMenu);

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
      const dpr = Math.min(window.devicePixelRatio, 2);
      const composerTarget = new THREE.WebGLRenderTarget(
        container.clientWidth * dpr,
        container.clientHeight * dpr,
        { type: THREE.HalfFloatType, stencilBuffer: true }
      );
      const composer = new EffectComposer(renderer, composerTarget);
      composer.setPixelRatio(dpr);
      composer.setSize(container.clientWidth, container.clientHeight);

      const vignetteBgPass = new VignetteBackgroundPass(vignetteMaterial);
      vignetteBgPassRef.current = vignetteBgPass;
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

      const ssrPass = new CustomSSRPass({
        renderer,
        scene,
        camera: activeCamera,
        width: container.clientWidth,
        height: container.clientHeight,
        selects: null,
        bouncing: false,
        groundReflector: null,
      });
      ssrPass.enabled = settings.ssrQuality !== 'off';
      composer.addPass(ssrPass);
      ssrPassRef.current = ssrPass;

      const fxaaPass = new ShaderPass(FXAAShader);
      fxaaPass.enabled = settings.antialiasMode === 'fxaa';
      composer.addPass(fxaaPass);
      fxaaPassRef.current = fxaaPass;

      const smaaPass = new SMAAPass();
      smaaPass.setSize(
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
        if (ssrPassRef.current) ssrPassRef.current.setSize(w, h);
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
        canvas.removeEventListener('contextmenu', handleContextMenu);
        window.removeEventListener('pointermove', handleGlobalDimensionPointerMove);
        window.removeEventListener('pointerup', handleGlobalDimensionPointerUp);
        cleanupScene();
        vignetteBgPassRef.current?.dispose();
        aoPassRef.current?.dispose();
        ssrPassRef.current?.dispose();
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
      settings.draftPullDirection,
      settings.draftSafeAngleDeg,
      settings.draftWarningAngleDeg,
    ]);

    // Real-time live update for Draft Angle Analysis LookDev:
    // Ensures immediate recoloring upon changing pull direction axis or angle thresholds
    // without requiring leaving and re-entering LookDev mode.
    useEffect(() => {
      if (draftMaterialRef.current) {
        const pullVec = getPullDirectionVector(settings.draftPullDirection || '+Y');
        draftMaterialRef.current.uniforms.uPullDir.value.copy(pullVec);
        draftMaterialRef.current.uniforms.uSafeAngle.value = settings.draftSafeAngleDeg ?? 3.0;
        draftMaterialRef.current.uniforms.uWarningAngle.value = settings.draftWarningAngleDeg ?? 1.0;
      }
      if (settings.material === 'draft') {
        applyMaterialAndShadows();
        requestRender();
      }
    }, [
      settings.draftPullDirection,
      settings.draftSafeAngleDeg,
      settings.draftWarningAngleDeg,
      settings.material,
    ]);

    // Real-time live update for Center of Mass & Balance Check LookDev:
    // Calculates or clears balance visuals whenever balance mode is toggled
    // or when model dimensions/transforms/rotations change.
    useEffect(() => {
      if (settings.material === 'balance') {
        updateBalanceVisuals();
      } else if (balanceGroupRef.current && sceneRef.current) {
        sceneRef.current.remove(balanceGroupRef.current);
        disposeHierarchy(balanceGroupRef.current);
        balanceGroupRef.current = null;
        setBalanceAnalysis(null);
        balanceAnalysisRef.current = null;
        requestRender();
      }
    }, [
      settings.material,
      dimensions.scaleFactor,
      dimensions.rotX,
      dimensions.rotY,
      dimensions.rotZ,
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
      settings.clipping.solidCaps,
      settings.clipping.capOpacity,
      settings.clipping.capColor,
      settings.clipping.capHatching,
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

    // Post-processing (SSAO / SSR / antialiasing)
    useEffect(() => {
      syncPostProcessing();
      requestRender();
    }, [settings.ssaoEnabled, settings.ssaoRadius, settings.ssaoIntensity, settings.ssaoBias, settings.antialiasMode, settings.ssrQuality]);

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
        new HDRLoader().load(objectUrl, onTextureReady, undefined, (err) => {
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

    const formatDim = (inches: number) => {
      if (dimensionUnit === 'mm') {
        return `${(inches * 25.4).toFixed(2)} mm`;
      }
      return `${inches.toFixed(3)}"`;
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
        <canvas
          ref={canvasRef}
          id="canvas3d"
          className={`absolute inset-0 w-full h-full block ${dimensionsActive ? 'cursor-crosshair' : ''}`}
        />

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

            {/* Vertex Dimensioning */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  const next = !dimensionsActive;
                  setDimensionsActive(next);
                  dimensionsActiveRef.current = next;
                  setOpenRailPanel(next ? 'dimensions' : null);
                  rebuildDimensions3D();
                  requestRender();
                }}
                className={railBtnClass(dimensionsActive)}
                title={dimensionsActive ? 'Dimensions: Active (click to exit) — M' : 'Dimensions: Off (click to measure) — M'}
              >
                <Ruler className="w-4 h-4" />
              </button>
              {openRailPanel === 'dimensions' && dimensionsActive && (
                <div className={railPanelClass}>
                  {railPanelHeader('Dimensions')}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Unit</span>
                    <div className="flex items-center gap-1 bg-[#1e293b] p-0.5 rounded border border-slate-700">
                      <button
                        onClick={() => setDimensionUnit('in')}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          dimensionUnit === 'in' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Inches
                      </button>
                      <button
                        onClick={() => setDimensionUnit('mm')}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          dimensionUnit === 'mm' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        mm
                      </button>
                    </div>
                  </div>
                  <label className="flex items-center justify-between cursor-pointer text-xs">
                    <span className="text-slate-400">Show ΔX, ΔY, ΔZ</span>
                    <input
                      type="checkbox"
                      checked={showDimensionDeltas}
                      onChange={(e) => setShowDimensionDeltas(e.target.checked)}
                      className="accent-sky-500 rounded cursor-pointer"
                    />
                  </label>
                  <div className="text-[11px] text-slate-400 leading-snug bg-slate-900/60 p-2 rounded border border-slate-700/60">
                    Click two vertices to measure. Drag any dimension string or line to pull extension lines in the orthogonal normal directions (e.g. up/down Y or front/back Z for X-axis lines).
                  </div>

                  {dimensionsList.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-700/60">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
                        <span>Measurements ({dimensionsList.length})</span>
                        <button
                          onClick={handleClearAllDimensions}
                          className="text-rose-400 hover:text-rose-300 text-[10px] cursor-pointer"
                        >
                          Clear All
                        </button>
                      </div>
                      <div className="max-h-36 overflow-y-auto flex flex-col gap-1 pr-0.5">
                        {dimensionsList.map((dim, idx) => (
                          <div
                            key={dim.id}
                            className="flex items-center justify-between bg-[#1e293b] px-2 py-1 rounded text-xs border border-slate-700/70"
                          >
                            <span className="font-mono text-sky-400 font-bold">
                              #{idx + 1}: {formatDim(dim.distanceInches)}
                            </span>
                            <button
                              onClick={() => handleDeleteDimension(dim.id)}
                              className="text-slate-400 hover:text-rose-400 p-0.5 cursor-pointer"
                              title="Delete measurement"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                    <option value="draft">Draft Angle Analysis (Tooling)</option>
                    <option value="balance">Center of Mass &amp; Balance Check</option>
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
                          <ThicknessInput
                            value={settings.minThicknessInches}
                            onChange={(val) => onUpdateSettings({ minThicknessInches: val })}
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

                  {settings.material === 'draft' && (
                    <div className="flex flex-col gap-2.5 p-2.5 rounded-md border bg-slate-900/60 border-slate-700/70 text-slate-200">
                      {/* Pull Direction (Molding Axis) Picker */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                          <span>Pull Direction (Molding Axis)</span>
                          <span className="font-mono text-xs text-sky-400 font-bold">{settings.draftPullDirection}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { id: '+Y', label: '+Y Top' },
                            { id: '-Y', label: '-Y Bottom' },
                            { id: '+Z', label: '+Z Front' },
                            { id: '-Z', label: '-Z Back' },
                            { id: '+X', label: '+X Right' },
                            { id: '-X', label: '-X Left' },
                          ].map((axis) => {
                            const isSelected = settings.draftPullDirection === axis.id;
                            return (
                              <button
                                key={axis.id}
                                type="button"
                                onClick={() => onUpdateSettings({ draftPullDirection: axis.id as PullDirection })}
                                className={`py-1 px-2 rounded text-[11px] font-medium transition-all text-center flex items-center justify-center gap-1 cursor-pointer border ${
                                  isSelected
                                    ? 'bg-sky-500 border-sky-400 text-white font-bold shadow-xs shadow-sky-500/40 ring-1 ring-sky-400/50'
                                    : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'
                                }`}
                              >
                                <span>{axis.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Safe Draft Angle Slider */}
                      <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-700/60">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shadow-xs shadow-emerald-500/50" />
                            Safe Draft Angle
                          </span>
                          <span className="font-mono text-xs text-emerald-400 font-semibold">{settings.draftSafeAngleDeg.toFixed(1)}°</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="10.0"
                          step="0.5"
                          value={settings.draftSafeAngleDeg}
                          onChange={(e) => onUpdateSettings({ draftSafeAngleDeg: Number(e.target.value) })}
                          className="w-full accent-emerald-500 cursor-pointer"
                        />
                        <div className="flex justify-between text-[9px] text-slate-500 px-0.5">
                          <span>0.5°</span>
                          <span>3.0°</span>
                          <span>5.0°</span>
                          <span>10.0°</span>
                        </div>
                      </div>

                      {/* Warning Threshold Slider */}
                      <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-700/60">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-amber-400 font-medium flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block shadow-xs shadow-amber-500/50" />
                            Warning Threshold
                          </span>
                          <span className="font-mono text-xs text-amber-400 font-semibold">{settings.draftWarningAngleDeg.toFixed(1)}°</span>
                        </div>
                        <input
                          type="range"
                          min="0.0"
                          max="5.0"
                          step="0.5"
                          value={settings.draftWarningAngleDeg}
                          onChange={(e) => onUpdateSettings({ draftWarningAngleDeg: Number(e.target.value) })}
                          className="w-full accent-amber-500 cursor-pointer"
                        />
                        <div className="flex justify-between text-[9px] text-slate-500 px-0.5">
                          <span>0.0°</span>
                          <span>1.0°</span>
                          <span>2.5°</span>
                          <span>5.0°</span>
                        </div>
                      </div>

                      {/* Explicit Color-Coded Legend */}
                      <div className="flex flex-col gap-1.5 p-2 rounded bg-slate-950/60 border border-slate-800 text-[10px] text-slate-300">
                        <div className="text-[9px] font-bold tracking-wider uppercase text-slate-400 mb-0.5">
                          Demold Classification Legend
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" />
                          <span className="font-semibold text-emerald-400">Green:</span>
                          <span className="text-slate-300">Positive Draft / Safe demold (≥ {settings.draftSafeAngleDeg.toFixed(1)}°)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" />
                          <span className="font-semibold text-amber-400">Yellow/Amber:</span>
                          <span className="text-slate-300">Low Draft / Drag risk ({settings.draftWarningAngleDeg.toFixed(1)}° - {settings.draftSafeAngleDeg.toFixed(1)}°)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-red-500 shrink-0" />
                          <span className="font-semibold text-red-400">Red/Magenta:</span>
                          <span className="text-slate-300">Negative Draft / Undercut & die lock (&lt; {settings.draftWarningAngleDeg.toFixed(1)}°)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {settings.material === 'balance' && (
                    <div className="flex flex-col gap-2.5 p-3 rounded-xl border bg-slate-900/90 border-slate-700/80 shadow-inner text-slate-200 text-xs">
                      {balanceAnalysis ? (
                        <>
                          {/* High-Contrast Balance Indicator */}
                          <div
                            className={`flex items-center justify-between p-2 rounded-lg border font-semibold ${
                              balanceAnalysis.isStable
                                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                                : 'bg-red-950/40 border-red-500/40 text-red-300'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {balanceAnalysis.isStable ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 animate-pulse" />
                              )}
                              <span>
                                {balanceAnalysis.isStable
                                  ? 'Self-Standing (Stable)'
                                  : balanceAnalysis.tippingZDirection && balanceAnalysis.tippingZDirection !== 'none'
                                  ? `Tipping Risk: Pitch (${balanceAnalysis.tippingZDirection === 'forward' ? '+Z Fwd' : '-Z Back'})`
                                  : balanceAnalysis.tippingXDirection && balanceAnalysis.tippingXDirection !== 'none'
                                  ? `Tipping Risk: Roll (${balanceAnalysis.tippingXDirection === 'right' ? '+X Right' : '-X Left'})`
                                  : 'Tipping Risk (Unstable)'}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40">
                              {balanceAnalysis.isStable ? 'BALANCED' : 'TIPPING'}
                            </span>
                          </div>

                          {/* Limiting Axis Callout */}
                          {balanceAnalysis.limitingAxis && balanceAnalysis.limitingAxis !== 'Balanced' && (
                            <div
                              className={`flex items-start gap-2 p-2 rounded-lg border text-[11px] leading-tight ${
                                balanceAnalysis.limitingAxis === 'Z (Pitch)'
                                  ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                                  : balanceAnalysis.limitingAxis === 'X (Roll)'
                                  ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                                  : 'bg-red-950/30 border-red-500/40 text-red-200'
                              }`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                              <div className="flex flex-col gap-0.5">
                                <span className="font-semibold">
                                  {balanceAnalysis.limitingAxis === 'Z (Pitch)'
                                    ? 'Z-Axis (Pitch) is the Limiting Axis'
                                    : balanceAnalysis.limitingAxis === 'X (Roll)'
                                    ? 'X-Axis (Roll) is the Limiting Axis'
                                    : 'Center of Mass is Outside Base'}
                                </span>
                                <span className="text-slate-300 text-[10px]">
                                  {balanceAnalysis.limitingAxis === 'Z (Pitch)'
                                    ? `Tipping occurs at ${balanceAnalysis.criticalPitchAngleDeg.toFixed(1)}° pitch vs ${balanceAnalysis.criticalRollAngleDeg.toFixed(1)}° roll.`
                                    : balanceAnalysis.limitingAxis === 'X (Roll)'
                                    ? `Tipping occurs at ${balanceAnalysis.criticalRollAngleDeg.toFixed(1)}° roll vs ${balanceAnalysis.criticalPitchAngleDeg.toFixed(1)}° pitch.`
                                    : 'Model will tip over under its own weight.'}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Directional Stability Breakdown Cards */}
                          <div className="flex flex-col gap-1.5 pt-1">
                            {/* Z-Axis (Pitch / Forward-Backward) */}
                            <div
                              className={`p-2 rounded-lg border flex flex-col gap-1 text-[11px] ${
                                balanceAnalysis.limitingAxis === 'Z (Pitch)'
                                  ? 'bg-slate-800/80 border-amber-500/50'
                                  : 'bg-slate-800/40 border-slate-700/60'
                              }`}
                            >
                              <div className="flex items-center justify-between font-semibold">
                                <span className="flex items-center gap-1.5 text-sky-300">
                                  <span className={`w-2 h-2 rounded-full ${balanceAnalysis.limitingAxis === 'Z (Pitch)' ? 'bg-amber-400' : 'bg-sky-400'}`} />
                                  Pitch / Tipping (Z-Axis)
                                </span>
                                <span
                                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                                    !balanceAnalysis.isZStable
                                      ? 'bg-red-500/20 text-red-300'
                                      : balanceAnalysis.limitingAxis === 'Z (Pitch)'
                                      ? 'bg-amber-500/20 text-amber-300 font-bold'
                                      : 'bg-emerald-500/20 text-emerald-300'
                                  }`}
                                >
                                  {!balanceAnalysis.isZStable ? 'UNSTABLE' : `Max Tilt: ±${balanceAnalysis.criticalPitchAngleDeg.toFixed(1)}°`}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-300 pt-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-400">Front (+Z):</span>
                                  <span className={`font-mono ${balanceAnalysis.marginZFrontInches > 0 ? 'text-slate-200' : 'text-red-400 font-bold'}`}>
                                    {balanceAnalysis.marginZFrontInches >= 0 ? '+' : ''}
                                    {balanceAnalysis.marginZFrontInches.toFixed(3)}&quot;
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-400">Back (-Z):</span>
                                  <span className={`font-mono ${balanceAnalysis.marginZBackInches > 0 ? 'text-slate-200' : 'text-red-400 font-bold'}`}>
                                    {balanceAnalysis.marginZBackInches >= 0 ? '+' : ''}
                                    {balanceAnalysis.marginZBackInches.toFixed(3)}&quot;
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* X-Axis (Roll / Left-Right) */}
                            <div
                              className={`p-2 rounded-lg border flex flex-col gap-1 text-[11px] ${
                                balanceAnalysis.limitingAxis === 'X (Roll)'
                                  ? 'bg-slate-800/80 border-amber-500/50'
                                  : 'bg-slate-800/40 border-slate-700/60'
                              }`}
                            >
                              <div className="flex items-center justify-between font-semibold">
                                <span className="flex items-center gap-1.5 text-slate-200">
                                  <span className={`w-2 h-2 rounded-full ${balanceAnalysis.limitingAxis === 'X (Roll)' ? 'bg-amber-400' : 'bg-slate-400'}`} />
                                  Roll / Tipping (X-Axis)
                                </span>
                                <span
                                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                                    !balanceAnalysis.isXStable
                                      ? 'bg-red-500/20 text-red-300'
                                      : balanceAnalysis.limitingAxis === 'X (Roll)'
                                      ? 'bg-amber-500/20 text-amber-300 font-bold'
                                      : 'bg-emerald-500/20 text-emerald-300'
                                  }`}
                                >
                                  {!balanceAnalysis.isXStable ? 'UNSTABLE' : `Max Tilt: ±${balanceAnalysis.criticalRollAngleDeg.toFixed(1)}°`}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-300 pt-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-400">Left (-X):</span>
                                  <span className={`font-mono ${balanceAnalysis.marginXLeftInches > 0 ? 'text-slate-200' : 'text-red-400 font-bold'}`}>
                                    {balanceAnalysis.marginXLeftInches >= 0 ? '+' : ''}
                                    {balanceAnalysis.marginXLeftInches.toFixed(3)}&quot;
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-400">Right (+X):</span>
                                  <span className={`font-mono ${balanceAnalysis.marginXRightInches > 0 ? 'text-slate-200' : 'text-red-400 font-bold'}`}>
                                    {balanceAnalysis.marginXRightInches >= 0 ? '+' : ''}
                                    {balanceAnalysis.marginXRightInches.toFixed(3)}&quot;
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Stats Table */}
                          <div className="flex flex-col gap-1.5 pt-1 text-[11px] border-t border-slate-700/50">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Min Stability Margin:</span>
                              <span
                                className={`font-mono font-medium ${
                                  balanceAnalysis.isStable ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {balanceAnalysis.stabilityMarginInches >= 0 ? '+' : ''}
                                {balanceAnalysis.stabilityMarginInches.toFixed(3)}&quot; ({balanceAnalysis.stabilityMarginMm.toFixed(1)} mm)
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Center of Mass Height:</span>
                              <span className="font-mono text-sky-400">
                                {balanceAnalysis.cmHeightInches.toFixed(3)}&quot; ({balanceAnalysis.cmHeightMm.toFixed(1)} mm)
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Base Contact Points:</span>
                              <span className="font-mono text-slate-300">
                                {balanceAnalysis.contactPointCount} vertices
                              </span>
                            </div>
                            {balanceAnalysis.volumeCm3 > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Model Solid Volume:</span>
                                <span className="font-mono text-slate-300">
                                  {balanceAnalysis.volumeCm3.toFixed(2)} cm³
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Visual Legend */}
                          <div className="flex flex-col gap-1 pt-2 border-t border-slate-700/60 text-[10px] leading-relaxed text-slate-400">
                            <span className="font-semibold text-slate-300 mb-0.5">3D Visual Elements:</span>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shrink-0" />
                              <span className="text-slate-300">CM Gimbal Sphere &amp; Rings</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2.5 h-2.5 rounded-xs shrink-0 ${
                                  balanceAnalysis.isStable ? 'bg-emerald-500' : 'bg-red-500'
                                }`}
                              />
                              <span className="text-slate-300">Gravity Plumb Line &amp; Ground Target</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 shrink-0" />
                              <span className="text-slate-300">Z &amp; X Axis Tipping Crosshairs (Amber = Limiting)</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2.5 h-2.5 rounded-xs shrink-0 ${
                                  balanceAnalysis.isStable ? 'bg-emerald-500/50' : 'bg-red-500/50'
                                }`}
                              />
                              <span className="text-slate-300">Convex Hull Base Footprint</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-xs bg-slate-700 shrink-0" />
                              <span className="text-slate-300">Exclusive Ground Pedestal</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-slate-400 py-1">
                          <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                          <span>Analyzing mass distribution &amp; footprint...</span>
                        </div>
                      )}
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

                  {/* Cross-Section Stencil Solid Caps */}
                  <div className="border-t border-slate-700/80 my-1 pt-2 flex flex-col gap-2">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs font-semibold text-slate-200">Solid Cut Caps</span>
                      <input
                        type="checkbox"
                        checked={settings.clipping.solidCaps !== false}
                        onChange={(e) =>
                          onUpdateSettings({
                            clipping: { ...settings.clipping, solidCaps: e.target.checked },
                          })
                        }
                        className="accent-rose-500 w-4 h-4 cursor-pointer"
                        title="Enable solid manifold cross-section cut capping"
                      />
                    </label>

                    {settings.clipping.solidCaps !== false && (
                      <div className="flex flex-col gap-2 pl-2 border-l-2 border-rose-500/50">
                        {/* Cap Color & Presets */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>Cap Color</span>
                            <span className="font-mono text-slate-300">{settings.clipping.capColor || '#e11d48'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={settings.clipping.capColor || '#e11d48'}
                              onChange={(e) =>
                                onUpdateSettings({
                                  clipping: { ...settings.clipping, capColor: e.target.value },
                                })
                              }
                              className="w-6 h-6 rounded border border-slate-600 bg-transparent cursor-pointer p-0"
                              title="Custom cap color"
                            />
                            <div className="flex items-center gap-1 flex-1">
                              {[
                                { name: 'Rose', hex: '#e11d48' },
                                { name: 'Sky', hex: '#0284c7' },
                                { name: 'Amber', hex: '#d97706' },
                                { name: 'Emerald', hex: '#059669' },
                                { name: 'Slate', hex: '#475569' },
                                { name: 'Dark', hex: '#18181b' },
                              ].map((preset) => (
                                <button
                                  key={preset.hex}
                                  type="button"
                                  onClick={() =>
                                    onUpdateSettings({
                                      clipping: { ...settings.clipping, capColor: preset.hex },
                                    })
                                  }
                                  className={`w-4 h-4 rounded-full border transition-transform ${
                                    (settings.clipping.capColor || '#e11d48').toLowerCase() === preset.hex.toLowerCase()
                                      ? 'ring-2 ring-white scale-110 border-white'
                                      : 'border-slate-600 hover:scale-105'
                                  }`}
                                  style={{ backgroundColor: preset.hex }}
                                  title={preset.name}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Cap Opacity */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>Cap Opacity</span>
                            <span className="font-mono text-slate-300">
                              {Math.round((settings.clipping.capOpacity ?? 1) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="100"
                            step="5"
                            value={Math.round((settings.clipping.capOpacity ?? 1) * 100)}
                            onChange={(e) =>
                              onUpdateSettings({
                                clipping: {
                                  ...settings.clipping,
                                  capOpacity: Number(e.target.value) / 100,
                                },
                              })
                            }
                            className="w-full accent-rose-500 cursor-pointer"
                            title="Cross-section surface opacity"
                          />
                        </div>

                        {/* CAD Hatch Pattern */}
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="text-[11px] text-slate-300">CAD Hatch Pattern</span>
                          <input
                            type="checkbox"
                            checked={!!settings.clipping.capHatching}
                            onChange={(e) =>
                              onUpdateSettings({
                                clipping: { ...settings.clipping, capHatching: e.target.checked },
                              })
                            }
                            className="accent-rose-500 w-3.5 h-3.5 cursor-pointer"
                            title="Diagonal engineering cross-hatch texture on cut face"
                          />
                        </label>
                      </div>
                    )}
                  </div>
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

            {/* Post-Processing: SSAO + Anti-aliasing + Screen Space Reflections */}
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => setOpenRailPanel(openRailPanel === 'post' ? null : 'post')}
                className={railBtnClass(
                  settings.ssaoEnabled ||
                  settings.antialiasMode !== 'none' ||
                  (settings.ssrQuality && settings.ssrQuality !== 'off') ||
                  openRailPanel === 'post'
                )}
                title="Post-Processing (AO, Reflections, Anti-aliasing)"
              >
                <Wand2 className="w-4 h-4" />
              </button>
              {openRailPanel === 'post' && (
                <div className={railPanelClass}>
                  {railPanelHeader('Post-Processing')}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Ambient Occlusion</span>
                    <input
                      type="checkbox"
                      id="ssaoToggle"
                      checked={settings.ssaoEnabled}
                      onChange={(e) => onUpdateSettings({ ssaoEnabled: e.target.checked })}
                      className="w-3.5 h-3.5 accent-sky-500 cursor-pointer"
                    />
                  </div>
                  {settings.ssaoEnabled && (
                    <>
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
                    </>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-700/60">
                    <span className="text-slate-300">Anti-aliasing</span>
                    <select
                      id="antialiasSelect"
                      value={settings.antialiasMode}
                      onChange={(e) => onUpdateSettings({ antialiasMode: e.target.value as any })}
                      className="py-1 px-2 rounded-md border text-xs outline-hidden bg-[#1e293b] border-slate-600 text-white cursor-pointer"
                    >
                      <option value="none">Off</option>
                      <option value="fxaa">FXAA (fast)</option>
                      <option value="smaa">SMAA (higher quality)</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-700/60">
                    <span className="text-slate-300" title="Screen Space Reflections">Reflections (SSR)</span>
                    <select
                      id="ssrQualitySelect"
                      value={settings.ssrQuality || 'off'}
                      onChange={(e) => onUpdateSettings({ ssrQuality: e.target.value as SSRQuality })}
                      className="py-1 px-2 rounded-md border text-xs outline-hidden bg-[#1e293b] border-slate-600 text-white cursor-pointer"
                    >
                      <option value="off">Off</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
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

        {/* Draft Angle Mode HUD */}
        {settings.material === 'draft' && loadedFileName && (
          <div
            id="draftModeHud"
            className="absolute top-4 left-4 z-10 flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-xl backdrop-blur-md text-xs pointer-events-none select-none"
          >
            <div className="flex items-center gap-1.5 font-semibold text-sky-400">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span>Molding Axis: {settings.draftPullDirection}</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 font-bold text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Safe (≥ {settings.draftSafeAngleDeg.toFixed(1)}°)
              </span>
              <span className="flex items-center gap-1.5 font-bold text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                Low Draft (≥ {settings.draftWarningAngleDeg.toFixed(1)}°)
              </span>
              <span className="flex items-center gap-1.5 font-bold text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse" />
                Undercut (&lt; {settings.draftWarningAngleDeg.toFixed(1)}°)
              </span>
            </div>
          </div>
        )}

        {/* Center of Mass & Balance Mode HUD */}
        {settings.material === 'balance' && loadedFileName && balanceAnalysis && (
          <div
            id="balanceModeHud"
            className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-xl backdrop-blur-md text-xs pointer-events-none select-none"
          >
            <div className="flex items-center gap-2 font-semibold">
              {balanceAnalysis.isStable ? (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" />
                  Self-Standing
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-red-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-xs shadow-red-500/50" />
                  Tipping Risk:{' '}
                  {balanceAnalysis.tippingZDirection && balanceAnalysis.tippingZDirection !== 'none'
                    ? `Pitch (${balanceAnalysis.tippingZDirection === 'forward' ? '+Z Fwd' : '-Z Back'})`
                    : balanceAnalysis.tippingXDirection && balanceAnalysis.tippingXDirection !== 'none'
                    ? `Roll (${balanceAnalysis.tippingXDirection === 'right' ? '+X Right' : '-X Left'})`
                    : 'Off-Base'}
                </span>
              )}
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-slate-300">
                Pitch (Z):{' '}
                <span
                  className={`font-mono font-medium ${
                    !balanceAnalysis.isZStable
                      ? 'text-red-400 font-bold'
                      : balanceAnalysis.limitingAxis === 'Z (Pitch)'
                      ? 'text-amber-400 font-bold'
                      : 'text-sky-300'
                  }`}
                >
                  {balanceAnalysis.marginZOverallInches >= 0 ? '+' : ''}
                  {balanceAnalysis.marginZOverallInches.toFixed(3)}&quot; (±{balanceAnalysis.criticalPitchAngleDeg.toFixed(1)}°)
                </span>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">
                Roll (X):{' '}
                <span
                  className={`font-mono font-medium ${
                    !balanceAnalysis.isXStable
                      ? 'text-red-400 font-bold'
                      : balanceAnalysis.limitingAxis === 'X (Roll)'
                      ? 'text-amber-400 font-bold'
                      : 'text-slate-200'
                  }`}
                >
                  {balanceAnalysis.marginXOverallInches >= 0 ? '+' : ''}
                  {balanceAnalysis.marginXOverallInches.toFixed(3)}&quot; (±{balanceAnalysis.criticalRollAngleDeg.toFixed(1)}°)
                </span>
              </span>
              {balanceAnalysis.limitingAxis && balanceAnalysis.limitingAxis !== 'Balanced' && balanceAnalysis.limitingAxis !== 'Unstable' && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium text-[10px] border border-amber-500/30">
                    Limiting: {balanceAnalysis.limitingAxis}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* STL Auto-Split Notification Toast */}
        {stlSplitNotification && (
          <div
            id="stlSplitNotificationToast"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-emerald-500/60 shadow-2xl shadow-emerald-950/40 backdrop-blur-md text-xs text-slate-200 pointer-events-auto select-none"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <Boxes className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex flex-col pr-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">
                  {stlSplitNotification.count > 1
                    ? `Separated into ${stlSplitNotification.count} Meshes`
                    : 'Single Continuous Solid'}
                </span>
                {stlSplitNotification.count > 1 && (
                  <span className="font-mono text-[10px] text-emerald-400 font-semibold px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20">
                    {stlSplitNotification.count} parts
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400">
                {stlSplitNotification.message || (
                  <>
                    Disconnected solid shells detected in <span className="text-slate-300 font-mono">{stlSplitNotification.fileName}</span> and split for individual selection, isolation, and exploded view.
                  </>
                )}
              </span>
            </div>
            <button
              onClick={() => setStlSplitNotification(null)}
              className="ml-2 text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              title="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Selected Part Bounding Box HUD */}
        {selectedPartInfo && (
          <div
            id="selectedPartHud"
            className={`absolute ${
              (settings.material === 'thickness' || settings.material === 'draft' || settings.material === 'balance') && loadedFileName ? 'top-16' : 'top-4'
            } left-4 z-20 flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-sky-500/60 shadow-xl backdrop-blur-md text-xs pointer-events-auto select-none`}
          >
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-sky-400 shrink-0" />
              <span
                className="font-semibold text-white truncate max-w-[150px] sm:max-w-[220px]"
                title={selectedPartInfo.names ? selectedPartInfo.names.join(', ') : selectedPartInfo.name}
              >
                {selectedPartInfo.count > 1 ? `${selectedPartInfo.count} Meshes Selected` : selectedPartInfo.name}
              </span>
              {selectedPartInfo.count > 1 && (
                <span
                  className="text-[10px] text-sky-300/80 font-mono hidden xl:inline truncate max-w-[160px]"
                  title={selectedPartInfo.names.join(', ')}
                >
                  ({selectedPartInfo.names.join(', ')})
                </span>
              )}
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-2 font-mono text-sky-300">
              <span className="text-slate-400 font-sans font-medium text-[11px]">
                {selectedPartInfo.count > 1 ? 'Combined Box:' : 'Bounding Box:'}
              </span>
              <span>X {selectedPartInfo.wIn.toFixed(3)}&quot;</span>
              <span className="text-slate-500">×</span>
              <span>Y {selectedPartInfo.hIn.toFixed(3)}&quot;</span>
              <span className="text-slate-500">×</span>
              <span>Z {selectedPartInfo.dIn.toFixed(3)}&quot;</span>
              <span className="text-slate-400 text-[10px] hidden md:inline">
                ({selectedPartInfo.wMm.toFixed(1)} × {selectedPartInfo.hMm.toFixed(1)} × {selectedPartInfo.dMm.toFixed(1)} mm)
              </span>
            </div>
            <button
              onClick={() => clearSelection()}
              className="ml-1 p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Deselect (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
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

        {/* Dimension Tool Active Banner */}
        {dimensionsActive && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-slate-900/90 text-white text-xs border border-sky-500/50 shadow-lg backdrop-blur-sm pointer-events-auto">
            <Ruler className="w-4 h-4 text-sky-400" />
            <span>
              {activeDraftStart
                ? 'Click second vertex to complete measurement (Right-click cancels)'
                : draggingDimensionInfo
                ? `Pulling extension line along ${draggingDimensionInfo.axisLabel} — release to place`
                : 'Click any vertex to measure. Drag dimension string to pull extension lines.'}
            </span>
            <button
              onClick={() => {
                setDimensionsActive(false);
                dimensionsActiveRef.current = false;
                setOpenRailPanel(null);
                rebuildDimensions3D();
                requestRender();
              }}
              className="ml-1 p-0.5 rounded text-slate-400 hover:text-white cursor-pointer"
              title="Exit dimensioning (M)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Live Drafting Cursor Tooltip */}
        {dimensionsActive && hoveredCursorPos && currentDraftDistance !== null && (
          <div
            className="fixed z-40 px-2 py-1 rounded bg-slate-900/95 text-sky-400 text-xs font-mono font-bold border border-sky-500 shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-full mb-3"
            style={{ left: hoveredCursorPos.x, top: hoveredCursorPos.y }}
          >
            {formatDim(currentDraftDistance)}
          </div>
        )}

        {/* Screen-Space Dimension Badges */}
        {dimensionsActive &&
          projectedDimensions.map((pDim) => {
            if (!pDim.visible) return null;
            const isBeingDragged = draggingDimensionInfo?.dimId === pDim.id;
            const isRecent = recentDimIdRef.current === pDim.id;
            return (
              <div
                key={pDim.id}
                id={`dim-badge-${pDim.id}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startDraggingDimension(e.clientX, e.clientY, pDim.id);
                }}
                className={`absolute z-10 transform -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/95 border text-sky-300 text-xs font-mono font-semibold shadow-lg backdrop-blur-xs pointer-events-auto select-none cursor-grab active:cursor-grabbing transition-[border-color,box-shadow] ${
                  isBeingDragged
                    ? 'border-sky-300 ring-2 ring-sky-400/80 shadow-sky-500/30'
                    : isRecent
                    ? 'border-sky-400 ring-2 ring-sky-400/50 shadow-sky-500/20'
                    : 'border-sky-500/70 hover:border-sky-300 hover:shadow-sky-500/20'
                }`}
                style={{ left: pDim.x, top: pDim.y }}
                title="Click & drag to pull orthogonal extension lines"
              >
                <Move className={`w-3 h-3 text-sky-400 ${isBeingDragged ? 'animate-pulse' : 'opacity-70'}`} />
                <span>{formatDim(pDim.distanceInches)}</span>
                {showDimensionDeltas && (
                  <span className="text-[10px] text-slate-400 border-l border-slate-700 pl-1 font-normal">
                    ΔX:{formatDim(pDim.deltaXInches)} ΔY:{formatDim(pDim.deltaYInches)} ΔZ:{formatDim(pDim.deltaZInches)}
                  </span>
                )}
                {isBeingDragged && draggingDimensionInfo && (
                  <span className="text-[10px] text-sky-200 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-500/40">
                    {draggingDimensionInfo.axisLabel}: {draggingDimensionInfo.offsetInches >= 0 ? '+' : ''}
                    {formatDim(draggingDimensionInfo.offsetInches)}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteDimension(pDim.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-0.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Delete dimension"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}

        {/* Selected Mesh / Assembly Bounding Box Orthographic Dimension Badges (placed below & to right with 1/8" gap) */}
        {selectedPartInfo &&
          projectedBoxDimensions.map((bDim) => {
            if (!bDim.visible) return null;
            return (
              <div
                key={bDim.id}
                id={`bbox-badge-${bDim.id}`}
                className="absolute z-20 pointer-events-none transform -translate-x-1/2 -translate-y-1/2 flex items-center px-2 py-0.5 rounded bg-slate-900/90 border border-sky-400/90 text-sky-300 text-xs font-mono font-bold shadow-lg backdrop-blur-sm select-none"
                style={{ left: bDim.x, top: bDim.y }}
                title={`${bDim.axis} Axis Bounding Box Dimension`}
              >
                <span>{bDim.label}</span>
              </div>
            );
          })}

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

        {/* Hardware Acceleration Warning Banner */}
        {!hwAccelStatus.isHardwareAccelerated && !dismissHwWarning && (
          <div
            id="hw-acceleration-warning"
            role="alert"
            className="absolute bottom-3 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:w-auto sm:max-w-3xl z-40 p-3 sm:px-4 sm:py-3.5 rounded-xl bg-amber-950/95 border-2 border-amber-500/90 text-amber-100 shadow-2xl backdrop-blur-md pointer-events-auto flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <span className="font-bold text-[11px] sm:text-xs leading-snug tracking-wide uppercase text-amber-200">
                  ATTENTION: ENSURE YOUR BROWSER SETTINGS SHOW HARDWARE ACCELERATION ENABLE. IT IS NOT CURRENTLY DETECTED AND WILL RESULT IN  DEGRADED PERFORMANCE, IF NOT ENABLED.
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={() => setShowHwHelp((prev) => !prev)}
                  className="text-[11px] font-semibold text-amber-300 hover:text-white underline px-1.5 py-0.5 rounded hover:bg-amber-900/60 cursor-pointer transition-colors"
                >
                  {showHwHelp ? 'Hide Tips' : 'How to Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => setDismissHwWarning(true)}
                  className="text-amber-400 hover:text-white p-1 rounded hover:bg-amber-900/60 cursor-pointer transition-colors"
                  title="Dismiss warning"
                  aria-label="Dismiss warning"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showHwHelp && (
              <div className="pt-2 border-t border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed space-y-1 font-normal">
                <div>
                  <strong className="text-amber-300">Chrome / Edge / Brave:</strong> Open <em>Settings → System</em> (or <em>System & Performance</em>) → turn ON <strong>"Use graphics acceleration when available"</strong> (or "Use hardware acceleration when available"), then restart your browser.
                </div>
                <div>
                  <strong className="text-amber-300">Firefox:</strong> Open <em>Settings → General → Performance</em> → uncheck "Use recommended performance settings" → check <strong>"Use hardware acceleration when available"</strong>.
                </div>
                {hwAccelStatus.details && (
                  <div className="text-[10px] font-mono text-amber-400/80 pt-0.5">
                    Detection Detail: {hwAccelStatus.details}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);
