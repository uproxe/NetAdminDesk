// Состояние приложения: данные из базы, открытые сессии, навигация, диалоги и уведомления.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isMac } from '../api';
import type {
  AppInfo,
  CommandRecord,
  Device,
  DeviceGroup,
  DiagnosticProfile,
  Guide,
  HistorySource,
  Note,
  RiskLevel,
  Scenario,
  SessionInfo,
  Settings,
  TemplateParamDef,
  TunnelInfo,
  VaultStatus
} from '../../shared/types';
import type { AnyPrompt, NadEvent } from '../../shared/ipc';
import { SearchIndex, type SearchDoc } from '../../shared/search';
import { GUIDES } from '../../../data/guides/index';
import { categoryName } from '../../shared/categories';
import { getPlatform } from '../../shared/platforms';
import * as terms from './terminals';

export type { Section } from './sections';
import type { Section } from './sections';

export interface OpenSession extends SessionInfo {
  /** Временный ключ вкладки до получения id сессии. */
  key: string;
  pending: boolean;
}

export interface ExecSpec {
  title: string;
  command: string;
  template?: string | null;
  kind: 'switch' | 'linux' | 'sql';
  platform: string;
  risk: RiskLevel;
  source: HistorySource;
  commandUid?: string;
  /** Выполнить в указанной сессии (иначе — активная). */
  sessionKey?: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'error' | 'warn';
}

type DialogRender = (close: () => void) => ReactNode;

export interface AppStore {
  ready: boolean;
  info: AppInfo | null;
  settings: Settings;
  commands: CommandRecord[];
  devices: Device[];
  groups: DeviceGroup[];
  scenarios: Scenario[];
  notes: Note[];
  profiles: DiagnosticProfile[];
  templateParams: TemplateParamDef[];
  vault: VaultStatus | null;
  sessions: OpenSession[];
  activeSession: string | null;
  tunnels: TunnelInfo[];
  section: Section;
  selectedCommandId: number | null;
  index: SearchIndex<SearchRef>;
  prompts: AnyPrompt[];
  toasts: Toast[];
  dialogs: { id: number; render: () => ReactNode }[];
  splitOpen: boolean;
  setSection(s: Section): void;
  setSplitOpen(v: boolean): void;
  refresh(what?: 'commands' | 'devices' | 'scenarios' | 'settings' | 'notes' | 'profiles' | 'vault' | 'all'): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  /** background — открыть сессию, не переключаясь на вкладку SSH-сессий (для диагностики и поиска MAC). */
  connect(deviceId: number, opts?: { background?: boolean }): Promise<string | null>;
  reconnect(key: string): Promise<void>;
  closeSession(key: string): Promise<void>;
  setActiveSession(key: string | null): void;
  openCommand(id: number): void;
  /** Открытое руководство раздела «Обучение». */
  guideId: string | null;
  openGuide(id: string | null): void;
  toast(text: string, kind?: Toast['kind']): void;
  openDialog(render: DialogRender): () => void;
  confirm(opts: { title: string; text: ReactNode; okText?: string; danger?: boolean }): Promise<boolean>;
  respondPrompt(requestId: string, answer: unknown): void;
  copy(text: string): Promise<void>;
  sessionByKey(key: string | null): OpenSession | undefined;
  execHandler: { current: ((spec: ExecSpec) => void) | null };
  execute(spec: ExecSpec): void;
  /** Ввод во все сессии разделённого экрана: ключи вкладок или null (выключено). */
  setBroadcast(keys: string[] | null): void;
}

export type SearchRef =
  | { type: 'command'; item: CommandRecord }
  | { type: 'device'; item: Device }
  | { type: 'scenario'; item: Scenario }
  | { type: 'note'; item: Note }
  | { type: 'guide'; item: Guide };

const Ctx = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp вне AppProvider');
  return v;
}

