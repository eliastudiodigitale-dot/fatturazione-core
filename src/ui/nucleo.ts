// Nucleo della pagina: helper per costruire il DOM (nessun innerHTML con dati), rete, formati, tema, ricerca globale, scorciatoie, menu e rotte.
// Regola per chi modifica: niente backtick né "${" (è String.raw). I testi che arrivano dai dati entrano solo come nodi di testo (E, T).
export const NUCLEO = String.raw`
var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
function T(s){return document.createTextNode(String(s==null?'':s));}
function add(n,k){
  if(k==null||k===false)return;
  if(Array.isArray(k)){k.forEach(function(x){add(n,x);});return;}
  n.appendChild(k.nodeType?k:T(k));
}
/** Crea un elemento. a: class, id, text, on:{evento:fn}, value, qualunque attributo; true = attributo senza valore, false/null = niente. */
function E(tag,a,kids){
  var n=document.createElement(tag);
  if(a)Object.keys(a).forEach(function(k){
    var v=a[k];
    if(v==null||v===false)return;
    if(k==='class')n.className=v;
    else if(k==='text')n.textContent=v;
    else if(k==='on')Object.keys(v).forEach(function(ev){n.addEventListener(ev,v[ev]);});
    else if(k==='value')n.value=v;
    else n.setAttribute(k,v===true?'':v);
  });
  add(n,kids);
  return n;
}
var ICONE={
  oggi:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  ticket:'<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  crm:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  fatture:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  report:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  impostazioni:'<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  cerca:'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  piu:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  nota:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  fatto:'<polyline points="20 6 9 17 4 12"/>',
  orologio:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  trattativa:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  esci:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  scarica:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  chiudi:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
};
function I(n){var s=document.createElement('span');s.innerHTML='<svg class="i" viewBox="0 0 24 24" aria-hidden="true">'+(ICONE[n]||'')+'</svg>';return s.firstChild;}

// ---------------------------------------------------------------- preferenze (solo di questo browser) e tema
function pref(k,def){try{var v=localStorage.getItem('portale.'+k);return v==null?def:v;}catch(e){return def;}}
function setPref(k,v){try{localStorage.setItem('portale.'+k,v);}catch(e){}}
function applicaTema(){
  var t=pref('tema','auto'),d=pref('densita','comoda');
  document.documentElement.setAttribute('data-tema',t==='chiaro'||t==='scuro'?t:'auto');
  document.documentElement.setAttribute('data-densita',d==='compatta'?'compatta':'comoda');
}
applicaTema();

// ---------------------------------------------------------------- stato
var PAG=40;
var S={me:null,opz:null,utenti:[],piani:{per_business:{},predefiniti:{},business:[]},business:pref('business',''),risposte:null,badge:{},tasti:null,viste:[],t:{vista:'da_prendere'},c:{},f:{anno:String(new Date().getFullYear())},o:{},a:{}};
var ST={aperto:'Da prendere',in_lavorazione:'In lavorazione',in_attesa_cliente:'In attesa cliente',risolto:'Risolto',chiuso:'Chiuso'};
var STT={aperto:'blu',in_lavorazione:'blu',in_attesa_cliente:'ambra',risolto:'verde',chiuso:''};
var PR={urgente:'Urgente',alta:'Alta',normale:'Normale',bassa:'Bassa'};
var FASI={nuova:'Nuova',contattato:'Contattato',proposta:'Proposta',trattativa:'Trattativa',vinta:'Vinta',persa:'Persa'};
var TIPI={chiamata:'Chiamata',email:'Email',riunione:'Riunione',promemoria:'Promemoria'};
var DOCST={riservato:'Riservato',creato:'Creato',inviato_sdi:'Inviato SDI',consegnato:'Consegnato',annullato:'Annullato'};
var APERTI='aperto,in_lavorazione,in_attesa_cliente';
function puo(n){return Boolean(S.me&&S.me.permessi&&S.me.permessi[n]);}
function bz(){return S.business||undefined;}
function io(){return S.me.email||S.me.nome;}

// ---------------------------------------------------------------- rete
function chiama(metodo,path,body){
  var o={method:metodo,credentials:'same-origin',headers:{Accept:'application/json'}};
  if(metodo!=='GET')o.headers['X-Richiesta']='portale';
  if(body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body);}
  return fetch('/dashboard/api'+path,o).then(function(r){
    if(r.status===401){location.href='/dashboard/login';throw new Error('sessione scaduta');}
    return r.json().catch(function(){return {};}).then(function(j){if(!r.ok){var e=new Error(j.errore||('errore '+r.status));e.dati=j;e.status=r.status;throw e;}return j;});
  });
}
function qs(p){var q=new URLSearchParams();Object.keys(p||{}).forEach(function(k){if(p[k]!==''&&p[k]!=null&&p[k]!==false)q.set(k,p[k]);});var s=q.toString();return s?'?'+s:'';}
function api(path,p){return chiama('GET',path+qs(p));}
function scarica(path,p){location.href='/dashboard/api'+path+qs(p);}

// ---------------------------------------------------------------- formati
var nf=new Intl.NumberFormat('it-IT');
var ef=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0});
var ef2=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'});
function num(v){return v==null?'-':nf.format(v);}
function euro(v){return v==null?'-':ef.format(v);}
function euro2(v){return v==null?'-':ef2.format(v);}
function pc(v){return v==null?'-':v+'%';}
function ore(h){if(h==null)return '-';if(h<1)return Math.round(h*60)+' min';if(h<48)return (Math.round(h*10)/10)+' h';return (Math.round(h/24*10)/10)+' g';}
function data(iso){if(!iso)return '-';return new Date(iso).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}
function giorno(iso){if(!iso)return '-';return new Date(iso).toLocaleDateString('it-IT',{timeZone:'Europe/Rome'});}
function durata(ms){var m=Math.round(Math.abs(ms)/60000);if(m<1)return 'meno di 1 min';if(m<60)return m+' min';var h=Math.floor(m/60);if(h<48)return h+' h'+(h<10&&m%60?' '+(m%60)+' min':'');return Math.round(h/24)+' g';}
function fa(iso){if(!iso)return '';var ms=Date.now()-new Date(iso).getTime();return ms<0?'tra '+durata(ms):durata(ms)+' fa';}
function iniziali(s){var p=String(s||'?').replace(/@.*/,'').split(/[\s._-]+/).filter(Boolean);return ((p[0]||'?')[0]+(p[1]?p[1][0]:'')).toUpperCase();}
function enc(s){return encodeURIComponent(s);}

/** Stato SLA di un ticket: prossima scadenza con il tempo che manca (o scaduta da). */
function statoSla(t){
  if(t.stato==='risolto'||t.stato==='chiuso')return null;
  var prossima=t.prima_risposta_il?t.scade_risoluzione:t.scade_prima_risposta;
  var tipo=t.prima_risposta_il?'risoluzione':'risposta';
  if(!prossima)return t.piano_sla==='nessuno'?{testo:'Senza SLA',tono:'',corto:'senza SLA'}:null;
  var ms=new Date(prossima).getTime()-Date.now();
  if(ms<0)return {testo:'Scaduta da '+durata(ms)+' ('+tipo+')',tono:'rosso',corto:'scaduta '+durata(ms)};
  return {testo:(tipo==='risposta'?'Rispondere entro ':'Risolvere entro ')+durata(ms),tono:ms<4*3600e3?'ambra':'',corto:durata(ms)};
}

// ---------------------------------------------------------------- componenti piccoli
function tag(t,tono){return E('span',{class:'tag'+(tono?' '+tono:''),text:t});}
function prio(p){return E('span',{class:'pr '+p},[E('i'),PR[p]||p]);}
function av(nome,g){return E('span',{class:'av'+(nome&&S.me&&(nome===S.me.email||nome===S.me.nome)?' me':'')+(g?' g':''),title:nome||'Non assegnato',text:nome?iniziali(nome):'–'});}
function vuoto(titolo,sotto){return E('div',{class:'vuoto'},[titolo?E('b',{text:titolo}):null,sotto||null]);}
function btn(testo,fn,cls,icona){return E('button',{class:'btn '+(cls||''),type:'button',on:{click:fn}},[icona?I(icona):null,testo]);}
function campo(testo,ctrl,cls){return E('label',{class:'f'+(cls?' '+cls:'')},[testo,ctrl]);}
function inp(id,v,tipo,extra){var a={type:tipo||'text',value:v==null?'':v};if(id)a.id=id;if(extra)Object.keys(extra).forEach(function(k){a[k]=extra[k];});return E('input',a);}
function sel(id,opz,corrente,tutte){
  var s=E('select',{id:id});
  if(tutte!=null)s.appendChild(E('option',{value:'',text:tutte}));
  opz.forEach(function(o){var v=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;var op=E('option',{value:v,text:l});if(String(v)===String(corrente==null?'':corrente))op.setAttribute('selected','');s.appendChild(op);});
  return s;
}
function val(id){var e=$('#'+id);return e?e.value.trim():'';}
function spunta(id){var e=$('#'+id);return Boolean(e&&e.checked);}
function utentiOpz(){return S.utenti.map(function(u){return [u.email||u.nome,u.nome+(u.email?' ('+u.email+')':'')];});}
function pianiDi(bs){var v=[];(bs||[]).forEach(function(b){((S.piani.per_business||{})[b]||[]).forEach(function(x){if(v.indexOf(x)<0)v.push(x);});});return v;}
function pianiOpz(bs,conStandard){
  var o=[];if(conStandard)o.push(['','Standard dell’attività']);
  pianiDi(bs).forEach(function(x){o.push([x,x==='nessuno'?'Nessun SLA (best effort)':'Piano '+x]);});
  return o;
}
function nomePiano(p){return !p?'standard':p==='nessuno'?'nessun SLA':p;}

// ---------------------------------------------------------------- messaggi, finestre, pannello laterale
var tAvviso=null;
function avviso(msg,err){var a=$('#avviso');a.textContent=msg;a.className=err?'e':'';a.hidden=false;clearTimeout(tAvviso);tAvviso=setTimeout(function(){a.hidden=true;},err?7000:2800);}
function fallita(e){avviso(e&&e.message?e.message:String(e),true);}
function modale(titolo,corpo,azioni){
  var m=$('#modale');m.textContent='';
  var az=E('div',{class:'az'});
  (azioni||[]).forEach(function(a){az.appendChild(E('button',{class:'btn'+(a.pri?' pri':''),type:'button',on:{click:function(){if(a.fn)a.fn();else chiudiModale();}}},a.testo));});
  m.appendChild(E('div',{class:'sc2',role:'dialog','aria-label':titolo},[E('h3',{text:titolo}),corpo,az]));
  m.hidden=false;
  var primo=$('input,select,textarea',m);if(primo)primo.focus();
}
function chiudiModale(){var m=$('#modale');m.hidden=true;m.textContent='';}
function chiedi(titolo,testo,okTesto,fn){modale(titolo,E('p',{text:testo}),[{testo:'Annulla'},{testo:okTesto,pri:true,fn:function(){chiudiModale();fn();}}]);}
function drawer(titolo,corpo){
  var d=$('#dettaglio');d.textContent='';
  d.appendChild(E('div',{class:'hd'},[E('b',{text:titolo}),E('span',{class:'sp'}),btn('Chiudi',chiudiDrawer,'ghost sm','chiudi')]));
  d.appendChild(E('div',{class:'bd'},corpo));
  d.hidden=false;
}
function chiudiDrawer(){$('#dettaglio').hidden=true;$('#dettaglio').textContent='';}
function caricamento(){var v=$('#vista');v.textContent='';v.appendChild(E('div',{class:'vuoto',text:'Caricamento…'}));}
function errVista(e){var v=$('#vista');v.textContent='';v.appendChild(E('div',{class:'err'},[E('b',{text:'Non riesco a caricare questa pagina. '}),e&&e.message?e.message:String(e),' ',btn('Riprova',carica,'sm')]));}
function titoloPagina(testo,azioni,sotto){return E('div',{class:'pag-t'},[E('h1',{text:testo}),sotto?E('span',{class:'mut',text:sotto}):null,E('span',{class:'sp'}),azioni||null]);}

// ---------------------------------------------------------------- rotte e menu
function rotta(){var p=location.hash.replace(/^#\/?/,'').split('/').map(function(x){try{return decodeURIComponent(x);}catch(e){return x;}});return {sez:p[0]||'oggi',sub:p[1]||'',id:p[2]||''};}
function vai(path){var h='#/'+path;if(location.hash===h)carica();else location.hash=h;}
var VOCI=[
  {id:'oggi',nome:'Oggi',ic:'oggi'},
  {id:'ticket',nome:'Ticket',ic:'ticket',badge:'ticket'},
  {id:'crm',nome:'CRM',ic:'crm',sub:[['clienti','Clienti'],['trattative','Trattative'],['dafare','Da fare','attivita'],['duplicati','Duplicati']]},
  {id:'fatture',nome:'Fatturazione',ic:'fatture',perm:'fatture'},
  {id:'report',nome:'Report',ic:'report'},
  {id:'impostazioni',nome:'Impostazioni',ic:'impostazioni',perm:'impostazioni',sub:[['sla','SLA'],['risposte','Risposte rapide'],['personalizza','Personalizza']]}
];
function menu(){
  var R=rotta(),l=$('#lato');l.textContent='';
  l.appendChild(E('div',{class:'logo',text:'Gestione'}));
  VOCI.forEach(function(v){
    if(v.perm&&!puo(v.perm))return;
    var b=E('button',{class:'m'+(R.sez===v.id?' on':''),type:'button',on:{click:function(){vai(v.id+(v.sub?'/'+v.sub[0][0]:''));}}},[I(v.ic),v.nome]);
    if(v.badge&&S.badge[v.badge])b.appendChild(E('span',{class:'nb2 b',text:S.badge[v.badge]}));
    l.appendChild(b);
    if(v.sub&&R.sez===v.id)v.sub.forEach(function(s){
      var sb=E('button',{class:'m sub'+(R.sub===s[0]?' on':''),type:'button',on:{click:function(){vai(v.id+'/'+s[0]);}}},s[1]);
      if(s[2]&&S.badge[s[2]])sb.appendChild(E('span',{class:'nb2',text:S.badge[s[2]]}));
      l.appendChild(sb);
    });
  });
  l.appendChild(E('div',{class:'fine'},[E('b',{text:S.me.nome}),S.me.ruoli.join(', '),E('form',{method:'post',action:'/dashboard/logout'},[E('button',{class:'btn ghost sm',type:'submit'},[I('esci'),'Esci'])])]));
}
function aggiornaBadge(){
  var p=[api('/ticket-viste',{business:bz()}).then(function(c){S.badge.ticket=c.da_prendere||0;}).catch(function(){}),
    api('/attivita',{assegnato:io(),scadute:'true',limite:1,business:bz()}).then(function(c){S.badge.attivita=c.totale||0;}).catch(function(){})];
  return Promise.all(p).then(menu);
}

// ---------------------------------------------------------------- barra in alto: ricerca globale e attività
function disegnaBarra(){
  var b=$('#barra');b.textContent='';
  var box=E('div',{id:'cerca'},[I('cerca'),E('input',{id:'q-glob',type:'search',placeholder:'Cerca ticket, clienti, documenti',autocomplete:'off','aria-label':'Ricerca globale'}),E('kbd',{text:'/'}),E('div',{id:'risultati',hidden:true})]);
  b.appendChild(box);b.appendChild(E('span',{class:'sp'}));
  var elenco=(S.opz.business||[]);
  if(elenco.length>1){
    var s=sel('f-bus',elenco.map(function(x){return [x,x];}),S.business,'Tutte le attività');
    s.setAttribute('aria-label','Attività');
    s.addEventListener('change',function(){S.business=s.value;setPref('business',S.business);aggiornaBadge();carica();});
    b.appendChild(s);
  }
  b.appendChild(btn('Scorciatoie',aiuto,'ghost sm'));
  var inpG=$('#q-glob'),ris=$('#risultati'),tm=null,voci=[];
  function chiudiRis(){ris.hidden=true;}
  function apri(f){chiudiRis();inpG.value='';f();}
  function disegnaRis(r){
    ris.textContent='';voci=[];
    function gruppo(t,righe,mk){
      if(!righe.length)return;
      ris.appendChild(E('h4',{class:'cap',text:t}));
      righe.forEach(function(x){var el=mk(x);ris.appendChild(el);voci.push(el);});
    }
    gruppo('Ticket',r.ticket,function(x){return E('div',{class:'r',on:{click:function(){apri(function(){S.t.vista='tutti';vai('ticket/'+enc(x.ref));});}}},[prio(x.priorita),E('span',{class:'sp',text:x.oggetto}),E('span',{class:'mut',text:x.cliente_nome||x.business})]);});
    gruppo('Clienti',r.clienti,function(x){return E('div',{class:'r',on:{click:function(){apri(function(){vai('crm/clienti/'+enc(x.clickup_task_id));});}}},[E('span',{class:'sp',text:x.nome}),E('span',{class:'mut',text:x.email||x.partita_iva||''})]);});
    gruppo('Documenti',r.documenti,function(x){return E('div',{class:'r',on:{click:function(){apri(function(){vai('fatture/'+enc(x.ref));});}}},[E('span',{class:'sp',text:(x.tipo==='fattura'?'Fattura ':'Proforma ')+x.numero+'/'+x.anno}),E('span',{class:'mut',text:x.cliente_nome||''})]);});
    if(!voci.length)ris.appendChild(vuoto('Nessun risultato'));
    ris.hidden=false;
  }
  inpG.addEventListener('input',function(){
    clearTimeout(tm);var q=inpG.value.trim();
    if(q.length<2){chiudiRis();return;}
    tm=setTimeout(function(){api('/cerca',{q:q,business:bz()}).then(disegnaRis).catch(function(){});},180);
  });
  inpG.addEventListener('keydown',function(ev){
    if(ev.key==='Escape'){chiudiRis();inpG.blur();}
    if(ev.key==='Enter'&&voci[0])voci[0].click();
  });
  document.addEventListener('click',function(ev){if(!box.contains(ev.target))chiudiRis();});
}
function aiuto(){
  var righe=[['/','Cerca ovunque'],['j / k','Ticket successivo / precedente'],['Invio','Apri il ticket selezionato'],['a','Assegna a me il ticket aperto'],['r','Scrivi una risposta'],['e','Segna il ticket come risolto'],['Esc','Chiudi finestre e pannelli'],['?','Questa guida']];
  modale('Scorciatoie da tastiera',E('table',{class:'tbl'},E('tbody',null,righe.map(function(r){return E('tr',null,[E('td',null,E('b',{text:r[0]})),E('td',{text:r[1]})]);}))),[{testo:'Chiudi',pri:true}]);
}
document.addEventListener('keydown',function(ev){
  var el=ev.target,tipo=el&&el.tagName;
  var scrive=tipo==='INPUT'||tipo==='TEXTAREA'||tipo==='SELECT'||(el&&el.isContentEditable);
  if(ev.key==='Escape'){chiudiModale();chiudiDrawer();if(S.tasti)S.tasti(ev);return;}
  if(scrive||ev.metaKey||ev.ctrlKey||ev.altKey)return;
  if(ev.key==='/'){ev.preventDefault();var g=$('#q-glob');if(g)g.focus();return;}
  if(ev.key==='?'){aiuto();return;}
  if(S.tasti)S.tasti(ev);
});
`;
