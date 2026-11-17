// Шаблоны команд: {{ИМЯ}} или {{ИМЯ:значение по умолчанию}}.
import type { TemplateParamDef } from './types';
import { getPlatform } from './platforms';
import { formatMac, parseMac } from './mac';

export const PARAM_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::([^}]*))?\}\}/g;

export const BUILTIN_PARAMS: TemplateParamDef[] = [
  { name: 'IP', label: 'IP-адрес', type: 'ip', builtin: true, description: 'IPv4 или IPv6 адрес' },
  { name: 'MAC', label: 'MAC-адрес', type: 'mac', builtin: true, description: 'Любой формат; будет приведён к формату платформы' },
  { name: 'PORT', label: 'Порт', type: 'port', builtin: true, description: 'Номер порта коммутатора или TCP/UDP-порт' },
  { name: 'VLAN', label: 'VLAN', type: 'vlan', builtin: true, description: 'Номер VLAN 1–4094' },
  { name: 'INTERFACE', label: 'Интерфейс', type: 'interface', builtin: true, description: 'Например Gi1/0/5, ge1/5, e15, eth0' },
  { name: 'DEVICE', label: 'Устройство / имя хоста', type: 'text', builtin: true },
  { name: 'ACL_NAME', label: 'Имя или номер ACL', type: 'text', builtin: true },
  { name: 'SERVICE', label: 'Служба systemd', type: 'text', builtin: true, regex: '^[\\w@.:\\-]+$' },
  { name: 'USERNAME', label: 'Имя пользователя', type: 'text', builtin: true, regex: '^[\\w.\\-@]+$' },
  { name: 'FILE', label: 'Файл', type: 'path', builtin: true },
  { name: 'DIRECTORY', label: 'Каталог', type: 'path', builtin: true },
  { name: 'VLAN_LIST', label: 'Список VLAN', type: 'regex', regex: '^\\d{1,4}([,\\-]\\d{1,4})*$', builtin: true, description: 'Например 61,202 или 100-110' },
  { name: 'GROUP_NAME', label: 'Имя object-group', type: 'text', builtin: true },
  { name: 'LINE_NUMBER', label: 'Номер строки ACL', type: 'number', builtin: true },
  { name: 'PORT_CHANNEL', label: 'Номер Port-channel', type: 'number', builtin: true },
  { name: 'PASSWORD', label: 'Пароль', type: 'text', builtin: true, description: 'Не сохраняется в истории' },
  { name: 'HOST', label: 'Хост (IP или DNS-имя)', type: 'text', builtin: true },
  { name: 'MINUTES', label: 'Минуты', type: 'number', builtin: true },
  { name: 'VALUE', label: 'Значение', type: 'text', builtin: true },
  { name: 'DATABASE', label: 'База данных', type: 'regex', regex: '^[A-Za-z0-9_$\\-]+$', builtin: true, description: 'Имя базы: латиница, цифры, _ и -' },
  { name: 'TABLE', label: 'Таблица', type: 'regex', regex: '^[A-Za-z0-9_$.\\-]+$', builtin: true, description: 'Имя таблицы, можно со схемой: public.orders' },
  { name: 'PID', label: 'Номер процесса / соединения', type: 'number', builtin: true, description: 'Из SHOW PROCESSLIST (Id) или pg_stat_activity (pid)' }
];

export interface TemplateParam {
  name: string;
  defaultValue?: string;
  def: TemplateParamDef;
}

export function findParamDef(name: string, custom: TemplateParamDef[] = []): TemplateParamDef {
  const base = name.replace(/\d+$/, '');
  return (
    custom.find((p) => p.name === name) ||
    BUILTIN_PARAMS.find((p) => p.name === name) ||
    custom.find((p) => p.name === base) ||
    BUILTIN_PARAMS.find((p) => p.name === base) || { name, label: name, type: 'text', builtin: false }
  );
}

export function hasParams(text: string | null | undefined): boolean {
  if (!text) return false;
  PARAM_RE.lastIndex = 0;
  return PARAM_RE.test(text);
}

