/* eslint-disable */
// Shared chrome — sidebar, topbar, helpers

const { PRODUCTS, SALES_ORDERS, WORK_ITEMS, MATERIALS, SUPPLIERS, AGING_DAYS } = window.PLAN_DATA;

const fmtMoney = (n) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtMoneyShort = (n) => {
  if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.0$/, '') + 'k';
  return '$' + Math.round(n).toLocaleString();
};
const inDays = (d) => d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
const todayLabel = () => 'Mon, Apr 27';

window.PLAN_HELPERS = { fmtMoney, fmtMoneyShort, inDays, todayLabel };

const Sidebar = ({ activeTab }) => (
  <aside className="sidebar">
    <div className="sidebar-org">
      <div className="sidebar-org-avatar">PA</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>Paonia Soil Co.</div>
        <div style={{ fontSize: 11, color: 'hsl(0 0% 45%)' }}>Pilot</div>
      </div>
    </div>

    <div className="sidebar-section-label">Operations</div>
    <a className="sidebar-item active"><Icon name="layers" size={15} className="ico"/>Planning<span style={{ marginLeft: 'auto', fontSize: 11, color: 'hsl(0 0% 45%)' }}>{WORK_ITEMS.length + MATERIALS.filter(m => m.status !== 'ok').length}</span></a>
    <a className="sidebar-item"><Icon name="boxes" size={15} className="ico"/>Inventory</a>
    <a className="sidebar-item"><Icon name="factory" size={15} className="ico"/>Manufacturing</a>
    <a className="sidebar-item"><Icon name="shoppingCart" size={15} className="ico"/>Purchasing</a>
    <a className="sidebar-item"><Icon name="tag" size={15} className="ico"/>Sales</a>

    <div className="sidebar-section-label">Records</div>
    <a className="sidebar-item"><Icon name="package" size={15} className="ico"/>Products</a>
    <a className="sidebar-item"><Icon name="users" size={15} className="ico"/>Customers</a>
    <a className="sidebar-item"><Icon name="truck" size={15} className="ico"/>Suppliers</a>

    <div style={{ flex: 1 }}/>
    <a className="sidebar-item"><Icon name="settings" size={15} className="ico"/>Settings</a>
  </aside>
);

const Topbar = () => (
  <header className="topbar">
    <div className="crumbs">
      <span>Operations</span>
      <span className="sep">/</span>
      <span className="crumb-active">Planning</span>
    </div>
    <div style={{ flex: 1 }}/>
    <span style={{ fontSize: 12, color: 'hsl(0 0% 45%)', marginRight: 6 }}>{todayLabel()}</span>
    <button className="btn btn-ghost btn-sm btn-icon" aria-label="Refresh"><Icon name="refresh" size={15}/></button>
    <button className="btn btn-ghost btn-sm btn-icon" aria-label="Notifications"><Icon name="bell" size={15}/></button>
    <div style={{ width: 1, height: 18, background: 'hsl(0 0% 90%)' }}/>
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'hsl(0 0% 90%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 500 }}>JD</div>
  </header>
);

const PageHeader = ({ subtitle, children }) => (
  <div className="page-header">
    <div>
      <h1 className="page-title">Planning</h1>
      <p className="page-sub">{subtitle}</p>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      {children}
    </div>
  </div>
);

const PrimaryTabs = ({ tab, setTab }) => (
  <div className="primary-tabs">
    <button className={`primary-tab ${tab === 'production' ? 'active' : ''}`} onClick={() => setTab('production')}>
      <Icon name="factory" size={14}/> Production
      <span className="primary-tab-count">{WORK_ITEMS.length}</span>
    </button>
    <button className={`primary-tab ${tab === 'replenishment' ? 'active' : ''}`} onClick={() => setTab('replenishment')}>
      <Icon name="boxes" size={14}/> Replenishment
      <span className="primary-tab-count">{MATERIALS.filter(m => m.status !== 'ok').length}</span>
    </button>
  </div>
);

const Urgency = ({ level, label }) => {
  return (
    <div className={`urgency ${level}`}>
      <span className="dot"/>
      <span>{label}</span>
    </div>
  );
};

const ItemCell = ({ name, sku, suffix }) => (
  <div className="item">
    <div className="item-thumb"/>
    <div style={{ minWidth: 0 }}>
      <div className="item-name">{name}{suffix && <span style={{ color: 'hsl(0 0% 50%)', fontWeight: 400 }}> · {suffix}</span>}</div>
      <div className="item-sku mono">{sku}</div>
    </div>
  </div>
);

const SoStack = ({ ids }) => (
  <div className="so-stack">
    {ids.map(id => <span key={id} className="so-pill">{id.replace('SO-','#')}</span>)}
  </div>
);

const Checkbox = ({ checked, indeterminate, onChange, ariaLabel }) => {
  const ref = React.useRef(null);
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" className={`checkbox ${indeterminate ? 'indeterminate' : ''}`} checked={!!checked} onChange={onChange} aria-label={ariaLabel}/>;
};

Object.assign(window, { Sidebar, Topbar, PageHeader, PrimaryTabs, Urgency, ItemCell, SoStack, Checkbox });
