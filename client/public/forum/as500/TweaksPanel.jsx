// AS500 — Tweaks Panel
const { useState, useEffect } = React;

function TweaksPanel() {
  const [visible, setVisible] = useState(false);
  const [tweaks, setTweaks]   = useState({ ...window.__tweaks });

  // Register show/update hooks
  useEffect(() => {
    window.__tweakPanelShow   = (v) => setVisible(v);
    window.__tweakPanelUpdate = (t) => setTweaks({ ...t });
    return () => {
      window.__tweakPanelShow   = null;
      window.__tweakPanelUpdate = null;
    };
  }, []);

  function set(key, value) {
    const next = { ...tweaks, [key]: value };
    setTweaks(next);
    Object.assign(window.__tweaks, next);
    // Apply instantly
    const speed = next.animSpeed;
    const mult  = speed === 'off' ? 0 : speed === 'fast' ? 0.5 : 1;
    document.documentElement.style.setProperty('--anim-modal', `${Math.round(140 * mult)}ms`);
    document.documentElement.style.setProperty('--anim-view',  `${Math.round(100 * mult)}ms`);
    document.documentElement.style.setProperty('--anim-reply', `${Math.round(120 * mult)}ms`);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: value } }, '*');
  }

  if (!visible) return null;

  const row = (label, children) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #0a1a12' }}>
      <span style={{ fontSize:11, color:'#6b7280', letterSpacing:'0.08em', fontFamily:'inherit' }}>{label}</span>
      <div style={{ display:'flex', gap:6 }}>{children}</div>
    </div>
  );

  const chip = (label, active, onClick) => (
    <span
      key={label}
      onClick={onClick}
      style={{
        fontSize:10, fontFamily:'inherit', padding:'2px 8px', cursor:'default',
        letterSpacing:'0.08em',
        background: active ? '#00FF88' : 'transparent',
        color:      active ? '#000'    : '#00883d',
        border:     `1px solid ${active ? '#00FF88' : '#0f2a1f'}`,
      }}
    >{label}</span>
  );

  const toggle = (val, key) => (
    <span
      onClick={() => set(key, !val)}
      style={{
        fontSize:10, fontFamily:'inherit', padding:'2px 10px', cursor:'default',
        letterSpacing:'0.08em',
        background: val ? '#00FF88' : 'transparent',
        color:      val ? '#000'    : '#00883d',
        border:     `1px solid ${val ? '#00FF88' : '#0f2a1f'}`,
      }}
    >{val ? 'ON' : 'OFF'}</span>
  );

  return (
    <div style={{
      position:'fixed', bottom:40, right:16, zIndex:200,
      background:'#0a0f0c', border:'1px solid #1a3329',
      borderRadius:2, boxShadow:'0 4px 24px rgba(0,0,0,0.85)',
      width:260, fontFamily:'inherit',
    }}>
      <div style={{
        background:'#0d1710', borderBottom:'1px solid #1a3329',
        padding:'5px 12px',
        fontSize:11, color:'#00cc6a', letterSpacing:'0.12em',
      }}>TWEAKS</div>
      <div style={{ padding:'4px 12px 10px' }}>
        {row('ANIM SPEED',
          ['OFF','FAST','NORMAL'].map(s =>
            chip(s, tweaks.animSpeed === s.toLowerCase(), () => set('animSpeed', s.toLowerCase()))
          )
        )}
        {row('MODAL BLUR',    toggle(tweaks.modalBackdropBlur, 'modalBackdropBlur'))}
        {row('SCANLINES',     toggle(tweaks.scanlines, 'scanlines'))}
        {row('REPLY STAGGER', toggle(tweaks.replyStagger, 'replyStagger'))}
      </div>
    </div>
  );
}

const tweakRoot = document.createElement('div');
document.body.appendChild(tweakRoot);
ReactDOM.createRoot(tweakRoot).render(<TweaksPanel />);
