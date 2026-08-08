import { useEffect, useMemo, useRef, useState } from "react";

type Status = "planned" | "cart" | "bought";
type Item = { id: string; name: string; qty: number; unit: string; status: Status; price?: number; checked?: boolean };
type Section = { id: string; name: string; items: Item[] };
type ShoppingList = { id: string; roomId: string; name: string; store: string; sections: Section[]; updatedAt: number };
type Store = { lists: ShoppingList[]; activeId: string };
type Modal = null | "import" | "add" | "receipt" | "share" | "lists";

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const FIREBASE_URL = "https://skladno-b1126-default-rtdb.europe-west1.firebasedatabase.app";
const normalize = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
const formatMoney = (n: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(n);

const seed: Store = {
  activeId: "globus",
  lists: [{
    id: "globus", roomId: "globus-" + uid(), name: "Покупки в Глобус", store: "Саларьево", updatedAt: now(),
    sections: [
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
    ],
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
  const found: Record<string, number> = {};
  const all = list.sections.flatMap(s => s.items);
  for (const line of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    const price = line.match(/(\d+[\s\d]*[.,]\d{2})\s*(?:₽|руб\.?)?\s*$/i);
    if (!price) continue;
    const receiptName = normalize(line.slice(0, price.index));
    const tokens = receiptName.split(" ").filter(t => t.length > 2);
    let best: Item | undefined; let score = 0;
    for (const item of all) {
      const n = normalize(item.name);
      const next = tokens.filter(t => n.includes(t)).length / Math.max(tokens.length, 1);
      if (next > score) { score = next; best = item; }
    }
    if (best && score >= .35) found[best.id] = Number(price[1].replace(/\s/g, "").replace(",", "."));
  }
  return found;
}

function Icon({ children }: { children: React.ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span>; }

export default function App() {
  const [store, setStore] = useState<Store>(() => {
    try { return JSON.parse(localStorage.getItem("skladno-store") || "") as Store; } catch { return seed; }
  });
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "split">("list");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [importText, setImportText] = useState("");
  const [addText, setAddText] = useState("");
  const [addSection, setAddSection] = useState("");
  const [receiptText, setReceiptText] = useState("");
  const [people, setPeople] = useState(4);
  const [newListName, setNewListName] = useState("");
  const [syncState, setSyncState] = useState<"syncing" | "online" | "error">("syncing");
  const channel = useRef<BroadcastChannel | null>(null);
  const current = store.lists.find(l => l.id === store.activeId) || store.lists[0];

  const mutate = (fn: (list: ShoppingList) => ShoppingList) => setStore(prev => ({ ...prev, lists: prev.lists.map(l => l.id === prev.activeId ? { ...fn(l), updatedAt: now() } : l) }));
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2300); };

  useEffect(() => {
    channel.current = new BroadcastChannel("skladno");
    channel.current.onmessage = e => setStore(prev => e.data.lists?.some((l: ShoppingList) => l.updatedAt > (prev.lists.find(p => p.id === l.id)?.updatedAt || 0)) ? e.data : prev);
    return () => { channel.current?.close(); channel.current = null; };
  }, []);
  useEffect(() => {
    localStorage.setItem("skladno-store", JSON.stringify(store));
    channel.current?.postMessage(store);
  }, [store]);
  useEffect(() => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const data = hash.get("data");
    if (!data) return;
    try {
      const shared = JSON.parse(decodeURIComponent(escape(atob(data)))) as ShoppingList;
      setStore(prev => {
        const existing = prev.lists.find(list => list.roomId === shared.roomId);
        if (existing) return { ...prev, activeId: existing.id };
        const sharedId = uid();
        return { lists: [...prev.lists, { ...shared, id: sharedId }], activeId: sharedId };
      });
    } catch { /* ignore invalid links */ }
  }, []);
  useEffect(() => {
    if (!current) { setSyncState("error"); return; }
    let stopped = false; const base = FIREBASE_URL;
    const sync = async () => {
      try {
        setSyncState("syncing");
        const res = await fetch(`${base}/rooms/${current.roomId}.json`);
        if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
        const remote = await res.json() as ShoppingList | null;
        if (remote?.updatedAt && remote.updatedAt > current.updatedAt) {
          setStore(prev => ({ ...prev, lists: prev.lists.map(list => list.id === prev.activeId ? { ...remote, id: list.id } : list) }));
        } else {
          const write = await fetch(`${base}/rooms/${current.roomId}.json`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(current) });
          if (!write.ok) throw new Error(`Firebase write failed: ${write.status}`);
        }
        if (!stopped) setSyncState("online");
      } catch (error) {
        console.error(error);
        if (!stopped) setSyncState("error");
      }
    };
    sync(); const timer = window.setInterval(sync, 3500);
    return () => { stopped = true; clearInterval(timer); };
  }, [current?.roomId, current?.updatedAt]);

  const stats = useMemo(() => {
    const items = current?.sections.flatMap(s => s.items) || [];
    return { total: items.length, cart: items.filter(i => i.status === "cart").length, bought: items.filter(i => i.status === "bought").length, sum: items.reduce((n, i) => n + (i.price || 0), 0) };
  }, [current]);
  const visibleSections = useMemo(() => current?.sections.map(s => ({ ...s, items: s.items.filter(i => normalize(i.name).includes(normalize(search))) })).filter(s => s.items.length || !search) || [], [current, search]);

  if (!current) return <main className="empty"><h1>Складно</h1><button onClick={() => setStore(seed)}>Создать первый список</button></main>;

  const setStatus = (ids: Set<string>, status: Status) => {
    mutate(l => ({ ...l, sections: l.sections.map(s => ({ ...s, items: s.items.map(i => ids.has(i.id) ? { ...i, status } : i) })) }));
    setSelected(new Set()); flash(status === "bought" ? "Отмечено как купленное" : status === "cart" ? "Добавлено в корзину" : "Возвращено в список");
  };
  const cycleStatus = (id: string) => {
    const item = current.sections.flatMap(s => s.items).find(i => i.id === id)!;
    setStatus(new Set([id]), item.status === "planned" ? "cart" : item.status === "cart" ? "bought" : "planned");
  };
  const changeQty = (id: string, delta: number) => mutate(l => ({ ...l, sections: l.sections.map(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, qty: Math.max(.001, Math.round((i.qty + delta) * 1000) / 1000) } : i) })) }));
  const share = async () => {
    const safe = { ...current, id: "shared" };
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(safe))));
    const url = `${location.origin}${location.pathname}#room=${current.roomId}&data=${data}`;
    try { await navigator.clipboard.writeText(url); flash("Ссылка скопирована"); } catch { flash("Скопируйте ссылку из поля"); }
  };
  const importList = () => {
    const parsed = parseList(importText); if (!parsed.sections.length) return flash("Не удалось найти товары");
    mutate(l => ({ ...l, name: parsed.name || l.name, sections: parsed.sections })); setImportText(""); setModal(null); flash(`Импортировано: ${parsed.sections.reduce((n, s) => n + s.items.length, 0)} товаров`);
  };
  const addItems = () => {
    const lines = addText.split(/\n/).map(s => s.trim()).filter(Boolean); if (!lines.length) return;
    const targetSection = addSection || current.sections[0]?.id;
    mutate(l => ({ ...l, sections: l.sections.map(s => s.id === targetSection ? { ...s, items: [...s.items, ...lines.map(line => {
      const m = line.match(/^(.*?)(?:\s+[—–-]\s+|,\s*)([\d.,]+)\s*([а-яa-z.]+)$/i);
      return { id: uid(), name: m?.[1] || line, qty: Number((m?.[2] || "1").replace(",", ".")), unit: m?.[3] || "шт.", status: "planned" as Status };
    })] } : s) })); setAddText(""); setModal(null); flash(`Добавлено: ${lines.length}`);
  };
  const applyReceipt = () => {
    const prices = parseReceipt(receiptText, current); const count = Object.keys(prices).length;
    mutate(l => ({ ...l, sections: l.sections.map(s => ({ ...s, items: s.items.map(i => prices[i.id] ? { ...i, price: prices[i.id], status: "bought" } : i) })) }));
    setModal(null); setReceiptText(""); flash(`Сопоставлено позиций: ${count}`);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span>С</span><strong>Складно</strong></div>
      <button className="create-list" onClick={() => setModal("lists")}><Icon>＋</Icon> Новый список</button>
      <div className="side-label">Мои списки</div>
      {store.lists.map(list => <button key={list.id} className={`side-list ${list.id === current.id ? "active" : ""}`} onClick={() => setStore(s => ({ ...s, activeId: list.id }))}>
        <span className="bag">▱</span><span><b>{list.name}</b><small>{list.sections.flatMap(s => s.items).filter(i => i.status === "bought").length} из {list.sections.flatMap(s => s.items).length} куплено</small></span>
      </button>)}
    </aside>

    <main className="content">
      <header>
        <div className="mobile-brand"><span>С</span><b>Складно</b></div>
        <div className="title-wrap"><p><span className={`live-dot ${syncState}`}></span>{syncState === "online" ? "Онлайн · синхронизировано" : syncState === "syncing" ? "Синхронизация…" : "Ошибка синхронизации"}</p>
          <div className="editable-title"><h1 contentEditable suppressContentEditableWarning onBlur={e => mutate(l => ({ ...l, name: e.currentTarget.textContent || l.name }))}>{current.name}</h1><button aria-label="Переименовать">✎</button></div>
          <span className="store-name">{current.store}</span>
        </div>
        <div className="header-actions"><button className="secondary" onClick={() => setModal("import")}><Icon>⇩</Icon><span>Импорт</span></button><button className="primary" onClick={() => { setAddSection(current.sections[0]?.id || ""); setModal("add"); }}><Icon>＋</Icon><span>Добавить</span></button><button className="round" onClick={() => setModal("share")} aria-label="Поделиться">↗</button></div>
      </header>

      <nav className="tabs"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Список <span>{stats.total}</span></button><button className={view === "split" ? "active" : ""} onClick={() => setView("split")}>Калькулятор</button></nav>

      {view === "list" ? <>
        <section className="progress-card">
          <div><strong>{stats.bought}</strong><span>куплено</span></div><div><strong>{stats.cart}</strong><span>в корзине</span></div><div><strong>{stats.total - stats.bought - stats.cart}</strong><span>осталось</span></div>
          <div className="bar"><i style={{ width: `${stats.total ? stats.bought / stats.total * 100 : 0}%` }}></i><i style={{ width: `${stats.total ? stats.cart / stats.total * 100 : 0}%` }}></i></div>
        </section>
        <div className="toolbar"><label className="search"><Icon>⌕</Icon><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти товар" /></label><button onClick={() => setModal("receipt")}><Icon>▤</Icon> Загрузить чек</button></div>
        <div className="sections">
          {visibleSections.map(section => <section className="department" key={section.id}>
            <div className="department-head"><button className="collapse" onClick={() => setCollapsed(c => { const n = new Set(c); n.has(section.id) ? n.delete(section.id) : n.add(section.id); return n; })}>{collapsed.has(section.id) ? "›" : "⌄"}</button><h2>{section.name}</h2><span>{section.items.filter(i => i.status === "bought").length}/{section.items.length}</span><button className="more" aria-label="Меню отдела">•••</button></div>
            {!collapsed.has(section.id) && <div className="items">{section.items.map(item => <article className={`item ${item.status}`} key={item.id}>
              <input aria-label={`Выбрать ${item.name}`} type="checkbox" checked={selected.has(item.id)} onChange={e => setSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(item.id) : n.delete(item.id); return n; })} />
              <button className={`status ${item.status}`} onClick={() => cycleStatus(item.id)} aria-label="Изменить статус">{item.status === "bought" ? "✓" : item.status === "cart" ? "▣" : ""}</button>
              <div className="item-name"><strong>{item.name}</strong><small>{item.status === "planned" ? "Нужно купить" : item.status === "cart" ? "В корзине" : item.price ? formatMoney(item.price) : "Куплено"}</small></div>
              <div className="stepper"><button onClick={() => changeQty(item.id, -1)}>−</button><span>{item.qty} <small>{item.unit}</small></span><button onClick={() => changeQty(item.id, 1)}>＋</button></div>
            </article>)}</div>}
          </section>)}
          {!visibleSections.length && <div className="no-results">Ничего не найдено</div>}
        </div>
      </> : <SplitView list={current} people={people} setPeople={setPeople} mutate={mutate} />}
    </main>

    <nav className="mobile-nav"><button className="active" onClick={() => setView("list")}><Icon>☷</Icon>Список</button><button onClick={() => { setAddSection(current.sections[0]?.id || ""); setModal("add"); }}><Icon>＋</Icon>Добавить</button><button onClick={() => setView("split")}><Icon>÷</Icon>Разделить</button><button onClick={() => setModal("share")}><Icon>↗</Icon>Поделиться</button></nav>

    {selected.size > 0 && <div className="bulk"><b>Выбрано: {selected.size}</b><button onClick={() => setStatus(selected, "cart")}>▣ В корзину</button><button onClick={() => setStatus(selected, "bought")}>✓ Куплено</button><button onClick={() => setStatus(selected, "planned")}>↶ Вернуть</button><button className="close" onClick={() => setSelected(new Set())}>×</button></div>}
    {toast && <div className="toast">✓ {toast}</div>}

    {modal && <div className="modal-backdrop" onMouseDown={e => e.currentTarget === e.target && setModal(null)}><div className="modal" role="dialog" aria-modal="true">
      <button className="modal-close" onClick={() => setModal(null)}>×</button>
      {modal === "import" && <><span className="modal-icon">⇩</span><h2>Импорт списка</h2><p>Вставьте текст со строками «Отдел …» и товарами, начинающимися с маркера •.</p><textarea className="large" value={importText} onChange={e => setImportText(e.target.value)} placeholder={'Список покупок Глобус\n\nОтдел Хлеб\n• Хлеб тостовый, - 1 шт.'} /><button className="primary wide" onClick={importList}>Распознать и импортировать</button></>}
      {modal === "add" && <><span className="modal-icon">＋</span><h2>Добавить товары</h2><p>Один товар на строку. Количество можно написать через тире.</p><label>Отдел<select value={addSection} onChange={e => setAddSection(e.target.value)}>{current.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><textarea value={addText} onChange={e => setAddText(e.target.value)} placeholder={'Молоко — 2 шт.\nСметана — 1 уп.'} /><button className="primary wide" onClick={addItems}>Добавить товары</button></>}
      {modal === "receipt" && <><span className="modal-icon">▤</span><h2>Сверить с чеком</h2><p>Вставьте позиции чека вместе с ценами. Складно найдёт совпадения, добавит цены и отметит покупки.</p><textarea className="large" value={receiptText} onChange={e => setReceiptText(e.target.value)} placeholder={'Хлеб тостовый Harrys 169,99\nЛаваш Армянский 119,99'} /><button className="primary wide" onClick={applyReceipt}>Сопоставить позиции</button></>}
      {modal === "share" && <><span className="modal-icon">↗</span><h2>Поделиться списком</h2><p>В ссылку попадёт только «{current.name}». Остальные списки останутся приватными.</p><div className="share-code">{current.roomId}<span>Секретный код списка</span></div><button className="primary wide" onClick={share}>Скопировать ссылку</button><small className="hint">Без облачной синхронизации ссылка содержит безопасную копию текущего списка.</small></>}
      {modal === "lists" && <ListManager store={store} setStore={setStore} current={current} newListName={newListName} setNewListName={setNewListName} close={() => setModal(null)} flash={flash} />}
    </div></div>}
  </div>;
}

