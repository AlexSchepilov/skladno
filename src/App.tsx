import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, CircleAlert, Divide, Download, List, MoreHorizontal, Pencil, Plus, ReceiptText, RefreshCw, Search, Share2, ShoppingCart, Store as StoreIcon, Trash2, Undo2, X } from "lucide-react";

type Status = "planned" | "cart" | "bought";
type Item = { id: string; name: string; qty: number; unit: string; status: Status; price?: number; volume?: string; checked?: boolean };
type Section = { id: string; name: string; items: Item[] };
type StoreGroup = { id: string; name: string; sections: Section[] };
type ShoppingList = { id: string; roomId: string; name: string; dateStart?: string; dateEnd?: string; groups: StoreGroup[]; updatedAt: number; schemaVersion: 2 };
type Store = { lists: ShoppingList[]; activeId: string };
type Modal = null | "import" | "add" | "receipt" | "share" | "lists" | "store" | "syncError";

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const FIREBASE_URL = "https://skladno-b1126-default-rtdb.europe-west1.firebasedatabase.app";
const normalize = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
const formatMoney = (n: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(n);
const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const parseIsoDate = (value?: string) => { const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/); return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null; };
const formatListDates = (list: ShoppingList) => {
  const start = parseIsoDate(list.dateStart); const end = parseIsoDate(list.dateEnd || list.dateStart);
  if (!start || !end) return "";
  if (start.year === end.year && start.month === end.month) return start.day === end.day ? `${start.day} ${months[start.month - 1]} ${start.year}` : `${start.day}–${end.day} ${months[start.month - 1]} ${start.year}`;
  if (start.year === end.year) return `${start.day} ${months[start.month - 1]} – ${end.day} ${months[end.month - 1]} ${start.year}`;
  return `${start.day} ${months[start.month - 1]} ${start.year} – ${end.day} ${months[end.month - 1]} ${end.year}`;
};

function normalizeItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<Item>;
    const qty = Number(item.qty);
    return [{
      ...item,
      id: String(item.id || uid()),
      name: String(item.name || ""),
      qty: Number.isFinite(qty) ? qty : 1,
      unit: String(item.unit || "шт."),
      status: item.status === "cart" || item.status === "bought" ? item.status : "planned",
    }];
  });
}

function normalizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const section = entry as Partial<Section>;
    return [{
      ...section,
      id: String(section.id || uid()),
      name: String(section.name || ""),
      items: normalizeItems(section.items),
    }];
  });
}

function normalizeGroups(raw: unknown): StoreGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const group = entry as Partial<StoreGroup>;
    return [{
      ...group,
      id: String(group.id || uid()),
      name: String(group.name || "Магазин"),
      sections: normalizeSections(group.sections),
    }];
  });
}

function migrateList(raw: unknown): ShoppingList {
  const list = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (Array.isArray(list.groups)) {
    const rawName = String(list.name || "Новый список");
    const oldDatedName = rawName.match(/^(.*?)\s*\(8[–-]9 августа 2026\)$/i);
    return {
      id: String(list.id || uid()), roomId: String(list.roomId || `list-${uid()}-${uid()}`),
      name: oldDatedName?.[1].trim() || rawName,
      dateStart: String(list.dateStart || (oldDatedName ? "2026-08-08" : "")) || undefined,
      dateEnd: String(list.dateEnd || (oldDatedName ? "2026-08-09" : "")) || undefined,
      updatedAt: Number(list.updatedAt) || now(), schemaVersion: 2,
      groups: normalizeGroups(list.groups),
    };
  }
  const oldName = String(list.name || "Покупки");
  const shop = oldName.replace(/^покупки\s+в\s+/i, "").trim();
  const store = String(list.store || "").trim();
  const sections = normalizeSections(list.sections);
  return {
    id: String(list.id || uid()), roomId: String(list.roomId || `list-${uid()}-${uid()}`),
    name: /^покупки\s+в\s+/i.test(oldName) ? "Елизарово" : oldName,
    dateStart: /^покупки\s+в\s+/i.test(oldName) ? "2026-08-08" : undefined,
    dateEnd: /^покупки\s+в\s+/i.test(oldName) ? "2026-08-09" : undefined,
    groups: [{ id: uid(), name: [shop, store].filter(Boolean).join(" ") || "Магазин", sections }],
    updatedAt: Number(list.updatedAt) || now(), schemaVersion: 2,
  };
}

const listItems = (list: ShoppingList) => (list.groups || []).flatMap(group =>
  (group.sections || []).flatMap(section => section.items || [])
);

const seed: Store = {
  activeId: "globus",
  lists: [{
    id: "globus", roomId: `globus-${uid()}-${uid()}`, name: "Елизарово", dateStart: "2026-08-08", dateEnd: "2026-08-09", updatedAt: now(), schemaVersion: 2,
    groups: [{ id: uid(), name: "Глобус Саларьево", sections: [
      { id: uid(), name: "Хлеб", items: [
        { id: uid(), name: "Хлеб тостовый Harry's American Sandwich", qty: 1, unit: "шт.", status: "bought", price: 169.99 },
        { id: uid(), name: "Лаваш Армянский Глобус", qty: 2, unit: "уп.", status: "bought", price: 119.99 },
        { id: uid(), name: "Лепёшка восточная Хлеб-Пита", qty: 3, unit: "шт.", status: "cart" },
      ]},
      { id: uid(), name: "Овощи, фрукты", items: [
        { id: uid(), name: "Перец сладкий жёлтый", qty: 3, unit: "кг", status: "cart" },
        { id: uid(), name: "Редис с зеленью", qty: 2, unit: "шт.", status: "planned" },
        { id: uid(), name: "Картофель мытый Бэйби", qty: 1, unit: "шт.", status: "planned" },
        { id: uid(), name: "Кинза Глобус", qty: 1, unit: "шт.", status: "planned" },
      ]},
      { id: uid(), name: "Напитки и снеки", items: [
        { id: uid(), name: "Чипсы Pringles Сметана и лук", qty: 2, unit: "шт.", status: "planned" },
        { id: uid(), name: "Вода Калинов Родник негазированная", qty: 3, unit: "шт.", status: "planned" },
      ]},
    ]}],
  }],
};

