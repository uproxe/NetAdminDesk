// Preload: открывает интерфейсу только перечисленные в API_SPEC методы (contextIsolation, sandbox).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { API_SPEC, EVENT_CHANNEL, type NadEvent } from '../shared/ipc';

const api: Record<string, unknown> = {};
for (const [ns, methods] of Object.entries(API_SPEC)) {
  const obj: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const m of methods) obj[m] = (...args: unknown[]) => ipcRenderer.invoke(`nad:${ns}.${m}`, ...args);
  api[ns] = obj;
}
api.on = (listener: (e: NadEvent) => void) => {
  const h = (_e: IpcRendererEvent, payload: NadEvent) => listener(payload);
  ipcRenderer.on(EVENT_CHANNEL, h);
  return () => ipcRenderer.removeListener(EVENT_CHANNEL, h);
};
api.platform = process.platform;

contextBridge.exposeInMainWorld('nad', api);
