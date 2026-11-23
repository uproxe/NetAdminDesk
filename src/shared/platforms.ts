// Реестр платформ: производители коммутаторов, Linux и прочие SSH-устройства.

export type MacFormat = 'cisco' | 'dash' | 'colon' | 'hp' | 'plain';

export interface PlatformInfo {
  id: string;
  name: string;
  vendor: string;
  /** db — СУБД (для команд SQL; устройством не является). */
  kind: 'switch' | 'linux' | 'other' | 'db';
  /** Команды отключения постраничного вывода (выполняются видимо в терминале). */
  pagerOff: string[];
  /** Команда получения текущей конфигурации для резервной копии. */
  configCommand?: string;
  configCommandVerified: boolean;
  macFormat: MacFormat;
  macFormatVerified: boolean;
  /** Команда сохранения конфигурации. */
  saveCommand?: string;
  /** Поддерживает ли устройство обычно SSH exec (true только для Linux). */
  execSupported: boolean;
  notes: string;
  /** Порт SSH по умолчанию, если не 22. */
  sshPort?: number;
  /** Имя пользователя по умолчанию (подсказка в карточке устройства). */
  defaultUser?: string;
  /** В диагностике показывать только задачи, для которых есть профиль (не коммутатор). */
  diagOnlyProfiled?: boolean;
}

export const UNKNOWN_PLATFORM = 'unknown-ios';

