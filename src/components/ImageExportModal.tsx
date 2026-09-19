import React, { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  X,
  Download,
  Cloud,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Heart,
  Check,
  RotateCcw,
  Sparkles,
  Info,
  Maximize2,
  FolderOpen,
  FileText,
} from 'lucide-react';
import { ThemeMode, ResolutionOption, ViewExportId, ImageExportMode } from '../types';

export interface ImageExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  hasModel?: boolean;
  isExporting: boolean;
  exportProgress?: string | null;
  initialDestination?: 'download' | 'drive';
  currentResolution?: ResolutionOption;
  onStartExport: (config: {
    views: ViewExportId[];
    selectedViews?: ViewExportId[];
    combineToOne: boolean;
    exportMode?: ImageExportMode;
    resolution: ResolutionOption;
    destination: 'download' | 'drive';
  }) => void;
  onCancelExport?: () => void;
  showDriveOption?: boolean;
  driveFolderName?: string;
  gridEnabled?: boolean;
}

// SVG Angle Graphic component representing the character with baseball cap seen in image.png
const ViewAngleGraphic: React.FC<{ id: ViewExportId; isSelected: boolean }> = ({ id, isSelected }) => {
  const [imgError, setImgError] = useState(false);

  if (id === 'current') {
    return (
      <div className="relative flex items-center justify-center w-12 h-12">
        <Heart
          className={`w-9 h-9 transition-transform ${
            isSelected
              ? 'fill-rose-500 text-rose-500 scale-110 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
              : 'fill-rose-500/80 text-rose-400'
          }`}
        />
      </div>
    );
  }

  // Base character styling
  const headColor = isSelected ? '#38bdf8' : '#64748b';
  const capColor = isSelected ? '#f59e0b' : '#94a3b8';
  const visorColor = isSelected ? '#d97706' : '#64748b';
  const eyeColor = '#0f172a';

  return (
    <div
      className={`relative w-12 h-12 flex items-center justify-center shrink-0 transition-opacity duration-150 ${
        isSelected ? 'opacity-100' : 'opacity-35'
      }`}
    >
      {/* If the user puts custom PNG images in /assets/views/{id}.png, load them seamlessly */}
      {!imgError && (
        <img
          src={`/assets/views/${id}.png`}
          alt={id}
          className={`absolute inset-0 w-full h-full object-contain pointer-events-none z-10 transition-opacity duration-150 ${
            isSelected ? 'opacity-100' : 'opacity-30'
          }`}
          onError={() => setImgError(true)}
        />
      )}

      <svg viewBox="0 0 100 100" className="w-12 h-12 shrink-0 drop-shadow-sm">
        
      </svg>
    </div>
  );
};

// Definitions for all 15 views in exact layout of image.png
const ALL_PRESETS_IDS: ViewExportId[] = [
  'front_right_quarter',
  'top',
  'front_left_quarter',
  'rear_right',
  'right',
  'front_right',
  'front',
  'front_left',
  'left',
  'rear_left',
  'back',
  'rear_right_quarter',
  'bottom',
  'rear_left_quarter',
];

const PRIMARY_8_IDS: ViewExportId[] = [
  'front',
  'back',
  'top',
  'bottom',
  'left',
  'right',
  'front_left_quarter',
  'front_right_quarter',
];

const PRINCIPAL_10_IDS: ViewExportId[] = [
  'top',
  'rear_right',
  'right',
  'front_right',
  'front',
  'front_left',
  'left',
  'rear_left',
  'back',
  'bottom',
];

// Kept for backward compatibility
const ALL_TURNS_IDS: ViewExportId[] = ALL_PRESETS_IDS;
const STANDARD_8_IDS: ViewExportId[] = PRIMARY_8_IDS;

