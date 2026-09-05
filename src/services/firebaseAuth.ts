import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { DriveFileItem, DriveItem, SharedDriveItem, DriveSourceType } from '../types';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');
provider.setCustomParameters({
  prompt: 'consent',
});

// In-memory token storage (Mandated: NEVER persist access tokens in localStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive access token from Google sign in');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const googleSignOut = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

// Check if a file is a 3D model
export const is3DFile = (name: string, mimeType?: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.glb') ||
    lower.endsWith('.gltf') ||
    lower.endsWith('.stl') ||
    lower.endsWith('.obj') ||
    (mimeType ? mimeType.includes('model/') || mimeType.includes('gltf') || mimeType.includes('stl') : false)
  );
};

// List Shared Drives accessible to the user
export const listSharedDrives = async (): Promise<SharedDriveItem[]> => {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in with Google to access Shared Drives.');

  const url = 'https://www.googleapis.com/drive/v3/drives?pageSize=100';
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `Failed to list Shared Drives (${res.status})`);
  }

  const data = await res.json();
  return (data.drives || []) as SharedDriveItem[];
};

// List files and folders in a specific folder, shared drive, or search query
export const listDriveContents = async (options: {
  folderId?: string;
  sourceType?: DriveSourceType;
  queryText?: string;
} = {}): Promise<DriveItem[]> => {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in with Google to access Google Drive.');

  const { folderId = 'root', sourceType = 'my-drive', queryText } = options;
  let q = 'trashed = false';

  if (queryText && queryText.trim()) {
    const sanitized = queryText.trim().replace(/'/g, "\\'");
    q += ` and name contains '${sanitized}'`;
  } else if (sourceType === 'shared-with-me') {
    q += ' and sharedWithMe = true';
  } else {
    q += ` and '${folderId}' in parents`;
  }

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,mimeType,size,modifiedTime,iconLink)&pageSize=100&orderBy=folder,name&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `Failed to list Drive files (${res.status})`);
  }

  const data = await res.json();
  const rawFiles = data.files || [];

  return rawFiles.map((file: any) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    size: file.size,
    modifiedTime: file.modifiedTime,
    iconLink: file.iconLink,
  }));
};

// Legacy fallback for simple searches
export const listDrive3DFiles = async (queryText?: string): Promise<DriveFileItem[]> => {
  const items = await listDriveContents({ queryText });
  return items
    .filter((it) => !it.isFolder && is3DFile(it.name, it.mimeType))
    .map((it) => ({
      id: it.id,
      name: it.name,
      mimeType: it.mimeType,
      size: it.size,
      modifiedTime: it.modifiedTime,
      iconLink: it.iconLink,
    }));
};

export const downloadDriveFile = async (fileId: string): Promise<Blob> => {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in with Google to download file.');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download file from Google Drive (Status ${res.status})`);
  }

  return await res.blob();
};

export const createDriveFolder = async (
  folderName: string,
  parentFolderId: string = 'root'
): Promise<{ id: string; name: string }> => {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in with Google to create folders.');

  const metadata: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentFolderId && parentFolderId !== 'root') {
    metadata.parents = [parentFolderId];
  }

  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `Failed to create folder (${res.status})`);
  }

  return await res.json();
};

export const uploadFileToDrive = async (
  fileName: string,
  mimeType: string,
  blob: Blob,
  folderId?: string
): Promise<{ id: string; name: string }> => {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in with Google to save file to Drive.');

  const metadata: any = {
    name: fileName,
    mimeType: mimeType,
  };

  if (folderId && folderId !== 'root') {
    metadata.parents = [folderId];
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `Failed to upload to Google Drive (${res.status})`);
  }

  return await res.json();
};
