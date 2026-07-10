/**
 * Qortium bridge client — wraps window.qdnRequest() for type-safe calls.
 */

const getBridge = (): ((payload: Record<string, unknown>) => Promise<unknown>) | null => {
  const candidate =
    (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).qdnRequest) ||
    (typeof globalThis !== 'undefined' && (globalThis as unknown as Record<string, unknown>).qdnRequest) ||
    null;

  return typeof candidate === 'function'
    ? (candidate as (payload: Record<string, unknown>) => Promise<unknown>)
    : null;
};

/** Returns true when running inside Qortium Home with the qdnRequest bridge */
export const hasQortiumBridge = (): boolean => getBridge() !== null;

/** Make a typed request through the Qortium bridge */
export const requestQortium = async <T = unknown>(payload: Record<string, unknown>): Promise<T> => {
  const bridge = getBridge();

  if (!bridge) {
    throw new Error('Qortium bridge not available. Open this app inside Qortium Home.');
  }

  return bridge(payload) as Promise<T>;
};

/** Read bridge state (available actions, whether inside Home) */
export const getBridgeState = async (): Promise<{
  actions: string[];
  isHomeBridge: boolean;
  isUsingPublicNode: boolean;
  ui: string;
}> => {
  try {
    const result = (await requestQortium({ action: 'WHICH_UI' })) as { ui?: string };
    const ui = typeof result?.ui === 'string' ? result.ui : 'UNKNOWN';

    return {
      actions: [],
      isHomeBridge: ui !== 'BROWSER_DEV',
      isUsingPublicNode: false,
      ui,
    };
  } catch {
    return { actions: [], isHomeBridge: false, isUsingPublicNode: false, ui: 'UNKNOWN' };
  }
};

/** Encode any JSON-serializable payload to base64 */
export const encodeToBase64 = (payload: unknown): string => {
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
};

/** Read a File as a base64 data URL */
export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file for publishing.'));
    reader.readAsDataURL(file);
  });

/** Sanitise a string into a QDN-safe identifier segment */
export const sanitizeId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

/** Create a unique, time-sorted ID suitable for QDN identifiers */
export const createShortId = (): string => {
  const timePart = Date.now().toString(36);
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const randomPart = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('');
  return `${timePart}${randomPart}`;
};