function SplitView({ list, people, setPeople, mutate }: { list: ShoppingList; people: number; setPeople: (n: number) => void; mutate: (fn: (l: ShoppingList) => ShoppingList) => void }) {
  const bought = list.sections.flatMap(s => s.items).filter(i => i.status === "bought");
  const selected = bought.filter(i => i.checked !== false);
  const sum = selected.reduce((n, i) => n + (i.price || 0), 0);
  const toggle = (id: string) => mutate(l => ({ ...l, sections: l.sections.map(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, checked: i.checked === false } : i) })) }));
  return <div className="split-view"><div className="split-summary"><span>Итого к разделению</span><strong>{formatMoney(sum)}</strong><div className="people"><button onClick={() => setPeople(Math.max(1, people - 1))}>−</button><span><b>{people}</b> человек</span><button onClick={() => setPeople(people + 1)}>＋</button></div><div className="per-person"><span>С каждого</span><b>{formatMoney(sum / Math.max(people, 1))}</b></div></div><section className="calculator-list"><h2>Купленные товары <span>{selected.length} выбрано</span></h2>{bought.length ? bought.map(i => <label key={i.id}><input type="checkbox" checked={i.checked !== false} onChange={() => toggle(i.id)} /><span>{i.name}</span><input className="price" inputMode="decimal" value={i.price || ""} placeholder="0,00" onChange={e => mutate(l => ({ ...l, sections: l.sections.map(s => ({ ...s, items: s.items.map(x => x.id === i.id ? { ...x, price: Number(e.target.value.replace(",", ".")) || 0 } : x) })) }))} /><b>₽</b></label>) : <p className="no-results">Сначала отметьте товары как купленные.</p>}</section></div>;
}

