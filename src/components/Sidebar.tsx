import React, { useRef, useState, useEffect } from 'react';
import {
  LoadedPart,
  ModelDimensions,
  ResolutionOption,
  SelectedPartBounds,
  SnapDirection,
  ThemeMode,
  ViewerSettings,
} from '../types';
import type { VolumeStats } from './ThreeViewport';
import { HotkeyModal } from './HotkeyModal';
import {
  Box,
  Camera,
  ChevronDown,
  ChevronUp,
  Cloud,
  Layers,
  Maximize,
  Moon,
  RotateCw,
  Sun,
  Trash2,
  Upload,
  Video,
  Film,
  FileImage,
  Sparkles,
  Ruler,
  CopyCheck,
  Eye,
  EyeOff,
  Keyboard,
  List,
  LogOut,
} from 'lucide-react';

interface SidebarProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  hasModel: boolean;
  settings: ViewerSettings;
  onUpdateSettings: (settings: Partial<ViewerSettings>) => void;
  dimensions: ModelDimensions;
  onUpdateDimensions: (dims: Partial<ModelDimensions>) => void;
  onUpdateDimensionField?: (
    field: 'scale' | 'x' | 'y' | 'z' | 'rotX' | 'rotY' | 'rotZ',
    value: number
  ) => void;
  isTurntableActive: boolean;
  onToggleTurntable: () => void;
  onRecenter: () => void;
  onSnapView: (dir: SnapDirection) => void;
  onToggleDimensionMode?: () => void;
  resolution: ResolutionOption;
  onChangeResolution: (res: ResolutionOption) => void;
  onExportTurns: (destination: 'download' | 'drive') => void;
  onExportThreeQuarterViews?: (destination: 'download' | 'drive') => void;
  onExportAllSeparate?: (destination: 'download' | 'drive') => void;
  onExportVideo: (format: 'mp4' | 'webm', destination: 'download' | 'drive') => void;
  onOpenGifExportModal?: (destination?: 'download' | 'drive') => void;
  onOpenImageExportModal?: (destination?: 'download' | 'drive') => void;
  onOpenVideoGifExportModal?: (initialMode?: 'video' | 'gif', destination?: 'download' | 'drive') => void;
  isExportingGif?: boolean;
  exportGifStatus?: string;
  isExportingImage: boolean;
  exportImageStatus: string;
  exportImageTarget?: 'turns' | 'threeQuarter' | 'allSeparate' | null;
  isExportingVideo: boolean;
  exportVideoStatus: string;
  onUploadLocalFile: (file: File) => void;
  onUploadBatchFiles: (files: File[]) => void;
  onOpenDriveModal: (mode: 'import') => void;
  onLoadDemoModel: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  isOpenOnMobile: boolean;
  onCloseMobile: () => void;
  volumeStats: VolumeStats | null;
  parts: LoadedPart[];
  onTogglePartVisibility: (index: number) => void;
  onDeletePart: (index: number) => void;
  onDeleteHiddenParts?: () => void;
  selectedPartIndex?: number | null;
  selectedPartIndices?: number[];
  onSelectPart?: (index: number | null) => void;
  onSelectParts?: (indices: number[]) => void;
  selectedPartInfo?: SelectedPartBounds | null;
  // Isolate mode (hover a part, press I) is exclusively-managed by a snapshot/restore in
  // ThreeViewport — editing visibility here mid-isolate would conflict with that, so the whole
  // Loaded Meshes list goes read-only (but still visible) while it's active.
  isIsolated?: boolean;
  onCaptureViewport?: () => string | null;
  onOpenHotkeyModal?: () => void;
  onSeparateLooseParts?: (index?: number) => void;
}

interface DimensionInputProps {
  id: string;
  value: number;
  onCommit: (val: number) => void;
  step?: string;
  min?: number | null;
  sensitivity: number;
  isInteger?: boolean;
  isLight: boolean;
  widthClass?: string;
  formatDecimals?: number;
}

function DimensionInput({
  id,
  value,
  onCommit,
  step = '0.01',
  min = 0.001,
  sensitivity,
  isInteger = false,
  isLight,
  widthClass = 'w-24',
  formatDecimals = 3,
}: DimensionInputProps) {
  const [localStr, setLocalStr] = useState<string>(() =>
    isInteger ? String(Math.round(value)) : value.toFixed(formatDecimals)
  );
  const isFocusedRef = useRef(false);

  // Sync from outside if user is not actively typing
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalStr(isInteger ? String(Math.round(value)) : value.toFixed(formatDecimals));
    }
  }, [value, isInteger, formatDecimals]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalStr(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && (min === null || parsed >= min || isInteger)) {
      onCommit(isInteger ? Math.round(parsed) : parsed);
    }
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    const parsed = parseFloat(localStr);
    if (isNaN(parsed) || (min !== null && parsed < min && !isInteger)) {
      setLocalStr(isInteger ? String(Math.round(value)) : value.toFixed(formatDecimals));
    } else {
      const finalVal = isInteger ? Math.round(parsed) : parsed;
      setLocalStr(isInteger ? String(finalVal) : finalVal.toFixed(formatDecimals));
      onCommit(finalVal);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    e.target.select();
  };

  // Blender-style horizontal click-and-drag scrubbing
  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    const startX = e.clientX;
    const startVal = parseFloat(localStr) || value;
    let hasDragged = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 2) {
        hasDragged = true;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        let newVal = startVal + delta * sensitivity;
        if (min !== null && newVal < min) newVal = min;
        const formatted = isInteger ? Math.round(newVal) : parseFloat(newVal.toFixed(formatDecimals));
        setLocalStr(isInteger ? String(formatted) : formatted.toFixed(formatDecimals));
        onCommit(formatted);
      }
    };

    const onMouseUp = () => {
      if (hasDragged) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      value={localStr}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseDown={handleMouseDown}
      className={`${widthClass} text-right py-1 px-2 font-mono font-bold text-xs rounded-md border text-sky-400 cursor-ew-resize focus:outline-none focus:ring-1 focus:ring-sky-400 ${
        isLight
          ? 'bg-slate-100 border-slate-300 text-slate-900'
          : 'bg-[#1e293b] border-slate-600'
      }`}
    />
  );
}

