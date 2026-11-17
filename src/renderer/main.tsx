// Точка входа интерфейса.
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { AppProvider } from './lib/store';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root');

window.addEventListener('error', (e) => console.error('[renderer]', e.message, e.error));
window.addEventListener('unhandledrejection', (e) => console.error('[renderer] unhandled', e.reason));

createRoot(root).render(
  <AppProvider>
    <App />
  </AppProvider>
);
