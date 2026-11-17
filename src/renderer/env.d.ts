// Импорт стилей ради побочного эффекта (esbuild собирает их в renderer.css).
// Нужно для TypeScript 6, где по умолчанию проверяются импорты без значений (noUncheckedSideEffectImports).
declare module '*.css' {}