function buildIndex(commands: CommandRecord[], devices: Device[], scenarios: Scenario[], notes: Note[]): SearchIndex<SearchRef> {
  const docs: SearchDoc<SearchRef>[] = [];
  for (const c of commands) {
    docs.push({
      id: `c${c.id}`,
      group: c.kind,
      title: c.title,
      fields: [
        { text: c.title, weight: 3 },
        { text: c.command, weight: 3 },
        { text: c.template ?? '', weight: 1 },
        { text: c.description, weight: 1.5 },
        { text: `${c.tags.join(' ')} ${categoryName(c.kind, c.category)} ${c.vendorLabel}`, weight: 1.5 },
        { text: (c.details.examples ?? []).map((e) => `${e.cmd} ${e.desc}`).join(' '), weight: 1 },
        { text: (c.details.lineNotes ?? []).map((n) => n.note).join(' '), weight: 1 }
      ],
      facets: {
        platform: c.platform,
        vendor: c.vendorLabel,
        model: c.model,
        os: c.os,
        category: c.category,
        risk: c.risk,
        favorite: c.favorite,
        source: c.source,
        sensitive: c.sensitive,
        // Простые команды для начинающих и ваши записи — чуть выше в результатах
        boost: (c.tags.includes('основы') ? 0.15 : 0) + (c.source === 'user_txt' || c.source === 'user' ? 0.1 : 0)
      },
      ref: { type: 'command', item: c }
    });
  }
  for (const d of devices) {
    docs.push({
      id: `d${d.id}`,
      group: 'device',
      title: d.name,
      fields: [
        { text: d.name, weight: 3 },
        { text: `${d.host} ${d.hostname}`, weight: 3 },
        { text: `${d.description} ${d.location} ${d.tags.join(' ')} ${d.model} ${d.vendor} ${getPlatform(d.platform).name} ${d.linuxDistro} ${d.servicesNotes}`, weight: 1.5 }
      ],
      facets: { platform: d.platform, favorite: d.favorite, model: d.model },
      ref: { type: 'device', item: d }
    });
  }
  for (const s of scenarios) {
    docs.push({
      id: `s${s.id}`,
      group: 'scenario',
      title: s.name,
      fields: [
        { text: s.name, weight: 3 },
        { text: s.description, weight: 1.5 },
        { text: s.steps.map((x) => `${x.title} ${x.command}`).join(' '), weight: 1 }
      ],
      facets: { favorite: s.favorite, platform: s.platforms[0] },
      ref: { type: 'scenario', item: s }
    });
  }
  for (const n of notes) {
    docs.push({
      id: `n${n.id}`,
      group: 'note',
      title: n.title,
      fields: [
        { text: n.title, weight: 3 },
        { text: n.body, weight: 1.5 },
        { text: n.tags.join(' '), weight: 2 }
      ],
      facets: {},
      ref: { type: 'note', item: n }
    });
  }
  for (const g of GUIDES) {
    docs.push({
      id: `g${g.id}`,
      group: 'guide',
      title: g.title,
      fields: [
        { text: g.title, weight: 3 },
        { text: g.summary, weight: 2 },
        { text: g.tags.join(' '), weight: 2.5 },
        { text: g.body, weight: 0.8 }
      ],
      facets: {},
      ref: { type: 'guide', item: g }
    });
  }
  return new SearchIndex(docs);
}

let toastId = 1;
/**
 * Терминал создаётся до подключения под временным ключом, затем ключ меняется на id сессии
 * (и снова — при переподключении). Обработчики ввода терминала держат исходный ключ,
 * поэтому текущий ключ находится по цепочке переименований.
 */