function parseList(text: string): { name?: string; sections: Section[] } {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const sections: Section[] = [];
  let current: Section | null = null;
  let name: string | undefined;
  for (const line of lines) {
    if (/^итого\s*:/i.test(line)) continue;
    if (/^список покупок/i.test(line)) { name = line.replace(/^список покупок\s*/i, "").trim(); continue; }
    if (/^отдел\s+/i.test(line)) {
      current = { id: uid(), name: line.replace(/^отдел\s+/i, "").trim(), items: [] };
      sections.push(current); continue;
    }
    if (/^[•●\-*]\s*/.test(line)) {
      if (!current) { current = { id: uid(), name: "Без отдела", items: [] }; sections.push(current); }
      const clean = line.replace(/^[•●\-*]\s*/, "");
      const m = clean.match(/^(.*?)(?:,?\s*-\s*)?([\d.,]+)\s*([а-яa-z.]+)\s*$/i);
      current.items.push({ id: uid(), name: (m?.[1] || clean).replace(/,\s*$/, ""), qty: Number((m?.[2] || "1").replace(",", ".")), unit: m?.[3] || "шт.", status: "planned" });
    }
  }
  return { name, sections };
}

function parseReceipt(text: string, list: ShoppingList) {
  const found: Record<string, { price: number; qty?: number; volume?: string }> = {};
  const all = listItems(list);
  for (const line of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    if (/^(?:№|итого\s*\|)/i.test(line)) continue;
    const columns = line.split("|").map(value => value.trim());
    const isTableRow = columns.length >= 5 && /^\d+$/.test(columns[0]);
    const fallbackPrice = line.match(/(\d+[\s\d]*[.,]\d{2})\s*(?:₽|руб\.?)?\s*$/i);
    if (!isTableRow && !fallbackPrice) continue;
    const rawName = isTableRow ? columns[1] : line.slice(0, fallbackPrice!.index);
    const receiptName = normalize(rawName);
    const tokens = receiptName.split(" ").filter(t => t.length > 2);
    let best: Item | undefined; let score = 0;
    for (const item of all) {
      const itemTokens = normalize(item.name).split(" ").filter(token => token.length > 2);
      const shared = tokens.filter(token => itemTokens.includes(token)).length;
      const next = shared / Math.max(Math.min(tokens.length, itemTokens.length), 1);
      if (next > score) { score = next; best = item; }
    }
    if (best && score >= .5) {
      const rawPrice = isTableRow ? columns[4] : fallbackPrice![1];
      found[best.id] = {
        price: Number(rawPrice.replace(/\s/g, "").replace(",", ".")),
        qty: isTableRow ? Number(columns[2].replace(/\s/g, "").replace(",", ".")) || undefined : undefined,
        volume: isTableRow ? columns[3] || undefined : undefined,
      };
    }
  }
  return found;
}