/** Список параметров шаблона в порядке появления (без повторов). */
export function parseTemplate(text: string, custom: TemplateParamDef[] = []): TemplateParam[] {
  const seen = new Map<string, TemplateParam>();
  PARAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARAM_RE.exec(text))) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.set(name, { name, defaultValue: m[2]?.trim() || undefined, def: findParamDef(name, custom) });
    } else if (m[2] && !seen.get(name)!.defaultValue) {
      seen.get(name)!.defaultValue = m[2].trim();
    }
  }
  return [...seen.values()];
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function validateParam(def: TemplateParamDef, raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Значение не заполнено';
  if (/[\r\n]/.test(v)) return 'Значение не должно содержать перевод строки';
  switch (def.type) {
    case 'ip':
      if (IPV4.test(v) || (v.includes(':') && IPV6.test(v))) return null;
      return 'Некорректный IP-адрес';
    case 'mac':
      return parseMac(v) ? null : 'Некорректный MAC-адрес';
    case 'vlan': {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 4094 ? null : 'VLAN должен быть числом 1–4094';
    }
    case 'number':
      return /^\d+$/.test(v) ? null : 'Ожидается число';
    case 'port':
      return /^[\w\/.:\-]+$/.test(v) ? null : 'Некорректный порт';
    case 'interface':
      return /^[\w\/.:\- ]+$/.test(v) ? null : 'Некорректное имя интерфейса';
    case 'regex':
    case 'text':
    case 'path':
      if (def.regex) {
        try {
          return new RegExp(def.regex).test(v) ? null : `Значение не соответствует формату ${def.regex}`;
        } catch {
          return null;
        }
      }
      return null;
    default:
      return null;
  }
}

export interface RenderResult {
  text: string;
  missing: string[];
  errors: Record<string, string>;
  /** Значения после нормализации (например, MAC в формате платформы). */
  normalized: Record<string, string>;
}

export function renderTemplate(
  text: string,
  values: Record<string, string>,
  opts: { platform?: string; custom?: TemplateParamDef[]; macFormat?: string } = {}
): RenderResult {
  const params = parseTemplate(text, opts.custom);
  const missing: string[] = [];
  const errors: Record<string, string> = {};
  const normalized: Record<string, string> = {};
  for (const p of params) {
    let v = values[p.name] ?? p.defaultValue ?? '';
    const err = validateParam(p.def, v);
    if (err) {
      if (!v.trim()) missing.push(p.name);
      else errors[p.name] = err;
      continue;
    }
    v = v.trim();
    if (p.def.type === 'mac') {
      const hex = parseMac(v)!;
      const fmt = (opts.macFormat as never) || getPlatform(opts.platform).macFormat;
      v = formatMac(hex, fmt);
    }
    normalized[p.name] = v;
  }
  PARAM_RE.lastIndex = 0;
  const out = text.replace(PARAM_RE, (whole, name: string) => normalized[name] ?? whole);
  return { text: out, missing, errors, normalized };
}

// ---------- Автоматическое предложение шаблона ----------

const IPV4_IN_TEXT = /(?<![\d.])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?![\d.])/g;

function isMaskLike(ip: string): boolean {
  return /^(255|0)\./.test(ip) || /^255\.255\./.test(ip);
}

/**
 * Предлагает шаблон на основе исходной команды: MAC, IP, VLAN, интерфейсы, ACL и т. д.
 * Возвращает null, если подставлять нечего. Исходная команда не изменяется.
 */
