// Portale operativo (#46): pagina HTML, CSS e JavaScript senza librerie né risorse esterne (la CSP ammette solo questo nonce e lo stesso host).
// Il codice è diviso per sezione in src/ui/. Regole per chi modifica: niente backtick né "${" nei blocchi String.raw; i testi che arrivano dai dati
// entrano solo come nodi di testo (E, T); niente attributi style="" (la CSP li blocca); nessun dato di esempio: tutto arriva dall'API.
import { CSS } from './ui/stile.js';
import { NUCLEO } from './ui/nucleo.js';
import { OGGI } from './ui/oggi.js';
import { TICKET } from './ui/ticket.js';
import { CRM } from './ui/crm.js';
import { FATTURE } from './ui/fatture.js';
import { IMPOSTAZIONI } from './ui/impostazioni.js';

const AVVIO = String.raw`
function carica(){
  var R=rotta();
  S.tasti=null;
  if(!(R.sez==='fatture'&&R.sub))chiudiDrawer();
  chiudiModale();
  menu();
  caricamento();
  var f=oggi;
  if(R.sez==='ticket')f=ticketPagina;
  else if(R.sez==='crm')f=R.id?function(){return schedaCliente(R.id);}:R.sub==='trattative'?trattative:R.sub==='dafare'?dafare:R.sub==='duplicati'?duplicati:clienti;
  else if(R.sez==='fatture')f=puo('fatture')?fatture:oggi;
  else if(R.sez==='report')f=report;
  else if(R.sez==='impostazioni')f=impostazioni;
  var p;try{p=f();}catch(e){errVista(e);return;}
  Promise.resolve(p).catch(errVista);
  window.scrollTo(0,0);
}
function piedePagina(){
  api('/sync/stato').then(function(r){
    var out=(r.sync||[]).map(function(x){return x.nome+': '+(x.ultimo_ok?data(x.ultimo_ok):'mai')+(x.ultimo_errore?' (ultimo tentativo non riuscito)':'');});
    $('#sync').textContent=out.length?'Ultimi aggiornamenti dei dati — '+out.join(' · '):'';
  }).catch(function(){});
}
function avvia(){
  Promise.all([api('/me'),api('/filtri'),api('/utenti').catch(function(){return {utenti:[]};}),api('/piani-sla')]).then(function(r){
    S.me=r[0];S.opz=r[1];S.utenti=r[2].utenti;S.piani=r[3];
    // Attività configurate ma ancora senza dati devono poter essere scelte nei moduli; un ruolo ristretto vede solo le sue.
    var conf=(S.piani.business||[]).filter(function(b){return S.me.business===null||S.me.business.indexOf(b)>=0;});
    S.opz.business=S.opz.business.concat(conf.filter(function(b){return S.opz.business.indexOf(b)<0;})).sort();
    if(S.business&&S.opz.business.indexOf(S.business)<0)S.business='';
    disegnaBarra();
    window.addEventListener('hashchange',carica);
    $('#modale').addEventListener('click',function(ev){if(ev.target===this)chiudiModale();});
    carica();aggiornaBadge();piedePagina();
    setInterval(aggiornaBadge,60000);
  }).catch(errVista);
}
avvia();
`;

const SCRIPT = ["'use strict';", NUCLEO, OGGI, TICKET, CRM, FATTURE, IMPOSTAZIONI, AVVIO].join('\n');

/** Pagina completa; `nonce` è quello della Content-Security-Policy di questa risposta. */
export function paginaDashboard(nonce: string): string {
  return (
    `<!doctype html><html lang="it" data-tema="auto" data-densita="comoda"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><title>Gestione</title><style nonce="${nonce}">${CSS}</style></head><body>` +
    `<div id="app"><nav id="lato" aria-label="Menu principale"></nav><div id="corpo"><header id="barra"></header><main id="vista"><div class="vuoto">Caricamento…</div></main><footer id="sync"></footer></div></div>` +
    `<aside id="dettaglio" hidden></aside><div id="modale" hidden></div><div id="avviso" hidden role="status"></div>` +
    `<script nonce="${nonce}">(function(){${SCRIPT}})();</script></body></html>`
  );
}

export const _perTest = { CSS, SCRIPT };
