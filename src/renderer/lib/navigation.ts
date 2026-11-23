// Модель бокового меню с прогрессивным раскрытием.
// Принцип: сначала видны только основные разделы; редкие спрятаны в «Ещё» внутри своей группы,
// группы сворачиваются, а всё остальное доступно через Ctrl+K. Пользователь может закрепить
// любой пункт или убрать его в «Ещё» (правая кнопка мыши по пункту или «Настроить меню»).
import type { Settings } from '../../shared/types';
import type { Section } from './sections';

export type NavGroupId = 'main' | 'ref' | 'tools' | 'bottom';

export interface NavItem {
  id: Section;
  label: string;
  icon: string;
  group: NavGroupId;
  /** core — виден в простом режиме; extra — в простом режиме убран в «Ещё». */
  tier: 'core' | 'extra';
  /** Короткое пояснение (подсказка и поиск Ctrl+K). */
  hint: string;
  /** Дополнительные слова для поиска раздела. */
  keywords?: string;
}

export const NAV_GROUPS: { id: Exclude<NavGroupId, 'main' | 'bottom'>; label: string }[] = [
  { id: 'tools', label: 'Инструменты' },
  { id: 'ref', label: 'Справочник' }
];

export const NAV: NavItem[] = [
  { id: 'home', label: 'Главная', icon: 'home', group: 'main', tier: 'core', hint: 'С чего начать, последние устройства и подсказки' },
  { id: 'devices', label: 'Устройства', icon: 'server', group: 'main', tier: 'core', hint: 'Коммутаторы и серверы: адреса, логины, группы', keywords: 'хосты оборудование адреса' },
  { id: 'sessions', label: 'Сессии', icon: 'terminal', group: 'main', tier: 'core', hint: 'Открытые подключения SSH, Telnet и COM-порт', keywords: 'терминал консоль ssh telnet подключение' },
  { id: 'switches', label: 'Коммутаторы', icon: 'switch', group: 'ref', tier: 'core', hint: 'Команды коммутаторов по производителям', keywords: 'cisco hp vlan порт справочник' },
  { id: 'linux', label: 'Linux', icon: 'linux', group: 'ref', tier: 'core', hint: 'Команды Linux от простых до админских', keywords: 'сервер debian ubuntu справочник' },
  { id: 'sql', label: 'Базы данных', icon: 'database', group: 'ref', tier: 'core', hint: 'SQL: MySQL, MariaDB, PostgreSQL — подключение, пользователи, копии, мониторинг', keywords: 'sql mysql mariadb postgresql postgres база данных бд справочник' },
  { id: 'usergate', label: 'UserGate', icon: 'shield', group: 'ref', tier: 'core', hint: 'Межсетевой экран UserGate NGFW: CLI, сеть, правила, диагностика', keywords: 'usergate юзергейт ngfw межсетевой экран firewall утм ugos' },
  { id: 'learn', label: 'Обучение', icon: 'book', group: 'ref', tier: 'core', hint: 'Пошаговые руководства и словарь терминов', keywords: 'руководство инструкция учебник словарь' },
  { id: 'notes', label: 'Мои заметки', icon: 'note', group: 'ref', tier: 'extra', hint: 'Свои записи и шпаргалки' },
  { id: 'favorites', label: 'Избранное', icon: 'star', group: 'ref', tier: 'extra', hint: 'Отмеченные звёздочкой команды и сценарии' },
  { id: 'monitor', label: 'Мониторинг', icon: 'pulse', group: 'tools', tier: 'core', hint: 'Карта сети: какие устройства в сети, а какие нет (ping, SNMP, трапы), оповещения', keywords: 'мониторинг карта сети доступность snmp трап zabbix заббикс ping не в сети упал оповещение почта' },
  { id: 'passwords', label: 'Менеджер паролей', icon: 'key', group: 'tools', tier: 'core', hint: 'Логины, пароли и заметки под мастер-паролем — как KeePass; генератор, импорт и экспорт', keywords: 'пароли менеджер паролей keepass кипасс логин хранилище секреты генератор паролей bitwarden' },
  { id: 'scenarios', label: 'Сценарии', icon: 'list', group: 'tools', tier: 'core', hint: 'Готовые пошаговые действия: VLAN, PoE, диски, службы' },
  { id: 'diagnostics', label: 'Диагностика', icon: 'activity', group: 'tools', tier: 'core', hint: 'Проверка порта, коммутатора и сервера одной кнопкой' },
  { id: 'nettools', label: 'Сетевые утилиты', icon: 'calculator', group: 'tools', tier: 'extra', hint: 'Калькулятор подсетей, MAC-адреса, ping, проверка порта, SSH-ключи', keywords: 'калькулятор маска подсеть ip ping трассировка mac ключ' },
  { id: 'history', label: 'История', icon: 'history', group: 'tools', tier: 'extra', hint: 'Все отправленные команды и их результат' },
  { id: 'backups', label: 'Резервные копии', icon: 'archive', group: 'tools', tier: 'extra', hint: 'Копии конфигураций и сравнение версий', keywords: 'бэкап конфиг сравнение' },
  { id: 'settings', label: 'Настройки', icon: 'settings', group: 'bottom', tier: 'core', hint: 'Безопасность, терминал, импорт и экспорт' }
];

export const NAV_TITLES: Record<string, string> = {
  ...Object.fromEntries(NAV.map((n) => [n.id, n.label])),
  sessions: 'Сессии: SSH, Telnet, COM-порт',
  reference: 'Справочник команд коммутаторов',
  switches: 'Справочник команд коммутаторов',
  linux: 'Справочник команд Linux',
  sql: 'Справочник SQL: MySQL, MariaDB, PostgreSQL',
  learn: 'Обучение: руководства и словарь',
  nettools: 'Сетевые утилиты',
  usergate: 'Справочник UserGate NGFW',
  monitor: 'Мониторинг: карта сети и доступность',
  passwords: 'Менеджер паролей'
};

type NavSettings = Pick<Settings, 'uiMode' | 'navOverrides' | 'navCollapsed'>;

/** Пункт виден в меню (а не спрятан в «Ещё»). */
export function isNavShown(item: NavItem, s: NavSettings): boolean {
  const o = s.navOverrides?.[item.id];
  if (o) return o === 'show';
  return s.uiMode === 'full' || item.tier === 'core';
}

/** Сколько пунктов спрятано в «Ещё» во всех группах. */
export function hiddenNavCount(s: NavSettings): number {
  return NAV.filter((n) => !isNavShown(n, s)).length;
}
