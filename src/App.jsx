import { useState, useEffect, useCallback, useRef } from "react";

const CATEGORIES = {
  urodziny:    { label: "Urodziny",          color: "#2563EB", bg: "#EFF6FF" },
  smierc:      { label: "Rocznica śmierci",  color: "#DC2626", bg: "#FEF2F2" },
  wydarzenie:  { label: "Wydarzenie hist.",   color: "#16A34A", bg: "#F0FDF4" },
  polska:      { label: "Polska",            color: "#D97706", bg: "#FFFBEB" },
  sport:       { label: "Sport / Event",     color: "#7C3AED", bg: "#F5F3FF" },
  polityka:    { label: "Polityka / Szczyt", color: "#DB2777", bg: "#FDF2F8" },
  wybory:      { label: "Wybory",            color: "#0891B2", bg: "#ECFEFF" },
  katastrofa:  { label: "Katastrofa",        color: "#EA580C", bg: "#FFF7ED" },
  nauka:       { label: "Nauka / Tech",      color: "#059669", bg: "#ECFDF5" },
  kultura:     { label: "Kultura / Film",    color: "#C2410C", bg: "#FFF7ED" },
  ciekawostka: { label: "Ciekawostka",       color: "#6D28D9", bg: "#F5F3FF" },
};
const CAT_KEYS  = Object.keys(CATEGORIES);
const MONTHS_PL = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
                   "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
const DAYS_PL   = ["Pn","Wt","Śr","Cz","Pt","Sb","Nd"];

// ─── STORAGE ─────────────────────────────────────────────────────────────────

