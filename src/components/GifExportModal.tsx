import React, { useState, useEffect, useMemo } from 'react';
import {
  Film,
  X,
  Download,
  Cloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Maximize2,
  Clock,
  Gauge,
  Repeat,
  Layers,
  Palette,
} from 'lucide-react';
import { ThemeMode, GifExportOptions, GifAspectRatio } from '../types';

export interface GifExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  hasModel?: boolean;
  isExporting: boolean;
  progress: { current: number; total: number; stage: string; percent: number } | null;
  generatedBlob?: Blob | null;
  generatedUrl?: string | null;
  generatedFileName?: string | null;
  initialDestination?: 'download' | 'drive';
  viewportAspect?: number;
  onStartExport: (options: GifExportOptions, destination: 'download' | 'drive') => void;
  onCancelExport?: () => void;
  onSaveToDrive?: (blob: Blob, fileName: string) => void;
  showDriveOption?: boolean;
}

export const GifExportModal: React.FC<GifExportModalProps> = ({
  isOpen,
  onClose,
  theme,
  hasModel = true,
  isExporting,
  progress,
  generatedBlob = null,
  generatedUrl = null,
  generatedFileName = null,
  initialDestination = 'download',
  viewportAspect,
  onStartExport,
  onCancelExport,
  onSaveToDrive,
  showDriveOption = false,
}) => {
  const isLight = theme === 'light';

  // Configurable options
  const [aspectRatio, setAspectRatio] = useState<GifAspectRatio>('viewport');
  const [resolution, setResolution] = useState<480 | 720 | 1080>(720);
  const [duration, setDuration] = useState<3 | 4 | 6 | 8>(4);
  const [fps, setFps] = useState<15 | 24 | 30>(24);
  const [looping, setLooping] = useState<'infinite' | 'once'>('infinite');
  const [dithering, setDithering] = useState<boolean>(true);
  const [easing, setEasing] = useState<boolean>(false);
  const [background, setBackground] = useState<'viewport' | 'translucent'>('viewport');
  const [targetDestination, setTargetDestination] = useState<'download' | 'drive'>(initialDestination);

  useEffect(() => {
    if (initialDestination) {
      setTargetDestination(initialDestination);
    }
  }, [initialDestination]);

  // Compute dimensions and estimates
  const dimensions = useMemo(() => {
    if (aspectRatio === '1:1') {
      return { width: resolution, height: resolution, label: `${resolution} × ${resolution} px (Square 1:1)` };
    }
    if (aspectRatio === '16:9') {
      const w = resolution === 480 ? 854 : resolution === 720 ? 1280 : 1920;
      return { width: w, height: resolution, label: `${w} × ${resolution} px (Widescreen 16:9)` };
    }
    // Match Viewport
    const aspect = viewportAspect && viewportAspect > 0 ? viewportAspect : 16 / 9;
    let w: number;
    let h: number;
    if (aspect >= 1) {
      h = resolution;
      w = Math.round(resolution * aspect);
    } else {
      w = resolution;
      h = Math.round(resolution / aspect);
    }
    if (w % 2 !== 0) w += 1;
    if (h % 2 !== 0) h += 1;
    return { width: w, height: h, label: `${w} × ${h} px (Viewport ~${aspect.toFixed(2)}:1)` };
  }, [aspectRatio, resolution, viewportAspect]);

  const totalFrames = useMemo(() => {
    return Math.round(duration * fps);
  }, [duration, fps]);

  const estimatedSize = useMemo(() => {
    const pixelFactor = (dimensions.width * dimensions.height) / (720 * 720);
    const frameFactor = totalFrames / 96;
    const baseMb = background === 'translucent' ? 5.5 : 8.0;
    const est = baseMb * pixelFactor * frameFactor;
    if (est < 1) return '< 1 MB';
    if (est < 15) return `~${Math.round(est * 0.8)} – ${Math.round(est * 1.2)} MB`;
    return `~${Math.round(est * 0.85)} – ${Math.round(est * 1.15)} MB`;
  }, [dimensions, totalFrames, background]);

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

  if (!isOpen) return null;

  const handleStart = (dest: 'download' | 'drive') => {
    setTargetDestination(dest);
    onStartExport(
      {
        aspectRatio,
        resolution,
        duration,
        fps,
        looping,
        dithering,
        background,
        easing,
      },
      dest
    );
  };

  const formattedBlobSize = generatedBlob
    ? generatedBlob.size > 1024 * 1024
      ? `${(generatedBlob.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(generatedBlob.size / 1024).toFixed(1)} KB`
    : null;

  return (
    <div
      id="gif-export-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExporting) onClose();
      }}
    >
      <div
        id="gif-export-modal"
        role="dialog"
        aria-modal="true"
        className={`relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border transition-all ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-slate-900 border-slate-700 text-slate-100'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/90 border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 text-emerald-500 border border-emerald-500/30">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-tight">Export Turntable GIF</h3>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Frame-perfect 360° animated GIF generator for slides, docs, and chat
              </p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-gif-modal"
            onClick={onClose}
            disabled={isExporting}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-40 ${
              isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-slate-700 text-slate-400'
            }`}
            title="Close popup"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Completed State: Preview & Final Download */}
          {generatedUrl && generatedBlob && !isExporting ? (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <span className="font-semibold text-xs text-emerald-300">
                      Turntable GIF generated successfully!
                    </span>
                    <div className="text-[11px] text-emerald-400/80 font-mono">
                      {generatedFileName} • {formattedBlobSize}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-mono px-2 py-1 rounded bg-emerald-500/20 text-emerald-300">
                  {dimensions.width}×{dimensions.height} • {totalFrames} frames
                </span>
              </div>

              {/* GIF Live Preview */}
              <div
                className={`relative flex items-center justify-center rounded-xl p-4 border overflow-hidden ${
                  isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'
                }`}
              >
                <img
                  src={generatedUrl}
                  alt="Turntable GIF Preview"
                  className="max-h-72 object-contain rounded-lg shadow-lg"
                />
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    // Reset to export another
                    onCancelExport();
                  }}
                  className={`px-3.5 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  Configure Another
                </button>

                <div className="flex items-center gap-2">
                  {showDriveOption && (
                    <button
                      type="button"
                      onClick={() => onSaveToDrive(generatedBlob, generatedFileName || 'Turnaround.gif')}
                      className="px-4 py-2 rounded-lg font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
                    >
                      <Cloud className="w-4 h-4" />
                      <span>Save to Drive</span>
                    </button>
                  )}

                  <a
                    href={generatedUrl}
                    download={generatedFileName || 'Turnaround.gif'}
                    className="px-4 py-2 rounded-lg font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download .gif</span>
                  </a>

                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          ) : isExporting ? (
            /* Exporting In-Progress State */
            <div className="py-8 px-4 flex flex-col items-center justify-center text-center space-y-5 animate-in fade-in duration-200">
              <div className="relative flex items-center justify-center">
                <div className="w-20 h-20 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                <Film className="w-8 h-8 text-emerald-400 absolute" />
              </div>

              <div className="space-y-1.5 max-w-md">
                <h4 className="font-bold text-sm text-emerald-400">
                  {progress?.stage || 'Capturing Turntable Frames...'}
                </h4>
                <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Rendering seamless 360° orbit at {dimensions.width}×{dimensions.height} with 256-color quantization
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full max-w-md space-y-2">
                <div className="flex justify-between text-[11px] font-mono text-slate-400">
                  <span>
                    Frame {progress?.current || 0} of {progress?.total || totalFrames}
                  </span>
                  <span>{Math.round(progress?.percent || 0)}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-700/50 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-150 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, progress?.percent || 0))}%` }}
                  />
                </div>
              </div>

              {/* Cancel Button */}
              <button
                type="button"
                id="btn-cancel-gif-export"
                onClick={onCancelExport}
                className="mt-4 px-4 py-2 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors font-medium cursor-pointer"
              >
                Cancel Export
              </button>
            </div>
          ) : (
            /* Configuration Options View */
            <>
              {/* Option 1: Aspect Ratio */}
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Framing Aspect Ratio</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAspectRatio('viewport')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      aspectRatio === 'viewport'
                        ? 'bg-emerald-500/15 border-emerald-500/60 ring-1 ring-emerald-500/40'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                        : 'bg-slate-800/60 border-slate-700/70 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs">Match Viewport</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                        Video Match
                      </span>
                    </div>
                    <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      Exact 3D viewport framing with zero stretching (matches MP4/WebM video export).
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('1:1')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      aspectRatio === '1:1'
                        ? 'bg-emerald-500/15 border-emerald-500/60 ring-1 ring-emerald-500/40'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                        : 'bg-slate-800/60 border-slate-700/70 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs">Square (1:1)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                        Product
                      </span>
                    </div>
                    <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      Equal width and height with calibrated camera frustum. Zero model distortion.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('16:9')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      aspectRatio === '16:9'
                        ? 'bg-emerald-500/15 border-emerald-500/60 ring-1 ring-emerald-500/40'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                        : 'bg-slate-800/60 border-slate-700/70 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs">Widescreen (16:9)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                        Slides
                      </span>
                    </div>
                    <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      Standard presentation widescreen with calibrated camera frustum. Zero model distortion.
                    </span>
                  </button>
                </div>
              </div>

              {/* Option 2: Resolution */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Resolution</span>
                  </label>
                  <span className="text-[11px] font-mono text-emerald-400 font-medium">
                    {dimensions.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { val: 480, name: '480p', hint: 'Compact File' },
                    { val: 720, name: '720p', hint: 'Recommended' },
                    { val: 1080, name: '1080p', hint: 'High-Res Master' },
                  ].map((res) => (
                    <button
                      key={res.val}
                      type="button"
                      onClick={() => setResolution(res.val as 480 | 720 | 1080)}
                      className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer ${
                        resolution === res.val
                          ? 'bg-emerald-500/15 border-emerald-500/60 ring-1 ring-emerald-500/40'
                          : isLight
                          ? 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                          : 'bg-slate-800/60 border-slate-700/70 hover:bg-slate-800'
                      }`}
                    >
                      <div className="font-bold text-xs">{res.name}</div>
                      <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        {res.hint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Option 3: Duration & FPS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Duration */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
                      <Clock className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Duration (360° Orbit)</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([3, 4, 6, 8] as const).map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => setDuration(sec)}
                        className={`py-2 px-1 text-center rounded-lg border transition-all cursor-pointer ${
                          duration === sec
                            ? 'bg-emerald-500/15 border-emerald-500/60 font-bold text-emerald-300'
                            : isLight
                            ? 'bg-slate-50 border-slate-200 text-slate-700'
                            : 'bg-slate-800/60 border-slate-700 text-slate-300'
                        }`}
                      >
                        {sec}s {sec === 4 && <span className="text-[9px] block opacity-70">Def</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Frame Rate */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
                      <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Frame Rate (FPS)</span>
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">
                      {totalFrames} total frames
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { val: 15, label: '15 FPS', sub: 'Tiny' },
                      { val: 24, label: '24 FPS', sub: 'Smooth' },
                      { val: 30, label: '30 FPS', sub: 'Fluid' },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setFps(item.val as 15 | 24 | 30)}
                        className={`py-2 px-1 text-center rounded-lg border transition-all cursor-pointer ${
                          fps === item.val
                            ? 'bg-emerald-500/15 border-emerald-500/60 font-bold text-emerald-300'
                            : isLight
                            ? 'bg-slate-50 border-slate-200 text-slate-700'
                            : 'bg-slate-800/60 border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="text-xs">{item.label}</div>
                        <div className="text-[9px] opacity-70">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Option 4: Looping & Background */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Looping */}
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
                    <Repeat className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Playback Looping</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLooping('infinite')}
                      className={`py-2 px-2 text-center rounded-lg border transition-all cursor-pointer ${
                        looping === 'infinite'
                          ? 'bg-emerald-500/15 border-emerald-500/60 font-bold text-emerald-300'
                          : isLight
                          ? 'bg-slate-50 border-slate-200 text-slate-700'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300'
                      }`}
                    >
                      Infinite Loop
                    </button>
                    <button
                      type="button"
                      onClick={() => setLooping('once')}
                      className={`py-2 px-2 text-center rounded-lg border transition-all cursor-pointer ${
                        looping === 'once'
                          ? 'bg-emerald-500/15 border-emerald-500/60 font-bold text-emerald-300'
                          : isLight
                          ? 'bg-slate-50 border-slate-200 text-slate-700'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300'
                      }`}
                    >
                      Play Once (1 Time)
                    </button>
                  </div>
                </div>

                {/* Background */}
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
                    <Palette className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Background Plate</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setBackground('viewport')}
                      className={`py-2 px-2 text-center rounded-lg border transition-all cursor-pointer ${
                        background === 'viewport'
                          ? 'bg-emerald-500/15 border-emerald-500/60 font-bold text-emerald-300'
                          : isLight
                          ? 'bg-slate-50 border-slate-200 text-slate-700'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300'
                      }`}
                    >
                      Viewport Backdrop
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackground('translucent')}
                      className={`py-2 px-2 text-center rounded-lg border transition-all cursor-pointer ${
                        background === 'translucent'
                          ? 'bg-emerald-500/15 border-emerald-500/60 font-bold text-emerald-300'
                          : isLight
                          ? 'bg-slate-50 border-slate-200 text-slate-700'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300'
                      }`}
                    >
                      Translucent
                    </button>
                  </div>
                </div>
              </div>

              {/* Turntable Easing Option */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-4 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/40 border-slate-700/60'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-xs flex items-center gap-2">
                    <span>Turntable Easing</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">
                      Smooth Motion
                    </span>
                  </div>
                  <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Applies smooth cubic acceleration start and stop to the rotation cycle.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={easing}
                    onChange={(e) => setEasing(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                </label>
              </div>

              {/* Option 5: Dithering and Quantization info */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-4 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/40 border-slate-700/60'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-xs flex items-center gap-2">
                    <span>Floyd-Steinberg Dithering</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                      256 Max Colors
                    </span>
                  </div>
                  <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Diffuses color quantization error across pixels to prevent color banding on LookDev shaders and gradients.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={dithering}
                    onChange={(e) => setDithering(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {/* Summary spec badge */}
              <div
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-[11px] ${
                  isLight ? 'bg-emerald-50/60 border-emerald-200/60 text-emerald-800' : 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Output: <strong>{dimensions.width}×{dimensions.height}</strong> • <strong>{totalFrames} frames</strong> ({fps} fps @ {duration}s)
                  </span>
                </div>
                <div className="font-mono text-emerald-400 font-semibold">
                  Est. Size: {estimatedSize}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        {!generatedUrl && !isExporting && (
          <div
            className={`flex items-center justify-between px-5 py-3.5 border-t shrink-0 ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/90 border-slate-700'
            }`}
          >
            <button
              type="button"
              id="btn-cancel-gif-dialog"
              onClick={onClose}
              className={`px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-slate-700 text-slate-300'
              }`}
            >
              Cancel
            </button>

            <div className="flex items-center gap-2">
              {showDriveOption && (
                <button
                  type="button"
                  id="btn-export-gif-drive"
                  disabled={!hasModel}
                  onClick={() => handleStart('drive')}
                  className="px-4 py-2 rounded-lg font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  title="Export and save to Google Drive"
                >
                  <Cloud className="w-4 h-4" />
                  <span>Export to Drive</span>
                </button>
              )}

              <button
                type="button"
                id="btn-export-gif-download"
                disabled={!hasModel}
                onClick={() => handleStart('download')}
                className="px-5 py-2 rounded-lg font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white flex items-center gap-2 transition-all cursor-pointer shadow-md"
              >
                <Film className="w-4 h-4" />
                <span>Export GIF (Download)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
