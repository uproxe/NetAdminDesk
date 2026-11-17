// Доступ к API main-процесса (window.nad открывается preload-скриптом).
import type { NadApi } from '../shared/ipc';

declare global {
  interface Window {
    nad: NadApi & { platform?: string };
  }
}

export const api: NadApi = window.nad;
export const isMac = (window.nad as { platform?: string })?.platform === 'darwin' || /Mac/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
