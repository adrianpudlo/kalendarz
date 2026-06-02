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

  // 1. Strip markdown fences
  let s = raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();

  // 2. Direct parse
  try { return JSON.parse(s); } catch {}

  // 3. Find outermost { ... }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b+1)); } catch {} }

  // 4. Find outermost [ ... ] (if model returned bare array)
  const c = s.indexOf("["), d = s.lastIndexOf("]");
  if (c !== -1 && d > c) {
    try { return { events: JSON.parse(s.slice(c, d+1)) }; } catch {}
  }

  // 5. Fallback: extract individual {...} objects line by line
  const objects = [];
  let depth = 0, buf = "", inObj = false;
  for (const ch of s) {
    if (ch === "{") { depth++; inObj = true; }
    if (inObj) buf += ch;
    if (ch === "}") {
      depth--;
      if (depth === 0 && inObj) {
        try {
          const obj = JSON.parse(buf);
          if (obj.id || obj.title) objects.push(obj);
        } catch {}
        buf = ""; inObj = false;
      }
    }
  }
  if (objects.length > 0) return { events: objects };

  console.error("RAW RESPONSE (first 800 chars):", raw.slice(0, 800));
  throw new Error("Błąd parsowania JSON. Odpowiedź modelu: " + raw.slice(0, 120));
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function callClaude(messages, opts = {}) {
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: opts.max_tokens || 8000,
    messages,
  };
  if (opts.system) body.system = opts.system;
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error || data?.anthropic_type || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
}

// ─── PROMPT ───────────────────────────────────────────────────────────────────

function buildPrompt(monthPL, year, days) {
  return `Jesteś redaktorem portalu zero.pl, który szuka tematów do angażujących artykułów narracyjnych. Styl portalu: głębokie, wciągające teksty o ludziach i zdarzeniach — dramat, paradoks, zaskoczenie, historia z puentą.

Wygeneruj 60-70 tematów na ${monthPL} ${year}, które mają POTENCJAŁ NA DOBRY ARTYKUŁ dla takiego portalu.

ZASADY DAT — KRYTYCZNE: Podawaj TYLKO daty co do których jesteś absolutnie pewny. Jeśli nie pamiętasz dokładnego dnia zdarzenia w tym miesiącu — POMIŃ ten temat, nie zgaduj. Przykład błędu którego NIE wolno popełniać: Wałęsa urodził się 29 września, nie w czerwcu.

SELEKCJA — tylko tematy z potencjałem narracyjnym:
- dramat, paradoks lub nieoczywista historia
- coś czego czytelnik nie wiedział
- postać lub zdarzenie które rezonuje emocjonalnie

ZASADY:
- Zmarli: rocznice śmierci LUB urodziny TYLKO okrągłe (50,75,100,125,150 lat)
- Żyjący: urodziny tylko jeśli ciekawa historia
- Minimum 4 tematy z każdej kategorii
- Dzień: liczba całkowita 1–${days}

JĘZYK: Wszystko po polsku. Tytuł max 8 słów. Subtitle: 1-2 zdania — konkretny dramat lub paradoks, nie suchy fakt.

Kategorie: urodziny, smierc, wydarzenie, polska, sport, polityka, wybory, katastrofa, nauka, kultura, ciekawostka

Tylko JSON, zero tekstu poza JSON:
{"events":[{"id":"slug","day":1,"title":"Tytuł po polsku","subtitle":"Opis po polsku","category":"kategoria","anniversary":"np. 50 lat lub null"}]}`;
}

// ─── FETCH EVENTS ─────────────────────────────────────────────────────────────

