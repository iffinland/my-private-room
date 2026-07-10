import type { QortiumAccount } from '../../types';
import { requestQortium } from './qortiumClient';

/**
 * Request the currently selected account from Qortium Home.
 * The user may need to approve the request in the Home UI.
 */
export const getSelectedAccount = async (): Promise<QortiumAccount> => {
  const raw = (await requestQortium({ action: 'GET_SELECTED_ACCOUNT' })) as Record<string, unknown>;

  const address = typeof raw?.address === 'string' ? raw.address : '';
  const accountName = typeof raw?.name === 'string' ? raw.name : null;

  // Collect all names owned by this account
  const rawNames = raw?.names ?? raw?.accountNames ?? [];
  const names: string[] = (Array.isArray(rawNames) ? rawNames : [rawNames])
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).name === 'string') {
        return ((entry as Record<string, unknown>).name as string).trim();
      }
      return '';
    })
    .filter(Boolean);

  // Deduplicate and ensure the account name is first
  const uniqueNames = Array.from(new Set([accountName, ...names].filter((n): n is string => n !== null)));

  return {
    address,
    name: uniqueNames[0] ?? null,
    names: uniqueNames,
    isUnlocked: raw?.isUnlocked === true,
  };
};

/** Check whether the selected account is usable (address present and unlocked) */
export const isAccountReady = (account: QortiumAccount | null): boolean =>
  account !== null && account.address.length > 0 && account.isUnlocked;
