// AS500 — Terminal component
const { useState, useEffect, useRef, useCallback } = React;

const C = {
  g:  { color: '#00FF88' },
  g2: { color: '#00cc6a' },
  gm: { color: '#6b7280' },
  am: { color: '#ffb300' },
  rd: { color: '#ff3b3b' },
  bl: { color: '#4da3ff' },
  sel: { background: '#00FF88', color: '#000' },
};

function Line({ children, style, raw }) {
  if (raw) return (
    <div style={{ fontFamily:'inherit', fontSize:13, lineHeight:'1.55', whiteSpace:'pre', ...style }}>
      {children}
    </div>
  );
  return (
    <div style={{ fontFamily:'inherit', fontSize:13, lineHeight:'1.55', whiteSpace:'pre', color:'#00FF88', ...style }}>
      {children}
    </div>
  );
}

function Cursor() {
  return (
    <span style={{
      display:'inline-block', width:9, height:13,
      background:'#00FF88',
      boxShadow:'0 0 8px rgba(0,255,136,0.45)',
      animation:'as500-blink 800ms step-end infinite',
      verticalAlign:'text-bottom',
    }} />
  );
}

// Box drawing helpers
const BOX = {
  h: '─', v: '│',
  tl:'┌', tr:'┐', bl:'└', br:'┘',
  ml:'├', mr:'┤',
};

function boxLine(width, left, mid, right) {
  return left + BOX.h.repeat(width - 2) + right;
}

// Main Terminal component — renders a screen of lines
function Terminal({ screen, inputLine, onKey, width=78 }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { onKey && onKey(e); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onKey]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      style={{
        background: '#000',
        border: '1px solid #0f2a1f',
        padding: '10px 14px',
        position: 'relative',
        outline: 'none',
        flex: 1,
        overflow: 'hidden',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {/* scanlines */}
      <div style={{
        position:'absolute', inset:0, pointerEvents:'none',
        background:'repeating-linear-gradient(to bottom,transparent 0px,transparent 1px,rgba(0,0,0,0.04) 1px,rgba(0,0,0,0.04) 2px)',
        zIndex:10,
      }}/>

      <style>{`
        @keyframes as500-blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>

      {screen.map((row, i) => (
        <Line key={i} raw={row.raw} style={row.style}>
          {row.content}
        </Line>
      ))}

      {/* input line */}
      {inputLine !== undefined && (
        <Line>
          <span style={C.g2}>&gt; </span>
          <span style={C.g}>{inputLine}</span>
          <Cursor />
        </Line>
      )}
    </div>
  );
}

Object.assign(window, { Terminal, Line, Cursor, C, BOX });
