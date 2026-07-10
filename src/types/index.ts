/** The currently selected account in Qortium Home */
export interface QortiumAccount {
  address: string;
  name: string | null;
  names: string[];
  isUnlocked: boolean;
}

/** A file stored in the user's file office */
export interface PrivateFile {
  id: string;
  identifier: string;
  name: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  tags: string[];
  /** ISO timestamp of when the file was published */
  uploadedAt: string;
  /** Optional description / notes about the file */
  description?: string;
  thumbnailIdentifier: string | null;
}

/** Raw QDN resource status response */
export interface QdnResourceStatus {
  status: string;
  description?: string;
  localChunkCount?: number;
  totalChunkCount?: number;
  percentLoaded?: number;
}

/** Result of a file publish operation */
export interface FilePublishResult {
  success: boolean;
  identifier: string;
  error?: string;
}

/** App-level load state */
export type LoadState<T> =
  | { phase: 'idle'; value: T }
  | { phase: 'loading'; value: T }
  | { phase: 'ready'; value: T }
  | { phase: 'error'; value: T; error: string };

/** QDN bridge actions available in this session */
export interface BridgeInfo {
  actions: string[];
  isHomeBridge: boolean;
}

/** Category definition */
export interface FileCategory {
  id: string;
  label: string;
  icon: string;
  mimePatterns: string[];
}