async function fetchEvents(year, month) {
  const days = new Date(year, month, 0).getDate();
  const prompt = buildPrompt(MONTHS_PL[month-1], year, days);

  let text, parsed;
  for (let attempt = 1; attempt <= 2; attempt++) {
    text = await callClaude(
      [{ role:"user", content: prompt }],
      {
        max_tokens: 7000,
        system: "Odpowiadasz WYŁĄCZNIE poprawnym JSON. Zero tekstu przed JSON ani po nim. Zero markdown. Żadnych wstępów ani komentarzy. Tylko surowy JSON zaczynający się od { i kończący na }.",
      }
    );
    try {
      parsed = extractJSON(text);
      break;
    } catch(e) {
      if (attempt === 2) throw e;
      console.warn("Attempt 1 parse failed, retrying…");
    }
  }

  const evs = parsed.events || parsed;
  if (!Array.isArray(evs) || !evs.length) throw new Error("Pusta lista zdarzeń");
  const maxDay = new Date(year, month, 0).getDate();
  return evs
    .filter(e => e && e.title && CAT_KEYS.includes(e.category))
    .map((e, i) => ({
      id: e.id || `ev-${i}`,
      day: Math.min(Math.max(parseInt(e.day)||1, 1), maxDay),
      title: String(e.title).slice(0, 80),
      subtitle: String(e.subtitle||"").slice(0, 300),
      category: e.category,
      anniversary: e.anniversary || null,
    }));
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const today = new Date();
  const [year,    setYear]    = useState(today.getFullYear());
  const [month,   setMonth]   = useState(today.getMonth()+1);
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [filters, setFilters] = useState(new Set(CAT_KEYS));
  const [view,    setView]    = useState("calendar");
  const [tooltip, setTooltip] = useState(null); // {ev, x, y}
  const [meta,    setMeta]    = useState({});

  const ym = `${year}-${String(month).padStart(2,"0")}`;

  const loadMonth = useCallback(async (force=false) => {
    setLoading(true); setLoadErr(""); setLoadMsg("Ładuję…");
    try {
      const m      = stor.get("meta:gen") || {};
      const stored = stor.get(`ev:${ym}`);
      if (stored?.length && !force) {
        setEvents(stored); setMeta(m); setLoading(false); return;
      }
      setLoadMsg(`Generuję ${MONTHS_PL[month-1]} ${year}…`);
      const evs = await fetchEvents(year, month);
      stor.set(`ev:${ym}`, evs);
      m[ym] = new Date().toISOString();
      stor.set("meta:gen", m);
      setMeta({...m}); setEvents(evs);
    } catch(e) {
      console.error(e);
      setLoadErr(`Błąd: ${e.message}`);
    }
    setLoading(false);
  }, [ym, year, month]);

  useEffect(() => { setEvents([]); loadMonth(); }, [loadMonth]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = (new Date(year, month-1, 1).getDay()+6)%7;

  const byDay = {};
  events.filter(e=>filters.has(e.category)).forEach(e=>{
    (byDay[e.day] = byDay[e.day]||[]).push(e);
  });

  const nav = dir => {
    let m=month+dir, y=year;
    if(m>12){m=1;y++;} if(m<1){m=12;y--;}
    setMonth(m); setYear(y); setTooltip(null);
  };

  const toggleF = k => setFilters(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n; });
  const sorted = events.filter(e=>filters.has(e.category)).sort((a,b)=>a.day-b.day);
  const total  = events.filter(e=>filters.has(e.category)).length;

  const showTooltip = (ev, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ ev, x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div style={{ minHeight:"100vh", background:"#F8F7F4", color:"#1A1A1A",
      fontFamily:"Georgia,'Times New Roman',serif" }}
      onClick={()=>setTooltip(null)}>

      {/* HEADER */}
      <header style={{ background:"#fff", borderBottom:"1.5px solid #E5E3DE",
        padding:"13px 22px 11px", display:"flex", alignItems:"center",
        justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ display:"flex", alignItems:"baseline", gap:9 }}>
            <span style={{ fontSize:10, letterSpacing:".2em", textTransform:"uppercase",
              color:"#DC2626", fontFamily:"monospace", fontWeight:700 }}>zero.pl</span>
            <h1 style={{ fontSize:19, fontWeight:700, letterSpacing:"-.02em", margin:0, color:"#111" }}>
              Planer Tematów
            </h1>
          </div>
          <p style={{ fontSize:10, color:"#AAA", margin:"2px 0 0", fontFamily:"monospace" }}>
            {meta[ym] ? `${total} tematów` : "brak danych"} · {MONTHS_PL[month-1]} {year}
          </p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <NavBtn onClick={()=>nav(-1)}>‹</NavBtn>
          <span style={{ fontSize:15, fontWeight:700, color:"#111", minWidth:140, textAlign:"center" }}>
            {MONTHS_PL[month-1]} {year}
          </span>
          <NavBtn onClick={()=>nav(1)}>›</NavBtn>
          <div style={{ width:1, height:22, background:"#E5E3DE", margin:"0 2px" }}/>
          <NavBtn onClick={()=>loadMonth(true)} disabled={loading} title="Regeneruj ten miesiąc">↻</NavBtn>
          <NavBtn onClick={()=>setView(v=>v==="calendar"?"list":"calendar")}
            style={{ fontFamily:"monospace", fontSize:12 }}>
            {view==="calendar"?"≡":"▦"}
          </NavBtn>
          <div style={{ width:1, height:22, background:"#E5E3DE", margin:"0 2px" }}/>
          <button
            title="Wyczyść wszystkie zapisane dane"
            onClick={()=>{
              if(window.confirm("Wyczyścić cały cache? Wszystkie miesiące zostaną wygenerowane od nowa.")) {
                localStorage.clear();
                window.location.reload();
              }
            }}
            style={{ background:"transparent", border:"1px solid #E5E3DE",
              color:"#BBB", padding:"0 8px", height:30, borderRadius:3,
              cursor:"pointer", fontSize:9, fontFamily:"monospace",
              letterSpacing:".05em", whiteSpace:"nowrap" }}>
            WYCZYŚĆ CACHE
          </button>
        </div>
      </header>

      {/* FILTERS */}
      <div style={{ background:"#fff", padding:"7px 22px 9px",
        borderBottom:"1px solid #EDEDEA", display:"flex", gap:4, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:9, color:"#CCC", fontFamily:"monospace", letterSpacing:".1em", marginRight:3 }}>FILTR</span>
        {CAT_KEYS.map(k=>{
          const c=CATEGORIES[k], on=filters.has(k);
          const cnt = events.filter(e=>e.category===k).length;
          return (
            <button key={k} onClick={e=>{e.stopPropagation();toggleF(k);}} style={{
              background:on?c.bg:"transparent",
              border:`1px solid ${on?c.color+"55":"#E5E3DE"}`,
              borderRadius:3, color:on?c.color:"#CCC",
              padding:"2px 7px", fontSize:10, cursor:"pointer",
              fontFamily:"monospace", transition:"all .1s",
            }}>
              {c.label}{cnt>0 ? <span style={{ opacity:.6, marginLeft:3 }}>{cnt}</span> : null}
            </button>
          );
        })}
        <button onClick={e=>{e.stopPropagation();setFilters(new Set(CAT_KEYS));}} style={{
          marginLeft:"auto", background:"transparent", border:"1px solid #E5E3DE",
          color:"#CCC", padding:"2px 7px", fontSize:9, cursor:"pointer",
          fontFamily:"monospace", borderRadius:3,
        }}>Wszystkie</button>
      </div>

      {/* LOADING */}
      {loading && <LoadingProgress msg={loadMsg} />}

      {/* ERROR */}
      {!loading && loadErr && (
        <div style={{ padding:"24px 22px", textAlign:"center",
          fontFamily:"monospace", fontSize:12, color:"#DC2626" }}>
          {loadErr}
          <button onClick={()=>loadMonth(true)} style={{ marginLeft:12,
            background:"transparent", border:"1px solid #DC2626", color:"#DC2626",
            padding:"3px 10px", borderRadius:3, cursor:"pointer",
            fontFamily:"monospace", fontSize:11 }}>↻ Spróbuj ponownie</button>
        </div>
      )}

      {/* CALENDAR */}
      {!loading && !loadErr && view==="calendar" && (
        <div style={{ padding:"14px 22px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:3 }}>
            {DAYS_PL.map(d=>(
              <div key={d} style={{ textAlign:"center", fontSize:9, fontFamily:"monospace",
                color:"#CCC", letterSpacing:".06em", padding:"3px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
            {Array.from({length:startOffset}).map((_,i)=><div key={`x${i}`} style={{ minHeight:90 }}/>)}
            {Array.from({length:daysInMonth}).map((_,i)=>{
              const day=i+1, evs=byDay[day]||[];
              const isToday=day===today.getDate()&&month===today.getMonth()+1&&year===today.getFullYear();
              return (
                <div key={day} onClick={e=>e.stopPropagation()} style={{
                  minHeight:90, background:isToday?"#FFFBEB":"#fff",
                  border:`1px solid ${isToday?"#FCD34D":"#EDEDEA"}`,
                  borderRadius:3, padding:"5px 5px" }}>
                  <div style={{ fontSize:10, fontFamily:"monospace", marginBottom:3,
                    color:isToday?"#D97706":"#CCC", fontWeight:isToday?700:400 }}>{day}</div>
                  {evs.slice(0,4).map(ev=>(
                    <Chip key={ev.id} ev={ev}
                      onClick={e=>{ e.stopPropagation(); showTooltip(ev,e); }}/>
                  ))}
                  {evs.length>4 && (
                    <div style={{ fontSize:9, color:"#CCC", fontFamily:"monospace",
                      paddingLeft:3, cursor:"default" }}>+{evs.length-4}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LIST */}
      {!loading && !loadErr && view==="list" && (
        <div style={{ padding:"14px 22px", maxWidth:860 }}>
          {!sorted.length && <p style={{ color:"#CCC", fontFamily:"monospace",
            fontSize:12, padding:"30px 0" }}>Brak tematów dla wybranych filtrów.</p>}
          {sorted.map(ev=><Row key={ev.id} ev={ev}/>)}
        </div>
      )}

      {/* TOOLTIP */}
      {tooltip && <Tooltip data={tooltip} onClose={()=>setTooltip(null)}/>}
    </div>
  );
}

// ─── CHIP ─────────────────────────────────────────────────────────────────────

function Chip({ev, onClick}) {
  const c = CATEGORIES[ev.category]||CATEGORIES.wydarzenie;
  return (
    <div onClick={onClick} title={ev.title} style={{
      background:c.bg, borderLeft:`2px solid ${c.color}`,
      padding:"1px 4px", fontSize:9, color:c.color,
      borderRadius:"0 2px 2px 0", whiteSpace:"nowrap",
      overflow:"hidden", textOverflow:"ellipsis",
      cursor:"pointer", fontFamily:"monospace",
      lineHeight:1.45, marginBottom:2,
    }}>{ev.title}</div>
  );
}

// ─── ROW (list view) ──────────────────────────────────────────────────────────

function Row({ev}) {
  const c = CATEGORIES[ev.category]||CATEGORIES.wydarzenie;
  return (
    <div style={{ display:"flex", gap:12, padding:"10px 0",
      borderBottom:"1px solid #F0EEEB", alignItems:"flex-start" }}>
      <div style={{ minWidth:28, fontSize:17, fontWeight:700, color:"#DDD",
        fontFamily:"monospace", textAlign:"right", paddingTop:1 }}>{ev.day}</div>
      <div style={{ width:3, alignSelf:"stretch", background:c.color,
        borderRadius:2, flexShrink:0, minHeight:28 }}/>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:13, fontWeight:600, color:"#111" }}>{ev.title}</span>
          {ev.anniversary && (
            <span style={{ fontSize:9, fontFamily:"monospace", color:c.color,
              background:c.bg, border:`1px solid ${c.color}44`,
              padding:"1px 5px", borderRadius:2 }}>{ev.anniversary}</span>
          )}
          <span style={{ fontSize:9, fontFamily:"monospace", color:c.color+"99" }}>{c.label}</span>
        </div>
        <div style={{ fontSize:11, color:"#777", marginTop:2, lineHeight:1.5 }}>{ev.subtitle}</div>
      </div>
    </div>
  );
}

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────

function Tooltip({data, onClose}) {
  const {ev, x, y} = data;
  const c = CATEGORIES[ev.category]||CATEGORIES.wydarzenie;
  const ref = useRef(null);

  useEffect(()=>{
    if(!ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    if(box.right > vw-8) {
      ref.current.style.left = Math.max(8, vw - box.width - 8) + "px";
    }
  },[]);

  return (
    <div ref={ref} onClick={e=>e.stopPropagation()} style={{
      position:"fixed", left:x, top:y, zIndex:300,
      background:"#fff", border:`1.5px solid ${c.color}55`,
      borderRadius:6, padding:"11px 14px", maxWidth:300,
      boxShadow:"0 4px 24px #00000018", fontFamily:"Georgia,serif",
    }}>
      <div style={{ fontSize:9, fontFamily:"monospace", color:c.color,
        letterSpacing:".1em", marginBottom:4 }}>
        {c.label.toUpperCase()}{ev.anniversary ? ` · ${ev.anniversary}` : ""}
      </div>
      <div style={{ fontSize:14, fontWeight:700, color:"#111",
        lineHeight:1.3, marginBottom:6 }}>{ev.title}</div>
      <div style={{ fontSize:12, color:"#666", lineHeight:1.55 }}>{ev.subtitle}</div>
      <button onClick={onClose} style={{ position:"absolute", top:6, right:8,
        background:"none", border:"none", color:"#CCC",
        fontSize:16, cursor:"pointer", lineHeight:1 }}>×</button>
    </div>
  );
}

// ─── LOADING PROGRESS ─────────────────────────────────────────────────────────

function LoadingProgress({ msg }) {
  const TOTAL = 90;
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
  useEffect(()=>{
    const t = setInterval(()=>setElapsed(Math.floor((Date.now()-start.current)/1000)),500);
    return ()=>clearInterval(t);
  },[]);
  const pct = Math.min(95, Math.round(100*(1-Math.exp(-3.5*elapsed/TOTAL))));
  const step = [...STEPS].reverse().find(s=>elapsed>=s.at)?.text || STEPS[0].text;
  const mins = Math.floor(elapsed/60), secs = elapsed%60;
  const time = mins>0 ? `${mins}:${String(secs).padStart(2,"0")} min` : `${secs} sek`;
  return (
    <div style={{ padding:"50px 22px 30px", maxWidth:460, margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"baseline", marginBottom:9 }}>
        <div style={{ fontSize:11, fontFamily:"monospace", color:"#555", fontWeight:600 }}>
          Generowanie tematów
        </div>
        <div style={{ fontSize:10, fontFamily:"monospace", color:"#AAA" }}>{time}</div>
      </div>
      <div style={{ height:5, background:"#EDEDEA", borderRadius:3,
        overflow:"hidden", marginBottom:11 }}>
        <div style={{ height:"100%", width:`${pct}%`,
          background:"linear-gradient(90deg,#2563EB,#7C3AED)",
          borderRadius:3, transition:"width .5s ease" }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between" }}>
        <div style={{ fontSize:10, fontFamily:"monospace", color:"#999" }}>
          <Spinner/> {step}
        </div>
        <div style={{ fontSize:11, fontFamily:"monospace",
          color:"#2563EB", fontWeight:600 }}>{pct}%</div>
      </div>
      {elapsed>80 && (
        <div style={{ marginTop:16, fontSize:10, fontFamily:"monospace",
          color:"#CCC", textAlign:"center", lineHeight:1.6 }}>
          API jest teraz wolne — poczekaj lub kliknij ↻
        </div>
      )}
    </div>
  );
}

// ─── MICRO ────────────────────────────────────────────────────────────────────

function NavBtn({children,onClick,disabled,title,style={}}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      background:"#fff", border:"1px solid #E5E3DE", color:"#777",
      width:30, height:30, borderRadius:3, cursor:disabled?"default":"pointer",
      fontSize:16, display:"flex", alignItems:"center", justifyContent:"center",
      opacity:disabled?0.4:1, ...style,
    }}>{children}</button>
  );
}

function Spinner() {
  const [f,setF]=useState(0);
  const fr=["◐","◓","◑","◒"];
  useEffect(()=>{const t=setInterval(()=>setF(x=>(x+1)%4),150);return()=>clearInterval(t);},[]);
  return <span style={{ fontFamily:"monospace" }}>{fr[f]}</span>;
}
