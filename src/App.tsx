/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreeViewport, ThreeViewportHandle, VolumeStats } from './components/ThreeViewport';
import { DriveModal } from './components/DriveModal';
import { GifExportModal } from './components/GifExportModal';
import { ImageExportModal } from './components/ImageExportModal';
import { VideoGifExportModal } from './components/VideoGifExportModal';
import { HotkeyModal } from './components/HotkeyModal';
import {
  DriveSaveOptions,
  GifExportOptions,
  VideoExportOptions,
  ImageExportConfig,
  ImageExportMode,
  LoadedPart,
  ModelDimensions,
  ResolutionOption,
  SelectedPartBounds,
  SnapDirection,
  ThemeMode,
  ViewerSettings,
  ViewExportId,
} from './types';
import { Menu, RotateCw, ZoomIn } from 'lucide-react';

export default function App() {
  const viewportRef = useRef<ThreeViewportHandle>(null);

  // Theme Mode (applies to sidebar/navigation chrome)
  const [theme, setTheme] = useState<ThemeMode>('dark');

  // Viewer Settings
  const [settings, setSettings] = useState<ViewerSettings>({
    material: 'grey',
    minThicknessInches: 0.06,
    isOrtho: true,
    focalLength: 50,

    showGrid: false,
    gridSquareSizeInches: 0.125,
    gridMajorEveryInches: 1,
    gridMinorColorHex: '#334155',
    gridMajorColorHex: '#38bdf8',

    castShadows: false,
    shadowSoftness: 40,
    shadowDarkness: 70,
    shadowMapResolution: 2048,

    lockLightsToCamera: true,
    contrastPercent: 100,
    backgroundColorHex: '#1e293b',
    vignetteEnabled: false,
    vignetteColorHex: '#000000',
    vignetteIntensityPercent: 50,

    opacityPercent: 100,
    wireframeColorHex: '#38bdf8',
    customColorHex: '#9a9a9a',
    customRoughnessPercent: 95,
    customMetalnessPercent: 0,
    sketchColorHex: '#94a3b8',
    sketchHighlightColorHex: '#e2e8f0',
    sketchShadowColorHex: '#334155',

    draftPullDirection: '+Y',
    draftSafeAngleDeg: 3.0,
    draftWarningAngleDeg: 1.0,

    environmentPreset: 'none',
    hdrRotationDeg: 0,
    envIntensity: 100,

    clipping: {
      x: { enabled: false, offsetPercent: 0, offsetInches: 0, flip: false },
      y: { enabled: false, offsetPercent: 0, offsetInches: 0, flip: false },
      z: { enabled: false, offsetPercent: 0, offsetInches: 0, flip: false },
      solidCaps: true,
      capOpacity: 1.0,
      capColor: '#e11d48',
      capHatching: false,
    },

    antialiasMode: 'none',
    ssaoEnabled: false,
    ssaoRadius: 20, // % of the model's radius — keeps AO detail scale-correct across unit systems
    ssaoIntensity: 120, // % strength, 100 = neutral
    ssaoBias: 20, // % — trades self-occlusion noise vs. missed fine detail
    ssrQuality: 'off',

    materialDensityGCm3: 1.1,
    costPerKgUSD: 4,

    explodeAmount: 0,

    turntableDirection: 'cw',
    turntableSpeed: 'normal',
    videoEasing: false,
  });

  // Model Dimensions & Transform
  const [dimensions, setDimensions] = useState<ModelDimensions>({
    scaleFactor: 1.0,
    widthInches: 0,
    heightInches: 0,
    depthInches: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
  });

  const [hasModel, setHasModel] = useState(false);
  const [loadedFileName, setLoadedFileName] = useState<string>('model');
  const [isTurntableActive, setIsTurntableActive] = useState(false);
  const [resolution, setResolution] = useState<ResolutionOption>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [volumeStats, setVolumeStats] = useState<VolumeStats | null>(null);
  const [parts, setParts] = useState<LoadedPart[]>([]);
  const [isolatedPartName, setIsolatedPartName] = useState<string | null>(null);
  const [selectedPartIndex, setSelectedPartIndex] = useState<number | null>(null);
  const [selectedPartIndices, setSelectedPartIndices] = useState<number[]>([]);
  const [selectedPartInfo, setSelectedPartInfo] = useState<SelectedPartBounds | null>(null);

  // Export State
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [exportImageTarget, setExportImageTarget] = useState<'turns' | 'threeQuarter' | 'allSeparate' | null>(null);
  const [exportImageStatus, setExportImageStatus] = useState('');
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportVideoStatus, setExportVideoStatus] = useState('');
  const [isExportingGif, setIsExportingGif] = useState(false);
  const [exportGifStatus, setExportGifStatus] = useState('');
  const [gifModalOpen, setGifModalOpen] = useState(false);
  const [gifExportDestination, setGifExportDestination] = useState<'download' | 'drive'>('download');
  const [gifProgress, setGifProgress] = useState<{ current: number; total: number; stage: string; percent: number } | null>(null);
  const [viewportAspect, setViewportAspect] = useState<number>(16 / 9);
  const gifAbortRef = useRef<{ current: boolean }>({ current: false });

  // Dedicated Export Modals State
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageExportDestination, setImageExportDestination] = useState<'download' | 'drive'>('download');
  const [videoGifModalOpen, setVideoGifModalOpen] = useState(false);
  const [videoGifModalInitialMode, setVideoGifModalInitialMode] = useState<'video' | 'gif'>('video');
  const [videoGifExportDestination, setVideoGifExportDestination] = useState<'download' | 'drive'>('download');

  // Google Drive Modal State
  const [driveModalOpen, setDriveModalOpen] = useState(false);
  const [driveModalMode, setDriveModalMode] = useState<'import' | 'save'>('import');
  const [driveSaveOptions, setDriveSaveOptions] = useState<DriveSaveOptions | null>(null);

  // Hotkey Cheatsheet Modal State
  const [isHotkeyModalOpen, setIsHotkeyModalOpen] = useState(false);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleUpdateSettings = (partial: Partial<ViewerSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  const handleUpdateDimensions = (partial: Partial<ModelDimensions>) => {
    setDimensions((prev) => ({ ...prev, ...partial }));
  };

  const handleUpdateDimensionField = (
    field: 'scale' | 'x' | 'y' | 'z' | 'rotX' | 'rotY' | 'rotZ',
    value: number
  ) => {
    viewportRef.current?.updateDimension(field, value);
  };

  const handleModelLoaded = (name: string) => {
    setHasModel(true);
    setLoadedFileName(name);
  };

  const handleUploadLocalFile = (file: File) => {
    viewportRef.current?.loadModelFromFile(file);
  };

  const handleUploadBatchFiles = (files: File[]) => {
    viewportRef.current?.loadModelsFromFiles(files);
  };

  const handleTogglePartVisibility = (index: number) => {
    viewportRef.current?.togglePartVisibility(index);
  };

  const handleDeletePart = (index: number) => {
    viewportRef.current?.deletePart(index);
  };

  const handleOpenDriveModal = (mode: 'import') => {
    setDriveModalMode(mode);
    setDriveModalOpen(true);
  };

  const handleDriveModelSelected = (file: File) => {
    viewportRef.current?.loadModelFromFile(file);
  };

  const handleDriveModelsSelected = (files: File[]) => {
    viewportRef.current?.loadModelsFromFiles(files);
  };

  const handleDeleteHiddenParts = () => {
    viewportRef.current?.deleteHiddenParts();
  };

  // Turnaround Sheet Image Export
  const handleExportTurns = (destination: 'download' | 'drive') => {
    if (!viewportRef.current || !hasModel) return;

    setIsExportingImage(true);
    setExportImageTarget('turns');
    setExportImageStatus('Preparing...');

    viewportRef.current.exportTurnaroundImage(
      resolution,
      (blob, fileName) => {
        setIsExportingImage(false);
        setExportImageTarget(null);
        setExportImageStatus('');

        if (destination === 'drive') {
          setDriveSaveOptions({
            fileName,
            mimeType: 'image/png',
            blob,
          });
          setDriveModalMode('save');
          setDriveModalOpen(true);
        } else {
          // Instant local download (default behavior requested by user)
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      },
      (status) => {
        setExportImageStatus(status);
      }
    );
  };

  // 3/4 Views Sheet Image Export (4 Cardinal 3/4 Views rotated 45 deg on Y axis, not elevated)
  const handleExportThreeQuarterViews = (destination: 'download' | 'drive') => {
    if (!viewportRef.current || !hasModel) return;

    setIsExportingImage(true);
    setExportImageTarget('threeQuarter');
    setExportImageStatus('Preparing...');

    viewportRef.current.exportThreeQuarterViewsImage(
      resolution,
      (blob, fileName) => {
        setIsExportingImage(false);
        setExportImageTarget(null);
        setExportImageStatus('');

        if (destination === 'drive') {
          setDriveSaveOptions({
            fileName,
            mimeType: 'image/png',
            blob,
          });
          setDriveModalMode('save');
          setDriveModalOpen(true);
        } else {
          // Instant local download
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      },
      (status) => {
        setExportImageStatus(status);
      }
    );
  };

  // Export All as Separate (Turnaround + 3/4 Views as individual PNGs in a single ZIP download)
  const handleExportAllSeparate = (destination: 'download' | 'drive') => {
    if (!viewportRef.current || !hasModel) return;

    setIsExportingImage(true);
    setExportImageTarget('allSeparate');
    setExportImageStatus('Preparing...');

    viewportRef.current.exportAllSeparateImages(
      resolution,
      (blob, fileName) => {
        setIsExportingImage(false);
        setExportImageTarget(null);
        setExportImageStatus('');

        if (destination === 'drive') {
          setDriveSaveOptions({
            fileName,
            mimeType: 'application/zip',
            blob,
          });
          setDriveModalMode('save');
          setDriveModalOpen(true);
        } else {
          // Instant local download
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      },
      (status) => {
        setExportImageStatus(status);
      }
    );
  };

  // Video Export (MP4 or WebM)
  const handleExportVideo = async (
    format: 'mp4' | 'webm',
    destination: 'download' | 'drive'
  ) => {
    if (!viewportRef.current || !hasModel) return;

    setIsExportingVideo(true);
    const label = format.toUpperCase();
    setExportVideoStatus(`Starting ${label}...`);

    try {
      await viewportRef.current.exportTurntableVideo(
        format,
        (blob, fileName) => {
          setIsExportingVideo(false);
          setExportVideoStatus('');

          if (destination === 'drive') {
            setDriveSaveOptions({
              fileName,
              mimeType: format === 'mp4' ? 'video/mp4' : 'video/webm',
              blob,
            });
            setDriveModalMode('save');
            setDriveModalOpen(true);
          } else {
            // Instant local download (default behavior requested by user)
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        },
        (status) => {
          setExportVideoStatus(`${label}: ${status}`);
        }
      );
    } catch (err: any) {
      console.error(err);
      setIsExportingVideo(false);
      setExportVideoStatus('');
      alert(`Video Export Error: ${err?.message || 'Recording failed'}`);
    }
  };

  // Image Views Export Modal Handlers
  const handleOpenImageModal = (destination: 'download' | 'drive' = 'download') => {
    setImageExportDestination(destination);
    setImageModalOpen(true);
  };

  const handleStartCustomImageExport = async (config: {
    views?: ViewExportId[];
    selectedViews?: ViewExportId[];
    combineToOne: boolean;
    exportMode?: ImageExportMode;
    resolution: ResolutionOption;
    destination: 'download' | 'drive';
  }) => {
    if (!viewportRef.current || !hasModel) return;

    const exportViews = config.selectedViews || config.views || [];
    if (exportViews.length === 0) {
      alert('Please select at least one view to export.');
      return;
    }

    setIsExportingImage(true);
    setExportImageStatus('Preparing image views...');

    try {
      if (viewportRef.current.exportCustomImageViews) {
        await viewportRef.current.exportCustomImageViews(
          {
            ...config,
            selectedViews: exportViews,
            views: exportViews,
          },
          (blob, fileName) => {
            setIsExportingImage(false);
            setExportImageStatus('');
            setImageModalOpen(false);

            if (config.destination === 'drive') {
              const mimeType = fileName.endsWith('.pdf')
                ? 'application/pdf'
                : fileName.endsWith('.zip')
                ? 'application/zip'
                : 'image/png';
              setDriveSaveOptions({
                fileName,
                mimeType,
                blob,
              });
              setDriveModalMode('save');
              setDriveModalOpen(true);
            } else {
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = fileName;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }
          },
          (status) => {
            setExportImageStatus(status);
          }
        );
      } else {
        throw new Error('Image export service is not ready.');
      }
    } catch (err: any) {
      console.error(err);
      setIsExportingImage(false);
      setExportImageStatus('');
      alert(`Image Export Error: ${err?.message || 'Export failed'}`);
    }
  };

  // Turntable Video / GIF Modal Handlers
  const handleOpenVideoGifModal = (
    initialMode: 'video' | 'gif' = 'video',
    destination: 'download' | 'drive' = 'download'
  ) => {
    setVideoGifModalInitialMode(initialMode);
    setVideoGifExportDestination(destination);
    if (viewportRef.current?.getViewportAspect) {
      setViewportAspect(viewportRef.current.getViewportAspect());
    }
    setVideoGifModalOpen(true);
  };

  const handleStartVideoExportFromModal = async (
    options: VideoExportOptions,
    destination: 'download' | 'drive' = 'download'
  ) => {
    if (!viewportRef.current || !hasModel) return;

    setIsExportingVideo(true);
    const label = options.format.toUpperCase();
    setExportVideoStatus(`Starting ${label}...`);

    try {
      await viewportRef.current.exportTurntableVideo(
        options,
        (blob, fileName) => {
          setIsExportingVideo(false);
          setExportVideoStatus('');
          setVideoGifModalOpen(false);

          if (destination === 'drive') {
            setDriveSaveOptions({
              fileName,
              mimeType: options.format === 'mp4' ? 'video/mp4' : 'video/webm',
              blob,
            });
            setDriveModalMode('save');
            setDriveModalOpen(true);
          } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        },
        (status) => {
          setExportVideoStatus(`${label}: ${status}`);
        }
      );
    } catch (err: any) {
      console.error(err);
      setIsExportingVideo(false);
      setExportVideoStatus('');
      alert(`Video Export Error: ${err?.message || 'Recording failed'}`);
    }
  };

  // Turntable GIF Export Handlers
  const handleOpenGifModal = (destination: 'download' | 'drive' = 'download') => {
    handleOpenVideoGifModal('gif', destination);
  };

  const handleStartGifExport = async (options: GifExportOptions, destination?: 'download' | 'drive') => {
    if (!viewportRef.current || !hasModel) return;

    const dest = destination || videoGifExportDestination || gifExportDestination;
    setGifExportDestination(dest);
    setVideoGifExportDestination(dest);
    setIsExportingGif(true);
    setExportGifStatus('Starting GIF...');
    gifAbortRef.current = { current: false };

    try {
      await viewportRef.current.exportTurntableGif(
        options,
        (blob, fileName) => {
          setIsExportingGif(false);
          setExportGifStatus('');
          setGifProgress(null);
          setGifModalOpen(false);
          setVideoGifModalOpen(false);

          if (dest === 'drive') {
            setDriveSaveOptions({
              fileName,
              mimeType: 'image/gif',
              blob,
            });
            setDriveModalMode('save');
            setDriveModalOpen(true);
          } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        },
        (progress) => {
          setGifProgress(progress);
          setExportGifStatus(`GIF: ${progress.percent}%`);
        },
        gifAbortRef.current
      );
    } catch (err: any) {
      console.error(err);
      setIsExportingGif(false);
      setExportGifStatus('');
      setGifProgress(null);
      alert(`GIF Export Error: ${err?.message || 'Encoding failed'}`);
    }
  };

  const handleCancelGifExport = () => {
    if (gifAbortRef.current) {
      gifAbortRef.current.current = true;
    }
    setIsExportingGif(false);
    setExportGifStatus('');
    setGifProgress(null);
    setGifModalOpen(false);
    setVideoGifModalOpen(false);
  };

  const handleSelectParts = useCallback((indices: number[]) => {
    setSelectedPartIndices(indices);
    setSelectedPartIndex(indices.length === 1 ? indices[0] : indices.length > 0 ? indices[indices.length - 1] : null);
  }, []);

  const handleSelectPart = useCallback((idx: number | null) => {
    setSelectedPartIndex(idx);
    setSelectedPartIndices(idx !== null ? [idx] : []);
  }, []);

  const explodeAnimRef = useRef<number | null>(null);

  const handleAnimateExplode = useCallback(() => {
    if (explodeAnimRef.current !== null) {
      cancelAnimationFrame(explodeAnimRef.current);
      explodeAnimRef.current = null;
    }

    setSettings((currentSettings) => {
      const currentVal = currentSettings.explodeAmount || 0;
      // If currently at or above 45% (0.45), animate down to 0; otherwise animate up to 50% (0.5)
      const targetVal = currentVal >= 0.45 ? 0 : 0.5;
      const startVal = currentVal;
      const duration = 500; // ms smooth animation
      const startTime = performance.now();

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        // Smooth ease-in-out quadratic curve
        const ease =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const nextAmount = startVal + (targetVal - startVal) * ease;
        setSettings((prev) => ({ ...prev, explodeAmount: nextAmount }));

        if (progress < 1) {
          explodeAnimRef.current = requestAnimationFrame(step);
        } else {
          setSettings((prev) => ({ ...prev, explodeAmount: targetVal }));
          explodeAnimRef.current = null;
        }
      };

      explodeAnimRef.current = requestAnimationFrame(step);
      return currentSettings;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (explodeAnimRef.current !== null) {
        cancelAnimationFrame(explodeAnimRef.current);
      }
    };
  }, []);

  // Global Keyboard Shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toUpperCase();
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(activeTag)) return;

      const key = e.key.toLowerCase();

      if (e.code === 'KeyF') {
        e.preventDefault();
        setIsFullscreen((prev) => !prev);
      } else if (e.code === 'Escape') {
        if (selectedPartIndex !== null || selectedPartIndices.length > 0) {
          setSelectedPartIndex(null);
          setSelectedPartIndices([]);
          viewportRef.current?.clearSelection();
        }
        if (isFullscreen) setIsFullscreen(false);
        if (driveModalOpen) setDriveModalOpen(false);
        if (isMobileSidebarOpen) setIsMobileSidebarOpen(false);
        if (isHotkeyModalOpen) setIsHotkeyModalOpen(false);
        if (imageModalOpen) {
          if (!isExportingImage) setImageModalOpen(false);
        }
        if (videoGifModalOpen) {
          if (isExportingGif) {
            handleCancelGifExport();
          } else if (!isExportingVideo) {
            setVideoGifModalOpen(false);
          }
        }
        if (gifModalOpen) {
          if (isExportingGif) {
            handleCancelGifExport();
          } else {
            setGifModalOpen(false);
          }
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        setIsTurntableActive((prev) => !prev);
      } else if (e.key === '<' || e.key === ',') {
        e.preventDefault();
        setSettings((prev) => {
          const current = prev.turntableSpeed || 'normal';
          const nextSpeed: 'slow' | 'normal' | 'fast' =
            current === 'fast' ? 'normal' : 'slow';
          return { ...prev, turntableSpeed: nextSpeed };
        });
      } else if (e.key === '>' || e.key === '.') {
        e.preventDefault();
        setSettings((prev) => {
          const current = prev.turntableSpeed || 'normal';
          const nextSpeed: 'slow' | 'normal' | 'fast' =
            current === 'slow' ? 'normal' : 'fast';
          return { ...prev, turntableSpeed: nextSpeed };
        });
      } else if (e.key === '?' || (e.shiftKey && (e.code === 'Slash' || key === '?'))) {
        e.preventDefault();
        setIsHotkeyModalOpen((prev) => !prev);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        viewportRef.current?.recenterView();
      } else if (e.key === '1') {
        viewportRef.current?.snapView('front');
      } else if (e.key === '2') {
        viewportRef.current?.snapView('back');
      } else if (e.key === '3') {
        viewportRef.current?.snapView('left');
      } else if (e.key === '4') {
        viewportRef.current?.snapView('right');
      } else if (e.key === '5') {
        viewportRef.current?.snapView('top');
      } else if (e.key === '6') {
        viewportRef.current?.snapView('bottom');
      } else if (e.key === '7') {
        viewportRef.current?.snapView('isofl');
      } else if (e.key === '8') {
        viewportRef.current?.snapView('isofr');
      } else if (key === 's') {
        e.preventDefault();
        handleOpenImageModal('download');
      } else if (key === 'v') {
        e.preventDefault();
        handleOpenVideoGifModal('video', 'download');
      } else if (key === 'w') {
        handleExportVideo('webm', 'download');
      } else if (e.shiftKey && key === 'g') {
        e.preventDefault();
        handleOpenVideoGifModal('gif', 'download');
      } else if (key === 'c') {
        setSettings((prev) => ({ ...prev, castShadows: !prev.castShadows }));
      } else if (key === 'l') {
        setSettings((prev) => ({ ...prev, lockLightsToCamera: !prev.lockLightsToCamera }));
      } else if (key === 'g') {
        setSettings((prev) => ({ ...prev, showGrid: !prev.showGrid }));
      } else if (key === 'o') {
        setSettings((prev) => ({ ...prev, isOrtho: !prev.isOrtho }));
      } else if (key === 'e') {
        e.preventDefault();
        handleAnimateExplode();
      } else if (key === 'r') {
        e.preventDefault();
        setSettings((prev) => {
          const isCurrentlyOn = prev.ssrQuality && prev.ssrQuality !== 'off';
          return {
            ...prev,
            ssrQuality: isCurrentlyOn ? 'off' : 'medium',
          };
        });
      } else if (key === 'b') {
        e.preventDefault();
        setSettings((prev) => ({
          ...prev,
          vignetteEnabled: !prev.vignetteEnabled,
        }));
      } else if (key === 'i') {
        viewportRef.current?.toggleIsolateHoveredPart();
      } else if (key === 'h') {
        viewportRef.current?.toggleSelectedOrHoveredVisibility();
      } else if (key === 'u') {
        viewportRef.current?.unhideAllParts();
      } else if (key === 'a') {
        viewportRef.current?.selectAllVisibleParts();
      } else if (key === 'm') {
        viewportRef.current?.toggleDimensionMode();
      } else if (key === 'p') {
        e.preventDefault();
        viewportRef.current?.separateLooseParts?.(selectedPartIndex);
      } else if (key === 'x') {
        e.preventDefault();
        setSettings((prev) => {
          const anyOn = prev.clipping.x.enabled || prev.clipping.y.enabled || prev.clipping.z.enabled;
          return {
            ...prev,
            clipping: {
              ...prev.clipping,
              x: { ...prev.clipping.x, enabled: !anyOn },
              y: { ...prev.clipping.y, enabled: false },
              z: { ...prev.clipping.z, enabled: false },
            },
          };
        });
      }
    },
    [isFullscreen, driveModalOpen, isMobileSidebarOpen, isHotkeyModalOpen, gifModalOpen, isExportingGif, hasModel, resolution, selectedPartIndex, selectedPartIndices, handleAnimateExplode]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isLight = theme === 'light';

  return (
    <div
      id="app-container"
      className={`flex h-screen w-screen overflow-hidden ${
        isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#0f172a] text-slate-100'
      }`}
    >
      {/* Mobile Top Header (only visible on screens <= 600px) */}
      <header
        className={`sm:hidden fixed top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2 border-b backdrop-blur-md ${
          isLight
            ? 'bg-white/90 border-slate-200 text-slate-900 shadow-2xs'
            : 'bg-slate-900/90 border-slate-700 text-slate-100 shadow-md'
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            id="btn-mobile-menu"
            onClick={() => setIsMobileSidebarOpen(true)}
            className="p-1.5 rounded-md hover:bg-slate-500/10 cursor-pointer"
            title="Open Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold text-xs tracking-wide">3D TURN MAKER</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => viewportRef.current?.recenterView()}
            className="p-1.5 rounded-md bg-sky-600 text-white text-xs cursor-pointer flex items-center gap-1"
            title="Fit to View"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            <span className="text-[10px]">Fit</span>
          </button>
          <button
            onClick={() => setIsTurntableActive((prev) => !prev)}
            className={`p-1.5 rounded-md text-xs cursor-pointer flex items-center gap-1 ${
              isTurntableActive ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white'
            }`}
            title="Turntable"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isTurntableActive ? 'animate-spin' : ''}`} />
            <span className="text-[10px]">{isTurntableActive ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </header>

      {/* Main Sidebar (Column on left for >600px, Drawer for <=600px) */}
      <Sidebar
        theme={theme}
        onToggleTheme={handleToggleTheme}
        hasModel={hasModel}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        dimensions={dimensions}
        onUpdateDimensions={handleUpdateDimensions}
        onUpdateDimensionField={handleUpdateDimensionField}
        isTurntableActive={isTurntableActive}
        onToggleTurntable={() => setIsTurntableActive((prev) => !prev)}
        onRecenter={() => viewportRef.current?.recenterView()}
        onSnapView={(dir) => viewportRef.current?.snapView(dir)}
        onToggleDimensionMode={() => viewportRef.current?.toggleDimensionMode()}
        resolution={resolution}
        onChangeResolution={setResolution}
        onExportTurns={handleExportTurns}
        onExportThreeQuarterViews={handleExportThreeQuarterViews}
        onExportAllSeparate={handleExportAllSeparate}
        onExportVideo={handleExportVideo}
        onOpenGifExportModal={handleOpenGifModal}
        onOpenImageExportModal={(dest) => handleOpenImageModal(dest || 'download')}
        onOpenVideoGifExportModal={(initialMode, dest) => handleOpenVideoGifModal(initialMode || 'video', dest || 'download')}
        isExportingGif={isExportingGif}
        exportGifStatus={exportGifStatus}
        isExportingImage={isExportingImage}
        exportImageStatus={exportImageStatus}
        exportImageTarget={exportImageTarget}
        isExportingVideo={isExportingVideo}
        exportVideoStatus={exportVideoStatus}
        onUploadLocalFile={handleUploadLocalFile}
        onUploadBatchFiles={handleUploadBatchFiles}
        onOpenDriveModal={handleOpenDriveModal}
        onLoadDemoModel={() => viewportRef.current?.loadDemoModel()}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
        isOpenOnMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        volumeStats={volumeStats}
        parts={parts}
        onTogglePartVisibility={handleTogglePartVisibility}
        onDeletePart={handleDeletePart}
        onDeleteHiddenParts={handleDeleteHiddenParts}
        selectedPartIndex={selectedPartIndex}
        selectedPartIndices={selectedPartIndices}
        onSelectPart={handleSelectPart}
        onSelectParts={handleSelectParts}
        selectedPartInfo={selectedPartInfo}
        isIsolated={isolatedPartName !== null}
        onCaptureViewport={() => viewportRef.current?.captureScreenshot() || null}
        onOpenHotkeyModal={() => setIsHotkeyModalOpen(true)}
        onSeparateLooseParts={(targetIndex) =>
          viewportRef.current?.separateLooseParts?.(
            typeof targetIndex === 'number' ? targetIndex : selectedPartIndex
          )
        }
      />

      {/* 3D Viewport */}
      <main className="flex-1 flex relative h-full w-full max-sm:pt-11 overflow-hidden">
        <ThreeViewport
          ref={viewportRef}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          dimensions={dimensions}
          onDimensionsChanged={setDimensions}
          isTurntableActive={isTurntableActive}
          theme={theme}
          onModelLoaded={handleModelLoaded}
          onOpenLocalUpload={() => {
            const input = document.getElementById('fileInput') as HTMLInputElement;
            if (input) input.click();
          }}
          onOpenDriveModal={() => handleOpenDriveModal('import')}
          onVolumeComputed={setVolumeStats}
          onPartsChanged={setParts}
          onIsolateChanged={setIsolatedPartName}
          selectedPartIndex={selectedPartIndex}
          selectedPartIndices={selectedPartIndices}
          onSelectPart={handleSelectPart}
          onSelectParts={handleSelectParts}
          onSelectedPartInfoChanged={setSelectedPartInfo}
          isFullscreen={isFullscreen}
        />
      </main>

      {/* Google Drive Modal */}
      <DriveModal
        isOpen={driveModalOpen}
        onClose={() => {
          setDriveModalOpen(false);
          setDriveSaveOptions(null);
        }}
        mode={driveModalMode}
        saveOptions={driveSaveOptions}
        onSelectModelFile={handleDriveModelSelected}
        onSelectModelFiles={handleDriveModelsSelected}
        theme={theme}
      />

      {/* Image Views Export Modal */}
      <ImageExportModal
        isOpen={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        theme={theme}
        hasModel={hasModel}
        isExporting={isExportingImage}
        exportProgress={exportImageStatus}
        initialDestination={imageExportDestination}
        currentResolution={resolution}
        onStartExport={handleStartCustomImageExport}
        showDriveOption={true}
        gridEnabled={settings.showGrid}
      />

      {/* Turntable Video / Animated GIF Export Modal */}
      <VideoGifExportModal
        isOpen={videoGifModalOpen}
        onClose={() => {
          if (isExportingGif) {
            handleCancelGifExport();
          } else {
            setVideoGifModalOpen(false);
          }
        }}
        theme={theme}
        hasModel={hasModel}
        isExportingVideo={isExportingVideo}
        isExportingGif={isExportingGif}
        videoExportStatus={exportVideoStatus}
        gifProgress={gifProgress}
        initialMode={videoGifModalInitialMode}
        initialDestination={videoGifExportDestination}
        viewportAspect={viewportAspect}
        videoEasingDefault={settings.videoEasing}
        onStartVideoExport={handleStartVideoExportFromModal}
        onStartGifExport={handleStartGifExport}
        onCancelExport={handleCancelGifExport}
        showDriveOption={true}
      />

      {/* Standalone Turntable Animated GIF Export Modal (Fallback) */}
      <GifExportModal
        isOpen={gifModalOpen}
        onClose={handleCancelGifExport}
        onStartExport={handleStartGifExport}
        isExporting={isExportingGif}
        progress={gifProgress}
        theme={theme}
        hasModel={hasModel}
        initialDestination={gifExportDestination}
        showDriveOption={true}
        viewportAspect={viewportAspect}
      />

      {/* Hotkey Cheatsheet Modal */}
      <HotkeyModal
        isOpen={isHotkeyModalOpen}
        onClose={() => setIsHotkeyModalOpen(false)}
        theme={theme}
      />
    </div>
  );
}
