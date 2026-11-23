import { useMemo, type ReactNode } from 'react';
import { api } from '../api';
import { useApp } from '../lib/store';

/**
 * Окна менеджера паролей рисуются в корне приложения, вне раздела, поэтому:
 * - действия в них отдельно продлевают время до автоблокировки;
 * - при блокировке (таймер, экран, сворачивание) они закрываются, чтобы открытый
 *   пароль или форма записи не оставались на экране.
 */

const open = new Set<() => void>();
let lastTouch = 0;

/** Продлить сеанс: не чаще раза в 20 с. */
export function pmActivity(): void {
  const now = Date.now();
  if (now - lastTouch < 20_000) return;
  lastTouch = now;
  void api.passwords.touch().catch(() => undefined);
}

/** Закрыть все окна менеджера паролей (при блокировке или уходе из раздела). */
export function closePmDialogs(): void {
  for (const close of [...open]) close();
  open.clear();
}

/** useApp(), у которого openDialog учитывает окна менеджера паролей. */
export function usePmApp(): ReturnType<typeof useApp> {
  const app = useApp();
  return useMemo(() => {
    const openDialog = (render: (close: () => void) => ReactNode) => {
      let closeOuter: () => void = () => undefined;
      const close = () => {
        open.delete(close);
        closeOuter();
      };
      closeOuter = app.openDialog(() => (
        <div style={{ display: 'contents' }} onMouseDown={pmActivity} onKeyDown={pmActivity}>
          {render(close)}
        </div>
      ));
      open.add(close);
      return close;
    };
    return { ...app, openDialog };
  }, [app]);
}
