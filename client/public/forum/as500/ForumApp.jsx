// AS500 — Forum Module
const { useState, useEffect, useRef, useCallback } = React;

// ── Data ─────────────────────────────────────────────────────

const CATEGORIES = [
  { id:'all',          label:'ALL THREADS',   count:58 },
  { id:'technical',    label:'TECHNICAL',     count:21 },
  { id:'routes',       label:'ROUTES',        count:14 },
  { id:'gear',         label:'GEAR',          count:11 },
  { id:'trip-reports', label:'TRIP REPORTS',  count: 8 },
  { id:'general',      label:'GENERAL',       count: 4 },
];

const THREADS = [
  {
    id:1, cat:'technical',
    title:'KTM 890 ADV R — valve clearance interval?',
    author:'rider_k', replies:14, views:312, updated:'2026-04-22',
    tag:'HOT', pinned:false,
    posts:[
      { id:1, author:'rider_k', ts:'2026-04-22 09:14', body:`Running a 2022 890 ADV R. Manual says 15k km for valve check but I'm\nhearing 10k from other riders. Anyone done it early?\n\nCurrent odometer: 12,340 km. Tempted to pull the tank now.` },
      { id:2, author:'dust_404', ts:'2026-04-22 10:02', body:`Did mine at 10k. Found one exhaust valve at the tight end of spec.\nGlad I didn't wait. KTM dealer confirmed they recommend 10k for\naggressive/offroad use.` },
      { id:3, author:'fjord_77', ts:'2026-04-22 11:30', body:`+1 on 10k for offroad use. Vibration loads are different.\nNot a big job — 2-3 hours if you've done it before.` },
      { id:4, author:'moto_hans', ts:'2026-04-22 14:55', body:`Just hit 20k on mine — no issues, all valves in spec. Think it depends\non how hard you're riding. Track/offroad = 10k. Road touring = 15k fine.` },
      { id:5, author:'rider_k', ts:'2026-04-22 16:40', body:`Good data. Going to do it at 13k as a compromise. Will post results.` },
    ],
  },
  {
    id:2, cat:'routes',
    title:'Iceland F-roads: April conditions report',
    author:'fjord_77', replies:8, views:189, updated:'2026-04-21',
    tag:'NEW', pinned:false,
    posts:[
      { id:1, author:'fjord_77', ts:'2026-04-21 07:00', body:`Back from two weeks. F26 (Sprengisandur) still closed — snow above 700m.\nF35 (Kjölur) passable but rough. Water crossings at Hvítá running high.\n\nBike: BMW R1250 GS. Ground clearance was the limiting factor, not power.` },
      { id:2, author:'atlas_r', ts:'2026-04-21 08:44', body:`Thanks for the report. What tyres were you on? Considering this in May.` },
      { id:3, author:'fjord_77', ts:'2026-04-21 09:12', body:`Metzeler Karoo 4. Would not do it on anything street-biased.\nThe highland tracks are loose volcanic gravel, not graded dirt.` },
    ],
  },
  {
    id:3, cat:'gear',
    title:'Touratech vs Jesse panniers — long term',
    author:'dust_404', replies:31, views:740, updated:'2026-04-20',
    tag:'HOT', pinned:false,
    posts:[
      { id:1, author:'dust_404', ts:'2026-04-18 12:00', body:`18 months with Touratech Zega Pro2 on the Africa Twin. Summary:\n\n  + Waterproof: zero leaks in 3 crossings\n  + Lock: solid, no rattle at all\n  - Weight: 4.2kg each empty — heavy\n  - Price: brutal\n\nConsidering Jesse for the next bike. Anyone done both?` },
      { id:2, author:'rider_k', ts:'2026-04-18 14:30', body:`Ran Jesse Odyssey on a KTM 950 for 4 years. Lighter but the mount\nflex bothered me on really rough stuff. Nothing broke though.` },
      { id:3, author:'moto_hans', ts:'2026-04-19 08:15', body:`Jesse customer service is top tier. Had a hinge crack at 60k km —\nthey replaced the whole lid, no receipt required.` },
    ],
  },
  {
    id:4, cat:'routes',
    title:'Atlas mountain loop — GPX track share',
    author:'rider_k', replies:5, views:98, updated:'2026-04-19',
    tag:'', pinned:false,
    posts:[
      { id:1, author:'rider_k', ts:'2026-04-19 18:00', body:`Completed the loop last autumn. 1,240 km, 8 days.\nRoute: Marrakech > Tizi n'Test > Zagora > Dades > Todra > Azrou > back.\n\nGPX attached. Fuel stops marked. One unmapped piste shortcut near Ait Benhaddou\n— do not miss the turn, it adds 40km on sand if you do.` },
      { id:2, author:'fjord_77', ts:'2026-04-19 20:10', body:`Downloaded. Planning this for October. Any border/permit issues?` },
      { id:3, author:'rider_k', ts:'2026-04-20 07:44', body:`No permits needed. Moroccan third-party insurance at the border — ~15 EUR.\nFuel: carry extra past Zagora, 180km gap with no unleaded.` },
    ],
  },
  {
    id:5, cat:'technical',
    title:'Africa Twin DCT — manual mode reliability?',
    author:'atlas_r', replies:9, views:201, updated:'2026-04-18',
    tag:'', pinned:false,
    posts:[
      { id:1, author:'atlas_r', ts:'2026-04-18 09:00', body:`Considering the 2024 AT with DCT. Concerned about offroad use in\nmanual mode. Anyone run this on real technical terrain?\n\nSpecifically: bog crossings, hillclimbs, slow technical rock.` },
      { id:2, author:'dust_404', ts:'2026-04-18 10:30', body:`2021 AT DCT, 28k km, 40% offroad. Manual mode is solid.\nThe main issue: you cannot slip the clutch manually — it's all electronic.\nFor slow technical: low-2 or low-1, it handles fine.` },
    ],
  },
  {
    id:6, cat:'trip-reports',
    title:'Balkans south loop — 14 days solo',
    author:'moto_hans', replies:19, views:430, updated:'2026-04-16',
    tag:'', pinned:true,
    posts:[
      { id:1, author:'moto_hans', ts:'2026-04-10 20:00', body:`Day 1-3: Slovenia > Croatia coast. Roads excellent, fuel cheap.\nDay 4-6: Bosnia interior. D807 near Foča — best road of the trip.\nDay 7-9: Montenegro mountains. Durmitor ring. Unmissable.\nDay 10-12: Albania — N of Valbona valley. Some gravel but spectacular.\nDay 13-14: Kosovo > Serbia > home.\n\n2,100 km total. Zero mechanical issues. One puncture in Albania.` },
      { id:2, author:'fjord_77', ts:'2026-04-11 07:00', body:`D807 flagged. Albania visa situation — still visa-on-arrival for EU riders?` },
      { id:3, author:'moto_hans', ts:'2026-04-11 08:10', body:`Confirmed yes, April 2026. €1 at border, instant. Bike insurance:\nget green card endorsed for AL before departure or buy at border (pricey).` },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────

function tagStyle(tag) {
  if (tag === 'HOT') return { color:'#ff3b3b' };
  if (tag === 'NEW') return { color:'#4da3ff' };
  return { color:'#6b7280' };
}

function pad(str, n) { return String(str).padEnd(n); }
function rpad(str, n) { return String(str).padStart(n); }

// ── Thread List Terminal Lines ────────────────────────────────

function threadListLines(threads, sel, catId) {
  const header = catId === 'all' ? 'FORUM — ALL THREADS' : `FORUM — ${catId.toUpperCase().replace('-',' ')}`;
  const lines = [
    { content: ' ' },
    { content: `  ${header}`, style:{ color:'#00883d', fontWeight:700, letterSpacing:'0.15em' } },
    { content: ' ' },
    { content: `  ${'#'.padEnd(4)}${'TOPIC'.padEnd(48)}${'AUTHOR'.padEnd(12)}${'REP'.padStart(4)}  ${'UPDATED'}`, style:{ color:'#6b7280' } },
    { content: '  ' + '─'.repeat(76), style:{ color:'#0f2a1f' } },
  ];

  threads.forEach((t, i) => {
    const pinMark  = t.pinned ? '■ ' : '  ';
    const tagStr   = t.tag ? `[${t.tag}]` : '     ';
    const titleRaw = `${pinMark}${t.title}`;
    const title    = titleRaw.length > 43 ? titleRaw.slice(0,42) + '…' : titleRaw.padEnd(43);
    const isActive = i === sel;

    if (isActive) {
      lines.push({
        content: `  ${String(t.id).padEnd(4)}${title} ${tagStr.padEnd(7)} ${t.author.padEnd(11)} ${rpad(t.replies,3)}  ${t.updated}`,
        style: { background:'#00FF88', color:'#000' },
        raw: true,
        clickId: t.id,
      });
    } else {
      // Render with mixed color via raw JSX
      lines.push({
        jsx: true,
        id: t.id,
        tag: t.tag,
        pinned: t.pinned,
        title: t.title,
        author: t.author,
        replies: t.replies,
        updated: t.updated,
        idx: String(t.id),
      });
    }
  });

  lines.push({ content: '  ' + '─'.repeat(76), style:{ color:'#0f2a1f' } });
  lines.push({ jsxActions: true, view: 'list' });
  lines.push({ content: ' ' });
  return lines;
}

// OP post block — full CSS border, no box-drawing chars
function OPPostBlock({ author, ts, body }) {
  return (
    <div style={{
      margin: '4px 16px 8px 16px',
      border: '1px solid #00883d',
      background: '#020d07',
    }}>
      <div style={{
        padding: '4px 10px',
        borderBottom: '1px solid #00883d',
        display: 'flex', gap: 16, alignItems: 'center',
      }}>
        <span style={{ fontSize:12, color:'#00FF88', fontFamily:'inherit', letterSpacing:'0.05em' }}>{author}</span>
        <span style={{ fontSize:11, color:'#00883d', fontFamily:'inherit' }}>{ts}</span>
        <span style={{ fontSize:10, color:'#00883d', fontFamily:'inherit', marginLeft:'auto', letterSpacing:'0.1em' }}>[OP]</span>
      </div>
      <div style={{ padding: '8px 10px' }}>
        {body.split('\n').map((line, i) => (
          <div key={i} style={{
            fontFamily:'inherit', fontSize:13, lineHeight:'1.6',
            whiteSpace:'pre', color:'var(--color-text-silver, #dff2e8)',
          }}>{line || ' '}</div>
        ))}
      </div>
    </div>
  );
}

function ThreadRow({ t, onClick }) {
  const [hovered, setHovered] = React.useState(false);
  const pinMark = t.pinned ? '■ ' : '  ';
  const titleRaw = `${pinMark}${t.title}`;
  const title = titleRaw.length > 43 ? titleRaw.slice(0,42) + '…' : titleRaw;
  const ts = tagStyle(t.tag);
  const tagStr = t.tag ? `[${t.tag}]` : '     ';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily:'inherit', fontSize:13, lineHeight:'1.55', whiteSpace:'pre',
        color:'#00FF88', cursor:'default',
        background: hovered ? '#0a1a10' : 'transparent',
        transition: 'background 80ms linear',
      }}
    >
      {'  '}{String(t.id).padEnd(4)}
      <span>{title.padEnd(43)}</span>
      {' '}
      <span style={ts}>{tagStr.padEnd(7)}</span>
      {' '}
      <span style={{ color: hovered ? '#00FF88' : '#00cc6a' }}>{t.author.padEnd(11)}</span>
      {' '}
      <span style={{ color:'#6b7280' }}>{rpad(t.replies,3)}</span>
      {'  '}
      <span style={{ color:'#6b7280' }}>{t.updated}</span>
    </div>
  );
}

