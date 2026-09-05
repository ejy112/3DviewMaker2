import React, { useRef, useState, useEffect } from 'react';
import {
  LoadedPart,
  ModelDimensions,
  ResolutionOption,
  SnapDirection,
  ThemeMode,
  ViewerSettings,
} from '../types';
import type { VolumeStats } from './ThreeViewport';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Cloud,
  Maximize,
  Moon,
  RotateCw,
  Sun,
  Trash2,
  Upload,
  Video,
  FileImage,
  Sparkles,
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
  resolution: ResolutionOption;
  onChangeResolution: (res: ResolutionOption) => void;
  onExportTurns: (destination: 'download' | 'drive') => void;
  onExportVideo: (format: 'mp4' | 'webm', destination: 'download' | 'drive') => void;
  isExportingImage: boolean;
  exportImageStatus: string;
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
}: DimensionInputProps) {
  const [localStr, setLocalStr] = useState<string>(() =>
    isInteger ? String(Math.round(value)) : value.toFixed(3)
  );
  const isFocusedRef = useRef(false);

  // Sync from outside if user is not actively typing
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalStr(isInteger ? String(Math.round(value)) : value.toFixed(3));
    }
  }, [value, isInteger]);

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
      setLocalStr(isInteger ? String(Math.round(value)) : value.toFixed(3));
    } else {
      const finalVal = isInteger ? Math.round(parsed) : parsed;
      setLocalStr(isInteger ? String(finalVal) : finalVal.toFixed(3));
      onCommit(finalVal);
    }
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
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
        const formatted = isInteger ? Math.round(newVal) : parseFloat(newVal.toFixed(3));
        setLocalStr(isInteger ? String(formatted) : formatted.toFixed(3));
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
      type="number"
      id={id}
      step={step}
      min={min !== null ? min : undefined}
      value={localStr}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseDown={handleMouseDown}
      className={`w-24 text-right py-1 px-2 font-mono font-bold text-xs rounded-md border text-sky-400 cursor-ew-resize ${
        isLight
          ? 'bg-slate-100 border-slate-300 text-slate-900'
          : 'bg-[#1e293b] border-slate-600'
      }`}
    />
  );
}

interface AccordionSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  bordered?: boolean;
  isLight?: boolean;
  // Optional extra control (e.g. "Hide All") rendered between the title and the chevron —
  // a sibling of both toggle buttons, not nested inside either, so it never fights their clicks.
  headerExtra?: React.ReactNode;
}