function ListManager({ store, setStore, current, newListName, setNewListName, close, flash }: { store: Store; setStore: React.Dispatch<React.SetStateAction<Store>>; current: ShoppingList; newListName: string; setNewListName: (s: string) => void; close: () => void; flash: (s: string) => void }) {
  const create = () => { if (!newListName.trim()) return; const id = uid(); const list: ShoppingList = { id, roomId: `${id}-${uid()}`, name: newListName.trim(), store: "", updatedAt: now(), sections: [{ id: uid(), name: "Общее", items: [] }] }; setStore(s => ({ lists: [...s.lists, list], activeId: id })); setNewListName(""); close(); };
  const remove = (id: string) => { if (store.lists.length === 1) return flash("Нельзя удалить единственный список"); const next = store.lists.filter(l => l.id !== id); setStore({ lists: next, activeId: id === store.activeId ? next[0].id : store.activeId }); };
  const updateSections = (fn: (sections: Section[]) => Section[]) => setStore(s => ({ ...s, lists: s.lists.map(l => l.id === current.id ? { ...l, updatedAt: now(), sections: fn(l.sections) } : l) }));
  const addSection = () => updateSections(sections => [...sections, { id: uid(), name: "Новый отдел", items: [] }]);
  const renameSection = (id: string, name: string) => updateSections(sections => sections.map(section => section.id === id ? { ...section, name: name || "Без названия" } : section));
  const removeSection = (id: string) => {
    if (current.sections.length === 1) return flash("Нельзя удалить единственный отдел");
    updateSections(sections => sections.filter(section => section.id !== id));
  };
  return <>
    <span className="modal-icon">☷</span><h2>Списки и отделы</h2>
    <div className="new-list-row"><input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Название нового списка" onKeyDown={e => e.key === "Enter" && create()} /><button className="primary" onClick={create}>Создать</button></div>
    <div className="manage-lists">{store.lists.map(l => <div key={l.id}><button onClick={() => { setStore(s => ({ ...s, activeId: l.id })); close(); }}><b>{l.name}</b><small>{l.sections.length} отделов</small></button><button className="trash" onClick={() => remove(l.id)} aria-label={`Удалить ${l.name}`}>×</button></div>)}</div>
    <h3 className="manage-title">Отделы в «{current.name}»</h3>
    <div className="manage-sections">{current.sections.map(section => <div key={section.id}><input value={section.name} onChange={e => renameSection(section.id, e.target.value)} aria-label="Название отдела" /><button className="trash" onClick={() => removeSection(section.id)} aria-label={`Удалить ${section.name}`}>×</button></div>)}</div>
    <button className="secondary wide" onClick={addSection}>＋ Добавить отдел</button>
  </>;
}
