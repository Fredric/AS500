// AS500 — Floating Panels
const { useState, useEffect } = React;

function PanelShell({ title, width=280, onClose, children, style={} }) {
  return (
    <div style={{
      background: '#0a0f0c',
      border: '1px solid #1a3329',
      borderRadius: 2,
      boxShadow: '0 4px 24px rgba(0,0,0,0.85)',
      width,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      <div style={{
        background: '#0d1710',
        borderBottom: '1px solid #1a3329',
        padding: '5px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{fontSize:11, color:'#00cc6a', letterSpacing:'0.12em', textTransform:'uppercase'}}>{title}</span>
        {onClose && (
          <span
            onClick={onClose}
            style={{fontSize:11, color:'#003d1e', cursor:'default', userSelect:'none'}}
          >⊗ [Esc]</span>
        )}
      </div>
      <div style={{padding:12, overflowY:'auto', flex:1}}>
        {children}
      </div>
    </div>
  );
}

function DataGridPanel({ title='DATA GRID', columns=[], rows=[], selectedIdx=0, onSelect, style={} }) {
  return (
    <PanelShell title={`${title} — ${rows.length} records`} width={500} style={style}>
      <table style={{width:'100%', borderCollapse:'collapse'}}>
        <thead>
          <tr style={{borderBottom:'1px solid #1a3329'}}>
            {columns.map(c => (
              <th key={c.key} style={{
                fontSize:10, color:'#6b7280', letterSpacing:'0.12em',
                textTransform:'uppercase', padding:'4px 8px', textAlign:'left', fontWeight:400,
                whiteSpace:'nowrap', fontFamily:'inherit',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => onSelect && onSelect(i)}
              style={{cursor:'default'}}
            >
              {columns.map(c => (
                <td key={c.key} style={{
                  fontSize:12, padding:'5px 8px',
                  borderBottom:'1px solid #0a1a12',
                  color: i === selectedIdx ? '#000' : (row[c.key+'_color'] || '#00FF88'),
                  background: i === selectedIdx ? '#00FF88' : 'transparent',
                  whiteSpace:'nowrap', fontFamily:'inherit',
                }}>{row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </PanelShell>
  );
}

function FilePreviewPanel({ filename, size, type, onClose, style={} }) {
  return (
    <PanelShell title="PREVIEW" width={240} onClose={onClose} style={style}>
      <div style={{fontSize:10, color:'#6b7280', marginBottom:8}}>{filename}</div>
      <div style={{
        width:'100%', height:120, background:'#0d1710',
        border:'1px solid #0f2a1f',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <span style={{fontSize:10, color:'#003d1e', letterSpacing:'0.1em'}}>[ {type || 'FILE'} PREVIEW ]</span>
      </div>
      <div style={{fontSize:11, color:'#00cc6a', marginTop:8}}>{filename}</div>
      <div style={{fontSize:10, color:'#6b7280'}}>{size}</div>
    </PanelShell>
  );
}

function AttachmentsTray({ items=[], onClose, style={} }) {
  return (
    <PanelShell title="ATTACHMENTS" width={260} onClose={onClose} style={style}>
      {items.map((item, i) => (
        <div key={i} style={{
          display:'flex', alignItems:'center', gap:8,
          padding:'5px 0', borderBottom:'1px solid #0a1a12',
        }}>
          <span style={{fontSize:11, color:'#003d1e'}}>▶</span>
          <span style={{fontSize:11, color:'#00cc6a', flex:1}}>{item.name}</span>
          <span style={{fontSize:10, color:'#6b7280'}}>{item.size}</span>
        </div>
      ))}
      <div style={{display:'flex', alignItems:'center', gap:8, paddingTop:6}}>
        <span style={{fontSize:11, color:'#6b7280'}}>⊕</span>
        <span style={{fontSize:11, color:'#6b7280'}}>attach file...</span>
      </div>
    </PanelShell>
  );
}

function EditorPanel({ title='EDITOR', content='', onClose, style={} }) {
  return (
    <PanelShell title={title} width={480} onClose={onClose} style={style}>
      <div style={{
        fontSize:12, color:'#00FF88', lineHeight:1.7,
        whiteSpace:'pre-wrap', wordBreak:'break-word',
      }}>{content}</div>
    </PanelShell>
  );
}

Object.assign(window, { PanelShell, DataGridPanel, FilePreviewPanel, AttachmentsTray, EditorPanel });