interface AccordionSectionProps {
  title: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  bordered?: boolean;
  isLight?: boolean;
  // Optional extra control (e.g. "Hide All") rendered between the title and the chevron —
  // a sibling of both toggle buttons, not nested inside either, so it never fights their clicks.
  headerExtra?: React.ReactNode;
  titleColor?: string;
}

// Shared collapsible section used for Clipping Planes, Post-Processing, Volume & Cost, and Loaded Meshes —
// keeps their header style, spacing, and toggle behavior identical everywhere they appear.
function AccordionSection({
  title,
  isOpen,
  onToggle,
  children,
  bordered,
  isLight,
  headerExtra,
  titleColor,
}: AccordionSectionProps) {
  return (
    <div
      className={`flex flex-col gap-2 ${
        bordered ? `pt-2 border-t ${isLight ? 'border-slate-200' : 'border-slate-700'}` : ''
      }`}
    >
      <div className="w-full flex items-center justify-between gap-2">
        <button
          onClick={onToggle}
          className={`flex-1 text-left text-[11px] font-bold uppercase tracking-wider cursor-pointer flex items-center gap-1.5 ${
            titleColor || 'text-slate-400'
          }`}
        >
          {title}
        </button>
        <div className="flex items-center gap-2">
          {headerExtra}
          <button
            onClick={onToggle}
            className={`cursor-pointer flex items-center ${titleColor || 'text-slate-400'}`}
          >
            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {isOpen && <div className="flex flex-col gap-2.5 text-xs">{children}</div>}
    </div>
  );
}

