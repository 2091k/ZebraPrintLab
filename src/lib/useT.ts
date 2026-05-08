import { useLabelStore } from '../store/labelStore';
import { locales, type Translations } from '../locales';

export function useT(): Translations {
  const locale = useLabelStore((s) => s.locale);
  return locales[locale];
}