// Clickable action button for bottom bars
function ActionBtn({ label, keyHint, onClick }) {
  const [hov, setHov] = React.useState(false);
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ cursor:'default', display:'inline-flex', alignItems:'center', gap:4 }}
    >
      <span style={{ fontSize:10, color:'#6b7280', fontFamily:'inherit' }}>{keyHint}</span>
      <span style={{ fontSize:10, color: hov ? '#00FF88' : '#00883d', fontFamily:'inherit', transition:'color 80ms' }}>{label}</span>
    </span>
  );
}



function ThreadDetailView({ thread, onReply, onBack }) {
  const scrollRef = React.useRef(null);

  // Scroll to bottom when new replies added
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread.posts.length]);

  const replies = thread.posts.slice(1);

  return (
    <div style={{
      background:'#000', border:'1px solid #0f2a1f',
      display:'flex', flexDirection:'column', height:'100%', overflow:'hidden',
      position:'relative',
    }}>
      {/* scanlines */}
      <div style={{
        position:'absolute', inset:0, pointerEvents:'none',
        background:'repeating-linear-gradient(to bottom,transparent 0px,transparent 1px,rgba(0,0,0,0.04) 1px,rgba(0,0,0,0.04) 2px)',
        zIndex:10,
      }}/>

      {/* Header — fixed, with BACK */}
      <div style={{
        padding:'10px 14px 6px', flexShrink:0,
        borderBottom:'1px solid #0f2a1f',
        display:'flex', justifyContent:'space-between', alignItems:'flex-start',
      }}>
        <div>
          <div style={{ fontFamily:'inherit', fontSize:13, lineHeight:'1.55', color:'#00FF88', fontWeight:700, whiteSpace:'pre' }}>
            {thread.title.toUpperCase()}
          </div>
          <div style={{ fontFamily:'inherit', fontSize:11, color:'#6b7280', marginTop:2, whiteSpace:'pre' }}>
            {`CATEGORY: ${thread.cat.toUpperCase().replace('-',' ')}   AUTHOR: ${thread.author}   REPLIES: ${thread.posts.length - 1}   VIEWS: ${thread.views}`}
          </div>
        </div>
        <ActionBtn keyHint="Esc" label="BACK" onClick={onBack} />
      </div>

      {/* Sticky OP */}
      <div style={{ flexShrink:0, padding:'8px 14px 0' }}>
        <OPPostBlock author={thread.posts[0].author} ts={thread.posts[0].ts} body={thread.posts[0].body} />
      </div>

      {/* REPLY button — just below OP */}
      <div style={{ flexShrink:0, padding:'8px 14px 4px' }}>
        <ActionBtn keyHint="R" label="REPLY" onClick={onReply} />
      </div>

      {/* Scrollable replies */}
      <div
        ref={scrollRef}
        style={{ flex:1, overflowY:'auto', padding:'4px 14px 12px' }}
      >
        {replies.length === 0 && (
          <div style={{ fontFamily:'inherit', fontSize:12, color:'#00883d', padding:'12px 0' }}>
            NO REPLIES YET — BE THE FIRST
          </div>
        )}
        {replies.map((p, i) => (
          <div
            key={p.id}
            className={window.__tweaks?.replyStagger ? 'as500-reply-enter' : ''}
            style={{ animationDelay: window.__tweaks?.replyStagger ? `${i * 40}ms` : '0ms' }}
          >
            <div style={{ padding:'10px 0 2px' }}>
              <span style={{ fontFamily:'inherit', fontSize:12, color:'#00cc6a' }}>─ {p.author}</span>
              <span style={{ fontFamily:'inherit', fontSize:11, color:'#00883d', marginLeft:12 }}>{p.ts}</span>
            </div>
            {p.body.split('\n').map((line, li) => (
              <div key={li} style={{
                fontFamily:'inherit', fontSize:13, lineHeight:'1.6',
                whiteSpace:'pre', color:'#6b7280', paddingLeft:12,
              }}>{line || ' '}</div>
            ))}
            {i < replies.length - 1 && (
              <div style={{ fontFamily:'inherit', fontSize:13, color:'#1a3329', marginTop:8, whiteSpace:'pre' }}>
                {'─'.repeat(72)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Compose Panel ─────────────────────────────────────────────

function ComposePanel({ mode, threadTitle, onClose, onSubmit }) {
  const [body, setBody]   = useState('');
  const [title, setTitle] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  const isReply = mode === 'reply';
  const label   = isReply ? `REPLY — ${threadTitle}` : 'NEW THREAD';

  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (isReply && body.trim()) onSubmit({ body });
      if (!isReply && title.trim() && body.trim()) onSubmit({ title, body });
    }
  }

  return (
    <div style={{
      background:'#0a0f0c', border:'1px solid #00cc6a',
      borderRadius:2, boxShadow:'0 4px 32px rgba(0,0,0,0.95), 0 0 0 1px rgba(0,255,136,0.08)',
      width: mode === 'reply' ? 560 : 420, display:'flex', flexDirection:'column',
    }}>
      {/* title bar */}
      <div style={{
        background:'#0d1f14', borderBottom:'1px solid #00cc6a',
        padding:'6px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, minWidth:0,
      }}>
        <span style={{ fontSize:11, color:'#00FF88', letterSpacing:'0.12em' }}>{label}</span>
        <span onClick={onClose} style={{ fontSize:11, color:'#00883d', cursor:'default', whiteSpace:'nowrap', flexShrink:0 }}>⊗ [Esc]</span>
      </div>
      <div style={{ padding:12, display:'flex', flexDirection:'column', gap:8 }}>
        {!isReply && (
          <>
            <div style={{ fontSize:10, color:'#6b7280', letterSpacing:'0.1em' }}>SUBJECT</div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={handleKey}
              placeholder="thread title..."
              style={{
                background:'#000', border:'1px solid #0f2a1f', borderRadius:0,
                color:'#00FF88', fontFamily:'inherit', fontSize:13, padding:'5px 8px',
                outline:'none', width:'100%',
              }}
            />
          </>
        )}
        <div style={{ fontSize:10, color:'#6b7280', letterSpacing:'0.1em', marginTop: isReply ? 0 : 4 }}>BODY</div>
        <textarea
          ref={inputRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKey}
          placeholder="write your reply..."
          rows={6}
          style={{
            background:'#000', border:'1px solid #0f2a1f', borderRadius:0,
            color:'#00FF88', fontFamily:'inherit', fontSize:13, padding:'6px 8px',
            outline:'none', resize:'vertical', width:'100%',
            lineHeight:1.6,
          }}
        />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:4 }}>
          <span style={{ fontSize:10, color:'#00883d' }}>Ctrl+Enter to submit</span>
          <span
            onClick={() => {
              if (isReply && body.trim()) onSubmit({ body });
              if (!isReply && title.trim() && body.trim()) onSubmit({ title, body });
            }}
            style={{
              fontSize:11, color:'#00FF88', cursor:'default', letterSpacing:'0.1em',
              padding:'3px 10px', border:'1px solid #00FF88',
            }}
          >▶ SUBMIT</span>
        </div>
      </div>
    </div>
  );
}

// ── Category Panel ────────────────────────────────────────────

function CategoryPanel({ cats, activeCat, onSelect, onClose }) {
  return (
    <div style={{
      background:'#0a0f0c', border:'1px solid #1a3329',
      borderRadius:2, boxShadow:'0 4px 24px rgba(0,0,0,0.85)',
      width:220,
    }}>
      <div style={{
        background:'#0d1710', borderBottom:'1px solid #1a3329',
        padding:'5px 12px', display:'flex', justifyContent:'space-between',
      }}>
        <span style={{ fontSize:11, color:'#00cc6a', letterSpacing:'0.12em' }}>CATEGORIES</span>
        <span onClick={onClose} style={{ fontSize:11, color:'#00883d', cursor:'default' }}>⊗</span>
      </div>
      <div style={{ padding:'6px 0' }}>
        {cats.map(cat => (
          <div
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            style={{
              padding:'4px 12px',
              display:'flex', justifyContent:'space-between', alignItems:'center',
              background: cat.id === activeCat ? '#00FF88' : 'transparent',
              color: cat.id === activeCat ? '#000' : '#00cc6a',
              fontSize:12, cursor:'default',
              borderBottom: '1px solid #0a1a12',
            }}
          >
            <span style={{ fontFamily:'inherit' }}>{cat.id === activeCat ? '◉' : '○'} {cat.label}</span>
            <span style={{ fontSize:10, color: cat.id === activeCat ? '#000' : '#6b7280' }}>{cat.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Search Panel ──────────────────────────────────────────────

function SearchPanel({ threads, onSelect, onClose }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current && ref.current.focus(); }, []);

  const results = q.trim().length > 1
    ? threads.filter(t => t.title.toLowerCase().includes(q.toLowerCase()) || t.author.toLowerCase().includes(q.toLowerCase()))
    : [];

  return (
    <div style={{
      background:'#0a0f0c', border:'1px solid #1a3329',
      borderRadius:2, boxShadow:'0 4px 24px rgba(0,0,0,0.85)',
      width:460,
    }}>
      <div style={{
        background:'#0d1710', borderBottom:'1px solid #1a3329',
        padding:'5px 12px', display:'flex', justifyContent:'space-between',
      }}>
        <span style={{ fontSize:11, color:'#00cc6a', letterSpacing:'0.12em' }}>SEARCH THREADS</span>
        <span onClick={onClose} style={{ fontSize:11, color:'#00883d', cursor:'default', whiteSpace:'nowrap', flexShrink:0 }}>⊗ [Esc]</span>
      </div>
      <div style={{ padding:12, display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:13, color:'#00cc6a' }}>/</span>
          <input
            ref={ref}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
            placeholder="search..."
            style={{
              flex:1, background:'#000', border:'1px solid #0f2a1f',
              color:'#00FF88', fontFamily:'inherit', fontSize:13, padding:'4px 8px',
              outline:'none',
            }}
          />
        </div>
        {results.length > 0 && (
          <div style={{ marginTop:4 }}>
            {results.map(t => (
              <div
                key={t.id}
                onClick={() => onSelect(t)}
                style={{
                  padding:'5px 4px', borderBottom:'1px solid #0a1a12',
                  cursor:'default',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#0d1710'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ fontSize:12, color:'#00FF88', fontFamily:'inherit' }}>{t.title}</div>
                <div style={{ fontSize:10, color:'#6b7280', fontFamily:'inherit', marginTop:2 }}>
                  {t.author}  ·  {t.replies} replies  ·  {t.updated}
                </div>
              </div>
            ))}
          </div>
        )}
        {q.trim().length > 1 && results.length === 0 && (
          <div style={{ fontSize:11, color:'#6b7280', fontFamily:'inherit' }}>ERR: NO RESULTS FOR "{q}"</div>
        )}
      </div>
    </div>
  );
}

// ── Main Forum App ────────────────────────────────────────────

function ForumApp() {
  const [view,       setView]       = useState('list');
  const [activeCat,  setActiveCat]  = useState(() => localStorage.getItem('forum_cat') || 'all');
  const [threadData, setThreadData] = useState(THREADS);
  const [sel,        setSel]        = useState(0);
  const [openThread, setOpenThread] = useState(null);
  const [scrollOff,  setScrollOff]  = useState(0);
  const [panel,      setPanel]      = useState(null); // 'compose-reply' | 'compose-new' | 'categories' | 'search'
  const [flash,      setFlash]      = useState('');
  const termRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('forum_view', view);
    localStorage.setItem('forum_cat', activeCat);
  }, [view, activeCat]);

  const filteredThreads = activeCat === 'all'
    ? threadData
    : threadData.filter(t => t.cat === activeCat);

  function openThreadById(id) {
    const t = threadData.find(x => x.id === id);
    if (t) { setOpenThread(t); setView('thread'); setScrollOff(0); setPanel(null); }
  }
  function openThreadByIdWithFlash(id) {
    const idx = filteredThreads.findIndex(x => x.id === id);
    if (idx !== -1) setSel(idx);
    setTimeout(() => openThreadById(id), 130);
  }
  // Expose for mouse clicks from ThreadRow
  useEffect(() => { window.__openThread = openThreadByIdWithFlash; }, [threadData, filteredThreads]);
  useEffect(() => { window.__forumSetPanel = setPanel; }, []);

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2000);
  }

  function handleSubmitReply({ body }) {
    const newPost = {
      id: openThread.posts.length + 1,
      author: 'RIDER_NODE_07',
      ts: new Date().toISOString().replace('T',' ').slice(0,16),
      body,
    };
    setThreadData(prev => prev.map(t =>
      t.id === openThread.id
        ? { ...t, posts: [...t.posts, newPost], replies: t.posts.length }
        : t
    ));
    setOpenThread(prev => ({ ...prev, posts: [...prev.posts, newPost], replies: prev.posts.length }));
    setPanel(null);
    setScrollOff(0);
    showFlash('REPLY POSTED — OK');
  }

  function handleSubmitNewThread({ title, body }) {
    const newId = Math.max(...threadData.map(t => t.id)) + 1;
    const newThread = {
      id: newId, cat: activeCat === 'all' ? 'general' : activeCat,
      title, author: 'RIDER_NODE_07', replies: 0, views: 1,
      updated: new Date().toISOString().slice(0,10),
      tag: 'NEW', pinned: false,
      posts: [{ id:1, author:'RIDER_NODE_07', ts: new Date().toISOString().replace('T',' ').slice(0,16), body }],
    };
    setThreadData(prev => [newThread, ...prev]);
    setPanel(null);
    showFlash('THREAD CREATED — OK');
  }

  const handleKey = useCallback((e) => {
    if (panel) {
      if (e.key === 'Escape') { e.preventDefault(); setPanel(null); }
      return;
    }

    if (view === 'list') {
      const count = filteredThreads.length;
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(0, s-1)); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(count-1, s+1)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        openThreadById(filteredThreads[sel]?.id);
      }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setPanel('compose-new'); }
      if (e.key === '/') { e.preventDefault(); setPanel('search'); }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setPanel('categories'); }
      if (e.key === 'Escape') { /* back to OS — no-op in standalone */ }
    }

    if (view === 'thread') {
      const posts = openThread?.posts || [];
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setPanel('compose-reply'); }
      if (e.key === 'Escape') { e.preventDefault(); setView('list'); setOpenThread(null); }
    }
  }, [view, panel, filteredThreads, sel, openThread]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // Build terminal lines (list view only)
  let screenLines = [];
  if (view === 'list') {
    screenLines = threadListLines(filteredThreads, sel, activeCat);
  }

  const activeModule = view === 'thread' && openThread
    ? `FORUM / ${openThread.cat.toUpperCase().replace('-',' ')}`
    : 'FORUM';

  return (
    <div style={{
      width:'100%', height:'100vh',
      display:'flex', flexDirection:'column',
      background:'#050607', overflow:'hidden',
    }}>
      <StatusBar module={activeModule} />

      <div style={{
        flex:1, display:'flex', gap:12, padding:'12px 16px',
        overflow:'hidden', alignItems:'flex-start', position:'relative',
      }}>

        {/* Main content area */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', height:'100%' }}>
          {view === 'thread' && openThread ? (
            <div className="as500-view-enter" style={{flex:1,display:'flex',flexDirection:'column',height:'100%'}}>
            <ThreadDetailView
              key={openThread.id}
              thread={openThread}
              onReply={() => setPanel('compose-reply')}
              onBack={() => { setView('list'); setOpenThread(null); }}
            />
            </div>
          ) : (
            <div className="as500-view-enter" style={{
              background:'#000', border:'1px solid #0f2a1f',
              padding:'10px 14px', position:'relative',
              flex:1, overflow:'hidden', cursor:'default', userSelect:'none',
            }}>
              {/* scanlines */}
              <div style={{
                position:'absolute', inset:0, pointerEvents:'none',
                background: window.__tweaks?.scanlines !== false
                  ? 'repeating-linear-gradient(to bottom,transparent 0px,transparent 1px,rgba(0,0,0,0.04) 1px,rgba(0,0,0,0.04) 2px)'
                  : 'none',
                zIndex:10,
              }}/>
              <style>{`@keyframes as500-blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
              {screenLines.map((row, i) => {
                if (row.jsx) return <ThreadRow key={i} t={row} onClick={() => window.__openThread && window.__openThread(row.id)} />;
              if (row.jsxActions) return (
                <div key={i} style={{ display:'flex', gap:20, padding:'4px 16px 2px', fontFamily:'inherit' }}>
                  <ActionBtn keyHint="N" label="NEW THREAD" onClick={() => window.__forumSetPanel && window.__forumSetPanel('compose-new')} />
                  <ActionBtn keyHint="/" label="SEARCH"     onClick={() => window.__forumSetPanel && window.__forumSetPanel('search')} />
                  <ActionBtn keyHint="F" label="FILTER"     onClick={() => window.__forumSetPanel && window.__forumSetPanel('categories')} />
                </div>
              );
                return (
                  <div key={i} style={{
                    fontFamily:'inherit', fontSize:13, lineHeight:'1.55',
                    whiteSpace:'pre', color:'#00FF88', ...row.style,
                  }}>
                    {row.content}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal overlay */}
        {panel && (
          <div
            onClick={() => setPanel(null)}
            className="as500-backdrop-enter"
            style={{
              position:'fixed', inset:0, zIndex:50,
              background: panel === 'compose-reply'
                ? (window.__tweaks?.modalBackdropBlur ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.45)')
                : (window.__tweaks?.modalBackdropBlur ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.75)'),
              backdropFilter: window.__tweaks?.modalBackdropBlur ? 'blur(4px)' : 'none',
              display:'flex',
              alignItems: panel === 'compose-reply' ? 'flex-end' : 'center',
              justifyContent: panel === 'compose-reply' ? 'flex-start' : 'center',
              padding: panel === 'compose-reply' ? '0 0 48px 28px' : '0',
            }}
          >
            <div className="as500-modal-enter" onClick={e => e.stopPropagation()}>
              {panel === 'categories' && (
                <CategoryPanel
                  cats={CATEGORIES}
                  activeCat={activeCat}
                  onSelect={(id) => { setActiveCat(id); setSel(0); setPanel(null); }}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === 'search' && (
                <SearchPanel
                  threads={threadData}
                  onSelect={(t) => { openThreadById(t.id); setPanel(null); }}
                  onClose={() => setPanel(null)}
                />
              )}
              {(panel === 'compose-reply' || panel === 'compose-new') && (
                <ComposePanel
                  mode={panel === 'compose-reply' ? 'reply' : 'new'}
                  threadTitle={openThread?.title}
                  onClose={() => setPanel(null)}
                  onSubmit={panel === 'compose-reply' ? handleSubmitReply : handleSubmitNewThread}
                />
              )}
            </div>
          </div>
        )}

      </div>

      {/* Flash message */}
      {flash && (
        <div style={{
          position:'fixed', bottom:40, left:'50%', transform:'translateX(-50%)',
          background:'#0d1710', border:'1px solid #00FF88',
          padding:'6px 20px', fontSize:12, color:'#00FF88',
          letterSpacing:'0.1em', zIndex:100,
          animation: 'as500-blink 400ms ease-out',
        }}>
          {flash}
        </div>
      )}

      <KeyBar />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ForumApp />);
