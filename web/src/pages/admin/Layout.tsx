import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty, PageHeader, ServiceIcon, TypeChip } from "../../components/ui";
import { api, type Group, type Service } from "../../lib/api";
import { useLoad } from "../../lib/hooks";

type Columns = Record<string, number[]>; // container id ("g12" | "none") → service ids

export default function LayoutPage() {
  const groupsQ = useLoad(() => api.get<Group[]>("/api/groups"), []);
  const servicesQ = useLoad(() => api.get<Service[]>("/api/services"), [], (e) => e.type === "layout");
  const [groups, setGroups] = useState<Group[]>([]);
  const [cols, setCols] = useState<Columns>({});
  const [active, setActive] = useState<number | null>(null);
  const [newName, setNewName] = useState("");

  const byId = new Map((servicesQ.data ?? []).map((s) => [s.id, s]));

  useEffect(() => {
    if (!groupsQ.data || !servicesQ.data) return;
    const gs = [...groupsQ.data].sort((a, b) => a.position - b.position || a.id - b.id);
    const c: Columns = { none: [] };
    gs.forEach((g) => (c[`g${g.id}`] = []));
    [...servicesQ.data]
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .forEach((s) => {
        const key = s.group_id != null && c[`g${s.group_id}`] ? `g${s.group_id}` : "none";
        c[key].push(s.id);
      });
    setGroups(gs);
    setCols(c);
  }, [groupsQ.data, servicesQ.data]);

  const persist = async (gs: Group[], c: Columns) => {
    const services: Record<string, number[]> = {};
    for (const [k, ids] of Object.entries(c)) services[k === "none" ? "none" : k.slice(1)] = ids;
    await api.put("/api/layout", { groups: gs.map((g) => g.id), services });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: string | number) => {
    if (typeof id === "string" && id in cols) return id;
    return Object.keys(cols).find((k) => cols[k].includes(Number(id)));
  };

  const onStart = (e: DragStartEvent) => setActive(Number(e.active.id));

  const onOver = (e: DragOverEvent) => {
    const { active: a, over } = e;
    if (!over) return;
    const from = findCol(a.id), to = findCol(over.id);
    if (!from || !to || from === to) return;
    setCols((c) => {
      const fromItems = c[from].filter((x) => x !== Number(a.id));
      const toItems = [...c[to]];
      const idx = typeof over.id === "number" ? toItems.indexOf(over.id) : toItems.length;
      toItems.splice(idx < 0 ? toItems.length : idx, 0, Number(a.id));
      return { ...c, [from]: fromItems, [to]: toItems };
    });
  };

  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    const { active: a, over } = e;
    if (!over) return;
    const col = findCol(a.id);
    if (!col) return;
    let next = cols;
    if (typeof over.id === "number" && cols[col].includes(over.id)) {
      const items = cols[col];
      next = { ...cols, [col]: arrayMove(items, items.indexOf(Number(a.id)), items.indexOf(over.id)) };
      setCols(next);
    }
    persist(groups, next);
  };

  const addGroup = async () => {
    if (!newName.trim()) return;
    await api.post("/api/groups", { name: newName.trim() });
    setNewName("");
    groupsQ.reload();
  };

  const renameGroup = async (g: Group) => {
    const name = prompt("Section name:", g.name);
    if (!name?.trim()) return;
    await api.patch(`/api/groups/${g.id}`, { name });
    groupsQ.reload();
  };

  const deleteGroup = async (g: Group) => {
    if (!confirm(`Delete the section "${g.name}"? Its services move to "No section".`)) return;
    await api.del(`/api/groups/${g.id}`);
    groupsQ.reload();
    servicesQ.reload();
  };

  const moveGroup = (i: number, d: number) => {
    const gs = arrayMove(groups, i, i + d);
    setGroups(gs);
    persist(gs, cols);
  };

  const toggleShow = async (s: Service) => {
    await api.patch(`/api/services/${s.slug}`, { show_on_launcher: !s.show_on_launcher });
    servicesQ.reload();
  };

  const containers = [...groups.map((g) => ({ key: `g${g.id}`, group: g as Group | null })), { key: "none", group: null }];

  return (
    <>
      <PageHeader title="Launcher layout" subtitle="Arrange the home page into sections. Drag services between sections; hidden ones stay in admin only." />
      <div className="grid max-w-4xl gap-5 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel p-2">
          <input className="input flex-1 border-0 bg-transparent focus:ring-0" placeholder="New section name, like Tools or Home automation"
            value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGroup()} />
          <button className="btn-primary py-1.5" disabled={!newName.trim()} onClick={addGroup}><Plus size={14} /> Add section</button>
        </div>

        {servicesQ.data?.length === 0 && <Empty icon={LayoutGrid}>Create a service first, then arrange it here.</Empty>}

        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd}>
          {containers.map(({ key, group }, gi) => (
            <section key={key} className="rounded-lg border border-line bg-panel">
              <div className="flex items-center gap-2 border-b border-line px-5 py-3">
                <h2 className="flex-1 text-sm font-semibold">
                  {group ? group.name : "No section"}
                  <span className="ml-2 text-xs font-normal text-faint tabular-nums">{cols[key]?.length ?? 0}</span>
                </h2>
                {group && (
                  <>
                    <button className="btn-ghost p-1.5" title="Move up" disabled={gi === 0} onClick={() => moveGroup(gi, -1)}><ChevronUp size={14} /></button>
                    <button className="btn-ghost p-1.5" title="Move down" disabled={gi === groups.length - 1} onClick={() => moveGroup(gi, 1)}><ChevronDown size={14} /></button>
                    <button className="btn-ghost p-1.5" title="Rename" onClick={() => renameGroup(group)}><Pencil size={14} /></button>
                    <button className="btn-ghost p-1.5 hover:text-down" title="Delete section" onClick={() => deleteGroup(group)}><Trash2 size={14} /></button>
                  </>
                )}
              </div>
              <Column id={key}>
                <SortableContext items={cols[key] ?? []} strategy={verticalListSortingStrategy}>
                  {(cols[key] ?? []).map((id) => {
                    const s = byId.get(id);
                    return s ? <Row key={id} s={s} onToggle={() => toggleShow(s)} /> : null;
                  })}
                </SortableContext>
                {(cols[key]?.length ?? 0) === 0 && <div className="px-3 py-4 text-center text-xs text-faint">Drag services here.</div>}
              </Column>
            </section>
          ))}
          <DragOverlay>{active && byId.get(active) ? <RowBody s={byId.get(active)!} dragging /> : null}</DragOverlay>
        </DndContext>
      </div>
    </>
  );
}