export const PLATFORMS: PlatformInfo[] = [
  {
    id: UNKNOWN_PLATFORM,
    name: 'Производитель не указан (IOS-подобный синтаксис)',
    vendor: 'Не указан',
    kind: 'switch',
    pagerOff: [],
    configCommand: 'show running-config',
    configCommandVerified: false,
    macFormat: 'cisco',
    macFormatVerified: false,
    execSupported: false,
    notes:
      'Команды из основного раздела TXT-заметок до заголовка ###SG300###. Производитель в файле не указан; синтаксис похож на Cisco IOS / Cisco Small Business, но это предположение, а не установленный факт.'
  },
  {
    id: 'cisco-ios',
    name: 'Cisco IOS / IOS XE',
    vendor: 'Cisco',
    kind: 'switch',
    pagerOff: ['terminal length 0'],
    configCommand: 'show running-config',
    configCommandVerified: true,
    macFormat: 'cisco',
    macFormatVerified: true,
    saveCommand: 'copy running-config startup-config',
    execSupported: false,
    notes: 'Классический Cisco IOS и IOS XE (Catalyst).'
  },
  {
    id: 'cisco-sg300',
    name: 'Cisco SG300 (Small Business)',
    vendor: 'Cisco',
    kind: 'switch',
    pagerOff: ['terminal datadump'],
    configCommand: 'show running-config',
    configCommandVerified: true,
    macFormat: 'colon',
    macFormatVerified: false,
    saveCommand: 'copy running-config startup-config',
    execSupported: false,
    notes: 'Серия Cisco Small Business (SG300/SF300 и близкие).'
  },
  {
    id: 'hp-procurve',
    name: 'HP ProCurve',
    vendor: 'HP',
    kind: 'switch',
    pagerOff: ['no page'],
    configCommand: 'show running-config',
    configCommandVerified: true,
    macFormat: 'cisco',
    macFormatVerified: false,
    saveCommand: 'write memory',
    execSupported: false,
    notes:
      'HP ProCurve / Aruba (ProVision). В TXT-заметках MAC указан в формате xxxx.xxxx.xxxx; в документации HP также используется формат xxxxxx-xxxxxx.'
  },
  {
    id: 'linksys',
    name: 'Linksys',
    vendor: 'Linksys',
    kind: 'switch',
    pagerOff: [],
    configCommand: 'show running-config',
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    notes: 'Управляемые коммутаторы Linksys (SRW/SPS).'
  },
  {
    id: 'at-8000s',
    name: 'Allied Telesis AT-8000S',
    vendor: 'Allied Telesis',
    kind: 'switch',
    pagerOff: [],
    configCommand: 'show running-config',
    configCommandVerified: false,
    macFormat: 'dash',
    macFormatVerified: true,
    saveCommand: 'copy running-config startup-config',
    execSupported: false,
    notes: 'Allied Telesis AT-8000S. Формат MAC xx-xx-xx-xx-xx-xx — по примеру из TXT-заметок.'
  },
  {
    id: 'alliedware',
    name: 'Allied Telesis (AlliedWare)',
    vendor: 'Allied Telesis',
    kind: 'switch',
    pagerOff: [],
    configCommand: 'show config dynamic',
    configCommandVerified: true,
    macFormat: 'dash',
    macFormatVerified: true,
    saveCommand: 'create config=boot.cfg',
    execSupported: false,
    notes:
      'Allied Telesis с CLI AlliedWare (приглашения вида «Manager >», «SecOff …>»). Конфигурацию сохраняют командой create config=<имя загрузочного файла> (см. show config).'
  },
  {
    id: 'qtech',
    name: 'Qtech',
    vendor: 'Qtech',
    kind: 'switch',
    pagerOff: [],
    configCommand: 'show running-config',
    configCommandVerified: false,
    macFormat: 'dash',
    macFormatVerified: false,
    execSupported: false,
    notes: 'Коммутаторы Qtech. Встроенные профили содержат только команды из TXT-заметок.'
  },
  {
    id: 'osnovo',
    name: 'OSNOVO',
    vendor: 'OSNOVO',
    kind: 'switch',
    pagerOff: [],
    configCommand: 'show running-config',
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    notes: 'Коммутаторы OSNOVO (порты вида ge1/5). Используйте синтаксис OSNOVO, команды Cisco не подставляются.'
  },
  {
    id: 'tplink',
    name: 'TP-Link',
    vendor: 'TP-Link',
    kind: 'switch',
    pagerOff: [],
    configCommand: 'show running-config',
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    saveCommand: 'copy running-config startup-config',
    execSupported: false,
    notes: 'Управляемые коммутаторы TP-Link (JetStream).'
  },
  {
    id: 'usergate',
    name: 'UserGate NGFW 7.x',
    vendor: 'UserGate',
    kind: 'switch',
    pagerOff: [],
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    sshPort: 2200,
    defaultUser: 'Admin',
    diagOnlyProfiled: true,
    notes:
      'Межсетевой экран UserGate NGFW 7.x. CLI по SSH на порту 2200 (доступ включается в зоне: «Контроль доступа → CLI по SSH»), пользователь Admin. После входа — режим диагностики (Admin@узел>), команда configure — режим конфигурации (Admin@узел#). В UserGate 6 и старше синтаксис CLI другой. Резервную копию настроек делают из веб-консоли или правилами экспорта — команды «показать всю конфигурацию» в справочнике нет.'
  },
  {
    id: 'linux',
    name: 'Linux (Debian / Ubuntu)',
    vendor: 'Linux',
    kind: 'linux',
    pagerOff: [],
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: true,
    execSupported: true,
    notes: 'Linux-серверы. Основной акцент — Debian и Ubuntu.'
  },
  {
    id: 'generic-ssh',
    name: 'Другое SSH-устройство',
    vendor: 'Другое',
    kind: 'other',
    pagerOff: [],
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    notes: 'Любое SSH-совместимое устройство.'
  },
  {
    id: 'sql',
    name: 'SQL (одинаково в MySQL, MariaDB и PostgreSQL)',
    vendor: 'SQL',
    kind: 'db',
    pagerOff: [],
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    notes: 'Стандартный SQL: работает в MySQL, MariaDB и PostgreSQL одинаково или почти одинаково.'
  },
  {
    id: 'mysql',
    name: 'MySQL / MariaDB',
    vendor: 'MySQL / MariaDB',
    kind: 'db',
    pagerOff: [],
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    notes: 'MariaDB — ответвление MySQL: синтаксис команд почти одинаковый, отличия отмечены в карточках. Клиент: mysql (в новых MariaDB — mariadb).'
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    vendor: 'PostgreSQL',
    kind: 'db',
    pagerOff: [],
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    notes: 'PostgreSQL: клиент psql, служебные команды начинаются с обратной косой черты (\\l, \\dt, \\du).'
  }
];

