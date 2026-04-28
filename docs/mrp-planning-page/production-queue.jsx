/* eslint-disable */
// Production view — Work Queue with downstream tree on sub-assemblies.

const ProductionQueue = () => {
  const [expanded, setExpanded] = React.useState(new Set());

  const toggleExpand = (id) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const buckets = React.useMemo(() => {
    const today = WORK_ITEMS.filter(w => w.daysOut === 0);
    const week  = WORK_ITEMS.filter(w => w.daysOut > 0 && w.daysOut <= 7);
    const next  = WORK_ITEMS.filter(w => w.daysOut > 7 && w.daysOut <= 14);
    const later = WORK_ITEMS.filter(w => w.daysOut > 14);
    return [
      { key: 'today', label: 'Now',       title: 'Start today',     meta: `${today.length} work order${today.length === 1 ? '' : 's'} · capacity 78%`, items: today },
      { key: 'week',  label: 'This week', title: 'Wed – Sun',       meta: `${week.length} work orders queued`, items: week },
      { key: 'next',  label: 'Next week', title: 'May 5 – May 11',  meta: `${next.length} work orders queued`, items: next },
      { key: 'later', label: 'Later',     title: 'May 12+',         meta: `${later.length} work orders queued`, items: later },
    ];
  }, []);

  // Downstream uses for a given sub-assembly SKU = work items consuming it,
  // expanded per sales-order-line they serve. Plus direct sales-order lines that
  // sell the sub-assembly itself as an end product.
  const downstreamUses = (parentWO) => {
    const uses = [];
    // Direct end-product sales (this sub-assembly sold as-is)
    parentWO.serves.forEach(s => {
      const product = PRODUCTS[s.sku];
      if (s.sku === parentWO.sku) {
        // sold as end product
        const so = SALES_ORDERS.find(o => o.id === s.id);
        uses.push({
          kind: 'final', soId: s.id, customer: so?.customer, dueDate: so?.dueDate, daysOut: so?.daysOut,
          qty: s.qty, sku: s.sku, productName: product?.name, productUnit: product?.unit,
        });
      }
    });
    // Downstream MOs that consume this SKU
    WORK_ITEMS.forEach(w => {
      const wp = PRODUCTS[w.sku];
      if (wp?.from === parentWO.sku) {
        // each SO this downstream MO serves becomes a row
        w.serves.forEach(s => {
          const so = SALES_ORDERS.find(o => o.id === s.id);
          uses.push({
            kind: 'downstream', soId: s.id, customer: so?.customer, dueDate: so?.dueDate, daysOut: so?.daysOut,
            qty: s.qty, sku: s.sku, productName: PRODUCTS[s.sku]?.name, productUnit: PRODUCTS[s.sku]?.unit,
            viaWO: w.id, viaStartBy: w.startBy,
          });
        });
      }
    });
    return uses.sort((a, b) => (a.daysOut ?? 99) - (b.daysOut ?? 99));
  };

  // Is this work order a sub-assembly (something downstream consumes it)?
  const isSubassembly = (wo) => WORK_ITEMS.some(o => PRODUCTS[o.sku]?.from === wo.sku);

  const criticalCount = WORK_ITEMS.filter(w => w.urgency === 'critical').length;
  const blockedCount = WORK_ITEMS.filter(w => w.blocked).length;
  const subassyCount = WORK_ITEMS.filter(isSubassembly).length;

  return (
    <>
      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-label"><Icon name="alert" size={12}/> Must start today</div>
          <div className="stat-value" style={{ color: criticalCount > 0 ? 'hsl(var(--destructive))' : undefined }}>
            {criticalCount}<span className="stat-suffix">work orders</span>
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="layers" size={12}/> Sub-assembly batches</div>
          <div className="stat-value">{subassyCount}<span className="stat-suffix">queued</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="clipboardList" size={12}/> Open sales orders</div>
          <div className="stat-value">{SALES_ORDERS.length}<span className="stat-suffix">in plan</span></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><Icon name="info" size={12}/> Schedule confidence</div>
          <div className="stat-value">{blockedCount === 0 ? '100%' : '92%'}<span className="stat-suffix">{blockedCount} dep{blockedCount === 1 ? '' : 's'}</span></div>
        </div>
      </div>

      {buckets.map(b => (
        <div key={b.key} className="bucket">
          <div className="bucket-header">
            <span className="bucket-label">{b.label}</span>
            <span className="bucket-title">{b.title}</span>
            <span className="bucket-meta">{b.meta}</span>
          </div>
          <div className="bucket-rule"/>
          <div className="work-list">
            {b.items.length === 0 && (
              <div style={{ padding: '14px 16px', fontSize: 13, color: 'hsl(0 0% 50%)', textAlign: 'center', border: '1px dashed hsl(0 0% 88%)', borderRadius: 8 }}>Nothing scheduled.</div>
            )}
            {b.items.map(w => {
              const product = PRODUCTS[w.sku];
              const subassy = isSubassembly(w);
              const isBlocked = !!w.blocked;
              const uses = subassy ? downstreamUses(w) : [];
              const isOpen = expanded.has(w.id);

              return (
                <div key={w.id} className={`work-card-wrap ${subassy ? 'has-tree' : ''}`}>
                  <div className={`work-card urgency-${w.urgency} ${isBlocked ? 'blocked' : ''}`}>
                    <div className="drag-handle" aria-label="reorder"/>
                    <div className="work-card-thumb"/>
                    <div className="work-card-main">
                      <div className="work-card-title">
                        <span className="qty">{w.qty}</span>
                        <span>{product?.name}</span>
                        <span style={{ color: 'hsl(0 0% 55%)', fontWeight: 400, fontSize: 13 }}>{product?.unit}</span>
                        {isBlocked && <span className="tag-soft tag-blocked"><Icon name="info" size={10}/>Waits on {w.blocked.replace('wo-','#')}</span>}
                      </div>
                      <div className="work-card-meta">
                        {subassy ? (
                          <button
                            onClick={() => toggleExpand(w.id)}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'hsl(0 0% 30%)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500 }}
                          >
                            <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={11}/>
                            Feeds {uses.length} downstream use{uses.length === 1 ? '' : 's'}
                          </button>
                        ) : (
                          <span><span className="mono" style={{ fontSize: 11.5 }}>{w.serves[0].id}</span>{w.serves.length === 1 ? ` · ${SALES_ORDERS.find(o => o.id === w.serves[0].id)?.customer || ''}` : ` +${w.serves.length - 1} more`}</span>
                        )}
                        {w.note && <><span className="dot"/><span>{w.note}</span></>}
                      </div>
                    </div>
                    <div className="work-card-due">
                      <div className="work-card-due-label">Required by</div>
                      <div className={`work-card-due-value ${w.urgency === 'critical' ? 'critical' : ''}`}>{w.requiredBy}</div>
                    </div>
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label="more"><Icon name="moreHorizontal" size={14}/></button>
                    <button className={`btn ${b.key === 'today' ? 'btn-primary' : 'btn-outline'} btn-sm`}>
                      {b.key === 'today' ? <><Icon name="check" size={13}/>Start MO</> : 'Schedule'}
                    </button>
                  </div>

                  {subassy && isOpen && (
                    <div className="downstream">
                      <ul className="downstream-list">
                        {uses.map((u, idx) => (
                          <li key={idx} className="downstream-item">
                            <div className="downstream-body">
                              <div className="downstream-row1">
                                <span className="downstream-qty">{u.qty}</span>
                                <span className="downstream-name">{u.productName}</span>
                                <span className="downstream-unit">{u.productUnit}</span>
                                {u.kind === 'downstream' && (
                                  <>
                                    <span className="tag-soft"><Icon name="layers" size={10}/>Sub-assembly</span>
                                    <span
                                      className="downstream-rule"
                                      title={`${product?.name} ${product?.unit} must be >10 days old to be used in production of ${u.productName} ${u.productUnit}`}
                                    >
                                      requires 10+ day hold
                                    </span>
                                  </>
                                )}
                              </div>
                              <div className="downstream-row2">
                                <span className="mono">{u.soId}</span>
                                <span className="sep">·</span>
                                <span>{u.customer}</span>
                                <span className="sep">·</span>
                                <span>Due {u.dueDate}</span>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
};

window.ProductionQueue = ProductionQueue;