const stor = {
  get(k)    { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── JSON EXTRACTOR ───────────────────────────────────────────────────────────

function extractJSON(raw) {
  if (!raw) throw new Error("Pusta odpowiedź");
  let s = raw.replace(/^```json\s*/i, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();

  try { return JSON.parse(s); } catch {}

  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }

  const c = s.indexOf("["), d = s.lastIndexOf("]");
  if (c !== -1 && d > c) { try { return { events: JSON.parse(s.slice(c, d + 1)) }; } catch {} }

  // Last resort: extract individual objects
  const objects = [];
  let depth = 0, buf = "", inObj = false;
  for (const ch of s) {
    if (ch === "{") { depth++; inObj = true; }
    if (inObj) buf += ch;
    if (ch === "}") {
      depth--;
      if (depth === 0 && inObj) {
        try { const o = JSON.parse(buf); if (o.title) objects.push(o); } catch {}
        buf = ""; inObj = false;
      }
    }
  }
  if (objects.length > 0) return { events: objects };

  console.error("Nieparsowalna odpowiedź:", raw.slice(0, 500));
  throw new Error("Zły format odpowiedzi: " + raw.slice(0, 80));
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function callClaude(userMessage) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: "Jesteś generatorem danych JSON. Twoja odpowiedź MUSI zaczynać się znakiem { i kończyć znakiem }. Absolutnie żadnych bloków ```json```. Żadnego tekstu przed ani po JSON. Tylko surowy JSON zaczynający się od znaku {.",
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
}

// ─── PROMPT ──────────────────────────────────────────────────────────────────

function buildPrompt(monthPL, year, days) {
  return `Wygeneruj 80-90 rocznic i wydarzeń na ${monthPL} ${year}.

ZASADY DAT — KRYTYCZNE: Tylko daty co do których jesteś pewny. Jeśli nie znasz dokładnego dnia — pomiń. Nie zgaduj.

ZASADY:
- Tytuł to SUCHY FAKT, nie temat artykułu. Przykłady:
  "48. urodziny Meryl Streep"
  "17. rocznica premiery Ojca Chrzestnego"
  "100. rocznica śmierci Lenina"
  "Finał NBA 2026"
  "25 lat od katastrofy Concorde"
- Subtitle: jedno zdanie — kim jest ta osoba lub czym było to wydarzenie. Bez dramatyzowania.
- Zmarli: rocznice śmierci (dowolne, szczególnie okrągłe) LUB urodziny TYLKO okrągłe (50,75,100,125,150 lat)
- Żyjący: urodziny jeśli znana postać (min. 40 lat)
- Min. 5 tematów z każdej kategorii, dzień: 1–${days}
- Kategorie: urodziny, smierc, wydarzenie, polska, sport, polityka, wybory, katastrofa, nauka, kultura, ciekawostka
- Szeroki zakres: politycy, sportowcy, aktorzy, muzycy, pisarze, naukowcy, wynalazcy, przestępcy, ofiary, odkrycia, premiery filmów i albumów, rekordy, pierwsze razy w historii

Format JSON:
{"events":[{"id":"slug","day":1,"title":"Tytuł — suchy fakt","subtitle":"Kim jest lub czym było","category":"kategoria","anniversary":"50 lat lub null"}]}`;
}

// ─── FETCH ────────────────────────────────────────────────────────────────────

async function fetchEvents(year, month) {
  const days = new Date(year, month, 0).getDate();
  const prompt = buildPrompt(MONTHS_PL[month - 1], year, days);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await callClaude(prompt);
      const parsed = extractJSON(text);
      const evs = parsed.events || parsed;
      if (!Array.isArray(evs) || !evs.length) throw new Error("Pusta lista");
      const maxDay = new Date(year, month, 0).getDate();
      return evs
        .filter(e => e && e.title && CAT_KEYS.includes(e.category))
        .map((e, i) => ({
          id: e.id || `ev-${i}`,
          day: Math.min(Math.max(parseInt(e.day) || 1, 1), maxDay),
          title: String(e.title).slice(0, 80),
          subtitle: String(e.subtitle || "").slice(0, 300),
          category: e.category,
          anniversary: e.anniversary || null,
        }));
    } catch (e) {
      if (attempt === 2) throw e;
      console.warn("Próba 1 nieudana, ponawiam…", e.message);
    }
  }
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const today = new Date();
  const [year,    setYear]    = useState(today.getFullYear());
  const [month,   setMonth]   = useState(today.getMonth() + 1);
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [filters, setFilters] = useState(new Set(CAT_KEYS));
  const [view,    setView]    = useState("calendar");
  const [tooltip, setTooltip] = useState(null);
  const [meta,    setMeta]    = useState({});

  const ym = `${year}-${String(month).padStart(2, "0")}`;

  const loadMonth = useCallback(async (force = false) => {
    setLoading(true); setLoadErr(""); setLoadMsg("Ładuję…");
    try {
      const m = stor.get("meta:gen") || {};
      const stored = stor.get(`ev:${ym}`);
      if (stored?.length && !force) {
        setEvents(stored); setMeta(m); setLoading(false); return;
      }
      setLoadMsg(`Generuję ${MONTHS_PL[month - 1]} ${year}…`);
      const evs = await fetchEvents(year, month);
      stor.set(`ev:${ym}`, evs);
      m[ym] = new Date().toISOString();
      stor.set("meta:gen", m);
      setMeta({ ...m }); setEvents(evs);
    } catch (e) {
      console.error(e);
      setLoadErr(`Błąd: ${e.message}`);
    }
    setLoading(false);
  }, [ym, year, month]);

  useEffect(() => { setEvents([]); loadMonth(); }, [loadMonth]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  const byDay = {};
  events.filter(e => filters.has(e.category)).forEach(e => {
    (byDay[e.day] = byDay[e.day] || []).push(e);
  });

  const nav = dir => {
    let m = month + dir, y = year;
    if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; }
    setMonth(m); setYear(y); setTooltip(null);
  };

  const toggleF = k => setFilters(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const sorted = events.filter(e => filters.has(e.category)).sort((a, b) => a.day - b.day);
  const total  = events.filter(e => filters.has(e.category)).length;

  const showTip = (ev, e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setTooltip({ ev, x: r.left, y: r.bottom + 4 });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8F7F4", color: "#1A1A1A",
      fontFamily: "Georgia,'Times New Roman',serif", maxWidth: 1200, margin: "0 auto" }}
      onClick={() => setTooltip(null)}>

      {/* HEADER */}
      <header style={{ background: "#fff", borderBottom: "1.5px solid #E5E3DE",
        padding: "11px 16px 10px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span style={{ fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase",
              color: "#DC2626", fontFamily: "monospace", fontWeight: 700 }}>zero.pl</span>
            <h1 style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", margin: 0, color: "#111" }}>
              Planer Tematów
            </h1>
          </div>
          <p style={{ fontSize: 10, color: "#AAA", margin: "2px 0 0", fontFamily: "monospace" }}>
            {meta[ym] ? `${total} tematów` : "brak danych"} · {MONTHS_PL[month - 1]} {year}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <NavBtn onClick={() => nav(-1)}>‹</NavBtn>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111", minWidth: 140, textAlign: "center" }}>
            {MONTHS_PL[month - 1]} {year}
          </span>
          <NavBtn onClick={() => nav(1)}>›</NavBtn>
          <Sep />
          <NavBtn onClick={() => loadMonth(true)} disabled={loading} title="Regeneruj ten miesiąc">↻</NavBtn>
          <NavBtn onClick={() => setView(v => v === "calendar" ? "list" : "calendar")}
            style={{ fontFamily: "monospace", fontSize: 12 }}>
            {view === "calendar" ? "≡" : "▦"}
          </NavBtn>
          <Sep />
          <button
            title="Wyczyść wszystkie zapisane dane"
            onClick={() => {
              if (window.confirm("Wyczyścić cały cache? Wszystkie miesiące zostaną wygenerowane od nowa.")) {
                localStorage.clear(); window.location.reload();
              }
            }}
            style={{ background: "transparent", border: "1px solid #E5E3DE", color: "#BBB",
              padding: "0 8px", height: 30, borderRadius: 3, cursor: "pointer",
              fontSize: 9, fontFamily: "monospace", letterSpacing: ".05em", whiteSpace: "nowrap" }}>
            WYCZYŚĆ CACHE
          </button>
        </div>
      </header>

      {/* FILTERS */}
      <div style={{ background: "#fff", padding: "6px 16px 8px", borderBottom: "1px solid #EDEDEA",
        display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#CCC", fontFamily: "monospace",
          letterSpacing: ".1em", marginRight: 3 }}>FILTR</span>
        {CAT_KEYS.map(k => {
          const c = CATEGORIES[k], on = filters.has(k);
          const cnt = events.filter(e => e.category === k).length;
          return (
            <button key={k} onClick={e => { e.stopPropagation(); toggleF(k); }} style={{
              background: on ? c.bg : "transparent",
              border: `1px solid ${on ? c.color + "55" : "#E5E3DE"}`,
              borderRadius: 3, color: on ? c.color : "#CCC",
              padding: "2px 7px", fontSize: 10, cursor: "pointer",
              fontFamily: "monospace", transition: "all .1s",
            }}>
              {c.label}{cnt > 0 && <span style={{ opacity: .6, marginLeft: 3 }}>{cnt}</span>}
            </button>
          );
        })}
        <button onClick={e => { e.stopPropagation(); setFilters(new Set(CAT_KEYS)); }} style={{
          marginLeft: "auto", background: "transparent", border: "1px solid #E5E3DE",
          color: "#CCC", padding: "2px 7px", fontSize: 9, cursor: "pointer",
          fontFamily: "monospace", borderRadius: 3,
        }}>Wszystkie</button>
      </div>

      {/* LOADING */}
      {loading && <LoadingProgress />}

      {/* ERROR */}
      {!loading && loadErr && (
        <div style={{ padding: "16px 16px", fontFamily: "monospace", fontSize: 12, color: "#DC2626" }}>
          {loadErr}
          <button onClick={() => loadMonth(true)} style={{ marginLeft: 12,
            background: "transparent", border: "1px solid #DC2626", color: "#DC2626",
            padding: "3px 10px", borderRadius: 3, cursor: "pointer",
            fontFamily: "monospace", fontSize: 11 }}>↻ Spróbuj ponownie</button>
        </div>
      )}

      {/* CALENDAR */}
      {!loading && !loadErr && view === "calendar" && (
        <div style={{ padding: "14px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 3 }}>
            {DAYS_PL.map(d => (
              <div key={d} style={{ textAlign: "center", fontSize: 9, fontFamily: "monospace",
                color: "#CCC", letterSpacing: ".06em", padding: "3px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {Array.from({ length: startOffset }).map((_, i) => <div key={`x${i}`} style={{ minHeight: 90 }} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1, evs = byDay[day] || [];
              const isToday = day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();
              return (
                <div key={day} onClick={e => e.stopPropagation()} style={{
                  minHeight: 90, background: isToday ? "#FFFBEB" : "#fff",
                  border: `1px solid ${isToday ? "#FCD34D" : "#EDEDEA"}`,
                  borderRadius: 3, padding: "5px 5px" }}>
                  <div style={{ fontSize: 10, fontFamily: "monospace", marginBottom: 3,
                    color: isToday ? "#D97706" : "#CCC", fontWeight: isToday ? 700 : 400 }}>{day}</div>
                  {evs.slice(0, 4).map(ev => (
                    <Chip key={ev.id} ev={ev} onClick={e => showTip(ev, e)} />
                  ))}
                  {evs.length > 4 && (
                    <div style={{ fontSize: 9, color: "#CCC", fontFamily: "monospace", paddingLeft: 3 }}>
                      +{evs.length - 4}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LIST */}
      {!loading && !loadErr && view === "list" && (
        <div style={{ padding: "12px 16px", maxWidth: "100%" }}>
          {!sorted.length && <p style={{ color: "#CCC", fontFamily: "monospace", fontSize: 12, padding: "30px 0" }}>
            Brak tematów dla wybranych filtrów.</p>}
          {sorted.map(ev => <Row key={ev.id} ev={ev} />)}
        </div>
      )}

      {/* TOOLTIP */}
      {tooltip && <Tooltip data={tooltip} onClose={() => setTooltip(null)} />}
    </div>
  );
}

// ─── CHIP ─────────────────────────────────────────────────────────────────────

function Chip({ ev, onClick }) {
  const c = CATEGORIES[ev.category] || CATEGORIES.wydarzenie;
  return (
    <div onClick={onClick} title={ev.title} style={{
      background: c.bg, borderLeft: `2px solid ${c.color}`,
      padding: "1px 4px", fontSize: 9, color: c.color,
      borderRadius: "0 2px 2px 0", whiteSpace: "nowrap",
      overflow: "hidden", textOverflow: "ellipsis",
      cursor: "pointer", fontFamily: "monospace",
      lineHeight: 1.45, marginBottom: 2,
    }}>{ev.title}</div>
  );
}

// ─── ROW ──────────────────────────────────────────────────────────────────────

function Row({ ev }) {
  const c = CATEGORIES[ev.category] || CATEGORIES.wydarzenie;
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 0",
      borderBottom: "1px solid #F0EEEB", alignItems: "flex-start" }}>
      <div style={{ minWidth: 28, fontSize: 17, fontWeight: 700, color: "#DDD",
        fontFamily: "monospace", textAlign: "right", paddingTop: 1 }}>{ev.day}</div>
      <div style={{ width: 3, alignSelf: "stretch", background: c.color,
        borderRadius: 2, flexShrink: 0, minHeight: 28 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{ev.title}</span>
          {ev.anniversary && (
            <span style={{ fontSize: 9, fontFamily: "monospace", color: c.color,
              background: c.bg, border: `1px solid ${c.color}44`,
              padding: "1px 5px", borderRadius: 2 }}>{ev.anniversary}</span>
          )}
          <span style={{ fontSize: 9, fontFamily: "monospace", color: c.color + "99" }}>{c.label}</span>
        </div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 2, lineHeight: 1.5 }}>{ev.subtitle}</div>
      </div>
    </div>
  );
}

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────

function Tooltip({ data, onClose }) {
  const { ev, x, y } = data;
  const c = CATEGORIES[ev.category] || CATEGORIES.wydarzenie;
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const box = ref.current.getBoundingClientRect();
    if (box.right > window.innerWidth - 8)
      ref.current.style.left = Math.max(8, window.innerWidth - box.width - 8) + "px";
    if (box.bottom > window.innerHeight - 8)
      ref.current.style.top = Math.max(8, y - box.height - 8) + "px";
  }, []);

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: "fixed", left: x, top: y, zIndex: 300,
      background: "#fff", border: `1.5px solid ${c.color}55`,
      borderRadius: 6, padding: "11px 14px", maxWidth: 300,
      boxShadow: "0 4px 24px #00000018", fontFamily: "Georgia,serif",
    }}>
      <div style={{ fontSize: 9, fontFamily: "monospace", color: c.color,
        letterSpacing: ".1em", marginBottom: 4 }}>
        {c.label.toUpperCase()}{ev.anniversary ? ` · ${ev.anniversary}` : ""}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#111",
        lineHeight: 1.3, marginBottom: 6 }}>{ev.title}</div>
      <div style={{ fontSize: 12, color: "#666", lineHeight: 1.55 }}>{ev.subtitle}</div>
      <button onClick={onClose} style={{ position: "absolute", top: 6, right: 8,
        background: "none", border: "none", color: "#CCC", fontSize: 16, cursor: "pointer" }}>×</button>
    </div>
  );
}

// ─── LOADING ─────────────────────────────────────────────────────────────────

function LoadingProgress() {
  const STEPS = [
    { at:  0, text: "Łączę się z AI…" },
    { at:  5, text: "Analizuję miesiąc i rok…" },
    { at: 15, text: "Szukam rocznic i wydarzeń…" },
    { at: 28, text: "Oceniam potencjał tematów…" },
    { at: 42, text: "Dobieram sport, politykę, katastrofy…" },
    { at: 55, text: "Filtruję pod kątem zero.pl…" },
    { at: 68, text: "Składam listę tematów…" },
    { at: 80, text: "Weryfikuję daty…" },
    { at: 88, text: "Już prawie…" },
  ];
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start.current) / 1000)), 500);
    return () => clearInterval(t);
  }, []);
  const pct = Math.min(95, Math.round(100 * (1 - Math.exp(-3.5 * elapsed / 90))));
  const step = [...STEPS].reverse().find(s => elapsed >= s.at)?.text || STEPS[0].text;
  const mins = Math.floor(elapsed / 60), secs = elapsed % 60;
  const time = mins > 0 ? `${mins}:${String(secs).padStart(2, "0")} min` : `${secs} sek`;

  return (
    <div style={{ padding: "50px 22px 30px", maxWidth: 460, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#555", fontWeight: 600 }}>
          Generowanie tematów
        </span>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#AAA" }}>{time}</span>
      </div>
      <div style={{ height: 5, background: "#EDEDEA", borderRadius: 3, overflow: "hidden", marginBottom: 11 }}>
        <div style={{ height: "100%", width: `${pct}%`,
          background: "linear-gradient(90deg,#2563EB,#7C3AED)",
          borderRadius: 3, transition: "width .5s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#999" }}>
          <Spinner /> {step}
        </span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#2563EB", fontWeight: 600 }}>{pct}%</span>
      </div>
      {elapsed > 80 && (
        <p style={{ marginTop: 16, fontSize: 10, fontFamily: "monospace",
          color: "#CCC", textAlign: "center", lineHeight: 1.6 }}>
          API jest teraz wolne — poczekaj lub kliknij ↻
        </p>
      )}
    </div>
  );
}

// ─── MICRO ────────────────────────────────────────────────────────────────────

function NavBtn({ children, onClick, disabled, title, style = {} }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      background: "#fff", border: "1px solid #E5E3DE", color: "#777",
      width: 30, height: 30, borderRadius: 3, cursor: disabled ? "default" : "pointer",
      fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
      opacity: disabled ? 0.4 : 1, ...style,
    }}>{children}</button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 22, background: "#E5E3DE", margin: "0 2px" }} />;
}

function Spinner() {
  const [f, setF] = useState(0);
  const fr = ["◐", "◓", "◑", "◒"];
  useEffect(() => { const t = setInterval(() => setF(x => (x + 1) % 4), 150); return () => clearInterval(t); }, []);
  return <span style={{ fontFamily: "monospace" }}>{fr[f]}</span>;
}