export function suggestTemplate(command: string, kind: 'switch' | 'linux' | 'sql' = 'switch'): string | null {
  let t = command;
  // Разные значения одного типа получают разные параметры: {{INTERFACE}}, {{INTERFACE2}}…
  const maps = new Map<string, Map<string, string>>();
  const alloc = (type: string, value: string): string => {
    let m = maps.get(type);
    if (!m) maps.set(type, (m = new Map()));
    const key = value.toLowerCase();
    if (!m.has(key)) m.set(key, m.size === 0 ? `{{${type}}}` : `{{${type}${m.size + 1}}}`);
    return m.get(key)!;
  };

  // MAC-адреса любых форматов
  t = t.replace(/\b[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\b/g, (v) => alloc('MAC', parseMac(v) ?? v));
  t = t.replace(/\b[0-9a-fA-F]{2}([-:])[0-9a-fA-F]{2}(?:\1[0-9a-fA-F]{2}){4}\b/g, (v) => alloc('MAC', parseMac(v) ?? v));

  // IP-адреса (маски и wildcard не трогаем)
  t = t.replace(IPV4_IN_TEXT, (ip) => (isMaskLike(ip) ? ip : alloc('IP', ip)));
  let ph = 0;
  t = t.replace(/\bxxx\.xx\.xx\.xx\b/g, () => alloc('IP', `xxx#${ph++}`));

  if (kind === 'switch') {
    // Имена файлов при копировании на TFTP
    t = t.replace(/(tftp:\/\/\{\{IP\d*\}\}\/)([^\s{}]+)/g, (_w, a, f) => a + alloc('FILE', f));
    t = t.replace(/\b(destfile=|filename\s+)([^\s{}]+)/g, (_w, a, f) => a + alloc('FILE', f));
    t = t.replace(/(tftp\s+\{\{IP\d*\}\}\s+)([^\s{}]+\.\w+)/g, (_w, a, f) => a + alloc('FILE', f));
    // VLAN
    t = t.replace(/(allowed vlan\s+(?:add|remove|except)\s+)(\d[\d,\-]*)/gi, (_w, a, v) => a + alloc('VLAN_LIST', v));
    t = t.replace(/\b(vlans?\s+(?:id\s+)?)(\d{1,4})\b(?![\-,\d])/gi, (_w, a, v) => a + alloc('VLAN', v));
    t = t.replace(/\b(interface\s+Vlan|^Vlan)(\d{1,4})\b/gim, (_w, a, v) => a + alloc('VLAN', v));
    t = t.replace(/\b(vlan=)("?)(\d{1,4})\2(?![\-,\d])/gi, (_w, a, q, v) => `${a}${q}${alloc('VLAN', v)}${q}`);
    t = t.replace(/\b(vid=)(\d{1,4})\b/gi, (_w, a, v) => a + alloc('VLAN', v));
    // Интерфейсы Cisco (без диапазонов)
    t = t.replace(
      /\b((?:Ten|ten)?[Gg]igabit[Ee]thernet|[Ff]ast[Ee]thernet|Gi|Fa|Te|gi|fa|te)\s?(\d+(?:\/\d+){0,2})\b(?![\-\d\/,])/g,
      (w) => alloc('INTERFACE', w.replace(/\s+/g, ''))
    );
    // OSNOVO ge1/5, Linksys/AT ethernet g5/e15, HP d20/b10/trk3
    t = t.replace(/\bge\d+\/\d+\b(?![\-\d\/,])/g, (w) => alloc('INTERFACE', w));
    t = t.replace(/\b(ethernet\s+)((?:[a-z]\d{1,3})|trk\d+)\b(?![\-,\d])/g, (_w, a, v) => a + alloc('INTERFACE', v));
    t = t.replace(/\b(interface\s+|mac-address\s+)([a-z]\d{1,2}|trk\d+)\b(?![\-,\d])/g, (_w, a, v) => a + alloc('INTERFACE', v));
    // AlliedWare port=8, interface=14
    t = t.replace(/\b(port=|interface=)(\d+)\b(?![\-,\d])/g, (_w, a, v) => a + alloc('PORT', v));
    // Port-channel / EtherChannel
    t = t.replace(/\b(etherchannel\s+|port-channel\s?)(\d+)\b/gi, (_w, a, v) => a + alloc('PORT_CHANNEL', v));
    // ACL
    t = t.replace(
      /\b(access-lists?(?:\s+(?:extended|standard|resequence))?\s+|access-group\s+)(?!\{\{)([\w\-]+)/g,
      (_w, a, v) => a + alloc('ACL_NAME', v)
    );
    // Object-group
    t = t.replace(/\b(object-group\s+(?:network\s+|service\s+|name\s+)?)(?!\{\{|network\b|service\b|name\b)([\w.\-]+)/g, (_w, a, v) => a + alloc('GROUP_NAME', v));
    t = t.replace(/<название группы>/g, (v) => alloc('GROUP_NAME', v));
    t = t.replace(/<номер порта>/g, (v) => alloc('PORT', v));
    t = t.replace(/\(номер строки\)/g, '{{LINE_NUMBER}}');
    t = t.replace(/^(no\s+)(\d+)\s*$/gm, '$1{{LINE_NUMBER}}');
    t = t.replace(/(?<!\p{L})ИМЯ(?!\p{L})/gu, '{{USERNAME}}').replace(/(?<!\p{L})ПАРОЛЬ(?!\p{L})/gu, '{{PASSWORD}}');
    t = t.replace(/\b(hostname\s+)(?!\{\{)([\w.\-]+)/g, (_w, a, v) => a + alloc('DEVICE', v));
    t = t.replace(/\b(reload in\s+)(\d+)\b/g, '$1{{MINUTES}}');
    t = t.replace(/(\|\s*(?:in|include)\s+)\.{3,}/g, '$1{{VALUE}}');
  }

  return t !== command ? t : null;
}