const VIEW_METADATA: Record<ViewExportId, { label: string; short: string }> = {
  current: { label: 'CURRENT VIEWPORT', short: 'Current' },
  rear_right: { label: 'REAR/RIGHT', short: 'Rear-R' },
  right: { label: 'RIGHT', short: 'Right' },
  front_right: { label: 'FRONT/RIGHT', short: 'Front-R' },
  front: { label: 'FRONT', short: 'Front' },
  front_left: { label: 'FRONT/LEFT', short: 'Front-L' },
  left: { label: 'LEFT', short: 'Left' },
  rear_left: { label: 'REAR/LEFT', short: 'Rear-L' },
  back: { label: 'BACK', short: 'Back' },
  top: { label: 'TOP', short: 'Top' },
  bottom: { label: 'BOTTOM', short: 'Bottom' },
  front_right_quarter: { label: 'FRONT/RIGHT Iso', short: '3/4 FR' },
  front_left_quarter: { label: 'FRONT/LEFT Iso', short: '3/4 FL' },
  rear_right_quarter: { label: 'REAR/RIGHT Iso', short: '3/4 RR' },
  rear_left_quarter: { label: 'REAR/LEFT Iso', short: '3/4 RL' },
};

export const ImageExportModal: React.FC<ImageExportModalProps> = ({
  isOpen,
  onClose,
  theme,
  hasModel = true,
  isExporting,
  exportProgress,
  initialDestination = 'download',
  currentResolution = 1,
  onStartExport,
  onCancelExport,
  showDriveOption = false,
  driveFolderName,
  gridEnabled = false,
}) => {
  const isLight = theme === 'light';

  // State
  const [selectedViews, setSelectedViews] = useState<ViewExportId[]>([
    'front',
    'back',
    'top',
    'bottom',
    'left',
    'right',
    'front_left_quarter',
    'front_right_quarter',
  ]);
  const [exportMode, setExportMode] = useState<ImageExportMode>('combine_image');
  const combineToOne = exportMode === 'combine_image';
  const [resolution, setResolution] = useState<ResolutionOption>(currentResolution);
  const [destination, setDestination] = useState<'download' | 'drive'>(initialDestination);

  useEffect(() => {
    if (initialDestination) setDestination(initialDestination);
  }, [initialDestination]);

  useEffect(() => {
    if (currentResolution) setResolution(currentResolution);
  }, [currentResolution]);

  // Check if resolution is disabled based on view count and exportMode
  // Note: PDF mode bypasses the browser canvas size limit by embedding individual 5K panels
  const isResOptionDisabled = (opt: ResolutionOption): boolean => {
    if (exportMode !== 'combine_image') return false;
    if (opt === 5 && selectedViews.length > 8) return true;
    if (opt === 4 && selectedViews.length > 10) return true;
    return false;
  };

  const getResOptionTooltip = (opt: ResolutionOption): string | undefined => {
    if (exportMode !== 'combine_image') return undefined;
    if (opt === 5 && selectedViews.length > 8) {
      return 'Disabled for combined single-image sheets with >8 views (browser canvas limit). Select PDF Blueprint or Separate images for 5k.';
    }
    if (opt === 4 && selectedViews.length > 10) {
      return 'Disabled for combined single-image sheets with >10 views (browser canvas limit). Select PDF Blueprint or Separate images for 4k.';
    }
    return undefined;
  };

  // Clamping effect if user selects more views or switches to combine_image
  useEffect(() => {
    if (exportMode === 'combine_image') {
      if (resolution === 5 && selectedViews.length > 8) {
        setResolution(selectedViews.length <= 10 ? 4 : 3);
      } else if (resolution === 4 && selectedViews.length > 10) {
        setResolution(3);
      }
    }
  }, [exportMode, selectedViews.length, resolution]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isExporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExporting, onClose]);

  // Toggle single view
  const toggleView = (id: ViewExportId) => {
    setSelectedViews((prev) => {
      if (prev.includes(id)) {
        return prev.filter((v) => v !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Quick selection helpers
  const handleSelectPrimary8 = () => {
    setSelectedViews([...PRIMARY_8_IDS]);
  };

  const handleSelectPrincipal10 = () => {
    setSelectedViews([...PRINCIPAL_10_IDS]);
  };

  const handleSelectAllPresets = () => {
    setSelectedViews([...ALL_PRESETS_IDS]);
  };

  const handleSelectAll = () => {
    setSelectedViews(['current', ...ALL_PRESETS_IDS]);
  };

  const handleSelectStandard8 = () => {
    setSelectedViews([...PRIMARY_8_IDS]);
  };

  const handleSelectAllTurns = () => {
    setSelectedViews([...ALL_PRESETS_IDS]);
  };

  const handleClearSelection = () => {
    setSelectedViews([]);
  };

  const isSelected = (id: ViewExportId) => selectedViews.includes(id);

  // Resolution info
  const resolutionInfo = useMemo(() => {
    const map: Record<ResolutionOption, { panelPx: number; sheetSize: string }> = {
      1: { panelPx: 1000, sheetSize: '~4,100 × 2,360 px' },
      2: { panelPx: 2000, sheetSize: '~8,200 × 4,720 px' },
      3: { panelPx: 3000, sheetSize: '~12,300 × 7,080 px' },
      4: { panelPx: 4000, sheetSize: '~16,400 × 9,440 px' },
      5: { panelPx: 5000, sheetSize: '~20,500 × 11,800 px' },
    };
    return map[resolution] || map[1];
  }, [resolution]);

  if (!isOpen) return null;

  const handleExecuteExport = () => {
    if (selectedViews.length === 0) return;
    onStartExport({
      views: selectedViews,
      selectedViews: selectedViews,
      combineToOne,
      exportMode,
      resolution,
      destination,
    });
  };

  // Render a view button card
  const renderViewButton = (id: ViewExportId, className: string = '') => {
    const active = isSelected(id);
    const meta = VIEW_METADATA[id];

    return (
      <button
        key={id}
        type="button"
        id={`btnView_${id}`}
        onClick={() => toggleView(id)}
        className={`group relative flex flex-col items-center justify-between p-2.5 rounded-xl border transition-all duration-150 select-none cursor-pointer ${className} ${
          active
            ? isLight
              ? 'bg-emerald-50/90 border-emerald-500 shadow-sm ring-2 ring-emerald-500/20'
              : 'bg-emerald-950/40 border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.2)] ring-1 ring-emerald-500/40'
            : isLight
            ? 'bg-slate-100/80 hover:bg-slate-200/70 border-slate-300 text-slate-700'
            : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 text-slate-400 hover:text-slate-200'
        }`}
      >
        {/* Active badge */}
        <div
          className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center transition-opacity ${
            active ? 'opacity-100 bg-emerald-500 text-white' : 'opacity-0'
          }`}
        >
          <Check className="w-2.5 h-2.5 stroke-[3]" />
        </div>

        {/* Angle SVG graphic */}
        <div className="my-0.5">
          <ViewAngleGraphic id={id} isSelected={active} />
        </div>

        {/* View title label */}
        <span
          className={`text-[10px] font-bold tracking-tight text-center leading-tight whitespace-nowrap mt-1 ${
            active
              ? isLight
                ? 'text-emerald-800'
                : 'text-emerald-300'
              : isLight
              ? 'text-slate-600'
              : 'text-slate-400'
          }`}
        >
          {meta.label}
        </span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div
        className={`relative w-full max-w-4xl rounded-2xl shadow-2xl border flex flex-col max-h-[92vh] overflow-hidden transition-all ${
          isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-950 border-slate-800 text-slate-100'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 flex items-center justify-between border-b shrink-0 ${
            isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800/80 bg-slate-900/60'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shadow-xs">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold tracking-tight">Export View Images</h2>
              <p className="text-[11px] text-slate-400">
                Configure orthographic angles, multi-view composite sheets, or separate PNGs
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isLight
                ? 'border-slate-200 hover:bg-slate-100 text-slate-500'
                : 'border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title="Close dialog (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5 text-xs">
          {/* Selection Controls & Quick Select Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs uppercase tracking-wider text-slate-400">
                Select Views to Include:
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                  selectedViews.length > 0
                    ? isLight
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {selectedViews.length} of 15 selected
              </span>
            </div>

            <div className="flex items-center flex-wrap gap-1.5">
              <button
                type="button"
                id="btnSelectPrimary8"
                onClick={handleSelectPrimary8}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                }`}
                title="Select 8 Primary views (Front, Back, Top, Bottom, Left, Right, 3/4 Iso FR, 3/4 Iso FL)"
              >
                8 Primary
              </button>

              <button
                type="button"
                id="btnSelectPrincipal10"
                onClick={handleSelectPrincipal10}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                }`}
                title="Select 10 Principal views (Top, Rear/Right, Right, Front/Right, Front, Front/Left, Left, Rear/Left, Back, Bottom)"
              >
                10 Principal
              </button>

              <button
                type="button"
                id="btnSelectAllPresets"
                onClick={handleSelectAllPresets}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                }`}
                title="Select all 14 preset turns (excludes Current Viewport)"
              >
                All Presets
              </button>

              <button
                type="button"
                id="btnSelectAllViews"
                onClick={handleSelectAll}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                }`}
                title="Select all 15 views (all presets + current viewport)"
              >
                Select All
              </button>

              <button
                type="button"
                id="btnClearSelection"
                onClick={handleClearSelection}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-slate-100 hover:bg-rose-50 hover:text-rose-600 border-slate-300 text-slate-600'
                    : 'bg-slate-800 hover:bg-rose-950/40 hover:text-rose-400 border-slate-700 text-slate-400'
                }`}
                title="Clear all view selections"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Warning banner for High-Res combined sheet limits */}
          {combineToOne && selectedViews.length > 8 && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs transition-all ${
                isLight
                  ? 'bg-amber-50/90 border-amber-300 text-amber-900 shadow-xs'
                  : 'bg-amber-950/40 border-amber-600/60 text-amber-200'
              }`}
            >
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[12px] text-amber-600 dark:text-amber-400">
                  <span>Please select Separate individual images or select fewer views</span>
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">
                  {selectedViews.length > 10 ? (
                    <>
                      <strong>4K (max 10 views)</strong> and <strong>5K (max 8 views)</strong> options are disabled because combining {selectedViews.length} views into a single massive canvas exceeds browser graphics memory and causes freezing.
                    </>
                  ) : (
                    <>
                      The <strong>5K option (max 8 views)</strong> is disabled because combining {selectedViews.length} views into a single sheet exceeds browser graphics memory and causes freezing.
                    </>
                  )}
                  {' '}To export at 4K or 5K, choose <strong>Separate individual images</strong> below or select fewer views.
                </p>
              </div>
            </div>
          )}

          {/* View Selection Grid Layout (modeled after image.png with exact column alignment) */}
          <div
            className={`p-3.5 rounded-xl border space-y-2.5 overflow-x-auto ${
              isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-900/40 border-slate-800/80'
            }`}
          >
            <div className="min-w-[700px] space-y-2">
              {/* Top Row: 8 columns. Current (cols 0-1), 3/4 FR (col 2), TOP (col 3), 3/4 FL (col 4), Spacer (cols 5-7) */}
              <div className="grid grid-cols-8 gap-2">
                {/* CURRENT VIEWPORT (Leftmost, spans 2 columns) */}
                <div className="col-span-2">
                  {renderViewButton('current', 'w-full h-full min-h-[96px] justify-center')}
                </div>

                {/* FRONT/RIGHT QUARTER (Column 2 - directly aligns above FRONT/RIGHT) */}
                <div className="col-span-1">
                  {renderViewButton('front_right_quarter', 'w-full h-full min-h-[96px]')}
                </div>

                {/* TOP (Column 3 - directly aligns above FRONT) */}
                <div className="col-span-1">
                  {renderViewButton('top', 'w-full h-full min-h-[96px]')}
                </div>

                {/* FRONT/LEFT QUARTER (Column 4 - directly aligns above FRONT/LEFT) */}
                <div className="col-span-1">
                  {renderViewButton('front_left_quarter', 'w-full h-full min-h-[96px]')}
                </div>

                {/* Empty right spacer (Columns 5, 6, 7) */}
                <div className="col-span-3" />
              </div>

              {/* Middle Row: The 8 Cardinal Horizontal Turntable Views */}
              <div className="grid grid-cols-8 gap-2">
                {renderViewButton('rear_right', 'w-full min-h-[96px]')}
                {renderViewButton('right', 'w-full min-h-[96px]')}
                {renderViewButton('front_right', 'w-full min-h-[96px]')}
                {renderViewButton('front', 'w-full min-h-[96px]')}
                {renderViewButton('front_left', 'w-full min-h-[96px]')}
                {renderViewButton('left', 'w-full min-h-[96px]')}
                {renderViewButton('rear_left', 'w-full min-h-[96px]')}
                {renderViewButton('back', 'w-full min-h-[96px]')}
              </div>

              {/* Bottom Row: 8 columns. Spacer (cols 0-1), 3/4 RR (col 2), BOTTOM (col 3), 3/4 RL (col 4), Spacer (cols 5-7) */}
              <div className="grid grid-cols-8 gap-2">
                {/* Left spacer (Columns 0, 1 - exact same width as CURRENT VIEWPORT above) */}
                <div className="col-span-2" />

                {/* REAR/RIGHT QUARTER (Column 2 - directly aligns below FRONT/RIGHT) */}
                <div className="col-span-1">
                  {renderViewButton('rear_right_quarter', 'w-full h-full min-h-[96px]')}
                </div>

                {/* BOTTOM (Column 3 - directly aligns below FRONT and TOP) */}
                <div className="col-span-1">
                  {renderViewButton('bottom', 'w-full h-full min-h-[96px]')}
                </div>

                {/* REAR/LEFT QUARTER (Column 4 - directly aligns below FRONT/LEFT) */}
                <div className="col-span-1">
                  {renderViewButton('rear_left_quarter', 'w-full h-full min-h-[96px]')}
                </div>

                {/* Empty right spacer (Columns 5, 6, 7) */}
                <div className="col-span-3" />
              </div>
            </div>
          </div>

          {/* Settings Section: Layout & Resolution & Destination */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Output Layout Option */}
            <div
              className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'
              }`}
            >
              <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                <span>Output Layout / Format</span>
                {exportMode === 'combine_pdf' && (
                  <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    1:1 True Scale (5K)
                  </span>
                )}
              </label>

              <div className="space-y-2">
                <button
                  type="button"
                  id="btnOptCombineToOne"
                  onClick={() => setExportMode('combine_image')}
                  className={`w-full p-2 rounded-lg border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                    exportMode === 'combine_image'
                      ? isLight
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-1 ring-emerald-500/20'
                        : 'bg-emerald-950/40 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/40'
                      : isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                      : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      exportMode === 'combine_image'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : isLight
                        ? 'border-slate-300 bg-white'
                        : 'border-slate-600 bg-slate-800'
                    }`}
                  >
                    {exportMode === 'combine_image' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div>
                    <span className="font-bold block text-xs">Combine views to 1 image (PNG)</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Single orthographic sheet grid with dimensions & title
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  id="btnOptCombineToPdf"
                  onClick={() => setExportMode('combine_pdf')}
                  className={`w-full p-2 rounded-lg border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                    exportMode === 'combine_pdf'
                      ? isLight
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-1 ring-emerald-500/20'
                        : 'bg-emerald-950/40 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/40'
                      : isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                      : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      exportMode === 'combine_pdf'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : isLight
                        ? 'border-slate-300 bg-white'
                        : 'border-slate-600 bg-slate-800'
                    }`}
                  >
                    {exportMode === 'combine_pdf' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs">Combine to 1:1 PDF</span>
                    
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      True real-world size (1&quot; = 1&quot;), 5000px panels, header with part names & dims
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  id="btnOptSeparateImages"
                  onClick={() => setExportMode('separate_images')}
                  className={`w-full p-2 rounded-lg border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                    exportMode === 'separate_images'
                      ? isLight
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-1 ring-emerald-500/20'
                        : 'bg-emerald-950/40 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/40'
                      : isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                      : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      exportMode === 'separate_images'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : isLight
                        ? 'border-slate-300 bg-white'
                        : 'border-slate-600 bg-slate-800'
                    }`}
                  >
                    {exportMode === 'separate_images' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div>
                    <span className="font-bold block text-xs">Separate individual images (ZIP)</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Individual high-res PNG files (zipped archive)
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Panel Resolution (Moved from left sidebar) */}
            <div
              className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400">
                  Panel Resolution
                </label>
                <span className="text-[10px] font-mono text-emerald-400">
                  {resolutionInfo.panelPx} × {resolutionInfo.panelPx} px
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {([1, 2, 3, 4, 5] as ResolutionOption[]).map((opt) => {
                  const disabled = isResOptionDisabled(opt);
                  const isCur = resolution === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      id={`btnRes_${opt}k`}
                      disabled={disabled}
                      title={getResOptionTooltip(opt)}
                      onClick={() => !disabled && setResolution(opt)}
                      className={`py-2 px-1 rounded-lg font-bold text-center border transition-all ${
                        disabled
                          ? isLight
                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-50'
                            : 'bg-slate-900/40 text-slate-600 border-slate-800/80 cursor-not-allowed opacity-40'
                          : isCur
                          ? isLight
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs cursor-pointer'
                            : 'bg-emerald-500 text-slate-950 font-extrabold border-emerald-400 shadow-sm cursor-pointer'
                          : isLight
                          ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700 cursor-pointer'
                          : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300 cursor-pointer'
                      }`}
                    >
                      <span className="block text-xs">{opt}k</span>
                      <span className="block text-[9px] opacity-75 font-normal">{opt * 1000}</span>
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-400 mt-2">
                {combineToOne ? `Sheet size: ${resolutionInfo.sheetSize}` : `Each view: ${resolutionInfo.panelPx}px`}
              </p>
            </div>

            {/* Save Destination & Translucent note */}
            <div
              className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'
              }`}
            >
              <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 mb-2">
                Save Destination
              </label>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  id="btnDestDownload"
                  onClick={() => setDestination('download')}
                  className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 font-semibold text-xs transition-all cursor-pointer ${
                    destination === 'download'
                      ? isLight
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                        : 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/40'
                      : isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                      : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>

                <button
                  type="button"
                  id="btnDestDrive"
                  onClick={() => setDestination('drive')}
                  className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 font-semibold text-xs transition-all cursor-pointer ${
                    destination === 'drive'
                      ? isLight
                        ? 'bg-sky-50 border-sky-500 text-sky-900'
                        : 'bg-sky-950/40 border-sky-500 text-sky-300 ring-1 ring-sky-500/40'
                      : isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                      : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>Google Drive</span>
                </button>
              </div>

              {destination === 'drive' && (
                <div className="flex items-center gap-1.5 text-[10px] text-sky-400 px-1">
                  <FolderOpen className="w-3 h-3 shrink-0" />
                  <span className="truncate">Saving to: {driveFolderName || 'Google Drive root'}</span>
                </div>
              )}

              {/* Quality & Transparency pledge */}
              <div className="mt-1 pt-1.5 border-t border-slate-800/40 text-[10px] text-emerald-400/90 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>Translucent background • Grid {gridEnabled ? 'rendered' : 'off'} • 300 DPI</span>
              </div>
            </div>
          </div>

          {/* Export Progress Bar (visible during active export) */}
          {isExporting && (
            <div
              className={`p-3.5 rounded-xl border ${
                isLight ? 'bg-emerald-50/80 border-emerald-200' : 'bg-emerald-950/30 border-emerald-800/60'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold mb-2 text-emerald-400">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{exportProgress || 'Rendering views...'}</span>
                </div>
                {onCancelExport && (
                  <button
                    type="button"
                    onClick={onCancelExport}
                    className="text-[11px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                  >
                    Cancel Export
                  </button>
                )}
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full w-full animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className={`px-5 py-4 border-t flex flex-wrap items-center justify-between gap-3 shrink-0 ${
            isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800/80 bg-slate-900/60'
          }`}
        >
          <div className="text-xs text-slate-400">
            {selectedViews.length === 0 ? (
              <span className="text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Please select at least one view
              </span>
            ) : (
              <span>
                Ready to export <strong>{selectedViews.length}</strong> view
                {selectedViews.length > 1 ? 's' : ''} as {combineToOne ? '1 sheet' : 'separate PNG files'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className={`px-4 py-2 rounded-lg font-semibold text-xs border transition-colors cursor-pointer ${
                isLight
                  ? 'border-slate-300 hover:bg-slate-100 text-slate-700'
                  : 'border-slate-700 hover:bg-slate-800 text-slate-300'
              }`}
            >
              Close
            </button>

            <button
              type="button"
              id="btnExecuteImageExport"
              onClick={handleExecuteExport}
              disabled={isExporting || selectedViews.length === 0 || !hasModel}
              className={`px-5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 text-white transition-all shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                destination === 'drive'
                  ? 'bg-sky-600 hover:bg-sky-500 active:scale-98 shadow-sky-900/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-98 shadow-emerald-900/30'
              }`}
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Exporting...</span>
                </>
              ) : destination === 'drive' ? (
                <>
                  <Cloud className="w-4 h-4" />
                  <span>
                    Save {selectedViews.length} View{selectedViews.length > 1 ? 's' : ''} to Drive
                  </span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>
                    {exportMode === 'combine_pdf'
                      ? `Export 1:1 PDF (${selectedViews.length} Views)`
                      : combineToOne
                      ? `Export Sheet (${selectedViews.length} Views)`
                      : `Export ${selectedViews.length} Images`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
