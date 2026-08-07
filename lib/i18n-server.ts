import { cookies } from 'next/headers';
import { DEFAULT_LANG, DictKey, Lang, LANG_COOKIE, translate } from './i18n';

export function getServerLang(): Lang {
  const c = cookies().get(LANG_COOKIE)?.value;
  return c === 'en' || c === 'ur' ? c : DEFAULT_LANG;
}

export function getServerT() {
  const lang = getServerLang();
  return (key: DictKey) => translate(key, lang);
}
