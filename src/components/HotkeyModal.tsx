import React, { useState, useEffect, useMemo } from 'react';
import { Keyboard, X, Search } from 'lucide-react';
import { ThemeMode } from '../types';

// ============================================================================
// IMPORTANT DEVELOPER NOTE:
// Whenever hotkeys or keyboard shortcuts are modified, added, or removed in
// 3DViewMaker (such as in src/App.tsx or ThreeViewport.tsx), ALWAYS update this
// HOTKEY_CATEGORIES list to keep the cheatsheet perfectly in sync.
// ============================================================================

export interface HotkeyItem {
  keys: string[];
  action: string;
  description?: string;
  note?: string;
}

export interface HotkeyCategory {
  title: string;
  items: HotkeyItem[];
}

export const HOTKEY_CATEGORIES: HotkeyCategory[] = [
  {
    title: 'Camera & Viewport Navigation',
    items: [
      {
        keys: ['Enter'],
        action: 'Fit & recenter model to viewport',
        description: 'Auto-adjusts camera distance and targets center of bounding volume',
      },
      {
        keys: ['Space'],
        action: 'Start / pause turntable auto-rotation',
        description: 'Smooth 360-degree rotation around the active vertical axis',
      },
      {
        keys: ['<'],
        action: 'Lower Turntable Speed',
        description: 'Decreases turntable auto-rotation speed (Fast → Normal → Slow)',
      },
      {
        keys: ['>'],
        action: 'Faster Turntable Speed',
        description: 'Increases turntable auto-rotation speed (Slow → Normal → Fast)',
      },
      {
        keys: ['?'],
        action: 'Open Hotkey Cheatsheet Popup',
        description: 'Displays all keyboard shortcuts, navigation commands, and hotkey actions',
      },
      {
        keys: ['F'],
        action: 'Toggle Fullscreen mode',
        description: 'Hides sidebars and expands the 3D canvas to fill display (Esc to exit)',
      },
      {
        keys: ['O'],
        action: 'Toggle Orthographic / Perspective projection',
        description: 'Instantly switches between technical CAD projection and perspective',
      },
      {
        keys: ['G'],
        action: 'Toggle ground grid on / off',
        description: 'Shows or hides the adaptive measurement ground plane',
      },
      {
        keys: ['B'],
        action: 'Toggle Background / Vignette on / off',
        description: 'Toggles the radial background vignette gradient plate on or off',
      },
      {
        keys: ['R'],
        action: 'Toggle Screen-Space Reflections (SSR)',
        description: 'Toggles real-time specular reflections (defaults to Medium quality when enabled)',
      },
      {
        keys: ['C'],
        action: 'Toggle cast shadows on / off',
        description: 'Toggles real-time ground contact directional shadowing',
      },
      {
        keys: ['X'],
        action: 'Toggle Cross-Section Clipping Cut',
        description: 'Toggles cross-section clipping plane on or off with solid cross-section capping',
      },
      {
        keys: ['L'],
        action: 'Toggle lock lights to camera',
        description: 'Locks key/fill lights relative to view direction when tumbling',
      },
      {
        keys: ['Esc'],
        action: 'Deselect all / Exit isolate / Close dialogs',
        description: 'Clears selection outline, exits mesh isolation, or closes open modals',
      },
    ],
  },
  {
    title: 'Camera Snap Views (Number Keys)',
    items: [
      { keys: ['1'], action: 'Front View', description: 'Aligns camera to true front orthographic/perspective' },
      { keys: ['2'], action: 'Back View', description: 'Aligns camera to true rear' },
      { keys: ['3'], action: 'Left View', description: 'Aligns camera to true left side' },
      { keys: ['4'], action: 'Right View', description: 'Aligns camera to true right side' },
      { keys: ['5'], action: 'Top View', description: 'Aligns camera directly overhead looking down' },
      { keys: ['6'], action: 'Bottom View', description: 'Aligns camera looking straight up from below' },
      { keys: ['7'], action: 'Isometric Front-Left (Iso FL)', description: '3/4 angle CAD presentation view from front-left' },
      { keys: ['8'], action: 'Isometric Front-Right (Iso FR)', description: '3/4 angle CAD presentation view from front-right' },
    ],
  },
  {
    title: 'Mesh & Assembly Management',
    items: [
      {
        keys: ['I'],
        action: 'Isolate hovered / selected mesh',
        description: 'Focuses only on targeted mesh and hides others; press I again to restore',
      },
      {
        keys: ['H'],
        action: 'Hide / show selected or hovered mesh',
        description: 'Toggles mesh visibility in the scene without deleting geometry',
      },
      {
        keys: ['U'],
        action: 'Unhide all meshes (show all)',
        description: 'Restores every loaded assembly part to full visibility',
      },
      {
        keys: ['A'],
        action: 'Select all visible meshes',
        description: 'Selects all currently visible parts in viewport or assembly hierarchy',
      },
      {
        keys: ['E'],
        action: 'Exploded View (Animate 0% to 50%)',
        description: 'Smoothly animates assembly part separation between 0% and 50%',
      },
      {
        keys: ['P'],
        action: 'Separate loose parts',
        description: 'Splits targeted mesh (or all loaded meshes) into individual disconnected parts (same as Blender)',
      },
      {
        keys: ['Shift', 'Click'],
        action: 'Add / remove mesh to multi-selection',
        description: 'Ctrl/Cmd + Click also supported for selective batch actions',
      },
    ],
  },
  {
    title: 'Tools & Quick Exports',
    items: [
      {
        keys: ['M'],
        action: 'Toggle Point-to-Point Measurement Tool',
        description: 'Click any two surface vertices to compute exact real-world dimensions',
      },
      {
        keys: ['S'],
        action: 'Open Export Images Modal',
        description: 'Select custom views, resolution, and format to export as single sheet or separate PNGs',
      },
      {
        keys: ['V'],
        action: 'Open Export Video / GIF Modal',
        description: 'Configure resolution (up to 4K), aspect ratio, duration, FPS, and format for MP4, WebM, or GIF',
      },
      {
        keys: ['W'],
        action: 'Quick Export Turntable Video as WebM',
        description: 'Directly captures 360-degree rotation video in lightweight WebM container',
      },
      {
        keys: ['Shift', 'G'],
        action: 'Open Video / GIF Modal (GIF Mode)',
        description: 'Jump directly to animated GIF export with transparency, dithering, and looping settings',
      },
    ],
  },
];

