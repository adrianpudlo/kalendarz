import { useState, useEffect, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

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

const MONTHS_PL = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
                   "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
const MONTHS_EN = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"];
const DAYS_PL   = ["Pn","Wt","Śr","Cz","Pt","Sb","Nd"];
const LANG_FLAGS = { en:"🇬🇧", fr:"🇫🇷", de:"🇩🇪", pl:"🇵🇱", es:"🇪🇸", it:"🇮🇹" };
const CAT_KEYS  = Object.keys(CATEGORIES);

// ─── LOCAL STORAGE (replaces window.storage from claude.ai) ──────────────────

const stor = {
  get(k)    { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── ROBUST JSON EXTRACTOR ───────────────────────────────────────────────────

function extractJSON(raw) {
  if (!raw || typeof raw !== "string") throw new Error("Empty response");
  let s = raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  const aStart = s.indexOf("["), aEnd = s.lastIndexOf("]");
  if (aStart !== -1 && aEnd > aStart) {
    try { return JSON.parse(s.slice(aStart, aEnd + 1)); } catch {}
  }
  throw new Error("Could not parse JSON from response");
}

// ─── API (calls /api/claude proxy) ───────────────────────────────────────────

async function callClaude(messages, opts = {}) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: opts.max_tokens || 8000,
      messages,
      ...(opts.tools ? { tools: opts.tools, tool_choice: { type: "auto" } } : {}),
    }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error || errData?.anthropic_type || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  return { text, raw: data };
}

// ─── PROMPTS ─────────────────────────────────────────────────────────────────

function eventsPrompt(monthPL, monthEN, year, days) {
  return `You are an editorial assistant helping a journalist find story hooks for ${monthPL} (${monthEN}) ${year}.

Generate a list of exactly 60 diverse events for this month. Return ONLY a JSON object — no preamble, no explanation, no markdown fences.

RULES:
- Dead people: use DEATH anniversaries freely; use BIRTH anniversaries ONLY for round numbers (50, 75, 100, 125, 150, 200 years). Never "83 years since birth of Lennon" — instead "45th death anniversary of Lennon".
- Living people: any interesting birthday (min age 40).
- Cover ALL 11 categories, minimum 4 events each.
- Day must be an integer between 1 and ${days}.

CATEGORIES:
urodziny - birthdays of living icons OR round birth anniversaries of historical figures (politicians, athletes, actors, musicians, scientists, inventors, writers)
smierc - death anniversaries (musicians, actors, scientists, politicians, criminals, victims)
wydarzenie - historic events (wars, treaties, revolutions, assassinations, discoveries, moon landing, Berlin Wall)
polska - Polish history (Solidarity, WWII, uprisings, sports milestones, cultural achievements, famous Poles)
sport - scheduled ${year} events (league finals, Grand Slams, World Championships, F1, Olympics) PLUS legendary sports moments anniversaries (famous goals, records, retirements, transfers)
polityka - scheduled ${year} summits (G7, G20, NATO, EU, UN, COP, APEC) PLUS historic summit anniversaries
wybory - presidential or parliamentary elections scheduled in ${year} worldwide — be specific about which country
katastrofa - aviation disasters (Smolensk, Tenerife, Lockerbie, TWA800, Concorde, 9/11), maritime (Titanic, Estonia, Costa Concordia), industrial (Chernobyl, Bhopal, Texas City), earthquakes, floods
nauka - science & tech milestones: DNA, penicillin, Moon landing, Internet, HIV, COVID-19, ChatGPT, first iPhone, Dolly the sheep, Hubble telescope
kultura - round anniversaries of iconic films/albums/TV shows/books/musicals; Oscar ceremonies; famous concert tours; legendary magazine covers
ciekawostka - surprising "firsts": first woman on Everest, first Bitcoin transaction, first selfie from space, Guinness records, Michael Jordan retirement, O.J. Simpson verdict, first Starbucks, first McDonald's in USSR

REQUIRED JSON STRUCTURE:
{"events":[{"id":"slug","day":1,"title":"Short title max 8 words","subtitle":"1-2 sentences: what is dramatic, paradoxical or surprising","category":"category","anniversary":"e.g. 50 years or null","searchQuery":"English query for finding long-form journalism about this topic in NYT Atlantic Guardian"}]}`;
}

const ideasPrompt = (ev, month, year) =>
`Jesteś redaktorem Mr. Y — dziennikarza piszącego narracyjne artykuły: zaczyna od paradoksu → dramatyczne sceny → puenta z dystansem. 8-12 minut czytania.

Temat: ${ev.title}
Data: ${ev.day} ${MONTHS_PL[month-1]} ${year}
Rocznica: ${ev.anniversary || "—"}
Kontekst: ${ev.subtitle}

Wygeneruj DOKŁADNIE 5 różnych pomysłów — każdy to inny kąt na ten sam temat.

Dla każdego pomysłu:
**[numer]. [TYTUŁ — z paradoksem lub zaskoczeniem]**
*Lead:* dwa wciągające zdania
*Kąt:* jedno zdanie — co jest unikalnego w tym podejściu

Pisz po polsku.`;

const articlesPrompt = (ev) =>
`Search the web and find 6-8 high-quality long-form articles about: "${ev.searchQuery || ev.title}"

I need RICH journalism — profiles, investigations, oral histories, retrospectives, deep dives — from: New York Times, The Atlantic, New Yorker, Guardian, BBC, Financial Times, Economist, Le Monde, ESPN, The Ringer, Rolling Stone, Vanity Fair, Washington Post, Der Spiegel, Time, Wired.

NOT short news, Wikipedia, press releases, forums.

After searching, respond with ONLY this JSON:
{"articles":[{"title":"headline","publication":"outlet","url":"https://...","language":"en","description":"one sentence why useful","year":2020}]}`;

// ─── DATA FETCHERS ───────────────────────────────────────────────────────────

async function fetchEvents(year, month) {
  const days = new Date(year, month, 0).getDate();
  const { text } = await callClaude(
    [{ role:"user", content: eventsPrompt(MONTHS_PL[month-1], MONTHS_EN[month-1], year, days) }],
    { max_tokens: 8000 }
  );
  const parsed = extractJSON(text);
  const evs = parsed.events || parsed;
  if (!Array.isArray(evs) || !evs.length) throw new Error("Empty events array");
  const maxDay = new Date(year, month, 0).getDate();
  return evs
    .filter(e => e && e.title && e.category && CAT_KEYS.includes(e.category))
    .map((e, i) => ({
      id: e.id || `ev-${i}`,
      day: Math.min(Math.max(parseInt(e.day)||1, 1), maxDay),
      title: String(e.title).slice(0,80),
      subtitle: String(e.subtitle||"").slice(0,300),
      category: e.category,
      anniversary: e.anniversary || null,
      searchQuery: e.searchQuery || e.title,
    }));
}

async function fetchIdeas(ev, month, year) {
  const { text } = await callClaude(
    [{ role:"user", content: ideasPrompt(ev, month, year) }],
    { max_tokens: 2000 }
  );
  return text;
}

async function fetchArticles(ev) {
  const { text } = await callClaude(
    [{ role:"user", content: articlesPrompt(ev) }],
    { max_tokens: 3000, tools: [{ type:"web_search_20250305", name:"web_search" }] }
  );
  if (!text || text.length < 30) throw new Error("No response");
  const parsed = extractJSON(text);
  const arts = parsed.articles || parsed;
  if (!Array.isArray(arts)) throw new Error("Not an array");
  return arts.filter(a => a.url && a.title);
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
  const [selected,setSelected]= useState(null);
  const [view,    setView]    = useState("calendar");
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
      setLoadMsg(`Generuję ${MONTHS_PL[month-1]} ${year}… (30–60 sek)`);
      const evs = await fetchEvents(year, month);
      stor.set(`ev:${ym}`, evs);
      m[ym] = new Date().toISOString();
      stor.set("meta:gen", m);
      setMeta({...m}); setEvents(evs);
    } catch(e) {
      console.error(e);
      setLoadErr(`Błąd: ${e.message} — kliknij ↻`);
    }
    setLoading(false);
  }, [ym, year, month]);

  useEffect(() => { setEvents([]); loadMonth(); }, [loadMonth]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = (new Date(year, month-1, 1).getDay()+6)%7;
  const byDay = {};
  events.filter(e=>filters.has(e.category)).forEach(e=>{
    (byDay[e.day]=byDay[e.day]||[]).push(e);
  });
  const nav = dir => {
    let m=month+dir,y=year;
    if(m>12){m=1;y++;} if(m<1){m=12;y--;}
    setMonth(m);setYear(y);setSelected(null);
  };
  const toggleF = k => setFilters(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n; });
  const sorted = events.filter(e=>filters.has(e.category)).sort((a,b)=>a.day-b.day);

  return (
    <div style={{ minHeight:"100vh", background:"#F8F7F4", color:"#1A1A1A",
      fontFamily:"Georgia,'Times New Roman',serif" }}>

      <header style={{ background:"#fff", borderBottom:"1.5px solid #E5E3DE",
        padding:"14px 22px 12px", display:"flex", alignItems:"center",
        justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ display:"flex", alignItems:"baseline", gap:9 }}>
            <span style={{ fontSize:10, letterSpacing:".2em", textTransform:"uppercase",
              color:"#DC2626", fontFamily:"monospace", fontWeight:700 }}>Mr. Y</span>
            <h1 style={{ fontSize:19, fontWeight:700, letterSpacing:"-.02em", margin:0, color:"#111" }}>
              Planer Tematów
            </h1>
          </div>
          <p style={{ fontSize:10, color:"#AAA", margin:"2px 0 0", fontFamily:"monospace" }}>
            {meta[ym] ? `${events.length} zdarzeń · ` : ""}{MONTHS_PL[month-1]} {year}
          </p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <NavBtn onClick={()=>nav(-1)}>‹</NavBtn>
          <span style={{ fontSize:15, fontWeight:700, color:"#111", minWidth:140, textAlign:"center" }}>
            {MONTHS_PL[month-1]} {year}
          </span>
          <NavBtn onClick={()=>nav(1)}>›</NavBtn>
          <div style={{ width:1, height:22, background:"#E5E3DE", margin:"0 2px" }}/>
          <NavBtn onClick={()=>loadMonth(true)} disabled={loading} title="Regeneruj miesiąc">↻</NavBtn>
          <NavBtn onClick={()=>setView(v=>v==="calendar"?"list":"calendar")}
            style={{ fontFamily:"monospace", fontSize:12 }}>
            {view==="calendar"?"≡":"▦"}
          </NavBtn>
        </div>
      </header>

      <div style={{ background:"#fff", padding:"7px 22px 9px", borderBottom:"1px solid #EDEDEA",
        display:"flex", gap:4, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:9, color:"#CCC", fontFamily:"monospace", letterSpacing:".1em", marginRight:3 }}>FILTR</span>
        {CAT_KEYS.map(k=>{
          const c=CATEGORIES[k]; const on=filters.has(k);
          return (
            <button key={k} onClick={()=>toggleF(k)} style={{
              background:on?c.bg:"transparent",
              border:`1px solid ${on?c.color+"55":"#E5E3DE"}`,
              borderRadius:3, color:on?c.color:"#CCC",
              padding:"2px 7px", fontSize:10, cursor:"pointer",
              fontFamily:"monospace", transition:"all .1s",
            }}>{c.label}</button>
          );
        })}
        <button onClick={()=>setFilters(new Set(CAT_KEYS))} style={{
          marginLeft:"auto", background:"transparent", border:"1px solid #E5E3DE",
          color:"#CCC", padding:"2px 7px", fontSize:9, cursor:"pointer",
          fontFamily:"monospace", borderRadius:3,
        }}>Wszystkie</button>
      </div>

      {loading && (
        <div style={{ padding:"50px 22px", textAlign:"center",
          fontFamily:"monospace", fontSize:12, color:"#999" }}>
          <Spinner/><br/><br/>{loadMsg}
        </div>
      )}
      {!loading && loadErr && (
        <div style={{ padding:"24px 22px", textAlign:"center",
          fontFamily:"monospace", fontSize:12, color:"#DC2626" }}>{loadErr}</div>
      )}

      {!loading && !loadErr && view==="calendar" && (
        <div style={{ padding:"14px 22px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:3 }}>
            {DAYS_PL.map(d=>(
              <div key={d} style={{ textAlign:"center", fontSize:9, fontFamily:"monospace",
                color:"#CCC", letterSpacing:".06em", padding:"3px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
            {Array.from({length:startOffset}).map((_,i)=><div key={`x${i}`} style={{ minHeight:88 }}/>)}
            {Array.from({length:daysInMonth}).map((_,i)=>{
              const day=i+1, evs=byDay[day]||[];
              const isToday=day===today.getDate()&&month===today.getMonth()+1&&year===today.getFullYear();
              return (
                <div key={day} style={{ minHeight:88,
                  background:isToday?"#FFFBEB":"#fff",
                  border:`1px solid ${isToday?"#FCD34D":"#EDEDEA"}`,
                  borderRadius:3, padding:"5px 5px" }}>
                  <div style={{ fontSize:10, fontFamily:"monospace", marginBottom:3,
                    color:isToday?"#D97706":"#CCC", fontWeight:isToday?700:400 }}>{day}</div>
                  {evs.slice(0,3).map(ev=><EventChip key={ev.id} ev={ev} onClick={()=>setSelected(ev)}/>)}
                  {evs.length>3 && (
                    <div onClick={()=>setSelected(evs[3])} style={{ fontSize:9,
                      color:"#CCC", fontFamily:"monospace", cursor:"pointer", paddingLeft:3 }}>
                      +{evs.length-3}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !loadErr && view==="list" && (
        <div style={{ padding:"14px 22px", maxWidth:860 }}>
          {!sorted.length && <p style={{ color:"#CCC", fontFamily:"monospace", fontSize:12, padding:"30px 0" }}>Brak zdarzeń.</p>}
          {sorted.map(ev=><EventRow key={ev.id} ev={ev} onClick={()=>setSelected(ev)}/>)}
        </div>
      )}

      {selected && <DetailPanel ev={selected} month={month} year={year} onClose={()=>setSelected(null)}/>}
    </div>
  );
}

function EventChip({ev,onClick}) {
  const c=CATEGORIES[ev.category]||CATEGORIES.wydarzenie;
  return (
    <div onClick={onClick} title={ev.title} style={{
      background:c.bg, borderLeft:`2px solid ${c.color}`,
      padding:"1px 3px", fontSize:9, color:c.color, borderRadius:"0 2px 2px 0",
      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
      cursor:"pointer", fontFamily:"monospace", lineHeight:1.45, marginBottom:2,
    }}>{ev.title}</div>
  );
}

function EventRow({ev,onClick}) {
  const c=CATEGORIES[ev.category]||CATEGORIES.wydarzenie;
  return (
    <div onClick={onClick} style={{ display:"flex", gap:12, padding:"10px 0",
      borderBottom:"1px solid #F0EEEB", cursor:"pointer", alignItems:"flex-start" }}>
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
        </div>
        <div style={{ fontSize:11, color:"#888", marginTop:2, lineHeight:1.45 }}>{ev.subtitle}</div>
      </div>
      <div style={{ fontSize:9, fontFamily:"monospace", color:c.color+"99", flexShrink:0, paddingTop:2 }}>
        {c.label}
      </div>
    </div>
  );
}

function DetailPanel({ev,month,year,onClose}) {
  const c=CATEGORIES[ev.category]||CATEGORIES.wydarzenie;
  const [tab, setTab]     = useState("ideas");
  const [ideas,setIdeas]  = useState("");
  const [iLoad,setILoad]  = useState(false);
  const [arts, setArts]   = useState(null);
  const [aLoad,setALoad]  = useState(false);
  const [aErr, setAErr]   = useState("");

  useEffect(()=>{
    setIdeas(""); setILoad(true);
    fetchIdeas(ev,month,year)
      .then(setIdeas).catch(e=>setIdeas("Błąd: "+e.message))
      .finally(()=>setILoad(false));
  },[ev.id]);

  const searchArticles=async()=>{
    setALoad(true);setAErr("");setArts(null);
    try { const a=await fetchArticles(ev); if(!a.length) setAErr("Brak wyników."); else setArts(a); }
    catch(e){ setAErr("Błąd: "+e.message); }
    setALoad(false);
  };

  const W=Math.min(500,window.innerWidth);
  return (
    <div style={{ position:"fixed",top:0,right:0,bottom:0,width:W,
      background:"#fff",borderLeft:"1.5px solid #E5E3DE",
      display:"flex",flexDirection:"column",zIndex:200,
      boxShadow:"-12px 0 48px #0000001A" }}>

      <div style={{ padding:"13px 16px",borderBottom:"1px solid #EDEDEA",
        display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontSize:9,fontFamily:"monospace",color:c.color,
            letterSpacing:".1em",marginBottom:3 }}>
            {c.label.toUpperCase()} · {ev.day} {MONTHS_PL[month-1].toUpperCase()} {year}
          </div>
          <div style={{ fontSize:15,fontWeight:700,lineHeight:1.3,color:"#111" }}>{ev.title}</div>
          {ev.anniversary && (
            <span style={{ display:"inline-block",marginTop:4,fontSize:9,
              fontFamily:"monospace",color:c.color,background:c.bg,
              border:`1px solid ${c.color}44`,padding:"1px 6px",borderRadius:2 }}>
              {ev.anniversary}
            </span>
          )}
        </div>
        <button onClick={onClose} style={{ background:"none",border:"none",
          color:"#CCC",fontSize:20,cursor:"pointer",padding:"0 2px",lineHeight:1 }}>×</button>
      </div>

      <div style={{ padding:"9px 16px",background:"#FAFAF8",borderBottom:"1px solid #F0EEEB" }}>
        <p style={{ fontSize:12,color:"#666",lineHeight:1.6,margin:0 }}>{ev.subtitle}</p>
      </div>

      <div style={{ display:"flex",borderBottom:"1.5px solid #EDEDEA" }}>
        {[["ideas","✦ 5 pomysłów"],["links","⌕ Artykuły"]].map(([k,lbl])=>(
          <button key={k} onClick={()=>setTab(k)} style={{
            flex:1,padding:"8px 0",background:"none",border:"none",
            borderBottom:`2px solid ${tab===k?c.color:"transparent"}`,
            color:tab===k?c.color:"#AAA",fontSize:10,cursor:"pointer",
            fontFamily:"monospace",letterSpacing:".04em",marginBottom:"-1.5px",
          }}>{lbl}</button>
        ))}
      </div>

      <div style={{ flex:1,overflowY:"auto",padding:"14px 16px" }}>
        {tab==="ideas" && <>
          {iLoad && <Center><Spinner/><br/>Generuję 5 pomysłów…</Center>}
          {!iLoad && ideas && (
            <>
              <SLabel>5 POMYSŁÓW NA ARTYKUŁ</SLabel>
              <div style={{ fontSize:12.5,lineHeight:1.75,color:"#333",whiteSpace:"pre-wrap" }}>{ideas}</div>
              <SBtn onClick={()=>{ setIdeas("");setILoad(true);
                fetchIdeas(ev,month,year).then(setIdeas).catch(e=>setIdeas("Błąd: "+e.message)).finally(()=>setILoad(false));
              }} style={{ marginTop:12 }}>↻ Inne pomysły</SBtn>
            </>
          )}
        </>}

        {tab==="links" && <>
          {aLoad && <Center><Spinner/><br/>Przeszukuję internet…<br/>
            <small style={{ color:"#CCC" }}>(15–30 sekund)</small></Center>}
          {!aLoad && aErr && <><p style={{ color:"#DC2626",fontSize:12,fontFamily:"monospace" }}>{aErr}</p>
            <SBtn onClick={searchArticles}>↻ Spróbuj ponownie</SBtn></>}
          {!aLoad && !aErr && arts===null && <>
            <p style={{ fontSize:12,color:"#888",lineHeight:1.6,marginBottom:12 }}>
              AI przeszuka internet i znajdzie długie, bogate artykuły z NYT, Atlantic,
              Guardian, Le Monde, ESPN i innych dużych mediów.
            </p>
            <ABtn color={c.color} bg={c.bg} onClick={searchArticles}>⌕ Szukaj artykułów</ABtn>
          </>}
          {!aLoad && arts && <>
            <SLabel>{arts.length} ARTYKUŁÓW</SLabel>
            {arts.map((a,i)=><ArtCard key={i} a={a}/>)}
            <SBtn onClick={searchArticles} style={{ marginTop:10 }}>↻ Szukaj ponownie</SBtn>
          </>}
        </>}
      </div>
    </div>
  );
}

function ArtCard({a}) {
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer" style={{
      display:"block",textDecoration:"none",marginBottom:7,
      background:"#FAFAF8",border:"1px solid #EDEDEA",borderRadius:4,padding:"9px 11px",
    }}
    onMouseEnter={e=>e.currentTarget.style.borderColor="#CCC"}
    onMouseLeave={e=>e.currentTarget.style.borderColor="#EDEDEA"}>
      <div style={{ display:"flex",justifyContent:"space-between",gap:6 }}>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontSize:12,fontWeight:600,color:"#111",lineHeight:1.3,marginBottom:3,
            overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",
            WebkitLineClamp:2,WebkitBoxOrient:"vertical" }}>{a.title}</div>
          <div style={{ display:"flex",gap:5,alignItems:"center",flexWrap:"wrap" }}>
            <span style={{ fontSize:10,fontFamily:"monospace",color:"#16A34A",
              background:"#F0FDF4",border:"1px solid #86EFAC66",
              padding:"1px 5px",borderRadius:2 }}>{a.publication}</span>
            {a.year && <span style={{ fontSize:9,color:"#CCC",fontFamily:"monospace" }}>{a.year}</span>}
            <span style={{ fontSize:11 }}>{LANG_FLAGS[a.language]||"🌐"}</span>
          </div>
          {a.description && (
            <div style={{ fontSize:10.5,color:"#888",marginTop:3,lineHeight:1.4 }}>{a.description}</div>
          )}
        </div>
        <span style={{ color:"#CCC",fontSize:13,flexShrink:0 }}>↗</span>
      </div>
    </a>
  );
}

function NavBtn({children,onClick,disabled,title,style={}}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      background:"#fff",border:"1px solid #E5E3DE",color:"#777",
      width:30,height:30,borderRadius:3,cursor:disabled?"default":"pointer",
      fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",
      opacity:disabled?0.4:1,...style,
    }}>{children}</button>
  );
}
function ABtn({children,onClick,color,bg}) {
  return (
    <button onClick={onClick} style={{
      background:bg,border:`1px solid ${color}55`,color,padding:"9px 14px",
      borderRadius:4,cursor:"pointer",fontSize:11,fontFamily:"monospace",
      letterSpacing:".04em",width:"100%",
    }}>{children}</button>
  );
}
function SBtn({children,onClick,style={}}) {
  return (
    <button onClick={onClick} style={{
      background:"transparent",border:"1px solid #E5E3DE",color:"#AAA",
      padding:"5px 11px",borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:"monospace",...style,
    }}>{children}</button>
  );
}
function SLabel({children}) {
  return <div style={{ fontSize:9,fontFamily:"monospace",color:"#CCC",
    letterSpacing:".1em",marginBottom:8,paddingBottom:5,
    borderBottom:"1px solid #F0EEEB" }}>{children}</div>;
}
function Center({children}) {
  return <div style={{ textAlign:"center",padding:"24px 0",color:"#AAA",
    fontFamily:"monospace",fontSize:11,lineHeight:1.7 }}>{children}</div>;
}
function Spinner() {
  const [f,setF]=useState(0);
  const fr=["◐","◓","◑","◒"];
  useEffect(()=>{ const t=setInterval(()=>setF(x=>(x+1)%4),150); return()=>clearInterval(t); },[]);
  return <span style={{ fontFamily:"monospace" }}>{fr[f]}</span>;
}
