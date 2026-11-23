/**
 * Логотип NetAdmin Desk: шеврон из трёх узлов (связи сети) и курсор терминала.
 * Геометрия и цвета — из build/logo.svg. На размерах до 32 px линии чуть толще,
 * как и в мелких значках (scripts/make-icons.py), иначе знак теряется.
 */
export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  const small = size <= 32;
  const stroke = small ? 20 : 14;
  const r = small ? 18 : 15;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect width="256" height="256" rx="56" fill="#0B1220" />
      <g stroke="#38BDF8" strokeWidth={stroke} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 80 84 L 144 128 L 80 172" />
        <path d="M 162 172 H 192" />
      </g>
      <g fill="#38BDF8">
        <circle cx="80" cy="84" r={r} />
        <circle cx="144" cy="128" r={r} />
        <circle cx="80" cy="172" r={r} />
      </g>
    </svg>
  );
}
