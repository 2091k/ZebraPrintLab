import { useRef } from "react";
import type Konva from "konva";
import { pxToDots, dotsToPx } from "../../../lib/coordinates";
import { inverseRotateDelta, type ViewRotation } from "../rotationGeometry";
import { gridSnapDelta, smartSnapDelta } from "../dragGeometry";
import { SNAP_THRESHOLD_PX } from "../../../lib/snapGuides";
import type { SnapGuide, SnapRect } from "../../../lib/snapGuides";
import { expandSelection, findObjectById, getAllLeaves } from "../../../types/Group";
import { useLabelStore, currentObjects, type ObjectChanges } from "../../../store/labelStore";

/** Everything the controller needs from LabelCanvas; mirrors the param style of
 *  useKonvaTransformer so move and resize sit at the same layer. */
interface DragControllerArgs {
  stageRef: React.RefObject<Konva.Stage | null>;
  transformerRef: React.RefObject<Konva.Transformer | null>;
  scale: number;
  dpmm: number;
  snapEnabled: boolean;
  /** Grid step in dots; only consulted when snapEnabled. */
  snapUnitDots: number;
  /** Visual (rotation-aware) label rect in stage pixels, for smart-snap. */
  labelRectPx: SnapRect;
  viewRotation: ViewRotation;
  setGuides: (guides: SnapGuide[]) => void;
}

/** Applies a live group-local pixel offset to one object during a drag.
 *  Shapes move their Konva node directly; line/state-driven renderers register
 *  a custom mover so the visible geometry follows. */
type LiveMover = (localDx: number, localDy: number) => void;

interface DragHandlers {
  /** Capture handler; wired to the Stage so it fires for every node via bubbling. */
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  /** Per-node handlers; spread onto each renderer's draggable node. */
  nodeDragHandlers: {
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  };
  /** Register/clear a custom live-mover for an object (state-driven renderers). */
  registerMover: (id: string, mover: LiveMover | null) => void;
}

interface DragState {
  /** Movable leaf ids moving together (single drag = one id). */
  ids: string[];
  primaryId: string;
  /** Group-local node position (px) per id at drag start. */
  startLocal: Map<string, { x: number; y: number }>;
  /** Stored model position (dots) per id at drag start, for the commit. */
  startModel: Map<string, { x: number; y: number }>;
  /** Selection union (stage px) at drag start, for smart snap. */
  startUnionPx: SnapRect;
  /** Primary node's stage-px client-rect top-left at drag start. */
  primaryStartPx: { x: number; y: number };
  /** Non-dragged leaf rects (stage px) as smart-snap targets. */
  others: SnapRect[];
  /** Latest model-space delta (dots), applied to all on commit. */
  lastDelta: { x: number; y: number };
}

/**
 * Centralizes whole-object drag for every renderer, the move counterpart to
 * useKonvaTransformer's resize. A single object snaps its own stored position;
 * a multi-selection (or expanded group) derives ONE snap delta and applies it
 * to all, so the elements never drift apart. Live preview moves Konva nodes
 * (or calls a registered mover for state-driven renderers like lines); the
 * commit is one delta-translation in dots, so it stays type-agnostic.
 */
