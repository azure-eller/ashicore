/* eslint-disable */
// Main app — Production / Replenishment tabs.

const { useTweaks, TweaksPanel, TweakSection, TweakRadio } = window;

const App = () => {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "tab": "production"
  }/*EDITMODE-END*/;

  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const tab = tweaks.tab;
  const setTab = (v) => setTweak('tab', v);

  return (
    <div className="app" data-screen-label="Planning">
      <Sidebar/>
      <div className="main">
        <Topbar/>
        <div className="content">
          <PageHeader subtitle={
            tab === 'production'
              ? 'What you need to make next, ordered by what your sales orders demand.'
              : 'Raw materials approaching reorder. Bulk-order to keep production stocked.'
          }>
            <button className="btn btn-outline btn-sm"><Icon name="download" size={14}/>Export</button>
            <button className="btn btn-primary btn-sm"><Icon name="sparkles" size={14}/>Auto-plan</button>
          </PageHeader>

          <PrimaryTabs tab={tab} setTab={setTab}/>

          {tab === 'production' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16, gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'hsl(0 0% 50%)' }}/>
                  <input className="input" style={{ paddingLeft: 30, width: 240 }} placeholder="Search…"/>
                </div>
                <button className="btn btn-outline btn-sm"><Icon name="filter" size={13}/>Filter<Icon name="chevronDown" size={13}/></button>
              </div>

              <ProductionQueue/>
            </>
          )}

          {tab === 'replenishment' && <ReplenishmentView/>}
        </div>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="View"/>
        <TweakRadio
          label="Tab"
          value={tab}
          options={['production', 'replenishment']}
          onChange={v => setTab(v)}
        />
      </TweaksPanel>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
