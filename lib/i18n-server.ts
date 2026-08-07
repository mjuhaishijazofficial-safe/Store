import { cookies } from 'next/headers';
import { DEFAULT_LANG, DictKey, Lang, LANG_COOKIE, translate } from './i18n';

// cookies() became async in Next.js 15+.
export async function getServerLang(): Promise<Lang> {
  const cookieStore = await cookies();
  const c = cookieStore.get(LANG_COOKIE)?.value;
  return c === 'en' || c === 'ur' ? c : DEFAULT_LANG;
}

export async function getServerT() {
  const lang = await getServerLang();
  return (key: DictKey) => translate(key, lang);
}
