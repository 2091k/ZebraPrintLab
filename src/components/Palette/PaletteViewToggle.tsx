import type { ReactElement } from 'react';
import { useLabelStore } from '../../store/labelStore';
import { useT } from '../../lib/useT';
import { Tooltip } from '../ui/Tooltip';
import type { PaletteView } from '../../store/slices/uiSlice';

/** Type-list view: two stacked rows. */
function ListViewIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="4" rx="1" />
      <rect x="2.5" y="9.5" width="11" height="4" rx="1" />
    </svg>
  );
}

/** Flat view: three lines. */
function FlatViewIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M3 4h10M3 8h10M3 12h10" />
    </svg>
  );
}

const ICONS: Record<PaletteView, () => ReactElement> = { list: ListViewIcon, flat: FlatViewIcon };
const LABELS: Record<PaletteView, 'viewList' | 'viewFlat'> = { list: 'viewList', flat: 'viewFlat' };

/** List/flat switch for the palette, rendered in the sidebar collapse bar. Styled
 *  as tabs to mirror the right sidebar's tab strip (active = accent + underline). */
export function PaletteViewToggle() {
  const t = useT();
  const view = useLabelStore((s) => s.paletteView);
  const setView = useLabelStore((s) => s.setPaletteView);
  return (
    <div className="flex" role="group" aria-label={t.palette.viewLabel}>
      {(['list', 'flat'] as const).map((v) => {
        const Icon = ICONS[v];
        const active = view === v;
        const label = t.palette[LABELS[v]];
        return (
          <Tooltip key={v} content={label}>
            <button
              type="button"
              aria-pressed={active}
              aria-label={label}
              onClick={() => setView(v)}
              className={`flex items-center justify-center px-3 py-2 transition-colors ${
                active ? 'text-accent border-b-2 border-accent' : 'text-muted hover:text-text'
              }`}
            >
              <Icon />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