export function useKonvaDragController(args: DragControllerArgs): DragHandlers {
  const dragRef = useRef<DragState | null>(null);
  const moversRef = useRef<Map<string, LiveMover>>(new Map());
  // Tracks whether guides are currently empty so grid drags don't re-render the
  // canvas every tick by setting an already-empty guide list.
  const guidesEmptyRef = useRef(true);

  const setGuides = (guides: SnapGuide[]) => {
    if (guides.length === 0 && guidesEmptyRef.current) return;
    guidesEmptyRef.current = guides.length === 0;
    args.setGuides(guides);
  };

  // Registration is idempotent: a renderer's register effect only re-runs
  // between React commits, never mid drag tick, so even a fresh reference each
  // render can't drop a mover during a drag. (The Compiler keeps it stable too.)
  const registerMover = (id: string, mover: LiveMover | null) => {
    if (mover) moversRef.current.set(id, mover);
    else moversRef.current.delete(id);
  };

  // Move one object by a group-local pixel offset, via its mover if registered.
  const applyOffset = (id: string, stage: Konva.Stage, localDx: number, localDy: number) => {
    const mover = moversRef.current.get(id);
    if (mover) {
      mover(localDx, localDy);
      return;
    }
    const node = stage.findOne<Konva.Node>(`#${id}`);
    const s = dragRef.current?.startLocal.get(id);
    if (node && s) node.position({ x: s.x + localDx, y: s.y + localDy });
  };

  const onDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    dragRef.current = null;
    const stage = args.stageRef.current;
    const primaryId = e.target.id();
    if (!stage || !primaryId) return;

    const state = useLabelStore.getState();
    const objs = currentObjects(state);
    if (!findObjectById(objs, primaryId)) return;

    // Drag the whole movable selection when the grabbed node is part of a 2+
    // selection; otherwise just the grabbed object.
    const selection = expandSelection(objs, state.selectedIds);
    const set = selection.includes(primaryId) && selection.length > 1 ? selection : [primaryId];
    const startLocal = new Map<string, { x: number; y: number }>();
    const startModel = new Map<string, { x: number; y: number }>();
    const ids: string[] = [];
    for (const id of set) {
      const obj = findObjectById(objs, id);
      const node = stage.findOne<Konva.Node>(`#${id}`);
      if (!obj || obj.locked || obj.visible === false || !node) continue;
      startLocal.set(id, { x: node.x(), y: node.y() });
      startModel.set(id, { x: obj.x, y: obj.y });
      ids.push(id);
    }
    if (!ids.includes(primaryId)) return;

    const dragged = new Set(ids);
    const others: SnapRect[] = [];
    for (const leaf of getAllLeaves(objs)) {
      if (dragged.has(leaf.id)) continue;
      const node = stage.findOne<Konva.Node>(`#${leaf.id}`);
      if (node) others.push(rectOf(node, stage));
    }
    const nodes = ids.map((id) => stage.findOne<Konva.Node>(`#${id}`)).filter(Boolean) as Konva.Node[];
    const startUnionPx = unionOfRects(nodes, stage);
    const primary = stage.findOne<Konva.Node>(`#${primaryId}`);
    if (!startUnionPx || !primary) return;
    const pr = primary.getClientRect({ relativeTo: stage });

    dragRef.current = {
      ids,
      primaryId,
      startLocal,
      startModel,
      startUnionPx,
      primaryStartPx: { x: pr.x, y: pr.y },
      others,
      lastDelta: { x: 0, y: 0 },
    };
  };

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const drag = dragRef.current;
    const stage = args.stageRef.current;
    if (!drag || !stage || e.target.id() !== drag.primaryId) return;
    const primary = stage.findOne<Konva.Node>(`#${drag.primaryId}`);
    const primaryStart = drag.startLocal.get(drag.primaryId);
    const primaryModel = drag.startModel.get(drag.primaryId);
    if (!primary || !primaryStart || !primaryModel) return;

    let localDx: number;
    let localDy: number;

    if (args.snapEnabled) {
      // Grid: snap the grabbed object's stored position (model space, no rotation
      // math), then translate the whole selection by that delta. Model, not node
      // origin, so barcode/text anchors that differ from the visual top-left
      // still land on the grid.
      const rawDx = pxToDots(primary.x() - primaryStart.x, args.scale, args.dpmm);
      const rawDy = pxToDots(primary.y() - primaryStart.y, args.scale, args.dpmm);
      const snap = gridSnapDelta(
        { x: primaryModel.x + rawDx, y: primaryModel.y + rawDy, width: 0, height: 0 },
        args.snapUnitDots,
      );
      const deltaDots = { x: rawDx + snap.dx, y: rawDy + snap.dy };
      localDx = dotsToPx(deltaDots.x, args.scale, args.dpmm);
      localDy = dotsToPx(deltaDots.y, args.scale, args.dpmm);
      setGuides([]);
    } else {
      // Smart: stage-pixel space so the guide layer lines up. Reconstruct the
      // union from the primary's screen movement (robust whether or not Konva
      // moved siblings live), snap it, then map back to group-local.
      const pr = primary.getClientRect({ relativeTo: stage });
      const cur: SnapRect = {
        id: "_sel",
        x: drag.startUnionPx.x + (pr.x - drag.primaryStartPx.x),
        y: drag.startUnionPx.y + (pr.y - drag.primaryStartPx.y),
        width: drag.startUnionPx.width,
        height: drag.startUnionPx.height,
      };
      const { dx, dy, guides } = smartSnapDelta(cur, drag.others, args.labelRectPx, SNAP_THRESHOLD_PX);
      [localDx, localDy] = inverseRotateDelta(
        cur.x - drag.startUnionPx.x + dx,
        cur.y - drag.startUnionPx.y + dy,
        args.viewRotation,
      );
      setGuides(guides);
    }

    drag.lastDelta = {
      x: pxToDots(localDx, args.scale, args.dpmm),
      y: pxToDots(localDy, args.scale, args.dpmm),
    };
    for (const id of drag.ids) applyOffset(id, stage, localDx, localDy);
    args.transformerRef.current?.forceUpdate();
  };

  const onDragEnd = () => {
    const drag = dragRef.current;
    const stage = args.stageRef.current;
    dragRef.current = null;
    setGuides([]);
    if (!drag) return;
    // State-driven renderers (movers): clear the live offset and return the
    // dragged Konva node to its base, since the committed model position drives
    // the final render. Plain shape nodes already sit at the committed spot
    // (start + delta), so resetting them would flicker.
    for (const id of drag.ids) {
      const mover = moversRef.current.get(id);
      if (!mover) continue;
      mover(0, 0);
      const start = drag.startLocal.get(id);
      if (stage && start) stage.findOne<Konva.Node>(`#${id}`)?.position(start);
    }
    const { x: dx, y: dy } = drag.lastDelta;
    if (dx === 0 && dy === 0) return;
    const changes: { id: string; changes: ObjectChanges }[] = [];
    for (const id of drag.ids) {
      const m = drag.startModel.get(id);
      if (m) changes.push({ id, changes: { x: m.x + dx, y: m.y + dy } });
    }
    if (changes.length > 0) useLabelStore.getState().updateObjects(changes);
  };

  return { onDragStart, nodeDragHandlers: { onDragMove, onDragEnd }, registerMover };
}

function rectOf(node: Konva.Node, stage: Konva.Stage): SnapRect {
  const r = node.getClientRect({ relativeTo: stage });
  return { id: node.id(), x: r.x, y: r.y, width: r.width, height: r.height };
}

function unionOfRects(nodes: Konva.Node[], stage: Konva.Stage): SnapRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = n.getClientRect({ relativeTo: stage });
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (minX === Infinity) return null;
  return { id: "_sel", x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