export const Sidebar: React.FC<SidebarProps> = ({
  theme,
  onToggleTheme,
  hasModel,
  settings,
  onUpdateSettings,
  dimensions,
  onUpdateDimensions,
  onUpdateDimensionField,
  isTurntableActive,
  onToggleTurntable,
  onRecenter,
  onSnapView,
  onToggleDimensionMode,
  resolution,
  onChangeResolution,
  onExportTurns,
  onExportThreeQuarterViews,
  onExportAllSeparate,
  onExportVideo,
  onOpenGifExportModal,
  onOpenImageExportModal,
  onOpenVideoGifExportModal,
  isExportingGif = false,
  exportGifStatus = '',
  isExportingImage,
  exportImageStatus,
  exportImageTarget,
  isExportingVideo,
  exportVideoStatus,
  onUploadLocalFile,
  onUploadBatchFiles,
  onOpenDriveModal,
  onLoadDemoModel,
  isFullscreen,
  onToggleFullscreen,
  isOpenOnMobile,
  onCloseMobile,
  volumeStats,
  parts,
  onTogglePartVisibility,
  onDeletePart,
  onDeleteHiddenParts,
  selectedPartIndex,
  selectedPartIndices,
  onSelectPart,
  onSelectParts,
  selectedPartInfo,
  isIsolated,
  onCaptureViewport,
  onOpenHotkeyModal,
  onSeparateLooseParts,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [isLoadedMeshesOpen, setIsLoadedMeshesOpen] = useState(false);
  const [showExportDriveMenu, setShowExportDriveMenu] = useState(false);
  const [isHotkeyModalOpen, setIsHotkeyModalOpen] = useState(false);

  const isLight = theme === 'light';

  const handleCommitDimensionField = (
    field: 'scale' | 'x' | 'y' | 'z' | 'rotX' | 'rotY' | 'rotZ',
    val: number
  ) => {
    if (onUpdateDimensionField) {
      onUpdateDimensionField(field, val);
    } else {
      if (['scale', 'x', 'y', 'z'].includes(field)) {
        const baseW =
          dimensions.baseWidthInches ||
          (dimensions.scaleFactor > 0 ? dimensions.widthInches / dimensions.scaleFactor : dimensions.widthInches);
        const baseH =
          dimensions.baseHeightInches ||
          (dimensions.scaleFactor > 0 ? dimensions.heightInches / dimensions.scaleFactor : dimensions.heightInches);
        const baseD =
          dimensions.baseDepthInches ||
          (dimensions.scaleFactor > 0 ? dimensions.depthInches / dimensions.scaleFactor : dimensions.depthInches);

        let newScale = 1.0;
        if (field === 'scale') {
          newScale = val;
        } else if (field === 'x' && baseW > 0) {
          newScale = val / baseW;
        } else if (field === 'y' && baseH > 0) {
          newScale = val / baseH;
        } else if (field === 'z' && baseD > 0) {
          newScale = val / baseD;
        }

        if (newScale > 0) {
          onUpdateDimensions({
            scaleFactor: parseFloat(newScale.toFixed(4)),
            widthInches: parseFloat((baseW * newScale).toFixed(3)),
            heightInches: parseFloat((baseH * newScale).toFixed(3)),
            depthInches: parseFloat((baseD * newScale).toFixed(3)),
          });
        }
      } else {
        onUpdateDimensions({ [field]: val });
      }
    }
  };

  // Helper for Blender-style drag
  const createDraggableInput = (
    value: number,
    onChange: (val: number) => void,
    sensitivity: number,
    minVal: number | null,
    isInteger: boolean
  ) => {
    return (e: React.MouseEvent<HTMLInputElement>) => {
      const startX = e.clientX;
      const startVal = value;
      let hasDragged = false;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        if (Math.abs(delta) > 2) {
          hasDragged = true;
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
          let newVal = startVal + delta * sensitivity;
          if (minVal !== null && newVal < minVal) newVal = minVal;
          onChange(isInteger ? Math.round(newVal) : parseFloat(newVal.toFixed(3)));
        }
      };

      const onMouseUp = () => {
        if (hasDragged) {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
  };

  // One file → single model, more than one → a multi-part assembly (each file keeps its own
  // origin). Drag-and-drop onto the viewport already follows this same rule.
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (e.target.files.length > 1) {
        onUploadBatchFiles(Array.from(e.target.files));
      } else {
        onUploadLocalFile(e.target.files[0]);
      }
      e.target.value = '';
      if (isOpenOnMobile) onCloseMobile();
    }
  };

  const handleHideAllParts = () => {
    parts.forEach((part, i) => {
      if (part.visible) onTogglePartVisibility(i);
    });
  };

  const handleShowAllParts = () => {
    parts.forEach((part, i) => {
      if (!part.visible) onTogglePartVisibility(i);
    });
  };

  const handleSelectAllVisible = () => {
    if (isIsolated || parts.length === 0) return;
    const visibleIndices = parts
      .map((p, idx) => (p.visible ? idx : -1))
      .filter((idx) => idx !== -1);
    if (visibleIndices.length === 0) return;

    const cur =
      selectedPartIndices ||
      (selectedPartIndex !== null && selectedPartIndex !== undefined ? [selectedPartIndex] : []);
    const allSelected =
      visibleIndices.length === cur.length &&
      visibleIndices.every((idx) => cur.includes(idx));

    if (allSelected) {
      if (onSelectParts) onSelectParts([]);
      else onSelectPart?.(null);
    } else {
      if (onSelectParts) onSelectParts(visibleIndices);
      else if (visibleIndices.length > 0) onSelectPart?.(visibleIndices[0]);
    }
  };

  const hasRotations = dimensions.rotX !== 0 || dimensions.rotY !== 0 || dimensions.rotZ !== 0;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenOnMobile && (
        <div
          className="fixed inset-0 bg-black/60 z-30 sm:hidden backdrop-blur-xs"
          onClick={onCloseMobile}
        />
      )}

      <aside
        id="app-sidebar"
        className={`w-[320px] shrink-0 border-r flex flex-col h-full z-40 transition-transform duration-200 overflow-y-auto ${
          isFullscreen ? 'hidden' : 'flex'
        } ${
          // Responsive layout: fixed drawer on mobile <= 600px, normal static sidebar on > 600px
          isOpenOnMobile
            ? 'fixed top-0 left-0 bottom-0 max-w-[85vw] shadow-2xl translate-x-0'
            : 'max-sm:-translate-x-full max-sm:fixed max-sm:top-0 max-sm:left-0 max-sm:bottom-0 max-sm:z-40'
        } ${
          isLight
            ? 'bg-slate-100/95 border-slate-300 text-slate-900 shadow-slate-200/50'
            : 'bg-[#1e293b] border-slate-700 text-slate-100'
        }`}
      >
        <div className="p-4 flex flex-col gap-3.5">
          {/* Top Header: Title, Theme Switch, Mobile Close */}
          <div className="flex items-center justify-between pb-1 border-b border-slate-700/20">
            <div className="flex items-center gap-2">
              <span id="app-title-header" className="font-bold text-xs tracking-wider uppercase opacity-90 flex items-center gap-1.5">
                <span>3DViewMaker</span>
                <span className="font-mono text-[10px] text-sky-400 font-semibold normal-case px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                  v1.55
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                id="btn-toggle-theme"
                onClick={onToggleTheme}
                title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                className={`p-1.5 rounded-md border text-xs transition-colors cursor-pointer flex items-center gap-1.5 ${
                  isLight
                    ? 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                    : 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-amber-400'
                }`}
              >
                {isLight ? <Moon className="w-3.5 h-3.5 text-slate-600" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
                <span className="text-[11px] font-medium">{isLight ? 'Dark' : 'Light'}</span>
              </button>
            </div>
          </div>

          {/* Load CAD: Local, Drive, or Ok, can you fix this issue: when saving export images to "separate individual images" I can see a really soft dimension and extension line but no dimension text, when a mesh is selected. The export all views to one image works perfect, the separate images need to print those dims the same way.Demo. Selecting (or dropping) more than one file loads
              them as a multi-part assembly instead of needing a separate batch-load control. */}
          <div className="flex flex-col gap-2">
            <div
              id="upload-dropzone-button"
              onClick={() => fileInputRef.current?.click()}
              title="Select multiple files to load them as a multi-part assembly"
              className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
                isLight
                  ? 'border-slate-300 bg-white hover:border-sky-500 text-slate-600'
                  : 'border-slate-600 bg-[#0f172a] hover:border-sky-400 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2 text-xs font-medium">
                <Upload className="w-4 h-4 text-sky-500" />
                <span>
                  Load CAD — <b>.GLB</b>, <b>.STL</b> or <b>.OBJ</b>
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                id="fileInput"
                accept=".glb,.stl,.obj,.gltf"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Quick Actions: Google Drive Import & Demo Model */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                id="btn-open-drive-modal"
                onClick={() => onOpenDriveModal('import')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-semibold border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-white border-blue-200 text-blue-600 hover:bg-blue-50'
                    : 'bg-blue-950/40 border-blue-800/80 text-blue-400 hover:bg-blue-900/40'
                }`}
                title="Open from Google Drive"
              >
                <Cloud className="w-3.5 h-3.5 text-blue-500" />
                <span>Google Drive</span>
              </button>

              <button
                id="btn-load-demo-model"
                onClick={onLoadDemoModel}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-semibold border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
                title="Load sample 3D model"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Load Demo</span>
              </button>
            </div>
          </div>

          {/* LOADED MESHES — visible whenever one or more meshes are loaded (single STL/OBJ or multi-part assembly).
              Sits right above the Viewer panel so it's visible as soon as a model or assembly loads. */}
          {parts.length > 0 && (
            <div
              className={`p-3 rounded-lg border flex flex-col gap-2 ${
                isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
              }`}
            >
              <AccordionSection
                title={
                  <span className="flex items-center gap-1.5">
                    <List className="w-3.5 h-3.5 text-sky-500" />
                    <span>MESHES</span>
                  </span>
                }
                isOpen={isLoadedMeshesOpen}
                onToggle={() => setIsLoadedMeshesOpen(!isLoadedMeshesOpen)}
                isLight={isLight}
                titleColor="text-sky-500"
                headerExtra={
                  <div className="flex items-center gap-1.5">
                    {onSeparateLooseParts && !isIsolated && parts.length > 0 && (
                      <button
                        type="button"
                        id="btnSeparateLooseParts"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeparateLooseParts();
                        }}
                        disabled={isIsolated}
                        title="Separate by loose parts (P) — splits disconnected shells into independent meshes"
                        className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent transition-colors flex items-center justify-center"
                        aria-label="Split loose parts"
                      >
                        <Layers className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onDeleteHiddenParts && !isIsolated && parts.some((p) => !p.visible) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteHiddenParts();
                        }}
                        title="Permanently remove all currently hidden meshes from scene and memory"
                        className="text-[10px] font-semibold text-rose-400 hover:text-rose-300 cursor-pointer whitespace-nowrap px-1.5 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 transition-colors mr-0.5"
                      >
                        Delete Hidden
                      </button>
                    )}
                    <button
                      onClick={handleSelectAllVisible}
                      disabled={isIsolated || parts.length === 0}
                      title={isIsolated ? 'Exit isolate mode (I) to select parts' : 'Select all visible meshes in viewport (or press A)'}
                      className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent transition-colors flex items-center justify-center"
                      aria-label="Select all visible meshes"
                    >
                      <CopyCheck className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleShowAllParts}
                      disabled={isIsolated}
                      title={isIsolated ? 'Exit isolate mode (I) to change visibility' : 'Show every loaded mesh (or press U in viewport)'}
                      className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent transition-colors flex items-center justify-center"
                      aria-label="Show all loaded meshes"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleHideAllParts}
                      disabled={isIsolated}
                      title={isIsolated ? 'Exit isolate mode (I) to change visibility' : 'Hide every loaded mesh'}
                      className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent transition-colors flex items-center justify-center"
                      aria-label="Hide all loaded meshes"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                }
              >
                {isIsolated && (
                  <div className="text-[10px] text-sky-400 leading-tight -mt-1 pb-0.5">
                    Isolated — press <b>I</b> to exit before changing visibility or deleting parts.
                  </div>
                )}
                {parts.map((part, i) => {
                  const isSelected = selectedPartIndices
                    ? selectedPartIndices.includes(i)
                    : selectedPartIndex === i;
                  return (
                    <div
                      key={`${part.name}-${i}`}
                      onClick={(e) => {
                        if (isIsolated) return;
                        if (e.shiftKey && onSelectParts) {
                          const currentIndices =
                            selectedPartIndices ||
                            (selectedPartIndex !== null && selectedPartIndex !== undefined
                              ? [selectedPartIndex]
                              : []);
                          if (currentIndices.includes(i)) {
                            onSelectParts(currentIndices.filter((idx) => idx !== i));
                          } else {
                            onSelectParts([...currentIndices, i]);
                          }
                        } else {
                          const isOnlySelected =
                            isSelected &&
                            (!selectedPartIndices || selectedPartIndices.length === 1);
                          onSelectPart?.(isOnlySelected ? null : i);
                        }
                      }}
                      className={`flex flex-col p-1.5 -mx-1 rounded-md transition-colors ${
                        isIsolated ? '' : 'cursor-pointer'
                      } ${
                        isSelected
                          ? 'bg-sky-500/20 border border-sky-500/50'
                          : 'border border-transparent hover:bg-slate-800/40'
                      }`}
                      title={isIsolated ? undefined : 'Click to select (Shift+Click to multi-select)'}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className={`flex items-center gap-2 min-w-0 flex-1 ${
                            isIsolated ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={part.visible}
                            disabled={isIsolated}
                            onChange={() => onTogglePartVisibility(i)}
                            className="accent-sky-500 w-4 h-4 shrink-0 disabled:cursor-not-allowed cursor-pointer"
                          />
                          <span className={`truncate ${isSelected ? 'text-sky-300 font-semibold' : ''}`} title={part.name}>
                            {part.name}
                          </span>
                        </label>
                        {onSeparateLooseParts && (
                          <button
                            type="button"
                            id={`btnSeparatePart-${i}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSeparateLooseParts(i);
                            }}
                            disabled={isIsolated}
                            title="Split this mesh into loose parts (P)"
                            className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                            aria-label={`Split ${part.name} into loose parts`}
                          >
                            <Layers className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeletePart(i);
                          }}
                          disabled={isIsolated}
                          title={isIsolated ? 'Exit isolate mode (I) to delete parts' : 'Remove this part from the scene and free its memory'}
                          className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {isSelected && selectedPartInfo && (!selectedPartInfo.count || selectedPartInfo.count <= 1) && (
                        <div className="mt-1.5 pt-1.5 border-t border-sky-500/30 text-[10px] text-sky-200 font-mono flex flex-col gap-0.5 pl-6">
                          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-sans font-semibold">
                            Bounding Box
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-sans">Width (X):</span>
                            <span>{selectedPartInfo.wIn.toFixed(3)}&quot; ({selectedPartInfo.wMm.toFixed(1)} mm)</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-sans">Height (Y):</span>
                            <span>{selectedPartInfo.hIn.toFixed(3)}&quot; ({selectedPartInfo.hMm.toFixed(1)} mm)</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-sans">Depth (Z):</span>
                            <span>{selectedPartInfo.dIn.toFixed(3)}&quot; ({selectedPartInfo.dMm.toFixed(1)} mm)</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {selectedPartInfo && selectedPartInfo.count > 1 && (
                  <div className="mt-2 p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/40 text-[11px] text-sky-200 font-mono flex flex-col gap-1">
                    <div className="flex items-center justify-between font-sans text-xs font-semibold text-white">
                      <span>Combined Box ({selectedPartInfo.count} meshes)</span>
                      <button
                        onClick={() => (onSelectParts ? onSelectParts([]) : onSelectPart?.(null))}
                        className="text-[10px] text-slate-400 hover:text-white cursor-pointer px-1 py-0.5 rounded hover:bg-slate-800"
                        title="Deselect all (Esc)"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400 font-sans">Width (X):</span>
                      <span>{selectedPartInfo.wIn.toFixed(3)}&quot; ({selectedPartInfo.wMm.toFixed(1)} mm)</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400 font-sans">Height (Y):</span>
                      <span>{selectedPartInfo.hIn.toFixed(3)}&quot; ({selectedPartInfo.hMm.toFixed(1)} mm)</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400 font-sans">Depth (Z):</span>
                      <span>{selectedPartInfo.dIn.toFixed(3)}&quot; ({selectedPartInfo.dMm.toFixed(1)} mm)</span>
                    </div>
                  </div>
                )}

                {onDeleteHiddenParts && !isIsolated && parts.some((p) => !p.visible) && (
                  <button
                    onClick={onDeleteHiddenParts}
                    className="w-full mt-2 py-1.5 px-2 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    title="Purge all hidden items from memory and scene (zoom fitting will then frame only loaded meshes)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete All Hidden Meshes ({parts.filter((p) => !p.visible).length})</span>
                  </button>
                )}
              </AccordionSection>
            </div>
          )}

          {/* VIEW OPTIONS PANEL */}
          <div
            className={`p-3 rounded-lg border flex flex-col gap-2.5 ${
              isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
            }`}
          >
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-sky-400" />
              <span>VIEW OPTIONS</span>
            </div>

            {/* Camera Framing Buttons */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                id="btnRecenter"
                onClick={onRecenter}
                className="col-span-2 py-2 px-2.5 rounded-md font-semibold text-xs bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer text-center"
              >
                Fit to View (Enter)
              </button>

              <button
                id="btnTurntable"
                onClick={onToggleTurntable}
                className={`col-span-2 py-2 px-2.5 rounded-md font-semibold text-xs transition-colors cursor-pointer text-center ${
                  isTurntableActive
                    ? 'bg-emerald-600 text-white'
                    : isLight
                    ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                {isTurntableActive ? 'Turntable: ON (Spacebar)' : 'Turntable: OFF (Spacebar)'}
              </button>

              {/* Turntable Direction & Speed — positioned directly below turntable button and above preset views */}
              <div
                className={`col-span-2 flex items-center justify-between gap-1.5 p-1.5 rounded-md border text-[11px] ${
                  isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-800/60 border-slate-700/60'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Dir:</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        turntableDirection: (settings.turntableDirection || 'cw') === 'cw' ? 'ccw' : 'cw',
                      })
                    }
                    className={`px-2 py-0.5 rounded font-semibold text-[10px] cursor-pointer transition-colors ${
                      isLight
                        ? 'bg-white hover:bg-slate-200 border border-slate-300 text-slate-700'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                    }`}
                    title="Toggle Rotation Direction (CW: Clockwise, CCW: Counter-Clockwise)"
                  >
                    {(settings.turntableDirection || 'cw').toUpperCase()}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 font-medium">Speed:</span>
                  {(['slow', 'normal', 'fast'] as const).map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => onUpdateSettings({ turntableSpeed: spd })}
                      className={`px-1.5 py-0.5 rounded capitalize text-[10px] font-medium cursor-pointer transition-colors ${
                        (settings.turntableSpeed || 'normal') === spd
                          ? 'bg-sky-600 text-white font-semibold'
                          : isLight
                          ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                          : 'bg-slate-700/60 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {spd}
                    </button>
                  ))}
                </div>
              </div>

              <button
                id="btnFront"
                onClick={() => onSnapView('front')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                Front (1)
              </button>
              <button
                id="btnBack"
                onClick={() => onSnapView('back')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                Back (2)
              </button>
              <button
                id="btnLeft"
                onClick={() => onSnapView('left')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                Left (3)
              </button>
              <button
                id="btnRight"
                onClick={() => onSnapView('right')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                Right (4)
              </button>
              <button
                id="btnTop"
                onClick={() => onSnapView('top')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                Top (5)
              </button>
              <button
                id="btnBottom"
                onClick={() => onSnapView('bottom')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                Bottom (6)
              </button>
              <button
                id="btnIsoFL"
                onClick={() => onSnapView('isofl')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                3/4 Front-L (7)
              </button>
              <button
                id="btnIsoFR"
                onClick={() => onSnapView('isofr')}
                className={`py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer ${
                  isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                3/4 Front-R (8)
              </button>

              {/* Fullscreen Toggle Button — positioned directly under the 3/4 views in the viewer area */}
              <button
                id="btnFullscreenToggle"
                onClick={onToggleFullscreen}
                className={`col-span-2 py-2 px-2.5 rounded-md font-semibold text-xs transition-colors cursor-pointer text-center ${
                  isLight
                    ? 'bg-slate-300 hover:bg-slate-400 text-slate-900'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                {isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen Toggle (F/Esc)'}
              </button>
            </div>
          </div>

          {/* EXPORT PANEL */}
          <div
            className={`p-3 rounded-lg border flex flex-col gap-2.5 ${
              isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <LogOut className="w-3.5 h-3.5 text-slate-400 rotate-180" />
                <span>EXPORT</span>
              </span>
            </div>

            {/* Main Export Action Buttons */}
            <div className="flex flex-col gap-2">
              {/* Green IMAGES Button with stack of images icon */}
              <button
                id="btnOpenImageExportModal"
                onClick={() => onOpenImageExportModal?.('download')}
                disabled={isExportingImage || isExportingVideo || isExportingGif || !hasModel}
                className="w-full py-2.5 px-3 rounded-md font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                title="Configure & Export Image Views (S)"
              >
                <Layers className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {isExportingImage ? exportImageStatus || 'Exporting Images...' : 'EXPORT IMAGES (S)'}
                </span>
              </button>

              {/* Blue VIDEO / GIF Button with film icon */}
              <button
                id="btnOpenVideoGifExportModal"
                onClick={() => onOpenVideoGifExportModal?.('video', 'download')}
                disabled={isExportingImage || isExportingVideo || isExportingGif || !hasModel}
                className="w-full py-2.5 px-3 rounded-md font-semibold text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                title="Configure & Export Video or GIF (V)"
              >
                <Film className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {isExportingVideo
                    ? exportVideoStatus || 'Exporting Video...'
                    : isExportingGif
                    ? exportGifStatus || 'Exporting GIF...'
                    : 'EXPORT VIDEO / GIF (V)'}
                </span>
              </button>
            </div>
          </div>

          {/* MODEL SCALE & ROTATION ACCORDION */}
          <div
            className={`p-3 rounded-lg border flex flex-col gap-2 ${
              isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
            }`}
          >
            <button
              id="settingsToggleBtn"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="w-full flex items-center justify-between text-xs font-bold text-sky-500 uppercase cursor-pointer"
            >
              <span>MODEL SCALE & ROTATION</span>
              <span id="settingsIcon">
                {isSettingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>

            {isSettingsOpen && (
              <div id="settingsContent" className="flex flex-col gap-2.5 pt-1.5">
                {/* Scale, Size & Rotation Panel (shown when model loaded) */}
                {hasModel ? (
                  <div
                    id="dimWrapper"
                    className={`pt-2 border-t flex flex-col gap-2 ${
                      isLight ? 'border-slate-200' : 'border-slate-700'
                    }`}
                  >
                    {/* Dimensions group */}
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                        Dimensions
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span>Scale Factor:</span>
                        <DimensionInput
                          id="scaleInput"
                          value={dimensions.scaleFactor}
                          onCommit={(val) => handleCommitDimensionField('scale', val)}
                          step="0.05"
                          min={0.001}
                          sensitivity={0.01}
                          isLight={isLight}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span>X (Width in.):</span>
                        <DimensionInput
                          id="dimInputX"
                          value={dimensions.widthInches}
                          onCommit={(val) => handleCommitDimensionField('x', val)}
                          step="0.01"
                          min={0.001}
                          sensitivity={0.05}
                          isLight={isLight}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span>Y (Height in.):</span>
                        <DimensionInput
                          id="dimInputY"
                          value={dimensions.heightInches}
                          onCommit={(val) => handleCommitDimensionField('y', val)}
                          step="0.01"
                          min={0.001}
                          sensitivity={0.05}
                          isLight={isLight}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span>Z (Depth in.):</span>
                        <DimensionInput
                          id="dimInputZ"
                          value={dimensions.depthInches}
                          onCommit={(val) => handleCommitDimensionField('z', val)}
                          step="0.01"
                          min={0.001}
                          sensitivity={0.05}
                          isLight={isLight}
                        />
                      </div>
                    </div>

                    {/* Rotation group */}
                    <div className="flex flex-col gap-2 pt-1.5 border-t border-slate-700/40">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                        Rotation
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span>Rotation X (°):</span>
                        <DimensionInput
                          id="rotInputX"
                          value={dimensions.rotX}
                          onCommit={(val) => handleCommitDimensionField('rotX', val)}
                          step="1"
                          min={null}
                          sensitivity={1}
                          isInteger={true}
                          isLight={isLight}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span>Rotation Y (°):</span>
                        <DimensionInput
                          id="rotInputY"
                          value={dimensions.rotY}
                          onCommit={(val) => handleCommitDimensionField('rotY', val)}
                          step="1"
                          min={null}
                          sensitivity={1}
                          isInteger={true}
                          isLight={isLight}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span>Rotation Z (°):</span>
                        <DimensionInput
                          id="rotInputZ"
                          value={dimensions.rotZ}
                          onCommit={(val) => handleCommitDimensionField('rotZ', val)}
                          step="1"
                          min={null}
                          sensitivity={1}
                          isInteger={true}
                          isLight={isLight}
                        />
                      </div>
                    </div>

                    {hasRotations && (
                      <div
                        id="rotWarning"
                        className="p-2 rounded-md bg-amber-500/10 border border-amber-500/40 text-amber-400 text-[10px] leading-tight"
                      >
                        NOTE: the size noted above is based on original input only, not the rotated
                        value!
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic py-1">
                    Load a 3D model to adjust scale and rotation.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* VOLUME & COST ESTIMATE ACCORDION (separate and below Settings Section) */}
          <div
            className={`p-3 rounded-lg border flex flex-col gap-2 ${
              isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
            }`}
          >
            <button
              id="volumeToggleBtn"
              onClick={() => setIsVolumeOpen(!isVolumeOpen)}
              className="w-full flex items-center justify-between text-xs font-bold text-sky-500 uppercase cursor-pointer"
            >
              <span>VOLUME & COST ESTIMATE</span>
              <span id="volumeIcon">
                {isVolumeOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>

            {isVolumeOpen && (
              <div id="volumeContent" className="flex flex-col gap-2.5 pt-1.5 text-xs">
                {volumeStats ? (
                  <>
                    {!volumeStats.isWatertight && (
                      <div className="text-xs text-amber-400 leading-tight">
                        Mesh isn&apos;t fully watertight — volume/weight may be approximate.
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-y-1">
                      <span className="text-slate-400 flex items-center gap-1">
                        Volume
                        {volumeStats.isPartialSelection && (
                          <span className="text-amber-400 font-bold">*</span>
                        )}
                      </span>
                      <span className="text-right font-mono text-sky-400">
                        {volumeStats.volumeCm3.toFixed(2)} cm³
                      </span>
                      <span className="text-slate-400 flex items-center gap-1">
                        Weight
                        {volumeStats.isPartialSelection && (
                          <span className="text-amber-400 font-bold">*</span>
                        )}
                      </span>
                      <span className="text-right font-mono text-sky-400">
                        {volumeStats.weightGrams.toFixed(1)} g
                      </span>
                      {volumeStats.isPartialSelection && (
                        <div className="col-span-2 text-[10px] text-amber-400/90 font-mono -mt-0.5 mb-0.5">
                          * Selected {volumeStats.selectedCount === 1 ? 'mesh' : `${volumeStats.selectedCount} meshes`} only ({volumeStats.selectedCount} of {volumeStats.totalPartCount || parts.length})
                        </div>
                      )}
                      <span className="text-slate-400 flex items-center gap-1">
                        Est. Cost
                        {volumeStats.isPartialSelection && (
                          <span className="text-amber-400 font-bold">*</span>
                        )}
                      </span>
                      <span className="text-right font-mono text-emerald-400">
                        ${volumeStats.estimatedCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Density (g/cm³)</span>
                      <DimensionInput
                        id="sidebarDensityInput"
                        value={settings.materialDensityGCm3}
                        onCommit={(val) => onUpdateSettings({ materialDensityGCm3: val })}
                        step="0.01"
                        min={0.01}
                        sensitivity={0.01}
                        formatDecimals={2}
                        widthClass="w-20"
                        isLight={isLight}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Cost / kg (USD)</span>
                      <DimensionInput
                        id="sidebarCostInput"
                        value={settings.costPerKgUSD}
                        onCommit={(val) => onUpdateSettings({ costPerKgUSD: val })}
                        step="0.10"
                        min={0}
                        sensitivity={0.1}
                        formatDecimals={2}
                        widthClass="w-20"
                        isLight={isLight}
                      />
                    </div>

                    {/* HR Break below Cost per user request */}
                    <hr className={`my-2 border-t ${isLight ? 'border-slate-300' : 'border-slate-700/60'}`} />

                    {/* Reference Guide: Ballpark Costs & Plastic Densities */}
                    <div className="flex flex-col gap-2.5 pt-0.5">
                      {/* Ballpark Material Costs (Screenshot reference) */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Ballpark Material Costs (/kg)
                          </span>
                          <span className="text-[9px] text-slate-500 italic">Click to apply</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          {[
                            { name: 'PVC (NP)', cost: 1.7143, displayCost: '$1.71', defaultDensity: 1.38 },
                            { name: 'ABS', cost: 2.0, displayCost: '$2.00', defaultDensity: 1.05 },
                            { name: 'PP + TPR', cost: 3.68, displayCost: '$3.68', defaultDensity: 0.95 },
                            { name: 'POM', cost: 3.72, displayCost: '$3.72', defaultDensity: 1.41 },
                          ].map((mat) => (
                            <button
                              key={mat.name}
                              type="button"
                              onClick={() => {
                                onUpdateSettings({
                                  costPerKgUSD: parseFloat(mat.cost.toFixed(2)),
                                });
                              }}
                              className={`flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors cursor-pointer border ${
                                isLight
                                  ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
                                  : 'bg-[#1e293b] hover:bg-slate-700/80 border-slate-700 text-slate-200'
                              }`}
                              title={`Click to set cost to ${mat.displayCost}/kg`}
                            >
                              <span className="font-medium text-[11px]">{mat.name}</span>
                              <span className="font-mono text-[11px] font-bold text-emerald-400">
                                {mat.displayCost}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Densities per Plastic Type (Screenshot reference) */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Plastic Densities (g/cm³)
                          </span>
                          <span className="text-[9px] text-slate-500 italic">Click to apply</span>
                        </div>

                        {/* PVC */}
                        <div
                          className={`p-2 rounded border flex flex-col gap-1 ${
                            isLight ? 'bg-slate-100 border-slate-300' : 'bg-[#1e293b]/70 border-slate-700/70'
                          }`}
                        >
                          <div className="font-bold text-sky-400 text-[11px]">
                            PVC (Polyvinyl Chloride)
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {[
                              { grade: 'Rigid PVC (uPVC)', range: '1.30 – 1.45', defaultVal: 1.38 },
                              { grade: 'Flexible / Plasticized PVC', range: '1.10 – 1.35', defaultVal: 1.22 },
                              { grade: 'Chlorinated PVC (CPVC)', range: '1.45 – 1.58', defaultVal: 1.51 },
                            ].map((item) => (
                              <button
                                key={item.grade}
                                type="button"
                                onClick={() => onUpdateSettings({ materialDensityGCm3: item.defaultVal })}
                                className={`flex items-center justify-between py-1 px-1.5 rounded transition-colors text-left cursor-pointer ${
                                  isLight ? 'hover:bg-slate-200/80' : 'hover:bg-slate-700/60'
                                }`}
                                title={`Click to set density to ${item.defaultVal} g/cm³`}
                              >
                                <span className={`text-[11px] ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                                  {item.grade}
                                </span>
                                <span className="font-mono font-semibold text-[11px] text-sky-400">
                                  {item.range}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* ABS */}
                        <div
                          className={`p-2 rounded border flex flex-col gap-1 ${
                            isLight ? 'bg-slate-100 border-slate-300' : 'bg-[#1e293b]/70 border-slate-700/70'
                          }`}
                        >
                          <div className="font-bold text-sky-400 text-[11px]">
                            ABS (Acrylonitrile Butadiene Styrene)
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {[
                              { grade: 'Standard / Natural ABS', range: '1.04 – 1.06', defaultVal: 1.05 },
                              { grade: 'High-Impact ABS', range: '1.00 – 1.10', defaultVal: 1.05 },
                              { grade: 'Flame-Retardant ABS', range: '1.15 – 1.22', defaultVal: 1.18 },
                            ].map((item) => (
                              <button
                                key={item.grade}
                                type="button"
                                onClick={() => onUpdateSettings({ materialDensityGCm3: item.defaultVal })}
                                className={`flex items-center justify-between py-1 px-1.5 rounded transition-colors text-left cursor-pointer ${
                                  isLight ? 'hover:bg-slate-200/80' : 'hover:bg-slate-700/60'
                                }`}
                                title={`Click to set density to ${item.defaultVal} g/cm³`}
                              >
                                <span className={`text-[11px] ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                                  {item.grade}
                                </span>
                                <span className="font-mono font-semibold text-[11px] text-sky-400">
                                  {item.range}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-slate-400 italic py-1">
                    Load a 3D model to view volume, weight, and estimated material cost.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Jazwares Logo */}
          <div className="pt-2 pb-1 text-center">
            <img
              id="sidebar-jazwares-logo"
              src={`${import.meta.env.BASE_URL}assets/jazwares-logo.png`}
              alt="Jazwares Logo"
              className="mx-auto max-w-[120px] h-auto object-contain opacity-45 hover:opacity-100 transition-opacity duration-300 ease-in-out"
            />
          </div>

          {/* Hotkey Cheatsheet Link */}
          <div className="text-center pb-2">
            <button
              id="btnHotkeyCheatsheet"
              type="button"
              onClick={() => {
                if (onOpenHotkeyModal) {
                  onOpenHotkeyModal();
                } else {
                  setIsHotkeyModalOpen(true);
                }
              }}
              className="text-[11px] font-medium text-sky-500 hover:text-sky-400 hover:underline cursor-pointer inline-flex items-center gap-1.5 transition-colors py-1 px-2.5 rounded-md hover:bg-sky-500/10"
              title="View all keyboard shortcuts (?)"
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>Hotkey Cheatsheet (?)</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Hotkey Cheatsheet Modal */}
      <HotkeyModal
        isOpen={isHotkeyModalOpen}
        onClose={() => setIsHotkeyModalOpen(false)}
        theme={theme}
      />
    </>
  );
};
