/* eslint-disable */
// Production view — Option B: Sales-Order Driven Schedule
// Each open SO expands to its production tree (parent + sub-assembly chain).
// Backwards planning: due date → work-back to "must start by".

const ProductionByOrder = () => {
  const [open, setOpen] = React.useState(new Set(SALES_ORDERS.slice(0, 4).map(s => s.id)));

  const toggle = (id) => {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    setOpen(next);
  };

  // Build production steps for a sales order, walking backwards through dep graph.
  const stepsForOrder = (so) => {
    const steps = [];
    so.items.forEach(item => {
      const product = PRODUCTS[item.sku];
      // direct production
      const directWO = WORK_ITEMS.find(w => w.sku === item.sku && w.serves.some(s => s.id === so.id));
      // sub-assembly upstream
      if (product?.from) {
        const subWO = WORK_ITEMS.find(w => w.sku === product.from && w.serves.some(s => s.id === so.id));
        if (subWO) steps.push({ ...subWO, role: 'sub-assembly', forItem: item });
      }
      if (directWO) steps.push({ ...directWO, role: 'final', forItem: item });
      else if (!product?.from) {
        // simple direct production with no dep
        steps.push({ id: 'direct-' + so.id + '-' + item.sku, sku: item.sku, qty: item.qty, role: 'final', forItem: item, requiredBy: so.dueDate, startBy: '—' });
      }
    });
    return steps;
  };

  return (
    <>
      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-label"><Icon name="tag" size={12}/> Open sales orders</div>
          <div className="stat-value">{SALES_ORDERS.length}<span className="stat-suffix">in plan</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="alert" size={12}/> At risk</div>
          <div className="stat-value" style={{ color: 'hsl(var(--destructive))' }}>2<span className="stat-suffix">need start today</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="layers" size={12}/> Production steps</div>
          <div className="stat-value">{WORK_ITEMS.length}<span className="stat-suffix">across all orders</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="calendar" size={12}/> Earliest due</div>
          <div className="stat-value">May 3<span className="stat-suffix">SO-3041</span></div>
        </div>
      </div>

      {SALES_ORDERS.map(so => {
        const steps = stepsForOrder(so);
        const isOpen = open.has(so.id);
        const atRisk = steps.some(s => WORK_ITEMS.find(w => w.id === s.id)?.urgency === 'critical');

        return (
          <div key={so.id} className="tl-order">
            <div className="tl-order-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn btn-ghost btn-icon btn-xs" onClick={() => toggle(so.id)} aria-label="toggle">
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14}/>
                </button>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{so.id}</span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{so.customer}</span>
                    {atRisk && <span className="status-chip order-now"><Icon name="alert" size={11}/>At risk</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'hsl(0 0% 45%)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Due {so.dueDate}</span>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'hsl(0 0% 80%)', display: 'inline-block' }}/>
                    <span>{inDays(so.daysOut)}</span>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'hsl(0 0% 80%)', display: 'inline-block' }}/>
                    <span>{so.value}</span>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'hsl(0 0% 80%)', display: 'inline-block' }}/>
                    <span>{steps.length} production step{steps.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm">View order</button>
                <button className="btn btn-primary btn-sm"><Icon name="sparkles" size={13}/>Schedule all</button>
              </div>
            </div>

            {isOpen && (
              <div>
                {steps.map((s, idx) => {
                  const product = PRODUCTS[s.sku];
                  const isLast = idx === steps.length - 1;
                  const w = WORK_ITEMS.find(wo => wo.id === s.id);
                  const urgency = w?.urgency || 'normal';
                  return (
                    <div key={s.id} className="tl-row">
                      <div className="tl-rail">
                        <span className={`tl-dot ${s.role === 'sub-assembly' ? 'subassy' : 'start'}`}/>
                        {!isLast && <span className="tl-line"/>}
                      </div>
                      <div className="tl-step" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 5, background: 'repeating-linear-gradient(45deg, hsl(0 0% 96%) 0 4px, hsl(0 0% 92%) 4px 8px)', border: '1px solid hsl(0 0% 90%)', flexShrink: 0 }}/>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                              <span style={{ background: 'hsl(0 0% 96%)', padding: '1px 6px', borderRadius: 4, fontSize: 12, fontFamily: 'Geist Mono, monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{s.qty}</span>
                              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{product?.name}</span>
                              <span style={{ color: 'hsl(0 0% 55%)', fontSize: 12.5 }}>{product?.unit}</span>
                              {s.role === 'sub-assembly' && <span className="tag-soft"><Icon name="layers" size={10}/>Sub-assembly</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'hsl(0 0% 45%)' }}>
                              <span className="mono" style={{ fontSize: 11.5 }}>{s.sku}</span>
                              {w?.note && <> · {w.note}</>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 11, color: 'hsl(0 0% 50%)' }}>Start by</div>
                            <div style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: urgency === 'critical' ? 'hsl(var(--destructive))' : undefined }}>{w?.startBy || s.startBy}</div>
                          </div>
                          <Icon name="arrowRight" size={14} style={{ color: 'hsl(0 0% 70%)' }}/>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 11, color: 'hsl(0 0% 50%)' }}>Required by</div>
                            <div style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{w?.requiredBy || s.requiredBy}</div>
                          </div>
                          <button className={`btn ${urgency === 'critical' ? 'btn-primary' : 'btn-outline'} btn-sm`}>
                            {urgency === 'critical' ? 'Start now' : 'Schedule'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

window.ProductionByOrder = ProductionByOrder;
