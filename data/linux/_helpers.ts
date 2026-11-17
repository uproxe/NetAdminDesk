// Помощник для описания встроенных Linux-команд в компактной форме.
import type { CommandInput, RiskLevel } from '../../src/shared/types';
import { classifyCommand } from '../../src/shared/risk';

export interface LinuxDef {
  /** Уникальный ключ записи (часть uid). */
  id: string;
  cat: string;
  title: string;
  /** Основная (типовая) команда — то, что копируется/выполняется по умолчанию. */
  cmd: string;
  syntax?: string;
  desc: string;
  params?: [string, string][];
  ex?: [string, string][];
  out?: string;
  /** true — нужны права root (sudo); 'partial' — без root вывод неполный. */
  root?: boolean | 'partial';
  /** Пакет, если команда не входит в базовую установку Debian/Ubuntu. */
  pkg?: string;
  compat?: string;
  warn?: string[];
  risk?: RiskLevel;
  verify?: string;
  rel?: string[];
  docs?: string;
  tpl?: string;
  tags?: string[];
  version?: string;
  /** Простая базовая команда для начинающих — показывается выше в поиске. */
  basic?: boolean;
}

export function L(d: LinuxDef): CommandInput {
  const auto = classifyCommand(d.cmd, 'linux').level;
  const privileges =
    d.root === true ? 'root (sudo)' : d.root === 'partial' ? 'обычный пользователь; часть данных — только с sudo' : 'обычный пользователь';
  return {
    uid: `builtin:linux:${d.id}`,
    kind: 'linux',
    entryType: 'command',
    platform: 'linux',
    vendorLabel: 'Linux',
    os: 'Debian / Ubuntu',
    category: d.cat,
    title: d.title,
    command: d.cmd,
    description: d.desc,
    details: {
      syntax: d.syntax,
      params: d.params?.map(([name, desc]) => ({ name, desc })),
      examples: d.ex?.map(([cmd, desc]) => ({ cmd, desc })),
      output: d.out,
      privileges,
      compat: d.compat ?? 'Debian, Ubuntu; в других дистрибутивах обычно так же',
      package: d.pkg,
      preinstalled: !d.pkg,
      warnings: d.warn,
      verify: d.verify,
      related: d.rel,
      docs: d.docs,
      versionNotes: d.version
    },
    template: d.tpl ?? null,
    risk: d.risk ?? auto,
    riskManual: false,
    mode: 'shell',
    source: 'builtin',
    verified: false,
    needsReview: false,
    vendorUnknown: false,
    sensitive: false,
    favorite: false,
    userModified: false,
    tags: [...(d.tags ?? []), ...(d.basic ? ['основы'] : [])]
  };
}
