/* eslint-disable */
// Replenishment view — reorder-point list with stock meter, days of cover, and projection.

const ForecastSpark = ({ burn, onHand, reorderAt, leadDays, days = 30 }) => {
  const points = [];
  let stock = onHand;
  for (let i = 0; i <= days; i++) {
    points.push({ x: i, y: stock });
    stock -= burn;
  }
  const w = 110, h = 28, padX = 2, padTop = 3, padBot = 4;
  const maxY = Math.max(onHand, reorderAt) * 1.1;
  const sx = (x) => padX + (x / days) * (w - padX * 2);
  const sy = (y) => padTop + (1 - Math.max(0, y) / maxY) * (h - padTop - padBot);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const area = path + ` L${sx(days)},${sy(0)} L${sx(0)},${sy(0)} Z`;

  const crossDay = burn > 0 ? Math.max(0, (onHand - reorderAt) / burn) : days;
  const crossX = sx(Math.min(days, crossDay));
  const crossY = sy(reorderAt);

  return (
    <svg className="forecast-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: w, height: h, overflow: 'visible' }}>
      <line x1={sx(0)} y1={crossY} x2={sx(days)} y2={crossY} stroke="hsl(38 92% 60%)" strokeWidth="0.75" strokeDasharray="2 2"/>
      <path d={area} fill="hsl(0 0% 92%)"/>
      <path d={path} fill="none" stroke="hsl(0 0% 30%)" strokeWidth="1.25"/>
      {crossDay < days && <circle cx={crossX} cy={crossY} r="2" fill="hsl(38 92% 50%)"/>}
    </svg>
  );
};