function Icon({ children }: { children: React.ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span>; }

export default function App() {
  const [store, setStore] = useState<Store>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("skladno-store") || "") as { lists?: unknown[]; activeId?: string };
      if (!saved.lists?.length) return seed;
      const lists = saved.lists.map(migrateList);
      return { lists, activeId: lists.some(list => list.id === saved.activeId) ? String(saved.activeId) : lists[0].id };
    } catch { return seed; }
  });
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "split">("list");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [importText, setImportText] = useState("");
  const [importGroup, setImportGroup] = useState("__new");
  const [addText, setAddText] = useState("");
  const [addGroup, setAddGroup] = useState("");
  const [addSection, setAddSection] = useState("__none");
  const [receiptText, setReceiptText] = useState("");
  const [people, setPeople] = useState(4);
  const [newListName, setNewListName] = useState("");
  const [openSectionMenu, setOpenSectionMenu] = useState("");
  const [openStoreMenu, setOpenStoreMenu] = useState("");
  const [editingGroup, setEditingGroup] = useState("");
  const [storeDraft, setStoreDraft] = useState("");
  const [syncState, setSyncState] = useState<"syncing" | "online" | "error">("syncing");
  const [syncError, setSyncError] = useState("");
  const [modalViewport, setModalViewport] = useState({ height: "100dvh", top: "0px" });
  const current = store.lists.find(l => l.id === store.activeId) || store.lists[0];
  const currentRef = useRef<ShoppingList | undefined>(current);
  const readyRoom = useRef<string | null>(null);
  const remoteUpdatedAt = useRef<Record<string, number>>({});
  const initialRoomHandled = useRef(false);

  const mutate = (fn: (list: ShoppingList) => ShoppingList) => setStore(prev => ({ ...prev, lists: prev.lists.map(l => l.id === prev.activeId ? { ...fn(l), updatedAt: Math.max(now(), l.updatedAt + 1) } : l) }));
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2300); };

  useEffect(() => { currentRef.current = current; }, [current]);

  useEffect(() => {
    localStorage.setItem("skladno-store", JSON.stringify(store));
  }, [store]);
  useEffect(() => {
    if (!modal || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const updateViewport = () => setModalViewport({
      height: `${Math.round(viewport.height)}px`,
      top: `${Math.round(viewport.offsetTop)}px`,
    });
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
    };
  }, [modal]);
  useEffect(() => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const room = hash.get("room") || "";
    const data = hash.get("data");
    if (!room && !data) return;
    if (room && !/^[a-z0-9_-]{6,160}$/i.test(room)) return;
    let snapshot: ShoppingList | null = null;
    if (data) {
      try { snapshot = JSON.parse(decodeURIComponent(escape(atob(data)))) as ShoppingList; } catch { /* old snapshot is optional */ }
    }
    const roomId = room || snapshot?.roomId;
    if (!roomId) return;
    setStore(prev => {
      const existing = prev.lists.find(list => list.roomId === roomId);
      if (existing) return { ...prev, activeId: existing.id };
      const sharedId = uid();
      const shared: ShoppingList = snapshot
        ? { ...migrateList(snapshot), id: sharedId, roomId }
        : { id: sharedId, roomId, name: "Загрузка списка…", groups: [], updatedAt: 0, schemaVersion: 2 };
      return { lists: [...prev.lists, shared], activeId: sharedId };
    });
  }, []);
  useEffect(() => {
    if (!initialRoomHandled.current) {
      initialRoomHandled.current = true;
      return;
    }
    if (!current?.roomId) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get("room") === current.roomId && !hash.has("data")) return;
    history.replaceState(null, "", `${location.pathname}${location.search}#room=${encodeURIComponent(current.roomId)}`);
  }, [current?.roomId]);
  useEffect(() => {
    if (!current) { setSyncState("error"); setSyncError("Активный список не найден."); return; }
    const roomId = current.roomId;
    let stopped = false;
    let firstPull = true;
    let pulling = false;
    readyRoom.current = null;

    const saveToFirebase = async (list: ShoppingList) => {
      const payload = { ...list, updatedAt: { ".sv": "timestamp" } };
      const response = await fetch(`${FIREBASE_URL}/rooms/${roomId}.json`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Firebase write failed: ${response.status}`);
      return await response.json() as ShoppingList;
    };

    const applyRemote = (raw: ShoppingList) => {
      const remote = migrateList(raw);
      const timestamp = Number(remote.updatedAt) || 0;
      const needsMigration = raw.schemaVersion !== 2 || raw.name !== remote.name || raw.dateStart !== remote.dateStart || raw.dateEnd !== remote.dateEnd;
      const migratedTimestamp = needsMigration ? Math.max(now(), timestamp + 1) : timestamp;
      remoteUpdatedAt.current[roomId] = timestamp;
      setStore(prev => {
        const local = prev.lists.find(list => list.roomId === roomId);
        if (!local) return prev;
        return { ...prev, lists: prev.lists.map(list => list.roomId === roomId ? { ...remote, id: local.id, updatedAt: migratedTimestamp } : list) };
      });
    };

    const pull = async () => {
      if (pulling) return;
      pulling = true;
      try {
        if (firstPull) setSyncState("syncing");
        const res = await fetch(`${FIREBASE_URL}/rooms/${roomId}.json`);
        if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
        const remote = await res.json() as ShoppingList | null;
        const local = currentRef.current;
        if (!local || local.roomId !== roomId || stopped) return;
        if (!remote) {
          applyRemote(await saveToFirebase(local));
        } else {
          const isDirty = local.updatedAt !== remoteUpdatedAt.current[roomId];
          if (firstPull || (!isDirty && Number(remote.updatedAt) > local.updatedAt)) applyRemote(remote);
        }
        readyRoom.current = roomId;
        setSyncError("");
        setSyncState("online");
      } catch (error) {
        console.error(error);
        if (!stopped) {
          setSyncError(!navigator.onLine ? "Нет подключения к интернету." : error instanceof Error ? error.message : "Неизвестная ошибка соединения с Firebase.");
          setSyncState("error");
        }
      } finally {
        firstPull = false;
        pulling = false;
      }
    };
    pull();
    const timer = window.setInterval(pull, 2500);
    return () => { stopped = true; clearInterval(timer); if (readyRoom.current === roomId) readyRoom.current = null; };
  }, [current?.roomId]);

  useEffect(() => {
    if (!current || readyRoom.current !== current.roomId || current.updatedAt === remoteUpdatedAt.current[current.roomId]) return;
    const roomId = current.roomId;
    const localVersion = current.updatedAt;
    const timer = window.setTimeout(async () => {
      try {
        setSyncState("syncing");
        const payload = { ...current, updatedAt: { ".sv": "timestamp" } };
        const response = await fetch(`${FIREBASE_URL}/rooms/${roomId}.json`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`Firebase write failed: ${response.status}`);
        const saved = migrateList(await response.json());
        const timestamp = Number(saved.updatedAt) || 0;
        remoteUpdatedAt.current[roomId] = timestamp;
        setStore(prev => ({ ...prev, lists: prev.lists.map(list => list.roomId === roomId && list.updatedAt === localVersion ? { ...saved, id: list.id, updatedAt: timestamp } : list) }));
        setSyncError("");
        setSyncState("online");
      } catch (error) {
        console.error(error);
        setSyncError(!navigator.onLine ? "Нет подключения к интернету." : error instanceof Error ? error.message : "Неизвестная ошибка соединения с Firebase.");
        setSyncState("error");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [current?.roomId, current?.updatedAt]);

  const stats = useMemo(() => {
    const items = current ? listItems(current) : [];
    return { total: items.length, cart: items.filter(i => i.status === "cart").length, bought: items.filter(i => i.status === "bought").length, sum: items.reduce((n, i) => n + (i.price || 0), 0) };
  }, [current]);
  const visibleGroups = useMemo(() => (current?.groups || []).map(group => ({
    ...group,
    sections: (group.sections || []).map(section => ({ ...section, items: (section.items || []).filter(item => normalize(item.name).includes(normalize(search))) })).filter(section => section.items.length || !search),
  })).filter(group => group.sections.length || !search) || [], [current, search]);

  if (!current) return <main className="empty"><h1>Складно</h1><button onClick={() => setStore(seed)}>Создать первый список</button></main>;

  const setStatus = (ids: Set<string>, status: Status) => {
    mutate(l => ({ ...l, groups: l.groups.map(group => ({ ...group, sections: group.sections.map(section => ({ ...section, items: section.items.map(item => ids.has(item.id) ? { ...item, status } : item) })) })) }));
    setSelected(new Set()); flash(status === "bought" ? "Отмечено как купленное" : status === "cart" ? "Добавлено в корзину" : "Возвращено в список");
  };
  const cycleStatus = (id: string) => {
    const item = listItems(current).find(i => i.id === id)!;
    setStatus(new Set([id]), item.status === "planned" ? "cart" : item.status === "cart" ? "bought" : "planned");
  };
  const updateShoppingItem = (id: string, changes: Partial<Item>) => mutate(l => ({ ...l, groups: l.groups.map(group => ({ ...group, sections: group.sections.map(section => ({ ...section, items: section.items.map(item => item.id === id ? { ...item, ...changes } : item) })) })) }));
  const deleteItems = (ids: Set<string>) => {
    mutate(l => ({ ...l, groups: l.groups.map(group => ({ ...group, sections: group.sections.map(section => ({ ...section, items: section.items.filter(item => !ids.has(item.id)) })) })) }));
    setSelected(new Set()); flash(ids.size === 1 ? "Товар удалён" : `Удалено товаров: ${ids.size}`);
  };
  const share = async () => {
    const url = `${location.origin}${location.pathname}#room=${encodeURIComponent(current.roomId)}`;
    try { await navigator.clipboard.writeText(url); flash("Ссылка скопирована"); } catch { flash("Скопируйте ссылку из поля"); }
  };
  const importList = () => {
    const parsed = parseList(importText); if (!parsed.sections.length) return flash("Не удалось найти товары");
    const sections = parsed.sections.map(section => section.name === "Без отдела" ? { ...section, name: "" } : section);
    mutate(l => importGroup === "__new"
      ? { ...l, groups: [...l.groups, { id: uid(), name: parsed.name || "Новый магазин", sections }] }
      : { ...l, groups: l.groups.map(group => group.id === importGroup ? { ...group, sections: [...group.sections, ...sections] } : group) });
    setImportText(""); setImportGroup("__new"); setModal(null); flash(`Импортировано: ${sections.reduce((n, s) => n + s.items.length, 0)} товаров`);
  };
  const addItems = () => {
    const lines = addText.split(/\n/).map(s => s.trim()).filter(Boolean); if (!lines.length) return;
    const targetGroup = addGroup || current.groups[0]?.id;
    if (!targetGroup) return flash("Сначала добавьте магазин");
    const items = lines.map(line => {
      const m = line.match(/^(.*?)(?:\s+[—–-]\s+|,\s*)([\d.,]+)\s*([а-яa-z.]+)$/i);
      return { id: uid(), name: m?.[1] || line, qty: Number((m?.[2] || "1").replace(",", ".")), unit: m?.[3] || "шт.", status: "planned" as Status };
    });
    mutate(l => ({ ...l, groups: l.groups.map(group => {
      if (group.id !== targetGroup) return group;
      if (addSection === "__none") {
        const direct = group.sections.find(section => !section.name);
        return direct
          ? { ...group, sections: group.sections.map(section => section.id === direct.id ? { ...section, items: [...section.items, ...items] } : section) }
          : { ...group, sections: [{ id: uid(), name: "", items }, ...group.sections] };
      }
      return { ...group, sections: group.sections.map(section => section.id === addSection ? { ...section, items: [...section.items, ...items] } : section) };
    }) })); setAddText(""); setModal(null); flash(`Добавлено: ${lines.length}`);
  };
  const applyReceipt = () => {
    const prices = parseReceipt(receiptText, current); const count = Object.keys(prices).length;
    mutate(l => ({ ...l, groups: l.groups.map(group => ({ ...group, sections: group.sections.map(section => ({ ...section, items: section.items.map(item => prices[item.id] ? { ...item, price: prices[item.id].price, qty: prices[item.id].qty || item.qty, volume: prices[item.id].volume, status: "bought" } : item) })) })) }));
    setModal(null); setReceiptText(""); flash(`Сопоставлено позиций: ${count}`);
  };
  const renameSection = (groupId: string, section: Section) => {
    const name = window.prompt("Новое название отдела", section.name || "Без отдела");
    if (name === null || !name.trim()) return;
    mutate(list => ({ ...list, groups: list.groups.map(group => group.id === groupId ? { ...group, sections: group.sections.map(item => item.id === section.id ? { ...item, name: name.trim() } : item) } : group) }));
    setOpenSectionMenu("");
  };
  const deleteSection = (groupId: string, section: Section) => {
    if (section.items.length && !window.confirm(`Удалить отдел «${section.name}» и ${section.items.length} товаров?`)) return;
    mutate(list => ({ ...list, groups: list.groups.map(group => group.id === groupId ? { ...group, sections: group.sections.filter(item => item.id !== section.id) } : group) }));
    setOpenSectionMenu(""); flash("Отдел удалён");
  };
  const openStoreEditor = (group?: StoreGroup) => {
    setEditingGroup(group?.id || ""); setStoreDraft(group?.name || ""); setOpenStoreMenu(""); setModal("store");
  };
  const saveStore = () => {
    if (!storeDraft.trim()) return flash("Введите название магазина");
    mutate(list => editingGroup
      ? { ...list, groups: list.groups.map(group => group.id === editingGroup ? { ...group, name: storeDraft.trim() } : group) }
      : { ...list, groups: [...list.groups, { id: uid(), name: storeDraft.trim(), sections: [] }] });
    setModal(null); flash(editingGroup ? "Магазин обновлён" : "Магазин добавлен");
  };
  const deleteStore = (group: StoreGroup) => {
    const count = group.sections.flatMap(section => section.items).length;
    if (!window.confirm(count ? `Удалить магазин «${group.name}» и ${count} товаров?` : `Удалить магазин «${group.name}»?`)) return;
    mutate(list => ({ ...list, groups: list.groups.filter(item => item.id !== group.id) }));
    setOpenStoreMenu(""); setModal(null); flash("Магазин удалён");
  };
  const updateSectionName = (groupId: string, sectionId: string, name: string) => mutate(list => ({ ...list, groups: list.groups.map(group => group.id === groupId ? { ...group, sections: group.sections.map(section => section.id === sectionId ? { ...section, name } : section) } : group) }));
  const addDepartment = (groupId: string) => mutate(list => ({ ...list, groups: list.groups.map(group => group.id === groupId ? { ...group, sections: [...group.sections, { id: uid(), name: "Новый отдел", items: [] }] } : group) }));
  const moveDepartment = (groupId: string, sectionId: string, direction: -1 | 1) => mutate(list => ({ ...list, groups: list.groups.map(group => {
    if (group.id !== groupId) return group;
    const named = group.sections.filter(section => section.name);
    const index = named.findIndex(section => section.id === sectionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= named.length) return group;
    [named[index], named[target]] = [named[target], named[index]];
    let namedIndex = 0;
    return { ...group, sections: group.sections.map(section => section.name ? named[namedIndex++] : section) };
  }) }));

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span>С</span><strong>Складно</strong></div>
      <button className="create-list" onClick={() => setModal("lists")}><Icon><Plus /></Icon> Новый список</button>
      <div className="side-label">Мои списки</div>
      {store.lists.map(list => <button key={list.id} className={`side-list ${list.id === current.id ? "active" : ""}`} onClick={() => setStore(s => ({ ...s, activeId: list.id }))}>
        <span className="bag"><StoreIcon size={17} /></span><span><b>{list.name}</b><small>{listItems(list).filter(i => i.status === "bought").length} из {listItems(list).length} куплено</small></span>
      </button>)}
    </aside>

    <main className="content">
      <header>
        <button className="mobile-brand" onClick={() => setModal("lists")} aria-label="Списки и магазины"><span>С</span><b>Складно</b></button>
        <div className="title-wrap"><button className={`sync-status ${syncState}`} disabled={syncState !== "error"} onClick={() => syncState === "error" && setModal("syncError")}><span className={`live-dot ${syncState}`}></span>{syncState === "online" ? "Онлайн · синхронизировано" : syncState === "syncing" ? "Синхронизация…" : "Ошибка синхронизации · подробнее"}</button>
          <div className="editable-title"><h1 contentEditable suppressContentEditableWarning onBlur={e => mutate(l => ({ ...l, name: e.currentTarget.textContent || l.name }))}>{current.name}</h1><button aria-label="Переименовать">✎</button></div>
          {formatListDates(current) && <span className="list-dates">{formatListDates(current)}</span>}
        </div>
        <div className="header-actions"><button className="secondary" onClick={() => { setImportGroup("__new"); setModal("import"); }}><Icon><Download /></Icon><span>Импорт</span></button><button className="primary" onClick={() => { setAddGroup(current.groups[0]?.id || ""); setAddSection("__none"); setModal("add"); }}><Icon><Plus /></Icon><span>Добавить</span></button><button className="round" onClick={() => setModal("share")} aria-label="Поделиться"><Share2 size={18} /></button></div>
      </header>

      <nav className="tabs"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Список <span>{stats.total}</span></button><button className={view === "split" ? "active" : ""} onClick={() => setView("split")}>Калькулятор</button></nav>

      {view === "list" ? <>
        <section className="progress-card">
          <div><strong>{stats.bought}</strong><span>куплено</span></div><div><strong>{stats.cart}</strong><span>в корзине</span></div><div><strong>{stats.total - stats.bought - stats.cart}</strong><span>осталось</span></div>
          <div className="bar"><i style={{ width: `${stats.total ? stats.bought / stats.total * 100 : 0}%` }}></i><i style={{ width: `${stats.total ? stats.cart / stats.total * 100 : 0}%` }}></i></div>
        </section>
        <div className="toolbar"><label className="search"><Icon><Search /></Icon><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти товар" /></label><button onClick={() => setModal("receipt")}><Icon><ReceiptText /></Icon> Загрузить чек</button><button className="add-store-button" onClick={() => openStoreEditor()} aria-label="Добавить магазин"><Icon><StoreIcon /></Icon><span>Добавить магазин</span></button></div>
        <div className="sections">
          {visibleGroups.map(group => <section className="store-group" key={group.id}>
            <div className="store-head"><span className="store-icon"><StoreIcon size={18} /></span><div><h2>{group.name}</h2><small>{group.sections.flatMap(section => section.items).length} товаров</small></div><div className="store-menu-wrap"><button className="more store-more" onClick={() => setOpenStoreMenu(value => value === group.id ? "" : group.id)} aria-label={`Меню магазина ${group.name}`}><MoreHorizontal size={20} /></button>{openStoreMenu === group.id && <div className="section-menu store-menu"><button onClick={() => openStoreEditor(group)}><Pencil size={15} />Настроить магазин</button><button className="danger" onClick={() => deleteStore(group)}><Trash2 size={15} />Удалить магазин</button></div>}</div></div>
            <div className="store-sections">{group.sections.map(section => <section className={`department ${section.name ? "" : "direct"}`} key={section.id}>
              {section.name && <div className="department-head"><button className="collapse" onClick={() => setCollapsed(c => { const n = new Set(c); n.has(section.id) ? n.delete(section.id) : n.add(section.id); return n; })}>{collapsed.has(section.id) ? "›" : "⌄"}</button><h2>{section.name}</h2><span>{section.items.filter(i => i.status === "bought").length}/{section.items.length}</span><div className="section-menu-wrap"><button className="more" onClick={() => setOpenSectionMenu(value => value === section.id ? "" : section.id)} aria-label={`Меню отдела ${section.name}`}><MoreHorizontal size={18} /></button>{openSectionMenu === section.id && <div className="section-menu"><button onClick={() => renameSection(group.id, section)}><Pencil size={14} />Переименовать</button><button className="danger" onClick={() => deleteSection(group.id, section)}><Trash2 size={14} />Удалить отдел</button></div>}</div></div>}
              {(!section.name || !collapsed.has(section.id)) && <div className="items">{section.items.map(item => <ShoppingItemRow key={item.id} item={item} selected={selected.has(item.id)} onSelect={checked => setSelected(prev => { const next = new Set(prev); checked ? next.add(item.id) : next.delete(item.id); return next; })} onStatus={() => cycleStatus(item.id)} onQuantity={qty => updateShoppingItem(item.id, { qty })} onUnit={unit => updateShoppingItem(item.id, { unit })} onDelete={() => deleteItems(new Set([item.id]))} />)}</div>}
            </section>)}</div>
          </section>)}
          {!visibleGroups.length && <div className="no-results">Ничего не найдено</div>}
        </div>
      </> : <SplitView list={current} people={people} setPeople={setPeople} mutate={mutate} />}
    </main>

    <nav className="mobile-nav"><button className="active" onClick={() => setView("list")}><Icon><List /></Icon>Список</button><button onClick={() => { setAddGroup(current.groups[0]?.id || ""); setAddSection("__none"); setModal("add"); }}><Icon><Plus /></Icon>Добавить</button><button onClick={() => { setImportGroup(current.groups[0]?.id || "__new"); setModal("import"); }}><Icon><Download /></Icon>Импорт</button><button onClick={() => setView("split")}><Icon><Divide /></Icon>Разделить</button><button onClick={() => setModal("share")}><Icon><Share2 /></Icon>Поделиться</button></nav>

    {selected.size > 0 && <div className="bulk"><b>Выбрано: {selected.size}</b><button onClick={() => setStatus(selected, "cart")}><ShoppingCart size={15} />В корзину</button><button onClick={() => setStatus(selected, "bought")}><Check size={15} />Куплено</button><button onClick={() => setStatus(selected, "planned")}><Undo2 size={15} />Вернуть</button><button className="danger" onClick={() => window.confirm(`Удалить выбранные товары (${selected.size})?`) && deleteItems(selected)}><Trash2 size={15} />Удалить</button><button className="close" onClick={() => setSelected(new Set())}><X size={18} /></button></div>}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}

    {modal && <div className="modal-backdrop" style={{ "--modal-viewport-height": modalViewport.height, "--modal-viewport-top": modalViewport.top } as React.CSSProperties} onMouseDown={e => e.currentTarget === e.target && setModal(null)}><div className="modal" role="dialog" aria-modal="true">
      <button className="modal-close" onClick={() => setModal(null)}>×</button>
      {modal === "import" && <><span className="modal-icon"><Download size={21} /></span><h2>Импорт покупок</h2><p>Заголовок «Список покупок …» станет названием магазина. Отделы можно не указывать.</p><label>Куда импортировать<select value={importGroup} onChange={e => setImportGroup(e.target.value)}><option value="__new">Создать новый магазин</option>{current.groups.map(group => <option key={group.id} value={group.id}>Добавить в «{group.name}»</option>)}</select></label><textarea className="large" value={importText} onChange={e => setImportText(e.target.value)} placeholder={'Список покупок Глобус Саларьево\n\nОтдел Хлеб\n• Хлеб тостовый, - 1 шт.'} /><button className="primary wide" onClick={importList}>Распознать и импортировать</button></>}
      {modal === "add" && <><span className="modal-icon"><Plus size={21} /></span><h2>Добавить товары</h2><p>Один товар на строку. Количество можно написать через тире.</p><label>Магазин<select value={addGroup} onChange={e => { setAddGroup(e.target.value); setAddSection("__none"); }}>{current.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Отдел<select value={addSection} onChange={e => setAddSection(e.target.value)}><option value="__none">Без отдела</option>{current.groups.find(group => group.id === addGroup)?.sections.filter(section => section.name).map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label><textarea value={addText} onChange={e => setAddText(e.target.value)} placeholder={'Молоко — 2 шт.\nСметана — 1 уп.'} /><button className="primary wide" onClick={addItems}>Добавить товары</button></>}
      {modal === "receipt" && <><span className="modal-icon"><ReceiptText size={21} /></span><h2>Сверить с чеком</h2><p>Вставьте таблицу с разделителем |. Складно сопоставит названия, количество, объём и итоговую сумму.</p><textarea className="large receipt-input" value={receiptText} onChange={e => setReceiptText(e.target.value)} placeholder={'№ | Название | Кол-во | Объём / Масса | Сумма, ₽\n1 | Пиво Corona Extra | 18 | 0,355 л | 2 322,00\n2 | Пиво Guinness Draft | 12 | 0,44 л | 2 508,00\nИтого |  | 30 |  | 4 830,00'} /><button className="primary wide" onClick={applyReceipt}>Сопоставить позиции</button></>}
      {modal === "share" && <><span className="modal-icon"><Share2 size={21} /></span><h2>Поделиться списком</h2><p>В ссылку попадёт только «{current.name}». Остальные списки останутся приватными.</p><div className="share-code">{current.roomId}<span>Секретный код списка</span></div><button className="primary wide" onClick={share}>Скопировать ссылку</button><small className="hint">Короткая ссылка содержит только секретный код списка.</small></>}
      {modal === "store" && <><span className="modal-icon"><StoreIcon size={21} /></span><h2>{editingGroup ? "Настроить магазин" : "Добавить магазин"}</h2><p>{editingGroup ? "Измените название, состав и порядок отделов." : "Создайте ещё одну группу покупок внутри этого списка."}</p><label>Название магазина<input value={storeDraft} onChange={event => setStoreDraft(event.target.value)} onKeyDown={event => event.key === "Enter" && saveStore()} placeholder="Например, Лемана ПРО" /></label>{editingGroup && (() => { const group = current.groups.find(item => item.id === editingGroup); const departments = group?.sections.filter(section => section.name) || []; return group && <div className="department-order"><div className="order-title"><b>Отделы</b><span>Порядок на экране</span></div>{departments.map((section, index) => <div className="order-row" key={section.id}><span className="drag-index">{index + 1}</span><input value={section.name} onChange={event => updateSectionName(group.id, section.id, event.target.value || "Без названия")} aria-label="Название отдела" /><button onClick={() => moveDepartment(group.id, section.id, -1)} disabled={index === 0} aria-label="Поднять отдел"><ArrowUp size={16} /></button><button onClick={() => moveDepartment(group.id, section.id, 1)} disabled={index === departments.length - 1} aria-label="Опустить отдел"><ArrowDown size={16} /></button><button className="order-delete" onClick={() => deleteSection(group.id, section)} aria-label={`Удалить ${section.name}`}><Trash2 size={16} /></button></div>)}{!departments.length && <div className="empty-departments">Отделов пока нет — товары могут лежать прямо в магазине.</div>}<button className="secondary wide compact" onClick={() => addDepartment(group.id)}><Plus size={15} />Добавить отдел</button></div>; })()}<div className="modal-actions"><button className="primary" onClick={saveStore}>{editingGroup ? "Сохранить" : "Добавить магазин"}</button>{editingGroup && current.groups.find(item => item.id === editingGroup) && <button className="delete-store" onClick={() => deleteStore(current.groups.find(item => item.id === editingGroup)!)}><Trash2 size={16} />Удалить магазин</button>}</div></>}
      {modal === "syncError" && <><span className="modal-icon sync-error-icon"><CircleAlert size={21} /></span><h2>Ошибка синхронизации</h2><p>Изменения остаются на этом устройстве. После восстановления соединения приложение попробует отправить их снова.</p><div className="sync-error-detail">{syncError || "Не удалось связаться с Firebase."}</div><button className="primary wide retry-button" onClick={() => location.reload()}><RefreshCw size={16} />Повторить подключение</button></>}
      {modal === "lists" && <ListManager store={store} setStore={setStore} current={current} newListName={newListName} setNewListName={setNewListName} close={() => setModal(null)} flash={flash} />}
    </div></div>}
  </div>;
}

function ShoppingItemRow({ item, selected, onSelect, onStatus, onQuantity, onUnit, onDelete }: { item: Item; selected: boolean; onSelect: (checked: boolean) => void; onStatus: () => void; onQuantity: (qty: number) => void; onUnit: (unit: string) => void; onDelete: () => void }) {
  const [offset, setOffset] = useState(0);
  const [qtyDraft, setQtyDraft] = useState(String(item.qty));
  const touch = useRef({ x: 0, y: 0 });
  const unit = item.unit.replace(/\.$/, "");
  const units = ["кг", "уп", "шт", "бут"];
  if (!units.includes(unit)) units.unshift(unit);
  useEffect(() => { setQtyDraft(String(item.qty)); }, [item.qty]);
  const commitQuantity = () => {
    const qty = Number(qtyDraft.trim().replace(",", "."));
    if (Number.isFinite(qty) && qty > 0) onQuantity(Math.round(qty * 1000) / 1000);
    else setQtyDraft(String(item.qty));
  };
  const adjustQuantity = (delta: -1 | 1) => {
    const parsed = Number(qtyDraft.trim().replace(",", "."));
    const base = Number.isFinite(parsed) && parsed > 0 ? parsed : item.qty;
    const next = unit === "кг" && base < 1 && delta > 0 ? 1 : Math.max(.001, Math.round((base + delta) * 1000) / 1000);
    setQtyDraft(String(next)); onQuantity(next);
  };
  const start = (event: React.TouchEvent) => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
  const move = (event: React.TouchEvent) => {
    const dx = event.touches[0].clientX - touch.current.x;
    const dy = event.touches[0].clientY - touch.current.y;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    setOffset(Math.max(-82, Math.min(0, dx)));
  };
  const end = () => setOffset(value => value < -42 ? -76 : 0);
  return <div className="swipe-row">
    <button className="swipe-delete" onClick={onDelete}>Удалить</button>
    <article className={`item ${item.status}`} style={{ transform: `translateX(${offset}px)` }} onTouchStart={start} onTouchMove={move} onTouchEnd={end}>
      <input aria-label={`Выбрать ${item.name}`} type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} />
      <button className={`status ${item.status}`} onClick={onStatus} aria-label="Изменить статус">{item.status === "bought" ? <Check size={14} /> : item.status === "cart" ? <ShoppingCart size={13} /> : ""}</button>
      <div className="item-name"><strong>{item.name}</strong><small>{item.status === "planned" ? "Нужно купить" : item.status === "cart" ? "В корзине" : ["Куплено", item.volume, item.price ? formatMoney(item.price) : ""].filter(Boolean).join(" · ")}</small></div>
      <div className="stepper"><button onClick={() => adjustQuantity(-1)} aria-label="Уменьшить количество">−</button><input value={qtyDraft} inputMode="decimal" onChange={event => setQtyDraft(event.target.value)} onBlur={commitQuantity} onFocus={event => event.currentTarget.select()} onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()} aria-label={`Количество ${item.name}`} /><select value={unit} onChange={event => onUnit(event.target.value)} aria-label={`Единица измерения ${item.name}`}>{units.map(value => <option value={value} key={value}>{value}</option>)}</select><button onClick={() => adjustQuantity(1)} aria-label="Увеличить количество">＋</button></div>
      <button className="item-delete" onClick={() => window.confirm(`Удалить «${item.name}»?`) && onDelete()} aria-label={`Удалить ${item.name}`}>×</button>
    </article>
  </div>;
}

function SplitView({ list, people, setPeople, mutate }: { list: ShoppingList; people: number; setPeople: (n: number) => void; mutate: (fn: (l: ShoppingList) => ShoppingList) => void }) {
  const bought = listItems(list).filter(i => i.status === "bought");
  const selected = bought.filter(i => i.checked !== false);
  const sum = selected.reduce((n, i) => n + (i.price || 0), 0);
  const updateItem = (id: string, fn: (item: Item) => Item) => mutate(l => ({ ...l, groups: l.groups.map(group => ({ ...group, sections: group.sections.map(section => ({ ...section, items: section.items.map(item => item.id === id ? fn(item) : item) })) })) }));
  const toggle = (id: string) => updateItem(id, item => ({ ...item, checked: item.checked === false }));
  return <div className="split-view"><div className="split-summary"><span>Итого к разделению</span><strong>{formatMoney(sum)}</strong><div className="people"><button onClick={() => setPeople(Math.max(1, people - 1))}>−</button><span><b>{people}</b> человек</span><button onClick={() => setPeople(people + 1)}>＋</button></div><div className="per-person"><span>С каждого</span><b>{formatMoney(sum / Math.max(people, 1))}</b></div></div><section className="calculator-list"><h2>Купленные товары <span>{selected.length} выбрано</span></h2>{bought.length ? bought.map(i => <label key={i.id}><input type="checkbox" checked={i.checked !== false} onChange={() => toggle(i.id)} /><span>{i.name}</span><input className="price" inputMode="decimal" value={i.price || ""} placeholder="0,00" onChange={e => updateItem(i.id, item => ({ ...item, price: Number(e.target.value.replace(",", ".")) || 0 }))} /><b>₽</b></label>) : <p className="no-results">Сначала отметьте товары как купленные.</p>}</section></div>;
}

function ListManager({ store, setStore, current, newListName, setNewListName, close, flash }: { store: Store; setStore: React.Dispatch<React.SetStateAction<Store>>; current: ShoppingList; newListName: string; setNewListName: (s: string) => void; close: () => void; flash: (s: string) => void }) {
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const create = () => {
    if (!newListName.trim()) return flash("Введите название списка");
    if (!dateStart) return flash("Укажите дату поездки");
    if (dateEnd && dateEnd < dateStart) return flash("Дата окончания должна быть не раньше начала");
    const id = uid();
    const list: ShoppingList = { id, roomId: `${id}-${uid()}-${uid()}`, name: newListName.trim(), dateStart, dateEnd: dateEnd || dateStart, updatedAt: now(), schemaVersion: 2, groups: [{ id: uid(), name: "Новый магазин", sections: [] }] };
    setStore(s => ({ lists: [...s.lists, list], activeId: id })); setNewListName(""); close();
  };
  const remove = (id: string) => { if (store.lists.length === 1) return flash("Нельзя удалить единственный список"); const next = store.lists.filter(l => l.id !== id); setStore({ lists: next, activeId: id === store.activeId ? next[0].id : store.activeId }); };
  const updateGroups = (fn: (groups: StoreGroup[]) => StoreGroup[]) => setStore(s => ({ ...s, lists: s.lists.map(list => list.id === current.id ? { ...list, updatedAt: Math.max(now(), list.updatedAt + 1), groups: fn(list.groups) } : list) }));
  const addGroup = () => updateGroups(groups => [...groups, { id: uid(), name: "Новый магазин", sections: [] }]);
  const renameGroup = (id: string, name: string) => updateGroups(groups => groups.map(group => group.id === id ? { ...group, name: name || "Без названия" } : group));
  const removeGroup = (group: StoreGroup) => {
    const count = group.sections.flatMap(section => section.items).length;
    if (count && !window.confirm(`Удалить магазин «${group.name}» и ${count} товаров?`)) return;
    updateGroups(groups => groups.filter(item => item.id !== group.id));
  };
  const addSection = (groupId: string) => updateGroups(groups => groups.map(group => group.id === groupId ? { ...group, sections: [...group.sections, { id: uid(), name: "Новый отдел", items: [] }] } : group));
  const renameSection = (groupId: string, id: string, name: string) => updateGroups(groups => groups.map(group => group.id === groupId ? { ...group, sections: group.sections.map(section => section.id === id ? { ...section, name: name || "Без названия" } : section) } : group));
  const removeSection = (groupId: string, section: Section) => {
    if (section.items.length && !window.confirm(`Удалить отдел «${section.name}» и ${section.items.length} товаров?`)) return;
    updateGroups(groups => groups.map(group => group.id === groupId ? { ...group, sections: group.sections.filter(item => item.id !== section.id) } : group));
  };
  return <>
    <span className="modal-icon"><List size={21} /></span><h2>Списки и магазины</h2>
    <div className="new-list-form"><label>Название<input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Например, Елизарово" /></label><div className="date-fields"><label>Дата начала<input type="date" value={dateStart} onChange={e => { setDateStart(e.target.value); if (dateEnd && dateEnd < e.target.value) setDateEnd(""); }} /></label><label>Дата окончания <span>необязательно</span><input type="date" min={dateStart} value={dateEnd} onChange={e => setDateEnd(e.target.value)} /></label></div><button className="primary wide" onClick={create}>Создать список</button></div>
    <div className="manage-lists">{store.lists.map(list => <div key={list.id}><button onClick={() => { setStore(s => ({ ...s, activeId: list.id })); close(); }}><b>{list.name}</b><small>{formatListDates(list) || "Дата не указана"}</small></button><button className="trash" onClick={() => remove(list.id)} aria-label={`Удалить ${list.name}`}>×</button></div>)}</div>
    <h3 className="manage-title">Магазины в «{current.name}»</h3>
    <div className="manage-groups">{current.groups.map(group => <section className="manage-group-card" key={group.id}>
      <div className="manage-group-name"><input value={group.name} onChange={e => renameGroup(group.id, e.target.value)} aria-label="Название магазина" /><button className="trash" onClick={() => removeGroup(group)} aria-label={`Удалить ${group.name}`}>×</button></div>
      <small>Отделы необязательны</small>
      <div className="manage-sections">{group.sections.filter(section => section.name).map(section => <div key={section.id}><input value={section.name} onChange={e => renameSection(group.id, section.id, e.target.value)} aria-label="Название отдела" /><button className="trash" onClick={() => removeSection(group.id, section)} aria-label={`Удалить ${section.name}`}>×</button></div>)}</div>
      <button className="secondary wide compact" onClick={() => addSection(group.id)}>＋ Добавить отдел</button>
    </section>)}</div>
    <button className="secondary wide" onClick={addGroup}>＋ Добавить магазин</button>
  </>;
}