const keyAliases = new Map<string, string>();
function resolveKey(key: string): string {
  let k = key;
  for (let i = 0; i < 64 && keyAliases.has(k); i++) k = keyAliases.get(k)!;
  return k;
}
let dialogId = 1;
let pendingKey = 1;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [profiles, setProfiles] = useState<DiagnosticProfile[]>([]);
  const [templateParams, setTemplateParams] = useState<TemplateParamDef[]>([]);
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [activeSession, setActiveSessionState] = useState<string | null>(null);
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [section, setSectionState] = useState<Section>('home');
  const [selectedCommandId, setSelectedCommandId] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<AnyPrompt[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialogs, setDialogs] = useState<{ id: number; render: () => ReactNode }[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;
  const sessionsRef = useRef<OpenSession[]>([]);
  sessionsRef.current = sessions;
  const execHandler = useRef<((spec: ExecSpec) => void) | null>(null);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastId++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const refresh = useCallback(async (what: Parameters<AppStore['refresh']>[0] = 'all') => {
    const all = what === 'all';
    const jobs: Promise<unknown>[] = [];
    if (all || what === 'commands') jobs.push(api.commands.list().then(setCommands));
    if (all || what === 'devices') jobs.push(api.devices.list().then(setDevices), api.groups.list().then(setGroups));
    if (all || what === 'scenarios') jobs.push(api.scenarios.list().then(setScenarios));
    if (all || what === 'settings') jobs.push(api.settings.get().then(setSettings));
    if (all || what === 'notes') jobs.push(api.notes.list().then(setNotes));
    if (all || what === 'profiles') jobs.push(api.profiles.list().then(setProfiles), api.templates.listParams().then(setTemplateParams));
    if (all || what === 'vault') jobs.push(api.vault.status().then(setVault));
    await Promise.all(jobs);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [i] = await Promise.all([api.app.info(), refresh('all')]);
        setInfo(i);
        const s = await api.settings.get();
        // «Справочник команд» (общий список) из версии 0.9 заменён разделами «Коммутаторы» и «Linux»
        if (s.lastSection && s.lastSection !== 'sessions') setSectionState((s.lastSection === 'reference' ? 'switches' : s.lastSection) as Section);
        setSplitOpen(false);
        setReady(true);
        await api.app.ready();
      } catch (e) {
        toast(`Ошибка загрузки данных: ${(e as Error).message}`, 'error');
      }
    })();
  }, [refresh, toast]);

  // Тема и масштаб
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    if (settings.uiFont) document.documentElement.style.setProperty('--ui-font', settings.uiFont);
    else document.documentElement.style.removeProperty('--ui-font');
    if (settings.monoFont) document.documentElement.style.setProperty('--mono-font', settings.monoFont);
    else document.documentElement.style.removeProperty('--mono-font');
    void api.app.setZoom(settings.uiScale || 1);
    terms.applyTerminalSettings(settings);
  }, [settings]);

  // События main-процесса
  useEffect(() => {
    return api.on((e: NadEvent) => {
      switch (e.type) {
        case 'ssh:data':
          terms.writeTerminal(e.id, e.data);
          break;
        case 'ssh:status':
          setSessions((list) => list.map((s) => (s.id === e.info.id ? { ...s, ...e.info, key: s.key, pending: false } : s)));
          if (e.info.status === 'closed') terms.writeInfo(e.info.id, '[соединение закрыто]');
          if (e.info.status === 'error' && e.info.error) terms.writeInfo(e.info.id, `[ошибка: ${e.info.error}]`);
          break;
        case 'ssh:closed':
          setSessions((list) => list.map((s) => (s.id === e.id ? { ...s, status: 'closed' } : s)));
          void api.devices.list().then(setDevices);
          break;
        case 'prompt':
          setPrompts((p) => [...p, e.prompt]);
          break;
        case 'tunnels:changed':
          setTunnels(e.tunnels);
          break;
        case 'data:changed':
          void refresh(e.what === 'history' ? 'commands' : (e.what as never));
          break;
        case 'app:error':
          toast(`Внутренняя ошибка: ${e.message}. Работа продолжается; подробности — в каталоге данных, logs/main.log.`, 'error');
          break;
        default:
          break;
      }
    });
  }, [refresh, toast]);

  const setSection = useCallback((s: Section) => {
    setSectionState(s);
    if (s !== 'sessions') void api.settings.set({ lastSection: s });
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const s = await api.settings.set(patch);
    setSettings(s);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      await api.app.clipboardWrite(text);
      toast('Скопировано в буфер обмена', 'ok');
    },
    [toast]
  );

  const openDialog = useCallback((render: DialogRender) => {
    const id = dialogId++;
    const close = () => setDialogs((d) => d.filter((x) => x.id !== id));
    setDialogs((d) => [...d, { id, render: () => render(close) }]);
    return close;
  }, []);

  const confirm = useCallback(
    (opts: { title: string; text: ReactNode; okText?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        openDialog((close) => (
          <ConfirmBox
            {...opts}
            onDone={(v) => {
              close();
              resolve(v);
            }}
          />
        ));
      }),
    [openDialog]
  );

  const respondPrompt = useCallback((requestId: string, answer: unknown) => {
    setPrompts((p) => p.filter((x) => x.requestId !== requestId));
    void api.prompts.respond(requestId, answer);
  }, []);

  const sessionByKey = useCallback((key: string | null) => sessionsRef.current.find((s) => s.key === key || s.id === key), []);

  // Ввод во все сессии: только для вкладок, видимых в разделённом экране (их вывод перед глазами).
  const broadcastRef = useRef<string[] | null>(null);
  const setBroadcast = useCallback((keys: string[] | null) => {
    broadcastRef.current = keys && keys.length > 1 ? keys : null;
  }, []);

  const makeTerminal = useCallback(
    (key: string) => {
      const s = settingsRef.current!;
      terms.createTerminal(key, s, {
        onInput: (data) => {
          const k = resolveKey(key);
          const targets = broadcastRef.current?.includes(k) ? broadcastRef.current : [k];
          for (const t of targets) {
            const sess = sessionsRef.current.find((x) => x.key === t);
            if (sess && !sess.pending && sess.status === 'ready') void api.ssh.write(sess.id, data);
          }
        },
        onResize: (cols, rows) => {
          const k = resolveKey(key);
          const sess = sessionsRef.current.find((x) => x.key === k);
          if (sess && !sess.pending) void api.ssh.resize(sess.id, cols, rows);
        },
        onCopy: (text) => void api.app.clipboardWrite(text),
        onPasteRequest: () => window.dispatchEvent(new CustomEvent('nad:paste', { detail: resolveKey(key) })),
        onSearch: () => window.dispatchEvent(new CustomEvent('nad:term-search', { detail: resolveKey(key) })),
        passCtrlK: () => !!settingsRef.current?.ctrlKInTerminal,
        copyOnSelect: () => !!settingsRef.current?.copyOnSelect,
        isMac
      });
    },
    []
  );

  const doConnect = useCallback(
    async (key: string, deviceId: number) => {
      const device = (await api.devices.list()).find((d) => d.id === deviceId);
      terms.writeInfo(key, `Подключение к ${device?.name ?? ''} (${device?.username ? `${device.username}@` : ''}${device?.host}:${device?.port})…`);
      try {
        const size = terms.terminalSize(key);
        const info = await api.ssh.connect(deviceId, size);
        terms.renameTerminal(key, info.id);
        if (key !== info.id) keyAliases.set(key, info.id);
        setSessions((list) => list.map((s) => (s.key === key ? { ...s, ...info, key: info.id, pending: false } : s)));
        setActiveSessionState((a) => (a === key ? info.id : a));
        setTimeout(() => {
          const sz = terms.fitTerminal(info.id);
          if (sz) void api.ssh.resize(info.id, sz.cols, sz.rows);
          terms.focusTerminal(info.id);
        }, 50);
        void api.devices.list().then(setDevices);
        return info.id;
      } catch (e) {
        const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        terms.writeInfo(key, `[не удалось подключиться] ${msg}`);
        setSessions((list) => list.map((s) => (s.key === key ? { ...s, status: 'error', error: msg, pending: false } : s)));
        void api.devices.list().then(setDevices);
        toast(msg, 'error');
        return null;
      }
    },
    [toast]
  );

  const connect = useCallback(
    async (deviceId: number, opts?: { background?: boolean }) => {
      const device = devices.find((d) => d.id === deviceId) ?? (await api.devices.list()).find((d) => d.id === deviceId);
      if (!device) return null;
      const key = `pending-${pendingKey++}`;
      makeTerminal(key);
      const s: OpenSession = {
        key,
        pending: true,
        id: key,
        deviceId,
        deviceName: device.name,
        host: device.host,
        platform: device.platform,
        protocol: device.protocol ?? 'ssh',
        status: 'connecting',
        startedAt: new Date().toISOString()
      };
      setSessions((list) => [...list, s]);
      setActiveSessionState(key);
      if (!opts?.background) setSectionState('sessions');
      return doConnect(key, deviceId);
    },
    [devices, makeTerminal, doConnect]
  );

  const reconnect = useCallback(
    async (key: string) => {
      const s = sessionsRef.current.find((x) => x.key === key);
      if (!s) return;
      if (!s.pending && s.status === 'ready') await api.ssh.disconnect(s.id);
      setSessions((list) => list.map((x) => (x.key === key ? { ...x, status: 'connecting', pending: true, error: undefined } : x)));
      await doConnect(key, s.deviceId);
    },
    [doConnect]
  );

  const closeSession = useCallback(async (key: string) => {
    const s = sessionsRef.current.find((x) => x.key === key);
    if (!s) return;
    if (!s.pending) await api.ssh.disconnect(s.id).catch(() => undefined);
    terms.disposeTerminal(s.key);
    setSessions((list) => {
      const rest = list.filter((x) => x.key !== key);
      setActiveSessionState((a) => (a === key ? rest[rest.length - 1]?.key ?? null : a));
      return rest;
    });
  }, []);

  const openCommand = useCallback(
    (id: number) => {
      const c = commands.find((x) => x.id === id);
      setSelectedCommandId(id);
      setSectionState(c?.kind === 'linux' ? 'linux' : c?.kind === 'sql' ? 'sql' : 'switches');
    },
    [commands]
  );

  const [guideId, setGuideId] = useState<string | null>(null);
  const openGuide = useCallback((id: string | null) => {
    setGuideId(id);
    if (id) setSectionState('learn');
  }, []);

  const execute = useCallback((spec: ExecSpec) => {
    execHandler.current?.(spec);
  }, []);

  const index = useMemo(() => buildIndex(commands, devices, scenarios, notes), [commands, devices, scenarios, notes]);

  const value: AppStore | null = settings
    ? {
        ready,
        info,
        settings,
        commands,
        devices,
        groups,
        scenarios,
        notes,
        profiles,
        templateParams,
        vault,
        sessions,
        activeSession,
        tunnels,
        section,
        selectedCommandId,
        index,
        prompts,
        toasts,
        dialogs,
        splitOpen,
        setSection,
        setSplitOpen,
        refresh,
        updateSettings,
        connect,
        reconnect,
        closeSession,
        setActiveSession: setActiveSessionState,
        openCommand,
        guideId,
        openGuide,
        toast,
        openDialog,
        confirm,
        respondPrompt,
        copy,
        sessionByKey,
        execHandler,
        execute,
        setBroadcast
      }
    : null;

  if (!value) {
    return <div className="empty" style={{ paddingTop: '30vh' }}>Загрузка NetAdmin Desk…</div>;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function ConfirmBox({ title, text, okText, danger, onDone }: { title: string; text: ReactNode; okText?: string; danger?: boolean; onDone: (v: boolean) => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onDone]);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">{text}</div>
        <div className="modal-footer">
          <button className="btn" onClick={() => onDone(false)}>
            Отмена
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => onDone(true)} autoFocus>
            {okText ?? 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
