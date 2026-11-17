// Локальный «умный» поиск по справочнику, руководствам, устройствам, сценариям и заметкам.
// Понимает:
//  • падежи и словоформы — «таблицу», «таблицы», «таблица»; «перезагрузить» ↔ «перезагрузка» (основы слов);
//  • русские названия программ и понятий — «апач» → apache, «докер» → docker, «мак» → mac, «влан» → vlan;
//  • русскую запись английских слов по звучанию — «курл» → curl, «линукс» → linux (фонетический ключ);
//  • опечатки — «ошибкии», «interfase» (расстояние Дамерау — Левенштейна);
//  • неверную раскладку — «ырщц мдфт» → show vlan;
//  • вопросы — служебные слова («как», «где», «на») не мешают, общие («посмотреть», «показать») необязательны.
import { CONCEPT_KEYS, STOP_WORDS, WEAK_PREFIXES } from './searchDict';
import { commonPrefix, cyrKey, editDistance, latinKeys, stemWord, typoBudget } from './morph';

export type SearchGroup = 'switch' | 'linux' | 'sql' | 'guide' | 'scenario' | 'device' | 'note' | 'action';

export interface SearchField {
  text: string;
  weight: number;
}

export interface SearchFilters {
  platform?: string;
  vendor?: string;
  model?: string;
  os?: string;
  category?: string;
  risk?: string;
  favorite?: boolean;
  source?: string;
  groups?: SearchGroup[];
  includeSensitive?: boolean;
}

export interface SearchDoc<T = unknown> {
  id: string;
  group: SearchGroup;
  title: string;
  fields: SearchField[];
  facets: {
    platform?: string;
    vendor?: string;
    model?: string;
    os?: string;
    category?: string;
    risk?: string;
    favorite?: boolean;
    source?: string;
    sensitive?: boolean;
    /** Небольшой постоянный бонус (например, для простых базовых команд). */
    boost?: number;
  };
  ref: T;
}

