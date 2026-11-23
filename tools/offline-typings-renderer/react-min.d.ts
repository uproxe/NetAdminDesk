// Минимальные объявления React для офлайн-проверки типов интерфейса, когда @types/react не установлен.
// Проверяют использование собственных типов приложения; полная проверка JSX выполняется в CI с @types/react.
declare module 'react' {
  export type ReactNode = any;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: readonly unknown[]): T;
  export interface MutableRefObject<T> {
    current: T;
  }
  export interface RefObject<T> {
    readonly current: T | null;
  }
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T>;
  export function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  export interface Context<T> {
    Provider: (props: { value: T; children?: ReactNode }) => any;
  }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export const Fragment: (props: { children?: ReactNode }) => any;
  export interface ButtonHTMLAttributes<T> {
    [k: string]: any;
  }
  export type CSSProperties = Record<string, string | number | undefined>;
  export interface MouseEvent<T = Element> {
    clientX: number;
    clientY: number;
    button: number;
    ctrlKey: boolean;
    currentTarget: T;
    target: EventTarget;
    preventDefault(): void;
    stopPropagation(): void;
  }
  export interface PointerEvent<T = Element> extends MouseEvent<T> {
    pointerId: number;
    shiftKey: boolean;
  }
  export interface WheelEvent<T = Element> extends MouseEvent<T> {
    deltaY: number;
  }
  export interface KeyboardEvent<T = Element> {
    key: string;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    target: EventTarget;
    currentTarget: T;
    preventDefault(): void;
    stopPropagation(): void;
    [k: string]: any;
  }
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [name: string]: {
        [attr: string]: any;
        [handler: `on${string}`]: ((e: any) => unknown) | undefined;
      };
    }
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicAttributes {
      key?: string | number | null;
    }
  }
}

declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: any): void; unmount(): void };
}

declare module '@xterm/xterm' {
  export type ITheme = Record<string, string | undefined>;
  export interface IDisposable { dispose(): void }
  export interface IMarker extends IDisposable { readonly line: number; readonly isDisposed: boolean; onDispose(cb: () => void): IDisposable }
  export interface IDecoration extends IDisposable { readonly marker: IMarker }
  export interface IDecorationOptions { marker: IMarker; x?: number; width?: number; height?: number; backgroundColor?: string; foregroundColor?: string; layer?: 'bottom' | 'top' }
  export interface IBufferLine { translateToString(trimRight?: boolean, start?: number, end?: number): string }
  export interface IBuffer { readonly type: 'normal' | 'alternate'; readonly baseY: number; readonly cursorY: number; readonly length: number; getLine(y: number): IBufferLine | undefined }
  export class Terminal {
    readonly buffer: { readonly active: IBuffer };
    onWriteParsed(cb: () => void): IDisposable;
    registerMarker(cursorYOffset?: number): IMarker;
    registerDecoration(o: IDecorationOptions): IDecoration | undefined;
    constructor(opts?: Record<string, unknown>);
    cols: number;
    rows: number;
    options: Record<string, any>;
    loadAddon(a: unknown): void;
    open(el: HTMLElement): void;
    write(d: string): void;
    onData(cb: (d: string) => void): { dispose(): void };
    onResize(cb: (s: { cols: number; rows: number }) => void): { dispose(): void };
    onSelectionChange(cb: () => void): { dispose(): void };
    attachCustomKeyEventHandler(h: (e: KeyboardEvent) => boolean): void;
    hasSelection(): boolean;
    getSelection(): string;
    focus(): void;
    clear(): void;
    paste(s: string): void;
    dispose(): void;
  }
}
declare module '@xterm/addon-fit' {
  export class FitAddon {
    fit(): void;
    proposeDimensions(): { cols: number; rows: number } | undefined;
  }
}
declare module '@xterm/addon-search' {
  export class SearchAddon {
    findNext(q: string, o?: unknown): boolean;
    findPrevious(q: string, o?: unknown): boolean;
    clearDecorations(): void;
  }
}

