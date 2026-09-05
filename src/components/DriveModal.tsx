import React, { useState, useEffect } from 'react';
import {
  googleSignIn,
  googleSignOut,
  listDriveContents,
  listSharedDrives,
  downloadDriveFile,
  uploadFileToDrive,
  createDriveFolder,
  is3DFile,
} from '../services/firebaseAuth';
import {
  DriveItem,
  SharedDriveItem,
  DriveSourceType,
  FolderCrumb,
  DriveSaveOptions,
  ThemeMode,
} from '../types';
import {
  Cloud,
  Download,
  Folder,
  FolderPlus,
  FolderOpen,
  HardDrive,
  Users,
  Share2,
  ChevronRight,
  ArrowLeft,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  UploadCloud,
  X,
  CheckCircle2,
  AlertCircle,
  FileBox,
} from 'lucide-react';

interface DriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'import' | 'save';
  saveOptions?: DriveSaveOptions | null;
  onSelectModelFile?: (file: File) => void;
  theme: ThemeMode;
}

export const DriveModal: React.FC<DriveModalProps> = ({
  isOpen,
  onClose,
  mode,
  saveOptions,
  onSelectModelFile,
  theme,
}) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Navigation State
  const [sourceType, setSourceType] = useState<DriveSourceType>('my-drive');
  const [sharedDrives, setSharedDrives] = useState<SharedDriveItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<FolderCrumb[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Action States
  const [isDownloadingId, setIsDownloadingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Folder Creation
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Reset or load initial folder when opened
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setUploadSuccessMsg(null);
      if (isAuthenticated) {
        loadCurrentLocation();
      }
    }
  }, [isOpen, isAuthenticated, sourceType]);

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1]?.id || 'root';
  const currentFolderName = breadcrumbs[breadcrumbs.length - 1]?.name || 'My Drive';

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setErrorMsg(null);
    try {
      const res = await googleSignIn();
      if (res?.user) {
        setUserEmail(res.user.email);
        setIsAuthenticated(true);
        setTimeout(() => {
          loadCurrentLocation();
        }, 100);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Google Sign-In failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    await googleSignOut();
    setIsAuthenticated(false);
    setUserEmail(null);
    setItems([]);
    setSharedDrives([]);
    setBreadcrumbs([{ id: 'root', name: 'My Drive' }]);
    setSourceType('my-drive');
  };

  // Load items based on source and folder
  const loadCurrentLocation = async (customFolderId?: string, query?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const targetFolderId = customFolderId ?? currentFolderId;

      if (sourceType === 'shared-drives' && breadcrumbs.length === 1 && !query) {
        // At the root of Shared Drives: list team drives
        const drives = await listSharedDrives();
        setSharedDrives(drives);
        setItems([]);
      } else {
        // List folder contents
        const contents = await listDriveContents({
          folderId: targetFolderId,
          sourceType,
          queryText: query || searchQuery,
        });
        setItems(contents);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to access Google Drive contents');
    } finally {
      setIsLoading(false);
    }
  };

  // Source Switcher handler
  const handleSwitchSource = (newSource: DriveSourceType) => {
    setSourceType(newSource);
    setSearchQuery('');
    if (newSource === 'my-drive') {
      setBreadcrumbs([{ id: 'root', name: 'My Drive' }]);
    } else if (newSource === 'shared-drives') {
      setBreadcrumbs([{ id: 'root', name: 'Shared Drives' }]);
    } else {
      setBreadcrumbs([{ id: 'shared-with-me', name: 'Shared with Me' }]);
    }
  };

  // Navigate into a folder
  const handleOpenFolder = (folderId: string, folderName: string) => {
    setSearchQuery('');
    const newBreadcrumbs = [...breadcrumbs, { id: folderId, name: folderName }];
    setBreadcrumbs(newBreadcrumbs);
    loadCurrentLocation(folderId, '');
  };

  // Click on breadcrumb
  const handleCrumbClick = (index: number) => {
    setSearchQuery('');
    const targetCrumb = breadcrumbs[index];
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    loadCurrentLocation(targetCrumb.id, '');
  };

  // Back one level
  const handleGoUp = () => {
    if (breadcrumbs.length > 1) {
      handleCrumbClick(breadcrumbs.length - 2);
    }
  };

  // Search submit
  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    loadCurrentLocation(currentFolderId, searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    loadCurrentLocation(currentFolderId, '');
  };

  // Select 3D Model File for Import
  const handleSelectModelFile = async (item: DriveItem) => {
    setIsDownloadingId(item.id);
    setErrorMsg(null);
    try {
      const blob = await downloadDriveFile(item.id);
      const file = new File([blob], item.name, {
        type: item.mimeType || 'application/octet-stream',
      });
      if (onSelectModelFile) {
        onSelectModelFile(file);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to download 3D file from Google Drive');
    } finally {
      setIsDownloadingId(null);
    }
  };

  // Create New Subfolder
  const handleCreateNewFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setIsCreatingFolder(true);
    setErrorMsg(null);
    try {
      const created = await createDriveFolder(newFolderName.trim(), currentFolderId);
      setShowNewFolderModal(false);
      setNewFolderName('');
      // Navigate directly into newly created folder
      handleOpenFolder(created.id, created.name);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Confirm Save to Drive
  const handleConfirmSave = async () => {
    if (!saveOptions) return;
    setIsUploading(true);
    setErrorMsg(null);
    setUploadSuccessMsg(null);
    try {
      await uploadFileToDrive(
        saveOptions.fileName,
        saveOptions.mimeType,
        saveOptions.blob,
        currentFolderId
      );
      setUploadSuccessMsg(`Saved to "${currentFolderName}" successfully!`);
      setTimeout(() => {
        onClose();
        setUploadSuccessMsg(null);
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save to Google Drive');
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes?: string) => {
    if (!bytes) return '';
    const num = parseInt(bytes, 10);
    if (isNaN(num)) return '';
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isLight = theme === 'light';

  // Filter 3D files vs subfolders
  const folderItems = items.filter((it) => it.isFolder);
  const fileItems = items.filter((it) => !it.isFolder && is3DFile(it.name, it.mimeType));
  const isShowingSharedDrivesRoot =
    sourceType === 'shared-drives' && breadcrumbs.length === 1 && !searchQuery;

  if (!isOpen) return null;

  return (
    <div
      id="drive-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs transition-all"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="drive-modal-dialog"
        className={`w-full max-w-2xl rounded-2xl shadow-2xl border transition-all overflow-hidden flex flex-col h-[90vh] max-h-[720px] ${
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
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                {mode === 'import' ? 'Open Model from Google Drive' : 'Save Export to Google Drive'}
              </h3>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {mode === 'import'
                  ? 'Browse folders, Shared Drives, and open 3D assets'
                  : 'Select any folder in My Drive or Shared Drives to save'}
              </p>
            </div>
          </div>
          <button
            id="btn-close-drive-modal"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-slate-700 text-slate-400'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {errorMsg && (
            <div className="mx-4 mt-3 flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {!isAuthenticated ? (
            /* Sign-In View */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-inner">
                <Cloud className="w-8 h-8" />
              </div>
              <div className="max-w-md space-y-1.5">
                <h4 className="font-semibold text-base">Connect to Google Drive</h4>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Grant access to browse your folders and Shared Drives, load 3D models (.glb, .stl,
                  .obj), or save your turnaround exports directly into your Drive.
                </p>
              </div>

              <button
                id="btn-google-sign-in"
                onClick={handleSignIn}
                disabled={isAuthenticating}
                className="flex items-center gap-3 px-6 py-2.5 rounded-xl border text-sm font-medium bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-sm border-slate-300 transition-all cursor-pointer disabled:opacity-60"
              >
                {isAuthenticating ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 48 48">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                )}
                <span>{isAuthenticating ? 'Connecting to Google...' : 'Sign in with Google'}</span>
              </button>
            </div>
          ) : (
            /* Authenticated Drive Browser */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Account & Source Navigation Header */}
              <div
                className={`flex flex-col gap-2.5 px-4 py-3 border-b ${
                  isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-800/50 border-slate-700/80'
                }`}
              >
                {/* User info bar */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-slate-400 overflow-hidden">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="truncate">{userEmail}</span>
                  </div>
                  <button
                    id="btn-google-sign-out"
                    onClick={handleSignOut}
                    className="flex items-center gap-1.5 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>

                {/* Source Selection Tabs */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/60 dark:bg-slate-800 border border-slate-300/40 dark:border-slate-700/60 text-xs">
                    <button
                      id="tab-my-drive"
                      onClick={() => handleSwitchSource('my-drive')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                        sourceType === 'my-drive'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      <span>My Drive</span>
                    </button>

                    <button
                      id="tab-shared-drives"
                      onClick={() => handleSwitchSource('shared-drives')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                        sourceType === 'shared-drives'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Shared Drives</span>
                    </button>

                    <button
                      id="tab-shared-with-me"
                      onClick={() => handleSwitchSource('shared-with-me')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                        sourceType === 'shared-with-me'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Shared with Me</span>
                    </button>
                  </div>

                  {/* Create New Folder Button (in Save mode or when inside folders) */}
                  {sourceType !== 'shared-with-me' && !isShowingSharedDrivesRoot && (
                    <button
                      id="btn-new-folder"
                      onClick={() => setShowNewFolderModal(true)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        isLight
                          ? 'border-slate-300 hover:bg-slate-200 text-slate-700'
                          : 'border-slate-700 hover:bg-slate-700 text-slate-300'
                      }`}
                      title="Create New Folder in this directory"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-blue-500" />
                      <span className="hidden sm:inline">New Folder</span>
                    </button>
                  )}
                </div>

                {/* Breadcrumbs & Search Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                  {/* Clickable Breadcrumbs Bar */}
                  <div
                    className={`flex-1 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs overflow-x-auto scrollbar-none ${
                      isLight ? 'bg-white border-slate-300/80' : 'bg-slate-900 border-slate-700/80'
                    }`}
                  >
                    {breadcrumbs.length > 1 && (
                      <button
                        onClick={handleGoUp}
                        className="p-1 rounded hover:bg-slate-500/20 text-slate-400 mr-1 cursor-pointer shrink-0"
                        title="Go up one folder"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {breadcrumbs.map((crumb, idx) => {
                      const isLast = idx === breadcrumbs.length - 1;
                      return (
                        <React.Fragment key={crumb.id + idx}>
                          {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
                          <button
                            onClick={() => handleCrumbClick(idx)}
                            disabled={isLast}
                            className={`truncate max-w-[140px] px-1 py-0.5 rounded cursor-pointer transition-colors ${
                              isLast
                                ? 'font-semibold text-blue-500 pointer-events-none'
                                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-500/10'
                            }`}
                          >
                            {crumb.name}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {/* Search Bar */}
                  <form onSubmit={handleSearchSubmit} className="relative flex items-center gap-1.5">
                    <div className="relative flex-1 sm:w-56">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        id="drive-search-input"
                        type="text"
                        placeholder="Search model or folder..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={`w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border outline-hidden transition-all ${
                          isLight
                            ? 'bg-white border-slate-300 text-slate-900 focus:border-blue-500'
                            : 'bg-slate-800 border-slate-700 text-slate-100 focus:border-blue-500'
                        }`}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={handleClearSearch}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => loadCurrentLocation()}
                      disabled={isLoading}
                      className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                        isLight
                          ? 'border-slate-300 hover:bg-slate-100 text-slate-600'
                          : 'border-slate-700 hover:bg-slate-800 text-slate-300'
                      }`}
                      title="Refresh contents"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </form>
                </div>
              </div>

              {/* Main Content List */}
              <div className="flex-1 overflow-y-auto p-4 min-h-0 divide-y divide-slate-800/40">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400 text-xs">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                    <span>Loading Drive contents...</span>
                  </div>
                ) : isShowingSharedDrivesRoot ? (
                  /* Shared Drives List */
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1 mb-2">
                      Available Shared Drives ({sharedDrives.length})
                    </div>
                    {sharedDrives.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-xs text-slate-400 gap-2">
                        <Users className="w-10 h-10 stroke-1 text-slate-500" />
                        <span>No Shared Drives found for your Google account.</span>
                        <span className="text-[11px] text-slate-500">
                          Switch to &quot;My Drive&quot; or check if your team assigned you to a Shared Drive.
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {sharedDrives.map((drive) => (
                          <div
                            key={drive.id}
                            onClick={() => handleOpenFolder(drive.id, drive.name)}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                              isLight
                                ? 'bg-slate-50 hover:bg-blue-50/60 border-slate-200 hover:border-blue-300'
                                : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/80 hover:border-blue-500/50'
                            }`}
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                                <Users className="w-4 h-4" />
                              </div>
                              <span className="font-medium text-xs truncate">{drive.name}</span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : items.length === 0 ? (
                  /* Empty Folder / No Results */
                  <div className="flex flex-col items-center justify-center py-14 px-4 text-center text-xs text-slate-400 gap-2">
                    <FolderOpen className="w-10 h-10 stroke-1 text-slate-500" />
                    <span className="font-medium text-slate-300">
                      {searchQuery
                        ? `No items found matching "${searchQuery}"`
                        : 'This folder is empty'}
                    </span>
                    <span className="text-[11px] text-slate-500 max-w-sm">
                      {mode === 'import'
                        ? 'No supported 3D models (.glb, .stl, .obj) or subfolders located here.'
                        : 'You can save your export directly into this folder, or create a new subfolder above.'}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Subfolders Section */}
                    {folderItems.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
                          Folders ({folderItems.length})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {folderItems.map((folder) => (
                            <div
                              key={folder.id}
                              onClick={() => handleOpenFolder(folder.id, folder.name)}
                              className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer group ${
                                isLight
                                  ? 'bg-slate-50 hover:bg-blue-50 border-slate-200 hover:border-blue-300'
                                  : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/60 hover:border-blue-500/40'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 overflow-hidden">
                                <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                                <span className="text-xs font-medium truncate">{folder.name}</span>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400 shrink-0 transition-colors" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 3D Files Section */}
                    {fileItems.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
                          3D Models ({fileItems.length})
                        </div>
                        <div className="space-y-1">
                          {fileItems.map((file) => {
                            const isDownloading = isDownloadingId === file.id;
                            const ext = file.name.split('.').pop()?.toUpperCase() || '3D';
                            return (
                              <div
                                key={file.id}
                                className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                                  isLight
                                    ? 'bg-white hover:bg-slate-50 border-slate-200'
                                    : 'bg-slate-800/40 hover:bg-slate-800/80 border-slate-700/50'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 overflow-hidden">
                                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-bold shrink-0">
                                    {ext}
                                  </span>
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-medium truncate">{file.name}</span>
                                    {file.size && (
                                      <span className="text-[10px] text-slate-400">
                                        {formatFileSize(file.size)}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {mode === 'import' && (
                                  <button
                                    id={`btn-open-file-${file.id}`}
                                    onClick={() => handleSelectModelFile(file)}
                                    disabled={isDownloading}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors shrink-0 cursor-pointer disabled:opacity-50 shadow-xs"
                                  >
                                    {isDownloading ? (
                                      <>
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>Opening...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Download className="w-3 h-3" />
                                        <span>Open</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SAVE MODE: Bottom Destination & Confirm Action Panel */}
              {mode === 'save' && saveOptions && (
                <div
                  className={`p-4 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/80 border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-xs overflow-hidden w-full sm:w-auto">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                      <FileBox className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1 text-slate-400 text-[11px]">
                        <span>Destination folder:</span>
                        <span className="font-semibold text-blue-400 truncate">
                          📁 {currentFolderName}
                        </span>
                      </div>
                      <span className="font-mono font-medium truncate text-xs">
                        {saveOptions.fileName} ({(saveOptions.blob.size / (1024 * 1024)).toFixed(2)}{' '}
                        MB)
                      </span>
                    </div>
                  </div>

                  {uploadSuccessMsg ? (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 text-xs font-semibold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{uploadSuccessMsg}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <button
                        onClick={onClose}
                        disabled={isUploading}
                        className={`px-4 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                          isLight
                            ? 'border-slate-300 hover:bg-slate-200 text-slate-700'
                            : 'border-slate-700 hover:bg-slate-700 text-slate-300'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        id="btn-confirm-save-drive"
                        onClick={handleConfirmSave}
                        disabled={isUploading || isShowingSharedDrivesRoot}
                        className="flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all cursor-pointer shadow-md disabled:opacity-50"
                      >
                        {isUploading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Saving to Drive...</span>
                          </>
                        ) : (
                          <>
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>Save in &quot;{currentFolderName}&quot;</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* New Folder Creation Dialog */}
      {showNewFolderModal && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewFolderModal(false);
          }}
        >
          <div
            className={`w-full max-w-sm rounded-xl p-5 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
            }`}
          >
            <h4 className="font-semibold text-sm mb-1 flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-blue-500" />
              <span>Create New Folder</span>
            </h4>
            <p className={`text-xs mb-3 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Will be created inside <strong>{currentFolderName}</strong>
            </p>

            <form onSubmit={handleCreateNewFolder} className="space-y-3">
              <input
                type="text"
                autoFocus
                placeholder="Folder name (e.g. 3D Exports)"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className={`w-full px-3 py-2 text-xs rounded-lg border outline-hidden transition-all ${
                  isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-blue-500'
                    : 'bg-slate-800 border-slate-700 text-slate-100 focus:border-blue-500'
                }`}
              />
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  disabled={isCreatingFolder}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                    isLight ? 'border-slate-300 hover:bg-slate-100' : 'border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim() || isCreatingFolder}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer disabled:opacity-50"
                >
                  {isCreatingFolder ? 'Creating...' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
