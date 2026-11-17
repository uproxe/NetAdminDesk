// Морфология для поиска: основы русских слов (стеммер Портера/Snowball), простая основа английских слов,
// «фонетический ключ» для сравнения русской записи с латиницей («апач» ↔ apache, «докер» ↔ docker)
// и расстояние Дамерау — Левенштейна для опечаток.

const RU_PERFECTIVE_GROUND = /((ив|ивши|ившись|ыв|ывши|ывшись)|((?<=[ая])(в|вши|вшись)))$/;
const RU_REFLEXIVE = /(с[яь])$/;
const RU_ADJECTIVE = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const RU_PARTICIPLE = /((ивш|ывш|ующ)|((?<=[ая])(ем|нн|вш|ющ|щ)))$/;
const RU_VERB =
  /((ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)|((?<=[ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)))$/;
const RU_NOUN = /(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const RU_RV = /^(.*?[аеиоуыэюя])(.*)$/;
const RU_DERIVATIONAL = /[^аеиоуыэюя][аеиоуыэюя]+[^аеиоуыэюя]+[аеиоуыэюя].*(?<=о)сть?$/;
const RU_DER = /ость?$/;
const RU_SUPERLATIVE = /(ейше|ейш)$/;

const stemCache = new Map<string, string>();

/** Основа русского слова (алгоритм Snowball для русского языка). «таблицу», «таблицы» → «таблиц». */
export function stemRussian(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  const cached = stemCache.get(w);
  if (cached !== undefined) return cached;
  const m = RU_RV.exec(w);
  let res = w;
  if (m) {
    const pre = m[1];
    let rv = m[2];
    let temp = rv.replace(RU_PERFECTIVE_GROUND, '');
    if (temp === rv) {
      rv = rv.replace(RU_REFLEXIVE, '');
      temp = rv.replace(RU_ADJECTIVE, '');
      if (temp !== rv) {
        rv = temp.replace(RU_PARTICIPLE, '');
      } else {
        temp = rv.replace(RU_VERB, '');
        rv = temp === rv ? rv.replace(RU_NOUN, '') : temp;
      }
    } else rv = temp;
    rv = rv.replace(/и$/, '');
    if (RU_DERIVATIONAL.test(rv)) rv = rv.replace(RU_DER, '');
    temp = rv.replace(/ь$/, '');
    if (temp === rv) rv = rv.replace(RU_SUPERLATIVE, '').replace(/нн$/, 'н');
    else rv = temp;
    res = pre + rv;
  }
  if (stemCache.size > 20000) stemCache.clear();
  stemCache.set(w, res);
  return res;
}

/** Простая основа английского слова: restarting → restart, services → service, logs → log. */
export function stemEnglish(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 5) return w.slice(0, -3) + 'y';
  if (/(ss|us|is|os|as)$/.test(w)) return w;
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** Основа слова любой из двух азбук. */
export function stemWord(word: string): string {
  if (/[а-яё]/.test(word)) return word.length >= 3 ? stemRussian(word) : word;
  return stemEnglish(word);
}

const CYR_TO_KEY: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia'
};

/** Фонетический ключ русского слова: «докер» → «doker», «апач» → «apach». */
export function cyrKey(word: string): string {
  let s = '';
  for (const ch of word.toLowerCase()) s += CYR_TO_KEY[ch] ?? (/[a-z0-9]/.test(ch) ? ch : '');
  return s.replace(/(.)\1+/g, '$1');
}

/** Фонетические ключи латинского слова в той же системе: docker → doker, nginx → ngiks / ndzhiks. */
export function latinKeys(word: string): string[] {
  const w = word.toLowerCase();
  if (!/^[a-z0-9]+$/.test(w) || !/[a-z]/.test(w)) return [];
  const base = w
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/qu/g, 'kv')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/w/g, 'v')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c(?!h)/g, 'k')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/y/g, 'i')
    .replace(/j/g, 'dzh');
  const k1 = base.replace(/(.)\1+/g, '$1');
  const k2 = base.replace(/g(?=[ei])/g, 'dzh').replace(/(.)\1+/g, '$1');
  return k1 === k2 ? [k1] : [k1, k2];
}

/** Ограниченное расстояние Дамерау — Левенштейна: если больше max, возвращается max + 1. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
}

/** Длина общего начала двух строк. */
export function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Допустимое число опечаток для слова такой длины. */
export function typoBudget(len: number): number {
  if (len >= 9) return 2;
  if (len >= 5) return 1;
  return 0;
}
