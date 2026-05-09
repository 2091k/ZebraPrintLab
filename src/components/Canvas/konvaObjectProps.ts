import type { LabelObject } from "../../registry";
import type { ObjectChanges } from "../../store/labelStore";

/** Shared props for the per-type renderers under KonvaObject (LineObject,
 *  ImageObject, BarcodeObject, KonvaObjectInner). LineObject and
 *  ImageObject re-narrow `obj` at the type level via `Omit & { obj: ... }`
 *  and the dispatcher passes the narrowed value explicitly; BarcodeObject
 *  and KonvaObjectInner currently take the wide LabelObject and narrow
 *  internally. */
export interface KonvaObjectProps {
  obj: LabelObject;
  scale: number;
  dpmm: number;
  offsetX: number;
  offsetY: number;
  isSelected: boolean;
  onSelect: (addToSelection: boolean) => void;
  onChange: (changes: ObjectChanges) => void;
  snap: (dots: number) => number;
}