// Shared collapsible section used for Clipping Planes, Post-Processing, and Volume & Cost —
// keeps their header style, spacing, and toggle behavior identical everywhere they appear.
function AccordionSection({ title, isOpen, onToggle, children, bordered, isLight, headerExtra }: AccordionSectionProps) {
  return (
    <div
      className={`flex flex-col gap-2 ${
        bordered ? `pt-2 border-t ${isLight ? 'border-slate-200' : 'border-slate-700'}` : ''
      }`}
    >
      <div className="w-full flex items-center justify-between gap-2">
        <button
          onClick={onToggle}
          className="flex-1 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider cursor-pointer"
        >
          {title}
        </button>
        <div className="flex items-center gap-2">
          {headerExtra}
          <button onClick={onToggle} className="text-slate-400 cursor-pointer flex items-center">
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
  resolution,
  onChangeResolution,
  onExportTurns,
  onExportVideo,
  isExportingImage,
  exportImageStatus,
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
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [isLoadedMeshesOpen, setIsLoadedMeshesOpen] = useState(false);
  const [showExportDriveMenu, setShowExportDriveMenu] = useState(false);

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
                  v0.98
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

          {/* Load CAD: Local, Drive, or Demo. Selecting (or dropping) more than one file loads
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

          {/* LOADED MESHES — only relevant once a model actually has multiple separable parts
              (a batch-loaded assembly, or a GLB whose top-level nodes are separable meshes).
              Sits right above the Viewer panel so it's visible as soon as an assembly loads. */}
          {parts.length > 1 && (
            <div
              className={`p-3 rounded-lg border flex flex-col gap-2 ${
                isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
              }`}
            >
              <AccordionSection
                title="Loaded Meshes"
                isOpen={isLoadedMeshesOpen}
                onToggle={() => setIsLoadedMeshesOpen(!isLoadedMeshesOpen)}
                isLight={isLight}
                headerExtra={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleShowAllParts}
                      title="Show every loaded part"
                      className="text-[10px] font-semibold text-slate-400 hover:text-sky-400 cursor-pointer whitespace-nowrap"
                    >
                      Show All
                    </button>
                    <button
                      onClick={handleHideAllParts}
                      title="Hide every loaded part"
                      className="text-[10px] font-semibold text-slate-400 hover:text-sky-400 cursor-pointer whitespace-nowrap"
                    >
                      Hide All
                    </button>
                  </div>
                }
              >
                {parts.map((part, i) => (
                  <div key={`${part.name}-${i}`} className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={part.visible}
                        onChange={() => onTogglePartVisibility(i)}
                        className="accent-sky-500 w-4 h-4 cursor-pointer shrink-0"
                      />
                      <span className="truncate" title={part.name}>
                        {part.name}
                      </span>
                    </label>
                    <button
                      onClick={() => onDeletePart(i)}
                      title="Remove this part from the scene and free its memory"
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </AccordionSection>
            </div>
          )}

          {/* VIEWER PANEL */}
          <div
            className={`p-3 rounded-lg border flex flex-col gap-2.5 ${
              isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
            }`}
          >
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              VIEWER
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
            </div>
          </div>

          {/* EXPORT PANEL */}
          <div
            className={`p-3 rounded-lg border flex flex-col gap-2.5 ${
              isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f172a] border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                EXPORT
              </span>
              <button
                onClick={() => setShowExportDriveMenu(!showExportDriveMenu)}
                className={`text-[10px] flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded cursor-pointer ${
                  showExportDriveMenu
                    ? 'bg-blue-500 text-white'
                    : isLight
                    ? 'text-blue-600 hover:bg-blue-50'
                    : 'text-blue-400 hover:bg-blue-900/30'
                }`}
              >
                <Cloud className="w-3 h-3" />
                <span>Drive Options</span>
              </button>
            </div>

            {/* Resolution & Image Export */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Resolution</span>
              <div className="flex gap-2">
                <select
                  id="exportResSelect"
                  value={resolution}
                  onChange={(e) => onChangeResolution(Number(e.target.value) as ResolutionOption)}
                  className={`w-14 shrink-0 py-2 px-1 text-xs font-bold rounded-md border outline-hidden ${
                    isLight
                      ? 'bg-slate-100 border-slate-300 text-slate-800'
                      : 'bg-[#1e293b] border-slate-600 text-white'
                  }`}
                >
                  <option value={1}>1k</option>
                  <option value={2}>2k</option>
                  <option value={3}>3k</option>
                  <option value={4}>4k</option>
                  <option value={5}>5k</option>
                </select>

                <div className="flex-1 flex gap-1">
                  <button
                    id="btnExportTurns"
                    onClick={() => onExportTurns('download')}
                    disabled={isExportingImage || isExportingVideo || !hasModel}
                    className="flex-1 py-2 px-2 rounded-md font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors cursor-pointer text-center truncate"
                  >
                    {isExportingImage ? exportImageStatus : 'Export Turns to Image (S)'}
                  </button>

                  {showExportDriveMenu && (
                    <button
                      id="btnExportTurnsDrive"
                      onClick={() => onExportTurns('drive')}
                      disabled={isExportingImage || isExportingVideo || !hasModel}
                      className="p-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors cursor-pointer"
                      title="Export Turnaround sheet directly to Google Drive"
                    >
                      <Cloud className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <hr className={`border-0 border-t ${isLight ? 'border-slate-200' : 'border-slate-700'}`} />

            {/* Side-by-Side Video Export Options */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex gap-1">
                <button
                  id="btnExportMp4"
                  onClick={() => onExportVideo('mp4', 'download')}
                  disabled={isExportingImage || isExportingVideo || !hasModel}
                  className="flex-1 py-2 px-1 text-center font-semibold text-[11px] rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors cursor-pointer truncate"
                >
                  {isExportingVideo && exportVideoStatus.includes('MP4')
                    ? exportVideoStatus
                    : 'Export MP4 (V)'}
                </button>
                {showExportDriveMenu && (
                  <button
                    id="btnExportMp4Drive"
                    onClick={() => onExportVideo('mp4', 'drive')}
                    disabled={isExportingImage || isExportingVideo || !hasModel}
                    className="p-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white"
                    title="Export MP4 to Drive"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex gap-1">
                <button
                  id="btnExportWebm"
                  onClick={() => onExportVideo('webm', 'download')}
                  disabled={isExportingImage || isExportingVideo || !hasModel}
                  className="flex-1 py-2 px-1 text-center font-semibold text-[11px] rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors cursor-pointer truncate"
                >
                  {isExportingVideo && exportVideoStatus.includes('WebM')
                    ? exportVideoStatus
                    : 'Export WebM (W)'}
                </button>
                {showExportDriveMenu && (
                  <button
                    id="btnExportWebmDrive"
                    onClick={() => onExportVideo('webm', 'drive')}
                    disabled={isExportingImage || isExportingVideo || !hasModel}
                    className="p-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white"
                    title="Export WebM to Drive"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* SETTINGS ACCORDION */}
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
              <span>SETTINGS</span>
              <span id="settingsIcon">
                {isSettingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>

            {isSettingsOpen && (
              <div id="settingsContent" className="flex flex-col gap-2.5 pt-1.5">
                {/* Scale, Size & Rotation Panel (shown when model loaded) */}
                {hasModel && (
                  <div
                    id="dimWrapper"
                    className={`pt-2 border-t flex flex-col gap-2 ${
                      isLight ? 'border-slate-200' : 'border-slate-700'
                    }`}
                  >
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Scale/Rotation
                    </div>

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

                    {/* Volume, Weight & Cost Estimate */}
                    {volumeStats && (
                      <AccordionSection
                        title="Volume & Cost Estimate"
                        isOpen={isVolumeOpen}
                        onToggle={() => setIsVolumeOpen(!isVolumeOpen)}
                        bordered
                        isLight={isLight}
                      >
                        {!volumeStats.isWatertight && (
                          <div className="text-xs text-amber-400 leading-tight">
                            Mesh isn&apos;t fully watertight — volume/weight may be approximate.
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-y-1">
                          <span className="text-slate-400">Volume</span>
                          <span className="text-right font-mono text-sky-400">
                            {volumeStats.volumeCm3.toFixed(2)} cm³
                          </span>
                          <span className="text-slate-400">Weight</span>
                          <span className="text-right font-mono text-sky-400">
                            {volumeStats.weightGrams.toFixed(1)} g
                          </span>
                          <span className="text-slate-400">Est. Cost</span>
                          <span className="text-right font-mono text-emerald-400">
                            ${volumeStats.estimatedCost.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Density (g/cm³)</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={settings.materialDensityGCm3}
                            onChange={(e) =>
                              onUpdateSettings({ materialDensityGCm3: parseFloat(e.target.value) || 1 })
                            }
                            className={`w-16 text-right py-1 px-1.5 font-mono rounded-md border text-sky-400 ${
                              isLight ? 'bg-slate-100 border-slate-300 text-slate-900' : 'bg-[#1e293b] border-slate-600'
                            }`}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Cost / kg (USD)</span>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={settings.costPerKgUSD}
                            onChange={(e) =>
                              onUpdateSettings({ costPerKgUSD: parseFloat(e.target.value) || 0 })
                            }
                            className={`w-16 text-right py-1 px-1.5 font-mono rounded-md border text-sky-400 ${
                              isLight ? 'bg-slate-100 border-slate-300 text-slate-900' : 'bg-[#1e293b] border-slate-600'
                            }`}
                          />
                        </div>
                      </AccordionSection>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fullscreen Toggle Button */}
          <button
            id="btnFullscreenToggle"
            onClick={onToggleFullscreen}
            className={`w-full py-2.5 px-3 rounded-md font-semibold text-xs transition-colors cursor-pointer text-center ${
              isLight
                ? 'bg-slate-300 hover:bg-slate-400 text-slate-900'
                : 'bg-slate-700 hover:bg-slate-600 text-white'
            }`}
          >
            {isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen Toggle (F/Esc)'}
          </button>

          {/* Jazwares Logo */}
          <div className="pt-2 pb-1 text-center">
            <img
              id="sidebar-jazwares-logo"
              src="https://cdn.cookielaw.org/logos/fe328015-5ba0-440b-96be-399813ddce55/019ed71b-fe3a-7d09-ab6f-ebb2d6233a0f/8d2a10ff-d963-41d9-8439-7c3ebbbaa2d5/jazwares-logo-squared.png"
              alt="Jazwares Logo"
              className="mx-auto max-w-[120px] h-auto object-contain opacity-45 hover:opacity-100 transition-opacity duration-300 ease-in-out"
            />
          </div>
        </div>
      </aside>
    </>
  );
};