function Column({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={clsx("grid min-h-12 gap-1 p-2 transition", isOver && "bg-accent/5")}>{children}</div>;
}

function Row({ s, onToggle }: { s: Service; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={clsx(isDragging && "opacity-30")}>
      <RowBody s={s} handle={{ ...attributes, ...listeners }} onToggle={onToggle} />
    </div>
  );
}

function RowBody({ s, handle, onToggle, dragging }: { s: Service; handle?: object; onToggle?: () => void; dragging?: boolean }) {
  return (
    <div className={clsx("flex items-center gap-2.5 rounded-md border border-line bg-panel-2 px-2 py-1.5", dragging && "shadow-lg ring-1 ring-accent/60", !s.show_on_launcher && "opacity-60")}>
      <button className="cursor-grab touch-none p-1 text-faint hover:text-fg" title="Drag to reorder" {...handle}><GripVertical size={14} /></button>
      <ServiceIcon name={s.name} icon={s.icon} className="size-7 rounded-lg text-sm" />
      <span className="flex-1 truncate text-sm">{s.name}</span>
      <TypeChip type={s.type} />
      {onToggle && (
        <button className="btn-ghost p-1.5" title={s.show_on_launcher ? "Shown on launcher. Click to hide." : "Hidden from launcher. Click to show."} onClick={onToggle}>
          {s.show_on_launcher ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      )}
    </div>
  );
}
