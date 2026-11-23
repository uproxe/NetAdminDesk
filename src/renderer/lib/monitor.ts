// Состояние мониторинга в интерфейсе: узлы, состояния, статус. Общее для меню (счётчик «не в сети»)
// и раздела «Мониторинг»; обновляется событиями из main-процесса.
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MonitorEvent, MonitorNode, MonitorState, MonitorStatusInfo } from '../../shared/monitor';

interface MonitorData {
  nodes: MonitorNode[];
  states: Map<number, MonitorState>;
  status: MonitorStatusInfo | null;
  /** Последние события (новые сверху), для живой ленты. */
  events: MonitorEvent[];
  loaded: boolean;
}

let data: MonitorData = { nodes: [], states: new Map(), status: null, events: [], loaded: false };
const subs = new Set<() => void>();
let started = false;

function set(patch: Partial<MonitorData>) {
  data = { ...data, ...patch };
  for (const s of subs) s();
}

export async function reloadMonitor(): Promise<void> {
  const [nodes, states, status, events] = await Promise.all([api.monitor.nodes(), api.monitor.states(), api.monitor.status(), api.monitor.events({ limit: 200 })]);
  set({ nodes, states: new Map(states.map((s) => [s.nodeId, s])), status, events, loaded: true });
}

function start() {
  if (started) return;
  started = true;
  api.on((e) => {
    if (e.type === 'monitor:states') {
      const m = new Map(data.states);
      for (const s of e.states) m.set(s.nodeId, s);
      set({ states: m });
    } else if (e.type === 'monitor:status') set({ status: e.status });
    else if (e.type === 'monitor:event') set({ events: [e.event, ...data.events].slice(0, 500) });
  });
  void reloadMonitor().catch(() => undefined);
}

export function useMonitor(): MonitorData {
  const [, force] = useState(0);
  useEffect(() => {
    start();
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return data;
}