export interface SearchHit<T = unknown> {
  doc: SearchDoc<T>;
  score: number;
  /** Совпали не все слова запроса. */
  partial?: boolean;
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function tokenize(s: string): string[] {
  const n = normalize(s);
  const base = n.split(/[\s,;()"'«»!?<>{}[\]`*]+/).filter(Boolean);
  const out = new Set<string>();
  for (const t of base) {
    const clean = t.replace(/^[.:\-—–]+|[.:\-—–]+$/g, '');
    if (clean) out.add(clean);
    for (const part of t.split(/[\/\-_.:|=@#+~$%^&\\]+/)) if (part && part !== clean) out.add(part);
  }
  return [...out];
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const EN2RU = new Map<string, string>();
const RU2EN = new Map<string, string>();
for (let i = 0; i < EN.length; i++) {
  EN2RU.set(EN[i], RU[i]);
  RU2EN.set(RU[i], EN[i]);
}

/** Переключение раскладки: «ырщц» → «show», «ghbdtn» → «привет». */
export function layoutSwap(s: string): string {
  const lower = s.toLowerCase();
  const isRu = /[а-яё]/.test(lower);
  return [...lower].map((ch) => (isRu ? RU2EN.get(ch) : EN2RU.get(ch)) ?? ch).join('');
}

const SINGLE_CONCEPTS = CONCEPT_KEYS.filter(([k]) => !k.includes(' '));
const MULTI_CONCEPTS = CONCEPT_KEYS.filter(([k]) => k.includes(' ')).map(([k, v]) => [k.split(' '), v] as const);

/** Дополнительные термины для слова запроса по словарю понятий (самый длинный подходящий ключ). */
export function expandToken(token: string): string[] {
  const out = new Set<string>([token]);
  for (const [key, alts] of SINGLE_CONCEPTS) {
    if (token.startsWith(key) && token.length <= key.length + 7) {
      alts.forEach((a) => out.add(a));
      break;
    }
  }
  // Обратное направление: mac → мак
  for (const [key, alts] of SINGLE_CONCEPTS) if (alts.includes(token)) out.add(key);
  return [...out];
}

const isWeak = (t: string) => WEAK_PREFIXES.some((p) => t.startsWith(p));

interface QueryToken {
  /** Как набрано (для отображения и фраз). */
  text: string;
  /** Термины с весами. */
  terms: Map<string, number>;
  weak: boolean;
}

interface PreparedField {
  text: string;
  tokens: string[];
  weight: number;
}

interface PreparedDoc<T> {
  doc: SearchDoc<T>;
  fields: PreparedField[];
}

interface VocabEntry {
  stem: string;
  keys: string[];
  cyr: boolean;
}

export class SearchIndex<T = unknown> {
  private docs: PreparedDoc<T>[];
  private vocab = new Map<string, VocabEntry>();
  private latinByKey = new Map<string, string[]>();
  private tokenCache = new Map<string, Map<string, number>>();

  constructor(docs: SearchDoc<T>[]) {
    this.docs = docs.map((doc) => ({
      doc,
      fields: doc.fields.filter((f) => f.text).map((f) => ({ text: normalize(f.text), tokens: tokenize(f.text), weight: f.weight }))
    }));
    for (const d of this.docs)
      for (const f of d.fields)
        for (const t of f.tokens) {
          if (this.vocab.has(t) || t.length > 40) continue;
          const cyr = /[а-я]/.test(t);
          const keys = cyr ? [] : latinKeys(t);
          this.vocab.set(t, { stem: stemWord(t), keys, cyr });
          for (const k of keys) {
            const list = this.latinByKey.get(k);
            if (list) list.push(t);
            else this.latinByKey.set(k, [t]);
          }
        }
  }

  get size(): number {
    return this.docs.length;
  }

  private matchFacets(d: SearchDoc<T>, f: SearchFilters): boolean {
    if (f.groups && f.groups.length && !f.groups.includes(d.group)) return false;
    if (f.platform && d.facets.platform !== f.platform) return false;
    if (f.vendor && d.facets.vendor !== f.vendor) return false;
    if (f.model && !(d.facets.model ?? '').toLowerCase().includes(f.model.toLowerCase())) return false;
    if (f.os && !(d.facets.os ?? '').toLowerCase().includes(f.os.toLowerCase())) return false;
    if (f.category && d.facets.category !== f.category) return false;
    if (f.risk && d.facets.risk !== f.risk) return false;
    if (f.favorite && !d.facets.favorite) return false;
    if (f.source && d.facets.source !== f.source) return false;
    if (!f.includeSensitive && d.facets.sensitive) return false;
    return true;
  }

  /** Разбор запроса в слова с наборами терминов. */
  private parseQuery(tokens: string[]): QueryToken[] {
    const out: QueryToken[] = [];
    const words = tokens.filter((t) => !STOP_WORDS.has(t));
    const list = words.length ? words : tokens;
    for (let i = 0; i < list.length; i++) {
      // Понятия из нескольких слов: «блок питания», «имя хоста», «открытые порты»
      let multi: { len: number; alts: readonly string[] } | null = null;
      for (const [parts, alts] of MULTI_CONCEPTS) {
        if (i + parts.length > list.length) continue;
        if (parts.every((p, k) => list[i + k].startsWith(p)) && (!multi || parts.length > multi.len)) multi = { len: parts.length, alts };
      }
      if (multi) {
        const terms = new Map<string, number>();
        for (const a of multi.alts) terms.set(a, 0.95);
        for (let k = 0; k < multi.len; k++) for (const [t, w] of this.termsFor(list[i + k])) if (!terms.has(t)) terms.set(t, w * 0.8);
        out.push({ text: list.slice(i, i + multi.len).join(' '), terms, weak: false });
        i += multi.len - 1;
        continue;
      }
      out.push({ text: list[i], terms: this.termsFor(list[i]), weak: isWeak(list[i]) });
    }
    // Если все слова «слабые» («показать список»), они становятся обязательными
    if (out.length && out.every((q) => q.weak)) out.forEach((q) => (q.weak = false));
    return out;
  }

  /** Термины для одного слова: само слово, понятия, транслитерация по звучанию. */
  private termsCache = new Map<string, Map<string, number>>();

  private termsFor(token: string): Map<string, number> {
    const cached = this.termsCache.get(token);
    if (cached) return cached;
    const terms = new Map<string, number>([[token, 1]]);
    for (const t of expandToken(token)) if (!terms.has(t)) terms.set(t, 0.85);
    // Русская запись английского слова: «апач» → apache, «курл» → curl
    if (/^[а-я]+$/.test(token) && token.length >= 3) {
      const key = cyrKey(token);
      const budget = typoBudget(key.length);
      for (const [vk, words] of this.latinByKey) {
        let ok = vk === key;
        if (!ok && key.length >= 4 && vk.startsWith(key)) ok = true;
        if (!ok && budget && Math.abs(vk.length - key.length) <= budget && editDistance(vk, key, budget) <= budget) ok = true;
        if (ok) for (const w of words) if (!terms.has(w)) terms.set(w, 0.8);
      }
    }
    if (this.termsCache.size > 500) this.termsCache.clear();
    this.termsCache.set(token, terms);
    return terms;
  }

  /** Оценки словаря для одного слова запроса: слово индекса → баллы (кэшируется). */
  private scoresFor(q: QueryToken): Map<string, number> {
    const cacheKey = [...q.terms.entries()].map(([t, w]) => `${t}:${w}`).join('|');
    const cached = this.tokenCache.get(cacheKey);
    if (cached) return cached;
    const res = new Map<string, number>();
    const prepared = [...q.terms.entries()]
      .filter(([t]) => !t.includes(' '))
      .map(([t, w]) => ({ t, w, stem: stemWord(t), cyr: /[а-я]/.test(t), budget: typoBudget(t.length) }));
    for (const [v, info] of this.vocab) {
      let best = 0;
      for (const p of prepared) {
        let s = 0;
        if (v === p.t) s = 10;
        else if (p.t.length <= 2) s = 0; // короткие команды (ls, cd, rm, ip) — только точное совпадение
        else if (info.stem === p.stem && p.stem.length >= 3) s = 9;
        else if (v.startsWith(p.t)) s = 7;
        else if (info.cyr === p.cyr && p.stem.length >= 4 && info.stem.length >= 4) {
          const cp = commonPrefix(info.stem, p.stem);
          if (cp >= 4 && cp >= Math.min(info.stem.length, p.stem.length) - 1) s = 6;
        }
        if (!s && p.t.length >= 3 && v.length > p.t.length && v.includes(p.t)) s = 3;
        if (!s && p.budget && info.cyr === p.cyr && Math.abs(v.length - p.t.length) <= p.budget && editDistance(v, p.t, p.budget) <= p.budget) s = 5;
        s *= p.w;
        if (s > best) best = s;
      }
      if (best > 0) res.set(v, best);
    }
    if (this.tokenCache.size > 300) this.tokenCache.clear();
    this.tokenCache.set(cacheKey, res);
    return res;
  }

  private scoreDoc(d: PreparedDoc<T>, q: QueryToken, scores: Map<string, number>): number {
    let best = 0;
    const phrases = [...q.terms.entries()].filter(([t]) => t.includes(' '));
    for (const f of d.fields) {
      let fb = 0;
      for (const t of f.tokens) {
        const s = scores.get(t);
        if (s && s > fb) fb = s;
      }
      for (const [p, w] of phrases) if (f.text.includes(p) && 9 * w > fb) fb = 9 * w;
      fb *= f.weight;
      if (fb > best) best = fb;
    }
    return best;
  }

  search(query: string, filters: SearchFilters = {}, limit = 200): SearchHit<T>[] {
    const q = normalize(query);
    const candidates = this.docs.filter((d) => this.matchFacets(d.doc, filters));
    if (!q) return candidates.slice(0, limit).map((d) => ({ doc: d.doc, score: 0 }));
    const raw = q.split(/\s+/).filter(Boolean);
    const variants = [raw, raw.map(layoutSwap)];
    let best: SearchHit<T>[] = [];
    for (const [vi, tokens] of variants.entries()) {
      if (vi === 1 && tokens.join(' ') === raw.join(' ')) break;
      const parsed = this.parseQuery(tokens);
      if (!parsed.length) continue;
      const scores = parsed.map((p) => this.scoresFor(p));
      const strong = parsed.map((p) => !p.weak);
      const strongCount = strong.filter(Boolean).length;
      const phrase = parsed.map((p) => p.text).join(' ');
      const hits: SearchHit<T>[] = [];
      const partial: SearchHit<T>[] = [];
      // Первый проход: оценки каждого слова для каждого документа и частота слов (для веса редких слов)
      const perDoc: { d: PreparedDoc<T>; s: number[] }[] = [];
      const df = new Array(parsed.length).fill(0);
      for (const d of candidates) {
        let any = false;
        const sc = parsed.map((p, i) => {
          const v = this.scoreDoc(d, p, scores[i]);
          if (v > 0) {
            any = true;
            df[i]++;
          }
          return v;
        });
        if (any) perDoc.push({ d, s: sc });
      }
      // Редкое слово запроса важнее частого: «перезагрузить сервер» — главное «перезагрузить»
      const idf = df.map((n) => 1 + Math.log((candidates.length + 1) / (n + 1)));
      const idfMean = idf.reduce((a, b) => a + b, 0) / (idf.length || 1);
      for (const { d, s: sc } of perDoc) {
        let total = 0;
        let matchedStrong = 0;
        for (let i = 0; i < parsed.length; i++) {
          if (sc[i] <= 0) continue;
          if (strong[i]) matchedStrong++;
          total += (strong[i] ? sc[i] : sc[i] * 0.4) * (idf[i] / idfMean);
        }
        if (phrase.length >= 3) for (const f of d.fields) if (f.text.includes(phrase)) total += 15 * f.weight;
        if (d.doc.facets.favorite) total *= 1.1;
        if (d.doc.facets.boost) total *= 1 + d.doc.facets.boost;
        if (vi === 1) total *= 0.9;
        if (matchedStrong === strongCount && strongCount > 0) hits.push({ doc: d.doc, score: total });
        else if (strongCount > 0 && matchedStrong > 0) partial.push({ doc: d.doc, score: total / 3, partial: true });
      }
      hits.sort((a, b) => b.score - a.score);
      partial.sort((a, b) => b.score - a.score);
      const res = [...hits, ...partial];
      if (vi === 0 && hits.length) {
        best = res;
        break;
      }
      if (res.length > best.length) best = res;
    }
    return best.slice(0, limit);
  }
}

/** Пояснение, как был понят запрос (для подсказки под строкой поиска). */
export function explainQuery(query: string): string[] {
  const tokens = normalize(query).split(/\s+/).filter((t) => t && !STOP_WORDS.has(t));
  const out: string[] = [];
  for (const t of tokens) {
    const alts = expandToken(t).filter((a) => a !== t);
    if (alts.length) out.push(`${t} → ${alts.slice(0, 4).join(', ')}`);
  }
  return out;
}