interface HotkeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
}

export const HotkeyModal: React.FC<HotkeyModalProps> = ({ isOpen, onClose, theme }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const isLight = theme === 'light';

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter hotkeys according to user search query
  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return HOTKEY_CATEGORIES;

    return HOTKEY_CATEGORIES.map((category) => {
      const matchingItems = category.items.filter((item) => {
        const matchesKey = item.keys.some((k) => k.toLowerCase().includes(q));
        const matchesAction = item.action.toLowerCase().includes(q);
        const matchesDesc = item.description?.toLowerCase().includes(q);
        return matchesKey || matchesAction || matchesDesc;
      });
      return {
        ...category,
        items: matchingItems,
      };
    }).filter((category) => category.items.length > 0);
  }, [searchQuery]);

  const totalFilteredCount = useMemo(() => {
    return filteredCategories.reduce((acc, cat) => acc + cat.items.length, 0);
  }, [filteredCategories]);

  if (!isOpen) return null;

  return (
    <div
      id="hotkey-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs transition-all animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="hotkey-modal-dialog"
        className={`w-full max-w-2xl rounded-2xl shadow-2xl border transition-all overflow-hidden flex flex-col max-h-[85vh] ${
          isLight
            ? 'bg-white border-slate-200 text-slate-900 shadow-slate-300/50'
            : 'bg-slate-900 border-slate-700 text-slate-100 shadow-black/90'
        }`}
      >
        {/* Modal Top Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/80 border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">Hotkey Cheatsheet</h3>
                <span className="font-mono text-[10px] text-sky-400 font-semibold px-1.5 py-0.2 rounded bg-sky-500/10 border border-sky-500/20">
                  Shortcuts
                </span>
              </div>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Keyboard shortcuts for high-speed navigation, framing, and modeling
              </p>
            </div>
          </div>
          <button
            id="btn-close-hotkey-modal"
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-slate-700 text-slate-400'
            }`}
            title="Close cheatsheet (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div
          className={`px-5 py-2.5 border-b flex items-center gap-2.5 ${
            isLight ? 'bg-slate-50/50 border-slate-200' : 'bg-slate-800/30 border-slate-800'
          }`}
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              id="hotkey-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search hotkey (e.g. 'fit', 'isolate', 'grid', 'MP4', '1')..."
              className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border outline-none transition-all ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-sky-500'
                  : 'bg-slate-800/90 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-sky-400'
              }`}
            />
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[11px] font-medium text-slate-400 hover:text-sky-400 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Scrollable Hotkey List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
          {totalFilteredCount === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No hotkeys found matching &ldquo;<span className="text-sky-400 font-semibold">{searchQuery}</span>&rdquo;
            </div>
          ) : (
            filteredCategories.map((category) => (
              <div key={category.title} className="flex flex-col gap-2">
                <div className="flex items-center justify-between pb-1 border-b border-slate-700/30">
                  <h4 className="text-[11px] font-bold text-sky-500 uppercase tracking-wider">
                    {category.title}
                  </h4>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {category.items.length} {category.items.length === 1 ? 'shortcut' : 'shortcuts'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-1.5 pt-1">
                  {category.items.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-colors ${
                        isLight
                          ? 'bg-slate-50/70 hover:bg-slate-100/90 border-slate-200/80'
                          : 'bg-slate-800/40 hover:bg-slate-800/80 border-slate-800'
                      }`}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-xs leading-snug">
                          {item.action}
                        </span>
                        {item.description && (
                          <span
                            className={`text-[11px] leading-tight ${
                              isLight ? 'text-slate-500' : 'text-slate-400'
                            }`}
                          >
                            {item.description}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {item.keys.map((key, kIdx) => (
                          <React.Fragment key={kIdx}>
                            {kIdx > 0 && (
                              <span className="text-slate-400 text-[10px] font-semibold">+</span>
                            )}
                            <kbd
                              className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold tracking-tight shadow-xs border transition-all ${
                                isLight
                                  ? 'bg-white border-slate-300 text-sky-700 shadow-slate-200'
                                  : 'bg-slate-800 border-slate-700 text-sky-400 shadow-black/40'
                              }`}
                            >
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer Note */}
        <div
          className={`px-5 py-3 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] ${
            isLight
              ? 'bg-slate-50 border-slate-200 text-slate-500'
              : 'bg-slate-800/60 border-slate-700/80 text-slate-400'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span>Hotkeys are automatically disabled while typing in text or numeric input fields.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer self-end sm:self-auto ${
              isLight
                ? 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'
                : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200'
            }`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
