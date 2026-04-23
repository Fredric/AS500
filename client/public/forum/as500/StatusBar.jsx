// AS500 — StatusBar component
const { useState, useEffect } = React;

function StatusBar({ module, session, rider, alert }) {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toTimeString().slice(0,5));
      setDate(now.toISOString().slice(0,10));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      background: '#0d1710',
      borderBottom: '1px solid #0f2a1f',
      padding: '5px 16px',
      display: 'flex',
      gap: 0,
      alignItems: 'center',
      fontSize: 11,
      userSelect: 'none',
      flexShrink: 0,
    }}>
      <span style={{color:'#00FF88', textShadow:'0 0 6px rgba(0,255,136,0.4)'}}>●</span>
      <span style={{color:'#00cc6a', marginLeft:6}}>{rider || 'RIDER_NODE_07'}</span>

      <span style={{color:'#0f2a1f', margin:'0 16px'}}>│</span>

      <span style={{color:'#6b7280', letterSpacing:'0.08em'}}>SESSION</span>
      <span style={{color:'#00cc6a', marginLeft:6}}>{session || '#A4F2'}</span>

      <span style={{color:'#0f2a1f', margin:'0 16px'}}>│</span>

      <span style={{color:'#6b7280', letterSpacing:'0.08em'}}>MODULE</span>
      <span style={{color:'#00cc6a', marginLeft:6}}>{module || 'MAIN'}</span>

      {alert && (<>
        <span style={{color:'#0f2a1f', margin:'0 16px'}}>│</span>
        <span style={{color:'#ffb300'}}>● {alert}</span>
      </>)}

      <div style={{marginLeft:'auto', display:'flex', gap:12}}>
        <span style={{color:'#6b7280'}}>{date}</span>
        <span style={{color:'#00cc6a'}}>{time}</span>
      </div>
    </div>
  );
}

const KeyHint = ({k, label}) => (
  <span style={{fontSize:10, color:'#00883d'}}>
    <span style={{color:'#6b7280'}}>{k}</span> {label}
  </span>
);

function KeyBar() {
  return (
    <div style={{
      background:'#050607',
      borderTop:'1px solid #0f2a1f',
      padding:'5px 16px',
      display:'flex',
      gap:20,
      flexShrink:0,
      userSelect:'none',
    }}>
      <KeyHint k="↑↓" label="navigate" />
      <KeyHint k="Enter" label="select" />
      <KeyHint k="Esc" label="back" />
      <KeyHint k="/" label="search" />
      <KeyHint k="Tab" label="panels" />
      <KeyHint k="Ctrl+E" label="expand" />
      <KeyHint k="Ctrl+P" label="preview" />
    </div>
  );
}

Object.assign(window, { StatusBar, KeyBar });
