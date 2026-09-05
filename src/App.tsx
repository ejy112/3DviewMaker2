/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreeViewport, ThreeViewportHandle, VolumeStats } from './components/ThreeViewport';
import { DriveModal } from './components/DriveModal';
import {
  DriveSaveOptions,
  LoadedPart,
  ModelDimensions,
  ResolutionOption,
  SnapDirection,
  ThemeMode,
  ViewerSettings,
} from './types';
import { Menu, RotateCw, ZoomIn } from 'lucide-react';

export default function App() {
  const viewportRef = useRef<ThreeViewportHandle>(null);

  // Theme Mode (applies to sidebar/navigation chrome)
  const [theme, setTheme] = useState<ThemeMode>('dark');

  // Viewer Settings
  const [settings, setSettings] = useState<ViewerSettings>({
    material: 'grey',
    minThicknessInches: 0.08,
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

    environmentPreset: 'studio',

    clipping: {
      x: { enabled: false, offsetInches: 0, flip: false },
      y: { enabled: false, offsetInches: 0, flip: false },
      z: { enabled: false, offsetInches: 0, flip: false },
    },

    antialiasMode: 'none',
    ssaoEnabled: false,
    ssaoRadius: 20, // % of the model's radius — keeps AO detail scale-correct across unit systems
    ssaoIntensity: 120, // % strength, 100 = neutral
    ssaoBias: 20, // % — trades self-occlusion noise vs. missed fine detail

    materialDensityGCm3: 1.04, // ABS-ish default
    costPerKgUSD: 25,

    explodeAmount: 0,
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

  // Export State
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [exportImageStatus, setExportImageStatus] = useState('');
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportVideoStatus, setExportVideoStatus] = useState('');

  // Google Drive Modal State
  const [driveModalOpen, setDriveModalOpen] = useState(false);
  const [driveModalMode, setDriveModalMode] = useState<'import' | 'save'>('import');
  const [driveSaveOptions, setDriveSaveOptions] = useState<DriveSaveOptions | null>(null);

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

  // Turnaround Sheet Image Export
  const handleExportTurns = (destination: 'download' | 'drive') => {
    if (!viewportRef.current || !hasModel) return;

    setIsExportingImage(true);
    setExportImageStatus('Preparing...');

    viewportRef.current.exportTurnaroundImage(
      resolution,
      (blob, fileName) => {
        setIsExportingImage(false);
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
        if (isFullscreen) setIsFullscreen(false);
        if (driveModalOpen) setDriveModalOpen(false);
        if (isMobileSidebarOpen) setIsMobileSidebarOpen(false);
      } else if (e.code === 'Space') {
        e.preventDefault();
        setIsTurntableActive((prev) => !prev);
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
        handleExportTurns('download');
      } else if (key === 'v') {
        handleExportVideo('mp4', 'download');
      } else if (key === 'w') {
        handleExportVideo('webm', 'download');
      } else if (key === 'c') {
        setSettings((prev) => ({ ...prev, castShadows: !prev.castShadows }));
      } else if (key === 'l') {
        setSettings((prev) => ({ ...prev, lockLightsToCamera: !prev.lockLightsToCamera }));
      } else if (key === 'g') {
        setSettings((prev) => ({ ...prev, showGrid: !prev.showGrid }));
      } else if (key === 'o') {
        setSettings((prev) => ({ ...prev, isOrtho: !prev.isOrtho }));
      }
    },
    [isFullscreen, driveModalOpen, isMobileSidebarOpen, hasModel, resolution]
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
        resolution={resolution}
        onChangeResolution={setResolution}
        onExportTurns={handleExportTurns}
        onExportVideo={handleExportVideo}
        isExportingImage={isExportingImage}
        exportImageStatus={exportImageStatus}
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
        theme={theme}
      />
    </div>
  );
}
