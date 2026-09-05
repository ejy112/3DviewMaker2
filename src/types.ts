export type SnapDirection =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'isofl'
  | 'isofr';

export type MaterialKey =
  | 'original'
  | 'grey'
  | 'gold'
  | 'thickness'
  | 'redClay'
  | 'chrome'
  | 'matteGrey'
  | 'pearl'
  | 'normal'
  | 'wireframe'
  | 'sketch'
  | 'matcapZebra';

export type ThemeMode = 'dark' | 'light';

export type ResolutionOption = 1 | 2 | 3 | 4 | 5;

export type VideoFormat = 'mp4' | 'webm';

export type EnvironmentPreset = 'studio' | 'outdoor' | 'interior' | 'sunset';

export type AntialiasMode = 'none' | 'fxaa' | 'smaa';

export type ClipAxis = 'x' | 'y' | 'z';

export interface ClippingPlaneSetting {
  enabled: boolean;
  // Position offset from origin, in inches, along the axis
  offsetInches: number;
  // Which side of the plane gets cut away
  flip: boolean;
}

export interface ClippingSettings {
  x: ClippingPlaneSetting; // Left / Right
  y: ClippingPlaneSetting; // Top / Bottom
  z: ClippingPlaneSetting; // Front / Back
}

export interface ModelDimensions {
  scaleFactor: number;
  widthInches: number;
  heightInches: number;
  depthInches: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  baseWidthInches?: number;
  baseHeightInches?: number;
  baseDepthInches?: number;
}

export interface ViewerSettings {
  material: MaterialKey;
  minThicknessInches: number;
  isOrtho: boolean;
  focalLength: number;

  // Grid
  showGrid: boolean;
  gridSquareSizeInches: number;
  gridMajorEveryInches: number;

  // Shadows (self-shadowing only, no ground plane)
  castShadows: boolean;
  shadowSoftness: number; // 0-100, maps to shadow radius/blur
  shadowDarkness: number; // 0-100, maps to bias/normalBias tightness
  shadowMapResolution: 1024 | 2048 | 4096;

  lockLightsToCamera: boolean;
  contrastPercent: number;
  backgroundColorHex: string;
  vignetteEnabled: boolean;
  vignetteColorHex: string;
  vignetteIntensityPercent: number;

  // Lookdev extras
  opacityPercent: number; // "ghost" slider, applies to any material
  wireframeColorHex: string;
  matteColorHex: string;
  // Cel-shaded tri-tone: sketchColorHex is the midtone, the other two are the lit/shadowed bands
  sketchColorHex: string;
  sketchHighlightColorHex: string;
  sketchShadowColorHex: string;

  // Environment / lighting
  environmentPreset: EnvironmentPreset;

  // Clipping planes
  clipping: ClippingSettings;

  // Post-processing
  antialiasMode: AntialiasMode;
  ssaoEnabled: boolean;
  ssaoRadius: number;
  ssaoIntensity: number;
  ssaoBias: number;

  // Volume / cost estimate
  materialDensityGCm3: number;
  costPerKgUSD: number;

  // Exploded view (batch-loaded parts only)
  explodeAmount: number; // 0-1
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  iconLink?: string;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size?: string;
  modifiedTime?: string;
  iconLink?: string;
}

export interface SharedDriveItem {
  id: string;
  name: string;
}

export interface FolderCrumb {
  id: string;
  name: string;
}

export type DriveSourceType = 'my-drive' | 'shared-drives' | 'shared-with-me';

export interface DriveSaveOptions {
  fileName: string;
  mimeType: string;
  blob: Blob;
  folderId?: string;
  folderName?: string;
}
