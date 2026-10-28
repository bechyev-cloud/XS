/* Сгенерировано tools/gen_park_cards.py из index.html — не править вручную. Функции карточек машин для страницы клиентов. */
const FX_I = {
  service:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
  all:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  free:'<path d="M20 6 9 17l-5-5"/>',
  rented:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  active:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  booked:'<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  service:'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4Z"/>',
  debt:'<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  fines:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  blacklist:'<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  oldDebt:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  oil:'<path d="M12 2.7S6 9 6 14a6 6 0 0 0 12 0c0-5-6-11.3-6-11.3Z"/>',
  violations:'<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5Z"/><path d="M12 8v4M12 16h.01"/>',
  week:'<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M8 15h8"/>',
  month:'<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  year:'<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  custom:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  home:'<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  dash:'<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  reports:'<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="5" rx="1"/><rect x="12" y="8" width="3" height="9" rx="1"/><rect x="17" y="5" width="3" height="12" rx="1"/>',
  income:'<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  repair:'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4Z"/>',
  pm:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  group:'<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"/>',
  news:'<path d="m3 11 18-8v18L3 13Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  support:'<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2ZM3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2Z"/><path d="M18 17v1a3 3 0 0 1-3 3h-3"/>',
  mine:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  xcar:'<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  tg:'<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
};
const FX_C = { service:'#e39a1e', all:'var(--accent)', week:'#3d8bfd', month:'#8b5cf6', year:'#0ea5e9', custom:'#64748b', globe:'#3d8bfd', home:'#22c08a', refresh:'#64748b', dash:'#3d8bfd', reports:'#8b5cf6', income:'#22c08a', repair:'#f97316', pm:'#3d8bfd', group:'#22c08a', news:'#f59e0b', support:'#8b5cf6', mine:'#22c08a', xcar:'#3d8bfd', tg:'#0ea5e9', free:'#22c08a', rented:'#3d8bfd', booked:'#8b5cf6', service:'#f97316', active:'#22c08a', debt:'#ef4444', fines:'#f59e0b', blacklist:'#64748b', oldDebt:'#e11d48', oil:'#0ea5e9', violations:'#dc2626' };
function ctvProg(ct){ if(ct.status==='done') return 1; if(ct.status==='booked' || ct.status==='cancelled') return 0; const s = +new Date(ct.start), e = +new Date(ct.end); if(!(e>s)) return 0; return Math.max(0, Math.min(1, (Date.now()-s)/(e-s))); }
const TI = {
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  hour:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12M7 2c0 5 10 6 10 10S7 17 7 22M17 2c0 5-10 6-10 10s10 5 10 10"/></svg>',
  arrow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
function tileSpecs(c, cls){
  const it = [];
  if(c.year) it.push([TI.cal, esc(c.year), 'год']);
  if(c.rate6h) it.push([TI.clock, money(c.rate6h), '6 часов']);
  if(c.overdueHourRate) it.push([TI.hour, money(c.overdueHourRate), 'час сверх']);
  return `<div class="tspec ${cls||''}">${it.map(([i,v,l])=>`<span>${i}<b>${v}</b><small>${l}</small></span>`).join('')}</div>`;
}
const money = n => (Math.round(n||0)).toLocaleString('ru-RU') + ' ' + DB.settings.currency;
function plateChip(plate, cls){
  const p = String(plate||'').trim(); if(!p) return '';
  const m = /^(.*?)[\s]*(\d{2,3})$/.exec(p.replace(/\s+/g,' '));
  const main = m && m[1].trim().length>=4 ? m[1].trim() : p, reg = m && m[1].trim().length>=4 ? m[2] : '';
  return `<span class="rplate ${cls||''}"><b>${esc(main)}</b>${reg?`<i>${esc(reg)}<small>RUS</small></i>`:''}</span>`;
}
function esc(s){ return (s||'').toString().replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function timerSvg(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>`;
}
function timeLeftLabel(endStr){
  const diffMs = new Date(endStr) - new Date();
  const abs = Math.abs(diffMs);
  const totalMin = Math.floor(abs/60000);
  const d = Math.floor(totalMin/1440), h = Math.floor((totalMin%1440)/60), m = totalMin%60;
  let text;
  if(d>0) text = `${d} д ${h} ч`;
  else if(h>0) text = `${h} ч ${m} мин`;
  else text = `${m} мин`;
  return diffMs>=0 ? { text:'Осталось '+text, overdue:false } : { text:'Просрочено на '+text, overdue:true };
}
function activeContractForCar(carId){
  return DB.contracts.find(c=>c.carId===carId && c.status==='active');
}
function carCard(c, viewMode){
  const badgeCls = {free:'free',rented:'rented',booked:'booked',service:'service'}[c.status];
  const badgeText = {free:'Свободна',rented:'В аренде',booked:'Забронирована',service:'Ремонт'}[c.status];
  const ac = c.status==='rented' ? activeContractForCar(c.id) : null;
  const tl = ac ? timeLeftLabel(ac.end) : null;
  const hasPhoto = !!c.photo;
  const plateIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h1M16 11h1"/></svg>`;
  const carSilhouette = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h1a2 2 0 1 0 4 0h4a2 2 0 1 0 4 0h1a1 1 0 0 0 1-1v-3a2 2 0 0 0-.4-1.2l-2.1-2.8a2 2 0 0 0-1.6-.8H6a1 1 0 0 0-1 .8L4.2 12A2 2 0 0 0 4 12.8V16a1 1 0 0 0 1 1Z"/><path d="M4 12h16"/></svg>`;
  if(DB.settings.windowsMode && viewMode==='tiles'){
    const st = DB.settings.carTileStyle || 's7';
    const photoHtml = hasPhoto ? `<img src="${c.photo}" alt="">` : carSilhouette;
    return `
    <div class="card win-car-tile wct-${st} ${hasPhoto?'has-photo':''} ${ac ? (tl.overdue?'overdue-glow':'rented-glow') : ''}" ${st==='s28' && hasPhoto ? `data-tint="${c.id}"` : ''} onclick="openCarDetail('${c.id}')">
      <div class="wct-photo">
        ${photoHtml}
        <span class="badge ${badgeCls} wct-badge">${badgeText}</span>
        ${ac ? `<span class="timer-pill ${tl.overdue?'overdue':''} wct-timer">${timerSvg()}${tl.text}</span>` : ''}
        ${st==='s2' ? `<div class="wct-ov"><div class="wct-glass"><div style="min-width:0"><div class="wct-name">${esc(c.make)} ${esc(c.model)}</div><div class="wct-yr">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</div></div><div class="wct-amount">${money(c.rate)}<small>в сутки</small></div></div></div>${plateChip(c.plate,'on-photo')}` : ''}
        ${st==='s3' ? `<div class="wct-tag"><small>за сутки</small>${money(c.rate)}</div>` : ''}
        ${st==='s21' ? `<div class="pz-top"><span>${esc(c.make)}</span><b>${esc(c.model)}</b>${c.year?`<i>${esc(c.year)}</i>`:''}</div>` : ''}
        ${st==='s23' ? `<svg class="wv" viewBox="0 0 400 60" preserveAspectRatio="none"><path d="M0 34 C 90 6, 170 6, 240 26 S 360 56, 400 22 L400 60 L0 60 Z"/></svg>` : ''}
        ${st==='s15' ? `<div class="sp-band"><span>${money(c.rate)}</span><small>в сутки</small></div>` : ''}
        ${st==='s17' ? `<div class="cpt-chips">${c.year?`<span>${TI.cal}${esc(c.year)}</span>`:''}${c.rate6h?`<span>${TI.clock}6 ч · ${money(c.rate6h)}</span>`:''}${c.overdueHourRate?`<span>${TI.hour}${money(c.overdueHourRate)}/ч</span>`:''}</div>` : ''}
        ${st==='s19' ? `<div class="rb"><span>${money(c.rate)}<small>в сутки</small></span></div>` : ''}
        ${st==='s10' ? `<div class="dg"><div class="dg-top"><div style="min-width:0"><div class="dg-name">${esc(c.make)} ${esc(c.model)}</div><div class="dg-plate">${esc(c.plate||'')}</div></div><div class="dg-price">${money(c.rate)}<small>в сутки</small></div></div>${tileSpecs(c,'dark')}</div>` : ''}
        ${st==='s7' ? `<div class="wct-coin"><b>${money(c.rate).replace(/\s?₽/,'')}</b><small>₽ / сутки</small></div>` : ''}
        ${st==='s8' ? `<div class="wct-mag"><span class="wct-mag-brand">${esc(c.make)}</span><span class="wct-mag-model">${esc(c.model)}</span>${c.year?`<span class="wct-mag-yr">${esc(c.year)}</span>`:''}</div><div class="wct-mag-bot"><span class="wct-mag-price">${money(c.rate)}<small> / сутки</small></span>${plateChip(c.plate)}</div>` : ''}
      </div>
      ${st==='s2' || st==='s8' || st==='s10' ? '' : st==='s25' ? `<div class="hg">
        <div class="hg-row"><div style="min-width:0"><div class="hg-name">${esc(c.make)} ${esc(c.model)}</div><div class="hg-sub">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</div></div>${plateChip(c.plate)}</div>
        <div class="hg-price"><span>${money(c.rate)}</span><small>в сутки</small></div>
      </div>` : st==='s26' ? `<div class="sl">
        <div class="sl-brand">${esc(c.make)}</div><div class="sl-model">${esc(c.model)}</div>
        <div class="sl-row"><span>${c.year?esc(c.year):''}</span><b>${money(c.rate)}<small> / сутки</small></b><span>${esc(c.plate||'')}</span></div>
      </div>` : st==='s27' ? `<div class="fl">
        <div class="fl-row"><div style="min-width:0"><div class="fl-name">${esc(c.make)} ${esc(c.model)}</div><div class="fl-icons">${c.year?`<span>${TI.cal}${esc(c.year)}</span>`:''}${c.rate6h?`<span>${TI.clock}${money(c.rate6h)}</span>`:''}${c.overdueHourRate?`<span>${TI.hour}${money(c.overdueHourRate)}/ч</span>`:''}</div></div>${plateChip(c.plate)}</div>
        <div class="fl-price"><div><small>Стоимость суток</small><b>${money(c.rate)}</b></div><span class="fl-status"><i></i>${badgeText}</span></div>
        <div class="fl-btns"><span class="fl-b main">Оформить аренду</span><span class="fl-b">Детали</span></div>
      </div>` : st==='s28' ? `<div class="tn">
        <div class="tn-row"><div style="min-width:0"><div class="tn-name">${esc(c.make)} ${esc(c.model)}</div><div class="tn-sub">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</div></div><div class="tn-price">${money(c.rate)}<small>в сутки</small></div></div>
        ${plateChip(c.plate,'tintp')}
      </div>` : st==='s21' ? `<div class="pz">
        <div class="pz-row"><div class="pz-price">${money(c.rate)}<small>в сутки</small></div>${plateChip(c.plate)}</div>
        ${tileSpecs(c)}
      </div>` : st==='s22' ? `<div class="cr">
        <div class="cr-brand">${esc(c.make)}</div><div class="cr-model">${esc(c.model)}</div>
        <div class="cr-row"><span class="cr-sub">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</span><span class="cr-price">${money(c.rate)}<small>/ сутки</small></span></div>
        <div class="cr-row">${plateChip(c.plate,'chrome')}<span class="cr-go">Выбрать ${TI.arrow}</span></div>
      </div>` : st==='s23' ? `<div class="wvi">
        <div class="wvi-head"><div style="min-width:0"><div class="wvi-name">${esc(c.make)} <b>${esc(c.model)}</b></div><div class="wvi-sub">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</div></div><div class="wvi-price">${money(c.rate)}<small>в сутки</small></div></div>
        <div class="wvi-foot">${plateChip(c.plate)}<span class="wvi-status"><i></i>${badgeText}</span></div>
      </div>` : st==='s24' ? `<div class="du">
        <div class="du-head"><div style="min-width:0"><div class="du-name">${esc(c.make)} ${esc(c.model)}</div><div class="du-sub">${c.year?esc(c.year)+' г.':''}</div></div>${plateChip(c.plate)}</div>
        <div class="du-opts"><div class="du-o on"><small>Сутки</small><b>${money(c.rate)}</b></div><div class="du-o"><small>6 часов</small><b>${c.rate6h?money(c.rate6h):'—'}</b></div>${c.overdueHourRate?`<div class="du-o"><small>Час сверх</small><b>${money(c.overdueHourRate)}</b></div>`:''}</div>
      </div>` : st==='s13' ? `<div class="au">
        <div class="au-brand">${esc(c.make)}</div><div class="au-model">${esc(c.model)}</div>
        <div class="au-price">${money(c.rate).replace(/\s?₽/,'')}<span>₽</span></div><div class="au-per">в сутки · ${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</div>
        ${plateChip(c.plate)}
      </div>` : st==='s14' ? `<div class="bn">
        <div class="bn-name">${esc(c.make)} ${esc(c.model)}</div>
        <div class="bn-grid"><div class="bn-t acc"><small>сутки</small><b>${money(c.rate)}</b></div><div class="bn-t"><small>6 часов</small><b>${c.rate6h?money(c.rate6h):'—'}</b></div><div class="bn-t"><small>год</small><b>${esc(c.year||'—')}</b></div><div class="bn-t plate"><small>госномер</small>${plateChip(c.plate)||'—'}</div></div>
      </div>` : st==='s15' ? `<div class="spt"><div class="spt-name">${esc(c.make)} <b>${esc(c.model)}</b></div><div class="spt-row"><span>${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</span>${plateChip(c.plate)}</div></div>`
      : st==='s16' ? `<div class="k16">
        <div class="k16-line"></div>
        <div class="k16-model">${esc(c.make)} ${esc(c.model)}</div>
        <div class="k16-row"><span class="k16-sub">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</span><span class="k16-price">${money(c.rate)}<small> / сутки</small></span></div>
        <div class="k16-row">${plateChip(c.plate,'bk')}<span class="k16-btn">Арендовать</span></div>
      </div>` : st==='s17' ? `<div class="cpi"><div style="min-width:0"><div class="wct-name">${esc(c.make)} ${esc(c.model)}</div>${plateChip(c.plate,'mt')}</div><div class="cpi-price">${money(c.rate)}<small>в сутки</small></div></div>`
      : st==='s18' ? `<div class="stk"><div class="stk-row"><div style="min-width:0"><div class="stk-name">${esc(c.make)} ${esc(c.model)}</div><div class="stk-sub">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</div></div><div class="stk-price">${money(c.rate)}<small>/сут</small></div></div>${plateChip(c.plate)}</div>`
      : st==='s19' ? `<div class="rbi"><div class="wct-name">${esc(c.make)} ${esc(c.model)}</div><div class="wct-row"><span class="wct-yr">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</span>${plateChip(c.plate)}</div></div>`
      : st==='s20' ? `<div class="nt"><div style="min-width:0"><div class="nt-brand">${esc(c.make)}</div><div class="nt-model">${esc(c.model)}</div><div class="nt-sub">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</div><div class="nt-plate">${esc(c.plate||'')}</div></div><div class="nt-ring"><b>${money(c.rate).replace(/\s?₽/,'')}</b><small>₽/сутки</small></div></div>`
      : st==='s9' ? `<div class="vt">
        <div class="vt-head"><div style="min-width:0"><div class="vt-brand">${esc(c.make)}</div><div class="vt-model">${esc(c.model)}</div></div>${plateChip(c.plate)}</div>
        ${tileSpecs(c)}
        <div class="vt-foot"><div class="vt-price">${money(c.rate)}<small>/ сутки</small></div><span class="vt-go">Подробнее ${TI.arrow}</span></div>
      </div>` : st==='s11' ? `<div class="tk">
        <div class="tk-main"><div class="tk-name">${esc(c.make)} ${esc(c.model)}</div><div class="tk-sub">${c.year?esc(c.year)+' г.':''}${c.rate6h?(c.year?' · ':'')+'6 ч — '+money(c.rate6h):''}</div>${plateChip(c.plate,'mt')}</div>
        <div class="tk-stub"><small>сутки</small><b>${money(c.rate).replace(/\s?₽/,'')}</b><small>₽</small></div>
      </div>` : st==='s12' ? `<div class="ap">
        <div class="ap-row"><div style="min-width:0"><div class="ap-name">${esc(c.make)} ${esc(c.model)}</div><div class="ap-sub">${[c.year?esc(c.year):'', esc(c.plate||'')].filter(Boolean).join('  ·  ')}</div></div><span class="ap-go">${TI.arrow}</span></div>
        <div class="ap-row"><span class="ap-price">${money(c.rate)} <small>/ сутки</small></span>${c.rate6h?`<span class="ap-six">6 ч · ${money(c.rate6h)}</span>`:''}</div>
      </div>` : st==='s5' ? `<div class="wct-info lux">
        <div class="lux-brand">${esc(c.make)}</div>
        <div class="lux-row"><div class="lux-model">${esc(c.model)}${c.year?` <i>${esc(c.year)}</i>`:''}</div><div class="lux-price">${money(c.rate)}<small>сутки</small></div></div>
        <div class="lux-line"></div>
        <div class="lux-row">${plateChip(c.plate,'gold')}${c.rate6h?`<span class="lux-six">6 ч · ${money(c.rate6h)}</span>`:''}</div>
      </div>` : st==='s6' ? `<div class="wct-info salon">
        <div class="salon-brand">${esc(c.make)}</div><div class="salon-model">${esc(c.model)}</div>
        <div class="salon-specs"><span><b>${esc(c.year||'—')}</b>год</span><span><b>${c.rate6h?money(c.rate6h):'—'}</b>6 часов</span><span><b>${c.overdueHourRate?money(c.overdueHourRate):'—'}</b>час сверх</span></div>
        <div class="salon-bot"><div class="salon-price">${money(c.rate)}<small>/ сутки</small></div><span class="salon-btn">Оформить</span></div>
        <div class="salon-plate">${plateChip(c.plate)}</div>
      </div>` : st==='s7' ? `<div class="wct-info neon">
        <div class="wct-name">${esc(c.make)} ${esc(c.model)}</div>
        <div class="wct-row"><span class="wct-yr">${[c.year?esc(c.year)+' г.':'', c.rate6h?'6 ч — '+money(c.rate6h):''].filter(Boolean).join(' · ')}</span>${plateChip(c.plate)}</div>
      </div>` : st==='s3' ? `<div class="wct-info">
        <div class="wct-row"><div class="wct-name">${esc(c.make)} ${esc(c.model)}</div>${plateChip(c.plate)}</div>
        <div class="wct-chips">${c.year?`<span>📅 ${esc(c.year)}</span>`:''}${c.rate6h?`<span>⏱ 6 ч · ${money(c.rate6h)}</span>`:''}${c.overdueHourRate?`<span>⌛ ${money(c.overdueHourRate)}/ч</span>`:''}</div>
      </div>` : st==='s4' ? `<div class="wct-info">
        <div class="wct-top"><div><div class="wct-name">${esc(c.make)} ${esc(c.model)}</div><div class="wct-yr">${c.year?esc(c.year)+' г.':''}</div></div><div class="wct-amount">${money(c.rate)}<small>в сутки</small></div></div>
        <div class="wct-line"></div>
        <div class="wct-row"><span class="wct-plate-mono">${plateIcon}${esc(c.plate||'—')}</span>${c.rate6h?`<span class="wct-yr">6 ч — ${money(c.rate6h)}</span>`:''}</div>
      </div>` : `<div class="wct-info">
        <div class="wct-top"><div style="min-width:0"><div class="wct-name">${esc(c.make)} ${esc(c.model)}</div>${plateChip(c.plate,'mt')}</div><div class="wct-pill"><b>${money(c.rate)}</b><small>в сутки</small></div></div>
        <div class="wct-chips">${c.year?`<span>📅 ${esc(c.year)}</span>`:''}${c.rate6h?`<span>⏱ 6 ч · ${money(c.rate6h)}</span>`:''}${c.overdueHourRate?`<span>⌛ ${money(c.overdueHourRate)}/ч</span>`:''}</div>
      </div>`}
    </div>`;
  }
  if(DB.settings.windowsMode && viewMode==='list'){
    const thumbHtml = hasPhoto ? `<img src="${c.photo}" alt="">` : carSilhouette;
    return `
    <div class="card win-car-row ${ac ? (tl.overdue?'overdue-glow':'rented-glow') : ''}" onclick="openCarDetail('${c.id}')">
      <div class="wcr-thumb">${thumbHtml}</div>
      <div class="wcr-name">${esc(c.make)} ${esc(c.model)}</div>
      <div class="wcr-mid">
        <span class="wcr-plate">${plateIcon}${esc(c.plate)}</span>
        <span class="badge ${badgeCls}">${badgeText}</span>
        ${ac ? `<span class="timer-pill ${tl.overdue?'overdue':''}">${timerSvg()}${tl.text}</span>` : ''}
      </div>
      <div class="wcr-amount">${money(c.rate)}<span style="color:var(--text-faint);font-weight:600;font-size:11px;"> /сутки</span></div>
      ${ac ? `<div class="wcr-actions">
        <button class="mini-icon-btn" style="margin-top:0;" title="Отправить шаблон клиенту" onclick="event.stopPropagation();openTemplatePicker('${c.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
        </button>
        <button class="mini-icon-btn" style="margin-top:0;" title="Отправить накопленный долг" onclick="event.stopPropagation();sendDebtToClient('${c.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </button>
      </div>` : '<div class="wcr-actions"></div>'}
    </div>`;
  }
  if(DB.settings.windowsMode){
    const thumbHtml = hasPhoto ? `<div class="wcc-thumb"><img src="${c.photo}" alt=""></div>` : '';
    return `
    <div class="card win-car-card ${hasPhoto?'has-photo':''} ${ac ? (tl.overdue?'overdue-glow':'rented-glow') : ''}" onclick="openCarDetail('${c.id}')">
      <div class="wcc-head">
        ${thumbHtml}
        <div class="wcc-top">
          <div class="wcc-name">${esc(c.make)} ${esc(c.model)}</div>
          <div class="wcc-amount">${money(c.rate)}<span class="wcc-amount-unit">в сутки</span></div>
        </div>
      </div>
      <div class="wcc-meta">
        <span class="badge ${badgeCls}">${badgeText}</span>
        <span class="wcc-plate">${plateIcon}${esc(c.plate)}</span>
        ${ac ? `<span class="timer-pill ${tl.overdue?'overdue':''}">${timerSvg()}${tl.text}</span>` : ''}
      </div>
      ${ac ? `<div class="wcc-actions">
        <button class="wcc-action-btn tpl" title="Отправить шаблон клиенту" onclick="event.stopPropagation();openTemplatePicker('${c.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
          Шаблон
        </button>
        <button class="wcc-action-btn debt" title="Отправить накопленный долг" onclick="event.stopPropagation();sendDebtToClient('${c.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Долг
        </button>
      </div>` : ''}
    </div>`;
  }
  const avatarHtml = hasPhoto
    ? `<div class="card-avatar" style="overflow:hidden;padding:0;"><img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`
    : `<div class="card-avatar">${(c.make||'?').slice(0,2).toUpperCase()}</div>`;
  return `
  <div class="card ${ac ? (tl.overdue?'overdue-glow':'rented-glow') : ''}" onclick="openCarDetail('${c.id}')">
    ${avatarHtml}
    <div class="card-body">
      <div class="card-title">${esc(c.make)} ${esc(c.model)}</div>
      <div class="card-sub"><span class="badge ${badgeCls}">${badgeText}</span> ${esc(c.plate)} · ${c.year||''}</div>
      ${ac ? `<div class="card-sub" style="margin-top:6px;"><span class="timer-pill ${tl.overdue?'overdue':''}">${timerSvg()}${tl.text}</span></div>` : ''}
    </div>
    <div class="card-right">
      <div class="card-amount">${money(c.rate)}</div>
      <div class="card-sub" style="justify-content:flex-end;">в сутки</div>
      ${ac ? `<div style="display:flex;gap:6px;">
        <button class="mini-icon-btn" title="Отправить шаблон клиенту" onclick="event.stopPropagation();openTemplatePicker('${c.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
        </button>
        <button class="mini-icon-btn" title="Отправить накопленный долг" onclick="event.stopPropagation();sendDebtToClient('${c.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </button>
      </div>` : ''}
    </div>
  </div>`;
}
function carCardMob(st, c){
  const k = c.status==='rented' ? 'rent' : c.status==='free' ? 'free' : c.status==='booked' ? 'book' : 'serv';
  const lbl = {free:'Свободна',rented:'В аренде',booked:'Забронирована',service:'Ремонт'}[c.status] || '';
  const ac = c.status==='rented' ? activeContractForCar(c.id) : null; const tl = ac ? timeLeftLabel(ac.end) : null;
  const kk = tl && tl.overdue ? 'over' : k; const lb = tl && tl.overdue ? 'Просрочено' : lbl;
  const pct = ac ? Math.round(ctvProg(ac)*100) : 0;
  const nm = esc(c.make)+' '+esc(c.model); const plate = c.plate ? `<span class="cm-plate">${esc(c.plate)}</span>` : '';
  const ph = c.photo ? `style="background-image:url('${c.photo}')"` : ''; const noph = c.photo ? '' : 'noph';
  const time = tl ? `<span class="cm-tm ${kk}">⏱ ${tl.text.replace('Просрочено на ','Просрочено ')}</span>` : `<span class="cm-tm free">${c.status==='free'?'✓ Готова к выдаче':lbl}</span>`;
  const price = `${money(c.rate)}`;
  const open = `onclick="openCarDetail('${c.id}')"`;
  const timeS = tl ? `<span class="cm-tm ${kk}">⏱ ${tl.overdue ? '−'+tl.text.replace('Просрочено на ','') : tl.text.replace('Осталось ','')}</span>` : `<span class="cm-tm free">${c.status==='free'?'✓ Готова':lbl}</span>`;
  if(st==='cm1') return `<div class="cma ${kk}" ${open}><div class="cm-img ${noph}" ${ph}><span class="cm-st ${kk}">${lb}</span><span class="cma-nm">${nm}</span><span class="cma-pr">${price}<small> / сут</small></span></div>${ac?`<div class="cma-pg"><i style="width:${tl.overdue?100:pct}%"></i></div>`:''}<div class="cma-bt">${plate}${c.year?`<span class="cm-y">${esc(c.year)}</span>`:''}${time}</div></div>`;
  if(st==='cm2') return `<div class="cmb ${kk}" ${open}><div class="cm-img ${noph}" ${ph}></div><div class="cmb-m"><div class="cmb-nm">${nm}</div><div class="cmb-row">${plate}<span class="cm-st ${kk}">${lb}</span></div><div class="cmb-row">${timeS}<span class="cmb-pr">${price}<small> /сут</small></span></div></div></div>`;
  if(st==='cm3') return `<div class="cmc ${kk}" ${open}><div class="cmc-top"><div class="cm-img ${noph}" ${ph}></div><div style="min-width:0;flex:1"><div class="cmc-nm">${nm}</div><div class="cmc-sub">${plate}${c.year?' · '+esc(c.year):''}</div></div></div><div class="cmc-bot"><span class="cmc-tm"><i class="${kk}"></i>${tl ? tl.text : lbl}</span><span class="cmc-pr">${price}</span></div></div>`;
  return `<div class="cmd ${kk}" ${open}><div class="cm-img ${noph}" ${ph}><span class="cm-st ${kk}">${lb}</span></div><div class="cmd-bd"><div class="cmd-nm">${nm}</div><div class="cmd-row">${plate}<span class="cmd-pr">${price}</span></div>${timeS}</div></div>`;
}
function chipsRow(filters, counts, cur, varName){
  const st = chipStyle();
  if(st==='cur') return `<div class="chips">${filters.map(([k,l])=>`<div class="chip ${cur===k?'active':''}" style="--cc:${k==='all'?'#6b7280':(FX_C[k]||'var(--text-dim)')}" onclick="${varName}='${k}';render()">${l} <span class="chip-count">${counts[k]}</span></div>`).join('')}</div>`;
  return `<div class="chips fx fx-${st}">${filters.map(([k,l])=>{ const n = counts[k]||0; return `<div class="chip ${cur===k?'active':''}" style="--c:${FX_C[k]||'var(--accent)'}" onclick="${varName}='${k}';render()"><i class="fx-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${FX_I[k]||FX_I.all}</svg></i><span class="fx-l">${l}</span><span class="chip-count ${n?'':'z'}">${n>99?'99+':n}</span></div>`; }).join('')}</div>`;
}
function chipStyle(){ return (DB.settings && DB.settings.chipStyle) || 'cur'; }
