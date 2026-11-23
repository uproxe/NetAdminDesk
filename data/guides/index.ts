// Встроенные руководства раздела «Обучение».
import { GUIDES_NETWORK_SWITCH } from './network-switch';
import { GUIDES_LINUX } from './linux-troubleshoot';
import { GUIDES_TOOLS } from './tools-guides';
import { GUIDES_DB } from './db-guides';
import { GUIDES_MONITORING } from './monitoring-guides';
import { GUIDES_USERGATE } from './usergate-guides';
import type { Guide } from '../../src/shared/types';

export const GUIDES: Guide[] = [...GUIDES_NETWORK_SWITCH, ...GUIDES_TOOLS, ...GUIDES_MONITORING, ...GUIDES_USERGATE, ...GUIDES_LINUX, ...GUIDES_DB];

export const GUIDE_SECTIONS: { id: Guide['section']; name: string }[] = [
  { id: 'start', name: 'Первые шаги' },
  { id: 'network', name: 'Основы сетей' },
  { id: 'switch', name: 'Задачи на коммутаторах' },
  { id: 'monitoring', name: 'Мониторинг сети' },
  { id: 'usergate', name: 'UserGate NGFW' },
  { id: 'linux', name: 'Linux для начинающих' },
  { id: 'db', name: 'Базы данных' },
  { id: 'troubleshoot', name: 'Решение проблем' },
  { id: 'glossary', name: 'Словарь' }
];