const byId = new Map(PLATFORMS.map((p) => [p.id, p]));

export function getPlatform(id: string | undefined | null): PlatformInfo {
  return (id && byId.get(id)) || customPlatform(id || 'generic-ssh');
}

export function customPlatform(id: string, name?: string): PlatformInfo {
  return {
    id,
    name: name || id.replace(/^custom-/, ''),
    vendor: name || id,
    kind: 'switch',
    pagerOff: [],
    configCommandVerified: false,
    macFormat: 'colon',
    macFormatVerified: false,
    execSupported: false,
    notes: 'Пользовательская платформа.'
  };
}

export function isKnownPlatform(id: string): boolean {
  return byId.has(id);
}

/** Типы устройств, предлагаемые в карточке устройства. */
export const DEVICE_TYPES: { id: string; label: string; platform: string }[] = [
  { id: 'cisco', label: 'Cisco', platform: 'cisco-ios' },
  { id: 'cisco-sg300', label: 'Cisco SG300', platform: 'cisco-sg300' },
  { id: 'hp-procurve', label: 'HP ProCurve', platform: 'hp-procurve' },
  { id: 'linksys', label: 'Linksys', platform: 'linksys' },
  { id: 'at-8000s', label: 'Allied Telesis AT-8000S', platform: 'at-8000s' },
  { id: 'alliedware', label: 'Allied Telesis (AlliedWare)', platform: 'alliedware' },
  { id: 'qtech', label: 'Qtech', platform: 'qtech' },
  { id: 'osnovo', label: 'OSNOVO', platform: 'osnovo' },
  { id: 'tplink', label: 'TP-Link', platform: 'tplink' },
  { id: 'usergate', label: 'UserGate NGFW (межсетевой экран)', platform: 'usergate' },
  { id: 'linux', label: 'Linux Server', platform: 'linux' },
  { id: 'unknown-ios', label: 'Коммутатор (IOS-подобный, производитель не указан)', platform: UNKNOWN_PLATFORM },
  { id: 'other', label: 'Другое SSH-устройство', platform: 'generic-ssh' }
];

export type CompatLevel = 'ok' | 'maybe' | 'mismatch';

export interface CompatResult {
  level: CompatLevel;
  message: string;
}

/** Проверка совместимости команды с платформой устройства. */
export function checkCompat(commandPlatform: string, commandKind: 'switch' | 'linux' | 'sql', devicePlatform: string): CompatResult {
  const dev = getPlatform(devicePlatform);
  if (commandKind === 'sql') {
    if (dev.kind === 'linux' || dev.kind === 'other')
      return { level: 'ok', message: 'Команда SQL выполняется на сервере с базой данных. Если это не команда оболочки (mysql, psql, pg_dump…), сначала откройте клиент базы в этой сессии.' };
    return { level: 'mismatch', message: `Команды SQL выполняются на сервере с базой данных, а «${dev.name}» — коммутатор.` };
  }
  if (commandKind === 'linux') {
    if (dev.kind === 'linux') return { level: 'ok', message: 'Linux-команда для Linux-сервера.' };
    return { level: 'mismatch', message: `Linux-команда не предназначена для устройства «${dev.name}».` };
  }
  if (dev.kind === 'linux') {
    return { level: 'mismatch', message: 'Команда коммутатора не предназначена для Linux-сервера.' };
  }
  if (commandPlatform === devicePlatform) return { level: 'ok', message: `Команда для платформы «${dev.name}».` };
  if (commandPlatform === UNKNOWN_PLATFORM || devicePlatform === UNKNOWN_PLATFORM) {
    return {
      level: 'maybe',
      message:
        'Производитель команды или устройства не указан. Совместимость не подтверждена — проверьте синтаксис перед выполнением.'
    };
  }
  if (dev.kind === 'other') {
    return { level: 'maybe', message: 'Тип устройства «Другое». Совместимость не может быть проверена.' };
  }
  const cmd = getPlatform(commandPlatform);
  return {
    level: 'mismatch',
    message: `Команда относится к платформе «${cmd.name}», а устройство — «${dev.name}». Автоматическая отправка запрещена.`
  };
}
