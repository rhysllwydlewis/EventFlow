(function(){
  'use strict';
  if(!['/dashboard/customer','/dashboard-customer.html'].includes(location.pathname)) return;
  const MAX=5;
  const STYLE_ID='customer-dashboard-polish-styles';
  const STORE='ef_customer_card_collapsed_';
  let queued=false, observer=null;

  function svg(){return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';}
  function slug(v){return String(v||'card').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'card';}
  function title(card){return String(card.querySelector('.sd-card-header__heading,h2,h3')?.textContent||'').trim();}

  function styles(){
    if(document.getElementById(STYLE_ID)) return;
    const s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      .customer-dashboard-page .ef-dashboard-card--collapsible{overflow:hidden;transition:box-shadow .18s ease,border-color .18s ease,transform .18s ease}
      .customer-dashboard-page .ef-dashboard-card--collapsible>.sd-card-header{cursor:pointer}
      .customer-dashboard-page .ef-dashboard-card--collapsed>.cd-card-body{display:none!important}
      .customer-dashboard-page .ef-dashboard-collapse-toggle{display:inline-flex;align-items:center;justify-content:center;gap:.42rem;min-height:2.25rem;padding:.48rem .75rem;border-radius:999px;border:1px solid rgba(11,128,115,.18);background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(240,253,250,.9));color:#0b8073;cursor:pointer;font-family:inherit;font-size:.8rem;font-weight:850;line-height:1;box-shadow:0 8px 18px rgba(15,23,42,.06),inset 0 1px 0 rgba(255,255,255,.86);transition:transform .16s ease,background .16s ease,border-color .16s ease,box-shadow .16s ease}
      .customer-dashboard-page .ef-dashboard-collapse-toggle:hover,.customer-dashboard-page .ef-dashboard-collapse-toggle:focus-visible{background:linear-gradient(135deg,#fff,#ecfdf5);border-color:rgba(11,128,115,.36);box-shadow:0 12px 24px rgba(13,148,136,.13),inset 0 1px 0 rgba(255,255,255,.92);outline:2px solid rgba(11,128,115,.24);outline-offset:2px;transform:translateY(-1px)}
      .customer-dashboard-page .ef-dashboard-collapse-toggle svg{width:16px;height:16px;transition:transform .16s ease}
      .customer-dashboard-page .ef-dashboard-card--collapsible:not(.ef-dashboard-card--collapsed) .ef-dashboard-collapse-toggle svg{transform:rotate(180deg)}
      .customer-dashboard-page .recommendations-widget{overflow:hidden!important}
      .customer-dashboard-page .recommendations-header,.customer-dashboard-page .recommendations-widget__header{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:.85rem!important}
      .customer-dashboard-page .ef-recommendations-row,.customer-dashboard-page #recommendations-widget .recommendations-grid,.customer-dashboard-page .recommendations-widget .recommendations-grid{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:stretch!important;gap:1rem!important;overflow:hidden!important;width:100%!important;max-width:100%!important}
      .customer-dashboard-page .ef-recommendations-row>*,.customer-dashboard-page #recommendations-widget .recommendations-grid>*,.customer-dashboard-page .recommendations-widget .recommendations-grid>*{flex:1 1 0!important;min-width:0!important;width:auto!important;max-width:none!important;box-sizing:border-box!important}
      .customer-dashboard-page .ef-recommendations-row>*:nth-child(n+6),.customer-dashboard-page #recommendations-widget .recommendations-grid>*:nth-child(n+6),.customer-dashboard-page .recommendations-widget .recommendations-grid>*:nth-child(n+6),.customer-dashboard-page .recommendations-widget .ef-rec-hidden{display:none!important}
      @media(max-width:900px){.customer-dashboard-page .ef-recommendations-row,.customer-dashboard-page #recommendations-widget .recommendations-grid,.customer-dashboard-page .recommendations-widget .recommendations-grid{overflow-x:auto!important;padding-bottom:.3rem;scroll-snap-type:x proximity}.customer-dashboard-page .ef-recommendations-row>*,.customer-dashboard-page #recommendations-widget .recommendations-grid>*,.customer-dashboard-page .recommendations-widget .recommendations-grid>*{flex:0 0 min(78vw,265px)!important;scroll-snap-align:start}}
    `;
    document.head.appendChild(s);
  }

  function setCollapsed(card,button,collapsed){
    const t=title(card)||'section';
    card.classList.toggle('ef-dashboard-card--collapsed',collapsed);
    button.setAttribute('aria-expanded',String(!collapsed));
    button.setAttribute('aria-label',(collapsed?'Expand ':'Minimise ')+t);
    button.innerHTML='<span>'+(collapsed?'Expand':'Minimise')+'</span>'+svg();
    try{localStorage.setItem(STORE+slug(t),collapsed?'1':'0');}catch(e){}
  }

  function collapsibleCards(){
    document.querySelectorAll('.customer-dashboard-page .card.cd-card').forEach(card=>{
      if(card.dataset.efPolishCollapseReady==='1'||card.id==='wedding-website-dashboard-card'||card.classList.contains('no-collapse')) return;
      const h=card.querySelector(':scope>.sd-card-header'), b=card.querySelector(':scope>.cd-card-body');
      if(!h||!b) return;
      const t=title(card).toLowerCase();
      if(!['budget settings','events calendar','your plans','saved suppliers','quick actions','support tickets','conversations'].some(x=>t.includes(x))) return;
      let a=h.querySelector(':scope>.sd-card-header__actions');
      if(!a){a=document.createElement('div');a.className='sd-card-header__actions';h.appendChild(a);}
      const btn=document.createElement('button');
      btn.type='button';btn.className='ef-dashboard-collapse-toggle';
      b.id=b.id||slug(t)+'-body';btn.setAttribute('aria-controls',b.id);a.appendChild(btn);
      card.dataset.efPolishCollapseReady='1';card.classList.add('ef-dashboard-card--collapsible');
      let collapsed=false;try{collapsed=localStorage.getItem(STORE+slug(t))==='1';}catch(e){}
      setCollapsed(card,btn,collapsed);
      btn.addEventListener('click',e=>{e.stopPropagation();setCollapsed(card,btn,!card.classList.contains('ef-dashboard-card--collapsed'));});
      h.addEventListener('click',e=>{if(e.target.closest('button,a,input,select,textarea'))return;setCollapsed(card,btn,!card.classList.contains('ef-dashboard-card--collapsed'));});
    });
  }

  function recWidgets(){
    const explicit=[...document.querySelectorAll('.recommendations-widget,#recommendations-widget,[data-recommendations-widget]')];
    const fuzzy=[...document.querySelectorAll('.customer-dashboard-page .card,.customer-dashboard-page section')].filter(el=>/recommended for you/i.test(el.textContent||'')&&el.querySelector('a,article,.supplier-card,.recommendation-card'));
    return [...new Set([...explicit,...fuzzy])];
  }
  function recItems(w){return [...w.querySelectorAll('.recommendation-card,.supplier-card,[class*="supplier-card"],[class*="recommendation-card"],article')].filter(i=>!i.closest('.recommendations-header,.recommendations-widget__header')&&i!==w);}
  function recommendations(){
    recWidgets().forEach(w=>{
      const items=recItems(w); if(!items.length) return;
      items.forEach((i,n)=>i.classList.toggle('ef-rec-hidden',n>=MAX));
      const visible=items.slice(0,MAX); const parents=new Set(visible.map(i=>i.parentElement).filter(Boolean));
      if(parents.size===1){visible[0].parentElement.classList.add('ef-recommendations-row');return;}
      let header=w.querySelector('.recommendations-header,.recommendations-widget__header');
      let row=w.querySelector(':scope>.ef-recommendations-row');
      if(!row){row=document.createElement('div');row.className='ef-recommendations-row';if(header&&header.parentElement===w)header.after(row);else w.appendChild(row);}
      items.forEach(i=>row.appendChild(i));
    });
  }
  function run(){styles();collapsibleCards();recommendations();}
  function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;run();});}
  function init(){run();observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});}
  addEventListener('beforeunload',()=>{if(observer)observer.disconnect();});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