const ReplenishmentView = () => {
  const [selected, setSelected] = React.useState(new Set());
  const [filter, setFilter] = React.useState('all');

  const filtered = MATERIALS.filter(m => filter === 'all' || m.status === filter);

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const orderNow = MATERIALS.filter(m => m.status === 'order-now');
  const orderSoon = MATERIALS.filter(m => m.status === 'order-soon');

  const selectedItems = MATERIALS.filter(m => selected.has(m.id));
  const selSuppliers = new Set(selectedItems.map(m => m.supplier)).size;

  return (
    <>
      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-label"><Icon name="alert" size={12}/> Order now</div>
          <div className="stat-value" style={{ color: 'hsl(var(--destructive))' }}>{orderNow.length}<span className="stat-suffix">at or below reorder point</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="info" size={12}/> Order soon</div>
          <div className="stat-value">{orderSoon.length}<span className="stat-suffix">approaching reorder</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="boxes" size={12}/> Materials tracked</div>
          <div className="stat-value">{MATERIALS.length}<span className="stat-suffix">across {Object.keys(SUPPLIERS).length} suppliers</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="calendar" size={12}/> Shortest cover</div>
          <div className="stat-value">7d<span className="stat-suffix">Worm Castings</span></div>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'hsl(0 0% 50%)' }}/>
          <input className="input" style={{ paddingLeft: 30, width: 280 }} placeholder="Search materials, suppliers…"/>
        </div>
        <div className="tabs">
          <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All <span style={{ color: 'hsl(0 0% 55%)', marginLeft: 2 }}>{MATERIALS.length}</span></button>
          <button className={`tab ${filter === 'order-now' ? 'active' : ''}`} onClick={() => setFilter('order-now')}>Order now <span style={{ color: 'hsl(0 0% 55%)', marginLeft: 2 }}>{orderNow.length}</span></button>
          <button className={`tab ${filter === 'order-soon' ? 'active' : ''}`} onClick={() => setFilter('order-soon')}>Soon <span style={{ color: 'hsl(0 0% 55%)', marginLeft: 2 }}>{orderSoon.length}</span></button>
          <button className={`tab ${filter === 'ok' ? 'active' : ''}`} onClick={() => setFilter('ok')}>Stocked <span style={{ color: 'hsl(0 0% 55%)', marginLeft: 2 }}>{MATERIALS.filter(m => m.status === 'ok').length}</span></button>
        </div>
        <div style={{ flex: 1 }}/>
        <button className="btn btn-outline btn-sm"><Icon name="sortAsc" size={13}/>Days of cover<Icon name="chevronDown" size={13}/></button>
        <button className="btn btn-outline btn-sm"><Icon name="settings" size={13}/>Reorder rules</button>
      </div>

      <div className="card">
        <table className="tbl tbl-compact">
          <thead><tr>
            <th style={{ width: 36 }}></th>
            <th>Material</th>
            <th>Status</th>
            <th style={{ width: 170 }}>On hand vs reorder</th>
            <th className="col-num">Days of cover</th>
            <th>Supplier</th>
            <th className="col-num">Suggested</th>
            <th className="col-actions"></th>
          </tr></thead>
          <tbody>
            {filtered.map(m => {
              const sup = SUPPLIERS[m.supplier];
              const max = Math.max(m.onHand, m.reorderAt * 2);
              const reorderPct = (m.reorderAt / max) * 100;
              const onHandPct = Math.min(100, (m.onHand / max) * 100);
              const tone = m.status === 'order-now' ? 'low' : m.status === 'order-soon' ? 'warn' : 'ok';
              return (
                <tr key={m.id} className={selected.has(m.id) ? 'selected' : ''}>
                  <td><Checkbox checked={selected.has(m.id)} onChange={() => toggle(m.id)}/></td>
                  <td><ItemCell name={m.name} sku={m.sku}/></td>
                  <td>
                    {m.status === 'order-now' && <span className="status-chip order-now"><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}/>Order now</span>}
                    {m.status === 'order-soon' && <span className="status-chip order-soon"><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}/>Order soon</span>}
                    {m.status === 'ok' && <span className="status-chip ok"><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}/>Stocked</span>}
                  </td>
                  <td>
                    <div className="stock-meter-wrap">
                      <div className="stock-meter">
                        <div className={`stock-meter-fill ${tone}`} style={{ width: `${onHandPct}%` }}/>
                        <div className="stock-meter-marker" style={{ left: `${reorderPct}%` }}/>
                      </div>
                      <div className="stock-meter-foot">
                        <span className="mono tabnum"><b>{m.onHand.toLocaleString()}</b> {m.unit}</span>
                        <span style={{ color: 'hsl(0 0% 55%)' }}>reorder at {m.reorderAt.toLocaleString()}</span>
                      </div>
                    </div>
                  </td>
                  <td className="col-num mono tabnum" style={{ color: m.daysCover < 14 ? 'hsl(var(--destructive))' : m.daysCover < 21 ? 'hsl(var(--warn))' : 'hsl(0 0% 35%)', fontWeight: m.daysCover < 14 ? 500 : 400 }}>
                    {m.daysCover}d
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 12.5 }}>{sup.name}</span>
                      <span style={{ fontSize: 11, color: 'hsl(0 0% 50%)' }}>Lead {sup.leadDays}d</span>
                    </div>
                  </td>
                  <td className="col-num mono tabnum">
                    {m.status !== 'ok'
                      ? <span style={{ fontWeight: 500 }}>{m.reorderQty}<span style={{ color: 'hsl(0 0% 60%)', fontSize: 11.5, marginLeft: 4, fontWeight: 400 }}>{m.unit}</span></span>
                      : <span style={{ color: 'hsl(0 0% 60%)' }}>—</span>
                    }
                  </td>
                  <td className="col-actions">
                    {m.status !== 'ok'
                      ? <button className="btn btn-outline btn-xs">Order</button>
                      : <button className="btn btn-ghost btn-xs">Adjust</button>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span><b>{selected.size}</b> material{selected.size > 1 ? 's' : ''} selected</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{selSuppliers} supplier{selSuppliers > 1 ? 's' : ''}</span>
          <div style={{ width: 1, height: 18, background: 'hsl(0 0% 100% / 0.2)', margin: '0 4px' }}/>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          <button className="btn btn-primary btn-sm"><Icon name="shoppingCart" size={13}/>Create {selSuppliers} PO{selSuppliers > 1 ? 's' : ''}</button>
        </div>
      )}
    </>
  );
};

window.ReplenishmentView = ReplenishmentView;
