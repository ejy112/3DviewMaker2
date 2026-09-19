import React, { useState, useEffect, useMemo } from 'react';
import {
  Film,
  X,
  Download,
  Cloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Maximize2,
  Clock,
  Gauge,
  Repeat,
  Layers,
  Palette,
  Video,
  FileVideo,
  Sliders,
  FolderOpen,
} from 'lucide-react';
import {
  ThemeMode,
  ExportAspectRatio,
  VideoFormat,
  VideoCompressionOption,
  VideoExportOptions,
  GifExportOptions,
} from '../types';

export interface VideoGifExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  hasModel?: boolean;
  isExportingVideo: boolean;
  isExportingGif: boolean;
  videoExportStatus?: string | null;
  gifProgress?: { current: number; total: number; stage: string; percent: number } | null;
  initialMode?: 'video' | 'gif';
  initialDestination?: 'download' | 'drive';
  viewportAspect?: number;
  videoEasingDefault?: boolean;
  onStartVideoExport: (options: VideoExportOptions, destination: 'download' | 'drive') => void;
  onStartGifExport: (options: GifExportOptions, destination: 'download' | 'drive') => void;
  onCancelExport?: () => void;
  showDriveOption?: boolean;
  driveFolderName?: string;
}

export const VideoGifExportModal: React.FC<VideoGifExportModalProps> = ({
  isOpen,
  onClose,
  theme,
  hasModel = true,
  isExportingVideo,
  isExportingGif,
  videoExportStatus,
  gifProgress,
  initialMode = 'video',
  initialDestination = 'download',
  viewportAspect,
  videoEasingDefault = false,
  onStartVideoExport,
  onStartGifExport,
  onCancelExport,
  showDriveOption = false,
  driveFolderName,
}) => {
  const isLight = theme === 'light';
  const isExporting = isExportingVideo || isExportingGif;

  // Mode: 'video' | 'gif'
  const [exportType, setExportType] = useState<'video' | 'gif'>(initialMode);

  // Video-specific settings
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('mp4');
  const [videoCompression, setVideoCompression] = useState<VideoCompressionOption>('high');
  const [videoEasing, setVideoEasing] = useState<boolean>(videoEasingDefault);

  // Common settings
  const [aspectRatio, setAspectRatio] = useState<ExportAspectRatio>('16:9');
  const [resolution, setResolution] = useState<480 | 720 | 1080 | 2160>(1080);
  const [duration, setDuration] = useState<number>(4);
  const [fps, setFps] = useState<number>(30);
  const [destination, setDestination] = useState<'download' | 'drive'>(initialDestination);

  // GIF-specific settings
  const [gifLooping, setGifLooping] = useState<'infinite' | 'once'>('infinite');
  const [gifDithering, setGifDithering] = useState<boolean>(true);
  const [gifBackground, setGifBackground] = useState<'viewport' | 'translucent'>('viewport');

  useEffect(() => {
    if (initialDestination) setDestination(initialDestination);
  }, [initialDestination]);

  useEffect(() => {
    if (initialMode) setExportType(initialMode);
  }, [initialMode]);

  // Adjust FPS when switching between video and gif if needed
  useEffect(() => {
    if (exportType === 'gif' && fps > 30) {
      setFps(30);
    }
  }, [exportType, fps]);

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

  // Compute dimensions
  const dimensions = useMemo(() => {
    if (aspectRatio === '1:1') {
      return { width: resolution, height: resolution, label: `${resolution} × ${resolution} px (Square 1:1)` };
    }
    if (aspectRatio === '16:9') {
      let w = 1920;
      if (resolution === 480) w = 854;
      else if (resolution === 720) w = 1280;
      else if (resolution === 1080) w = 1920;
      else if (resolution === 2160) w = 3840;
      return { width: w, height: resolution, label: `${w} × ${resolution} px (Widescreen 16:9)` };
    }
    if (aspectRatio === '9:16') {
      let h = 1920;
      if (resolution === 480) h = 854;
      else if (resolution === 720) h = 1280;
      else if (resolution === 1080) h = 1920;
      else if (resolution === 2160) h = 3840;
      return { width: resolution, height: h, label: `${resolution} × ${h} px (Vertical 9:16)` };
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

  // Estimated Size Calculation
  const estimatedSize = useMemo(() => {
    if (exportType === 'video') {
      // Bitrate based calculation: High (16 Mbps = 2MB/s), Balanced (8 Mbps = 1MB/s), Compact (4 Mbps = 0.5MB/s)
      const mbps = videoCompression === 'compact' ? 4 : videoCompression === 'balanced' ? 8 : 16;
      const baseMb = (mbps * duration) / 8;
      // Scale somewhat with resolution
      const resFactor = resolution === 2160 ? 1.5 : resolution === 1080 ? 1.0 : resolution === 720 ? 0.7 : 0.45;
      const finalEst = baseMb * resFactor;
      if (finalEst < 1) return '< 1 MB';
      return `~${Math.round(finalEst * 0.85)} – ${Math.round(finalEst * 1.15)} MB`;
    } else {
      // GIF size estimation
      const pixelFactor = (dimensions.width * dimensions.height) / (720 * 720);
      const frameFactor = totalFrames / 96;
      const baseMb = gifBackground === 'translucent' ? 5.5 : 8.0;
      const est = baseMb * pixelFactor * frameFactor;
      if (est < 1) return '< 1 MB';
      return `~${Math.round(est * 0.85)} – ${Math.round(est * 1.2)} MB`;
    }
  }, [exportType, videoCompression, duration, resolution, dimensions, totalFrames, gifBackground]);

  if (!isOpen) return null;

  const handleStartExport = () => {
    if (exportType === 'video') {
      onStartVideoExport(
        {
          format: videoFormat,
          aspectRatio,
          resolution,
          duration,
          fps: fps as 15 | 24 | 30 | 60,
          compression: videoCompression,
          videoEasing,
        },
        destination
      );
    } else {
      onStartGifExport(
        {
          aspectRatio,
          resolution,
          duration: duration as 2 | 3 | 4 | 6 | 8,
          fps: fps as 15 | 24 | 30,
          looping: gifLooping,
          dithering: gifDithering,
          background: gifBackground,
          easing: videoEasing,
        },
        destination
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div
        className={`relative w-full max-w-2xl rounded-2xl shadow-2xl border flex flex-col max-h-[92vh] overflow-hidden transition-all ${
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
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-500 shadow-xs">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold tracking-tight">Export Turntable Video / GIF</h2>
              <p className="text-[11px] text-slate-400">
                Configure 360° animation format, 4K resolution, framing, and compression
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

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
          {/* Row to switch between Video and GIF settings */}
          <div
            className={`p-1.5 rounded-xl border flex items-center gap-1.5 ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <button
              type="button"
              id="btnSelectVideoTab"
              onClick={() => setExportType('video')}
              disabled={isExporting}
              className={`flex-1 py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                exportType === 'video'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>VIDEO (MP4 / WebM)</span>
            </button>

            <button
              type="button"
              id="btnSelectGifTab"
              onClick={() => setExportType('gif')}
              disabled={isExporting}
              className={`flex-1 py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                exportType === 'gif'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-4 h-4" />
              <span>ANIMATED GIF</span>
            </button>
          </div>

          {/* Conditional Video or GIF specific options row */}
          {exportType === 'video' ? (
            <div
              className={`p-3.5 rounded-xl border space-y-3 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Output Format */}
                <div>
                  <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 block mb-1.5">
                    Video Format
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      id="btnFormatMp4"
                      onClick={() => setVideoFormat('mp4')}
                      className={`py-2 px-3 rounded-lg font-bold text-xs border text-center transition-all cursor-pointer ${
                        videoFormat === 'mp4'
                          ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                          : isLight
                          ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                          : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      MP4 (H.264)
                    </button>

                    <button
                      type="button"
                      id="btnFormatWebm"
                      onClick={() => setVideoFormat('webm')}
                      className={`py-2 px-3 rounded-lg font-bold text-xs border text-center transition-all cursor-pointer ${
                        videoFormat === 'webm'
                          ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                          : isLight
                          ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                          : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      WebM (VP9)
                    </button>
                  </div>
                </div>

                {/* Video Compression Options */}
                <div>
                  <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 block mb-1.5">
                    Quality & Bitrate
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'high' as VideoCompressionOption, label: 'High', rate: '16 Mbps' },
                      { id: 'balanced' as VideoCompressionOption, label: 'Balanced', rate: '8 Mbps' },
                      { id: 'compact' as VideoCompressionOption, label: 'Compact', rate: '4 Mbps' },
                    ].map((comp) => (
                      <button
                        key={comp.id}
                        type="button"
                        id={`btnComp_${comp.id}`}
                        onClick={() => setVideoCompression(comp.id)}
                        className={`py-1.5 px-1 rounded-lg border text-center transition-all cursor-pointer ${
                          videoCompression === comp.id
                            ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                            : isLight
                            ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                            : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300'
                        }`}
                      >
                        <span className="font-bold block text-xs">{comp.label}</span>
                        <span className="text-[9px] opacity-75 font-normal block">{comp.rate}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Video Easing Toggle */}
              <div className="pt-2.5 border-t border-slate-800/40 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs block">Turntable Easing</span>
                  <span className={`text-[11px] block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Smooth cubic acceleration start &amp; stop
                  </span>
                </div>
                <button
                  type="button"
                  id="btnToggleVideoEasing"
                  role="switch"
                  aria-checked={videoEasing}
                  onClick={() => setVideoEasing(!videoEasing)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer focus:outline-none ${
                    videoEasing ? 'bg-sky-600' : isLight ? 'bg-slate-300' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-xs ${
                      videoEasing ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          ) : (
            /* GIF Specific options row */
            <div
              className={`p-3.5 rounded-xl border space-y-3 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Background mode */}
                <div>
                  <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 block mb-1.5">
                    GIF Background
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      id="btnGifBgViewport"
                      onClick={() => setGifBackground('viewport')}
                      className={`py-1.5 px-2 rounded-lg font-semibold text-xs border text-center transition-all cursor-pointer ${
                        gifBackground === 'viewport'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : isLight
                          ? 'bg-white border-slate-300 text-slate-700'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      Viewport Scene
                    </button>
                    <button
                      type="button"
                      id="btnGifBgTranslucent"
                      onClick={() => setGifBackground('translucent')}
                      className={`py-1.5 px-2 rounded-lg font-semibold text-xs border text-center transition-all cursor-pointer ${
                        gifBackground === 'translucent'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : isLight
                          ? 'bg-white border-slate-300 text-slate-700'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      Transparent
                    </button>
                  </div>
                </div>

                {/* Looping mode */}
                <div>
                  <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 block mb-1.5">
                    Loop Playback
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      id="btnGifLoopInfinite"
                      onClick={() => setGifLooping('infinite')}
                      className={`py-1.5 px-2 rounded-lg font-semibold text-xs border text-center transition-all cursor-pointer ${
                        gifLooping === 'infinite'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : isLight
                          ? 'bg-white border-slate-300 text-slate-700'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      Infinite Loop
                    </button>
                    <button
                      type="button"
                      id="btnGifLoopOnce"
                      onClick={() => setGifLooping('once')}
                      className={`py-1.5 px-2 rounded-lg font-semibold text-xs border text-center transition-all cursor-pointer ${
                        gifLooping === 'once'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : isLight
                          ? 'bg-white border-slate-300 text-slate-700'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      Play Once
                    </button>
                  </div>
                </div>
              </div>

              {/* GIF Easing Toggle */}
              <div className="pt-2.5 border-t border-slate-800/40 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs block">Turntable Easing</span>
                  <span className={`text-[11px] block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Smooth cubic acceleration start &amp; stop
                  </span>
                </div>
                <button
                  type="button"
                  id="btnToggleGifEasing"
                  role="switch"
                  aria-checked={videoEasing}
                  onClick={() => setVideoEasing(!videoEasing)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer focus:outline-none ${
                    videoEasing ? 'bg-sky-600' : isLight ? 'bg-slate-300' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-xs ${
                      videoEasing ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Dithering Toggle */}
              <div className="pt-2.5 border-t border-slate-800/40 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs block">Palette Dithering</span>
                  <span className={`text-[11px] block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Error-diffusion for smooth color gradations without banding
                  </span>
                </div>
                <button
                  type="button"
                  id="btnToggleGifDithering"
                  role="switch"
                  aria-checked={gifDithering}
                  onClick={() => setGifDithering(!gifDithering)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer focus:outline-none ${
                    gifDithering ? 'bg-sky-600' : isLight ? 'bg-slate-300' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-xs ${
                      gifDithering ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Aspect Ratio Options (16:9, 1:1, 9:16, Viewport) */}
          <div>
            <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 block mb-1.5">
              Aspect Ratio
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: '16:9' as ExportAspectRatio, title: '16:9', sub: 'Widescreen' },
                { id: '1:1' as ExportAspectRatio, title: '1:1', sub: 'Square' },
                { id: '9:16' as ExportAspectRatio, title: '9:16', sub: 'Vertical / Reels' },
                { id: 'viewport' as ExportAspectRatio, title: 'Viewport', sub: 'Match Canvas' },
              ].map((asp) => (
                <button
                  key={asp.id}
                  type="button"
                  id={`btnAspect_${asp.id.replace(':', '_')}`}
                  onClick={() => setAspectRatio(asp.id)}
                  className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    aspectRatio === asp.id
                      ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                      : isLight
                      ? 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                  }`}
                >
                  <span className="font-bold block text-xs">{asp.title}</span>
                  <span className="text-[10px] opacity-75 block font-normal">{asp.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution Options (With 4k Option added as requested) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400">
                Resolution
              </label>
              <span className="text-[11px] font-mono text-sky-400">{dimensions.label}</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { res: 480 as const, label: '480p', desc: 'Fast / Compact' },
                { res: 720 as const, label: '720p', desc: 'HD Quality' },
                { res: 1080 as const, label: '1080p', desc: 'Full HD' },
                { res: 2160 as const, label: '4K (2160p)', desc: 'Ultra High-Res' },
              ].map((item) => (
                <button
                  key={item.res}
                  type="button"
                  id={`btnVideoRes_${item.res}`}
                  onClick={() => setResolution(item.res)}
                  className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    resolution === item.res
                      ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                      : isLight
                      ? 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                  }`}
                >
                  <span className="font-bold block text-xs">{item.label}</span>
                  <span className="text-[9px] opacity-75 block font-normal">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Duration & FPS settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Duration */}
            <div>
              <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 block mb-1.5">
                Duration (Full 360° Turn)
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {[2, 3, 4, 6, 8].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    id={`btnDur_${sec}s`}
                    onClick={() => setDuration(sec)}
                    className={`py-1.5 px-1 rounded-lg border text-center font-bold text-xs transition-all cursor-pointer ${
                      duration === sec
                        ? 'bg-sky-600 text-white border-sky-600'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-slate-900 border-slate-800 text-slate-300'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            {/* FPS */}
            <div>
              <label className="font-bold text-[11px] uppercase tracking-wider text-slate-400 block mb-1.5">
                Framerate (FPS)
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(exportType === 'video' ? [15, 24, 30, 60] : [15, 24, 30]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    id={`btnFps_${f}`}
                    onClick={() => setFps(f)}
                    className={`py-1.5 px-1 rounded-lg border text-center font-bold text-xs transition-all cursor-pointer ${
                      fps === f
                        ? 'bg-sky-600 text-white border-sky-600'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-slate-900 border-slate-800 text-slate-300'
                    }`}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Destination & Output Row with Settings summary & Estimated size */}
          <div
            className={`p-3.5 rounded-xl border space-y-2.5 ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/60 border-slate-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[11px] uppercase tracking-wider text-slate-400">
                Destination:
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btnVideoDestDownload"
                  onClick={() => setDestination('download')}
                  className={`py-1 px-2.5 rounded-md text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                    destination === 'download'
                      ? 'bg-sky-600 text-white border-sky-600'
                      : isLight
                      ? 'bg-white border-slate-300 text-slate-700'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>

                <button
                  type="button"
                  id="btnVideoDestDrive"
                  onClick={() => setDestination('drive')}
                  className={`py-1 px-2.5 rounded-md text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                    destination === 'drive'
                      ? 'bg-sky-600 text-white border-sky-600'
                      : isLight
                      ? 'bg-white border-slate-300 text-slate-700'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>Google Drive</span>
                </button>
              </div>
            </div>

            {destination === 'drive' && (
              <div className="flex items-center gap-1.5 text-[10px] text-sky-400">
                <FolderOpen className="w-3 h-3 shrink-0" />
                <span className="truncate">Destination: {driveFolderName || 'Google Drive root'}</span>
              </div>
            )}

            {/* Output settings summary & estimated size row (as requested by user) */}
            <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-2 text-slate-300">
                <span className="px-2 py-0.5 rounded-md bg-sky-950/60 border border-sky-800 text-sky-300 font-bold font-mono text-[10px]">
                  {exportType === 'video' ? videoFormat.toUpperCase() : 'GIF'}
                </span>
                <span>
                  {dimensions.width}×{dimensions.height} • {duration}s @ {fps}fps
                  {exportType === 'video' && ` • ${videoCompression}`}
                  {exportType === 'video' && videoEasing && ' • Eased'}
                </span>
              </div>
              <div className="font-mono text-emerald-400 font-bold">
                Est. Size: {estimatedSize}
              </div>
            </div>
          </div>

          {/* Progress / Status during active export */}
          {isExporting && (
            <div
              className={`p-3.5 rounded-xl border ${
                isLight ? 'bg-sky-50 border-sky-200' : 'bg-sky-950/30 border-sky-800/60'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold mb-2 text-sky-400">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {isExportingVideo
                      ? videoExportStatus || 'Encoding turntable video...'
                      : gifProgress?.stage || 'Encoding GIF animation...'}
                  </span>
                </div>
                {onCancelExport && (
                  <button
                    type="button"
                    onClick={onCancelExport}
                    className="text-[11px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-sky-500 h-full transition-all duration-200"
                  style={{
                    width: isExportingGif && gifProgress ? `${gifProgress.percent}%` : '100%',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-4 border-t flex items-center justify-between gap-3 shrink-0 ${
            isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800/80 bg-slate-900/60'
          }`}
        >
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

          {/* Export Button reflects Video or GIF depending on selection */}
          <button
            type="button"
            id="btnExecuteVideoGifExport"
            onClick={handleStartExport}
            disabled={isExporting || !hasModel}
            className="px-5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 text-white bg-sky-600 hover:bg-sky-500 active:scale-98 shadow-md shadow-sky-900/30 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                  {exportType === 'video'
                    ? `Save ${videoFormat.toUpperCase()} to Google Drive`
                    : 'Save GIF to Google Drive'}
                </span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  {exportType === 'video'
                    ? `Export Video (${videoFormat.toUpperCase()})`
                    : 'Export GIF'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
