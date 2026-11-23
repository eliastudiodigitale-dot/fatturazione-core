// Portale operativo (#46): HTML, CSS e JavaScript senza librerie né risorse esterne (la CSP ammette solo questo nonce e lo stesso host).
// Regole per chi modifica: niente backtick né "${" dentro CSS e SCRIPT (sono String.raw); ogni testo che arriva dai dati passa da esc();
// niente attributi style="" (la CSP li blocca): larghezze e colori dinamici si impostano da script con data-w (vedi stili()).

const CSS = String.raw`
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c2330;--mut:#5c6678;--line:#e3e6ec;--acc:#2456d6;--acc2:#c2570c;--ok:#18794e;--bad:#b42318;--warn:#a15c00;--chip:#eef1f6;--side:#fff}
@media (prefers-color-scheme:dark){:root:not([data-tema="chiaro"]){--bg:#10141b;--card:#181e28;--ink:#e8ecf3;--mut:#9aa5b8;--line:#2a3342;--acc:#6f95ff;--acc2:#f0954f;--ok:#4cc38a;--bad:#ff7b72;--warn:#e3b341;--chip:#222a38;--side:#141a23}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
button,select,input,textarea{font:inherit;color:inherit}
button{background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer}
button:hover:not(:disabled){border-color:var(--acc)}
button:disabled{opacity:.5;cursor:default}
button.p{background:var(--acc);border-color:var(--acc);color:#fff}
button.s{padding:2px 8px;font-size:13px}
button.rosso{color:var(--bad)}
button.dx{float:right}
select,input,textarea{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 8px;min-width:0;max-width:100%}
textarea{width:100%;min-height:80px;resize:vertical}
a{color:var(--acc)}
#app{display:grid;grid-template-columns:210px 1fr;min-height:100vh}
#lato{background:var(--side);border-right:1px solid var(--line);padding:14px 10px;position:sticky;top:0;height:100vh;overflow:auto;display:flex;flex-direction:column;gap:4px}
#lato h1{font-size:17px;margin:0 6px 10px}
#lato .m{display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:8px}
#lato .m.on{background:var(--acc);color:#fff}
#lato .m:hover:not(.on){background:var(--chip)}
#lato .sm{padding-left:26px;font-size:14px}
#lato .sp{flex:1}
#lato .ut{font-size:12px;color:var(--mut);margin:0 6px 6px;word-break:break-word}
#corpo{min-width:0}
.barra{display:flex;gap:10px;flex-wrap:wrap;align-items:end;padding:12px 16px}
.barra label,.filtri label,.modulo label{display:flex;flex-direction:column;font-size:12px;color:var(--mut);gap:3px}
.filtri{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px}
.filtri label.ck{flex-direction:row;align-items:center;gap:6px;padding-bottom:8px}
.preset{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.preset button.on{background:var(--acc);border-color:var(--acc);color:#fff}
.azioni{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.azioni .sp{flex:1}
main{padding:0 16px 24px}
.titolo{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 16px 0}
.titolo h2{margin:0;font-size:20px;flex:1}
.griglia{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));margin-bottom:16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.kpi .v{font-size:24px;font-weight:650;font-variant-numeric:tabular-nums}
.kpi .t{font-size:12px;color:var(--mut)}
.kpi .s{font-size:12px;color:var(--mut);margin-top:2px}
.kpi.bad .v{color:var(--bad)}.kpi.ok .v{color:var(--ok)}
.kpi.link{cursor:pointer}.kpi.link:hover{border-color:var(--acc)}
.sez{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px}
.sez h2{font-size:14px;margin:0 0 10px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.due{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--mut);font-weight:600;white-space:nowrap}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr.riga{cursor:pointer}tr.riga:hover td{background:var(--chip)}
tr.annullato td{color:var(--mut);text-decoration:line-through}
.scroll{overflow-x:auto}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:1px 9px;font-size:12px;margin:0 4px 2px 0;white-space:nowrap}
.chip.bad{color:var(--bad)}.chip.ok{color:var(--ok)}.chip.warn{color:var(--warn)}.chip.acc{color:var(--acc)}
.hb{display:grid;grid-template-columns:minmax(80px,30%) 1fr 36px;gap:8px;align-items:center;font-size:13px;margin:3px 0}
.hb .b{height:10px;background:var(--chip);border-radius:5px;overflow:hidden}.hb .b i{display:block;height:100%;background:var(--acc)}
.leg{font-size:12px;color:var(--mut);margin-bottom:6px}.leg b{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}
.leg b.ba{background:var(--acc)}.leg b.bb{background:var(--acc2)}
svg.g{width:100%;height:190px;display:block}
svg.g .a{fill:var(--acc)}svg.g .b{fill:var(--acc2)}svg.g text{fill:var(--mut);font-size:10px}svg.g line{stroke:var(--line)}
.pag{display:flex;gap:8px;align-items:center;margin-top:10px;color:var(--mut);font-size:13px}
.vuoto{color:var(--mut);padding:16px 0}
.err{background:var(--card);border:1px solid var(--bad);color:var(--bad);border-radius:10px;padding:10px 12px;margin:12px 0}
.tot{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 10px;color:var(--mut);font-size:14px}.tot b{color:var(--ink)}
#dettaglio{position:fixed;top:0;right:0;bottom:0;width:min(640px,100%);background:var(--card);border-left:1px solid var(--line);padding:16px;overflow:auto;box-shadow:-8px 0 24px rgba(0,0,0,.15);z-index:5}
#dettaglio[hidden],#modale[hidden]{display:none}
#dettaglio h3{margin:16px 0 6px}#dettaglio h3.p{margin-top:0}
.dl{display:grid;grid-template-columns:130px 1fr;gap:4px 10px;margin:12px 0;font-size:14px}.dl dt{color:var(--mut)}.dl dd{margin:0;word-break:break-word}
.modulo{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin:8px 0}
.modulo .largo{grid-column:1/-1}
.modulo .ck{flex-direction:row;align-items:center;gap:6px}
.chat{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.msg{border:1px solid var(--line);border-radius:10px;padding:8px 10px;max-width:92%;white-space:pre-wrap;word-break:break-word}
.msg.cl{align-self:flex-start}.msg.st{align-self:flex-end;background:var(--chip)}.msg.int{border-style:dashed;color:var(--warn)}
.msg small{display:block;color:var(--mut);font-size:11px;margin-bottom:2px}
.kanban{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px}
.col{background:var(--chip);border-radius:12px;padding:10px;min-height:120px}
.col h3{margin:0 0 8px;font-size:13px;display:flex;justify-content:space-between;gap:6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:8px;font-size:14px}
.card .sotto{color:var(--mut);font-size:12px}
#modale{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px;z-index:10;overflow:auto}
#modale .scatola{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;width:min(560px,100%)}
#modale h3{margin:0 0 6px}
#avviso{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 16px;border-radius:10px;z-index:20;max-width:90vw}
#avviso.err2{background:var(--bad);color:#fff}
#avviso[hidden]{display:none}
footer{padding:0 16px 24px;color:var(--mut);font-size:12px}
@media (max-width:760px){#app{grid-template-columns:1fr}#lato{position:static;height:auto;flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--line)}#lato h1,#lato .ut,#lato .sp{display:none}#lato .sm{padding-left:10px}}
`;

const SCRIPT = String.raw`
(function(){
'use strict';
var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var ST={aperto:'Da prendere',in_lavorazione:'In lavorazione',in_attesa_cliente:'In attesa cliente',risolto:'Risolto',chiuso:'Chiuso'};
var PR={urgente:'Urgente',alta:'Alta',normale:'Normale',bassa:'Bassa'};
var PRC={urgente:'bad',alta:'warn',normale:'',bassa:''};
var FASI={nuova:'Nuova',contattato:'Contattato',proposta:'Proposta',trattativa:'Trattativa',vinta:'Vinta',persa:'Persa'};
var TIPI={chiamata:'Chiamata',email:'Email',riunione:'Riunione',promemoria:'Promemoria'};
var DOCST={riservato:'Riservato',creato:'Creato',inviato_sdi:'Inviato SDI',consegnato:'Consegnato',annullato:'Annullato'};
var APERTI='aperto,in_lavorazione,in_attesa_cliente';
var PAG=50;
var S={me:null,opz:null,utenti:[],piani:null,sez:'cruscotto',sub:'',filtri:{business:'',giorni:'30',da:'',a:''},t:{preset:'aperti'},c:{},o:{aperte:true},a:{stato:'aperte'},f:{anno:String(new Date().getFullYear())},pag:{ticket:0,clienti:0,fatture:0},viste:[],aperto:null};

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
function qs(params){var q=new URLSearchParams();Object.keys(params||{}).forEach(function(k){if(params[k]!==''&&params[k]!=null&&params[k]!==false)q.set(k,params[k]);});var s=q.toString();return s?'?'+s:'';}
function api(path,params){return chiama('GET',path+qs(params));}
var nf=new Intl.NumberFormat('it-IT');
var ef=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0});
var ef2=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'});
function num(v){return v==null?'-':nf.format(v);}
function euro(v){return v==null?'-':ef.format(v);}
function euro2(v){return v==null?'-':ef2.format(v);}
function ore(h){if(h==null)return '-';if(h<1)return Math.round(h*60)+' min';if(h<48)return (Math.round(h*10)/10)+' h';return (Math.round(h/24*10)/10)+' g';}
function pc(v){return v==null?'-':v+'%';}
function data(iso){if(!iso)return '-';return new Date(iso).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}
function giorno(iso){if(!iso)return '-';return new Date(iso).toLocaleDateString('it-IT',{timeZone:'Europe/Rome'});}
function chip(t,c){return '<span class="chip '+(c||'')+'">'+esc(t)+'</span>';}
function vuoto(m){return '<div class="vuoto">'+esc(m)+'</div>';}
function permesso(n){return Boolean(S.me&&S.me.permessi&&S.me.permessi[n]);}

// ---------------------------------------------------------------- interfaccia di base
function stili(r){$$('[data-w]',r).forEach(function(e){e.style.width=e.getAttribute('data-w')+'%';});}
function mostra(html){var v=$('#vista');v.innerHTML=html;stili(v);}
function errore(e){mostra('<div class="err">'+esc(e.message||e)+'</div>');}
var timerAvviso=null;
function avviso(msg,err){var a=$('#avviso');a.textContent=msg;a.className=err?'err2':'';a.hidden=false;clearTimeout(timerAvviso);timerAvviso=setTimeout(function(){a.hidden=true;},err?7000:3000);}
function fallita(e){avviso(e.message||String(e),true);}
function pannello(html,largo){var a=$('#dettaglio');a.innerHTML='<button id="chiudi" class="s dx">Chiudi</button>'+html;a.hidden=false;stili(a);$('#chiudi').addEventListener('click',chiudiPannello);}
function chiudiPannello(){$('#dettaglio').hidden=true;S.aperto=null;}
function modale(html){var m=$('#modale');m.innerHTML='<div class="scatola">'+html+'</div>';m.hidden=false;stili(m);$$('[data-chiudi]',m).forEach(function(b){b.addEventListener('click',chiudiModale);});}
function chiudiModale(){$('#modale').hidden=true;$('#modale').innerHTML='';}
function opzioni(lista,sel,tutte,mappa){return (tutte===null?'':'<option value="">'+esc(tutte)+'</option>')+lista.map(function(v){var val=Array.isArray(v)?v[0]:v,lab=Array.isArray(v)?v[1]:(mappa&&mappa[v]?mappa[v]:v);return '<option value="'+esc(val)+'"'+(String(sel)===String(val)?' selected':'')+'>'+esc(lab)+'</option>';}).join('');}
function lab(testo,html,cls){return '<label'+(cls?' class="'+cls+'"':'')+'>'+esc(testo)+html+'</label>';}
function inp(id,testo,val,tipo,extra){return lab(testo,'<input id="'+id+'" type="'+(tipo||'text')+'" value="'+esc(val||'')+'" '+(extra||'')+'>');}
function sel(id,testo,html){return lab(testo,'<select id="'+id+'">'+html+'</select>');}
function val(id){var e=$('#'+id);return e?e.value.trim():'';}
function spunta(id){var e=$('#'+id);return Boolean(e&&e.checked);}
function businessBox(prefisso,scelti){return (S.opz.business||[]).map(function(b,i){return '<label class="ck"><input type="checkbox" id="'+prefisso+i+'" data-b="'+esc(b)+'"'+((scelti||[]).indexOf(b)>=0?' checked':'')+'> '+esc(b)+'</label>';}).join('');}
function businessScelti(prefisso){return $$('[id^="'+prefisso+'"][data-b]').filter(function(e){return e.checked;}).map(function(e){return e.getAttribute('data-b');});}
function utentiOpz(selezionato){var u=S.utenti.map(function(x){return [x.email||x.nome,x.nome+(x.email?' ('+x.email+')':'')];});if(selezionato&&!u.some(function(x){return x[0]===selezionato;}))u.push([selezionato,selezionato]);return opzioni(u,selezionato||'','Nessuno');}
function pianiOpz(selezionato,conStandard){var p=[];if(conStandard)p.push(['','Standard dell’attività']);(S.piani.piani||[]).forEach(function(x){p.push([x,x==='nessuno'?'Nessun SLA (best effort)':'Piano '+x]);});return opzioni(p,selezionato||'',null);}
function nomePiano(p){return !p?'standard':p==='nessuno'?'nessun SLA':p;}

// ---------------------------------------------------------------- grafici (cruscotto)
function kpi(titolo,valore,sotto,cl,vai){return '<div class="kpi '+(cl||'')+(vai?' link':'')+'"'+(vai?' data-vai="'+esc(vai)+'"':'')+'><div class="t">'+esc(titolo)+'</div><div class="v">'+esc(valore)+'</div>'+(sotto?'<div class="s">'+esc(sotto)+'</div>':'')+'</div>';}
function barreRaggruppate(punti,chiaveA,chiaveB,nomeA,nomeB,fmt){
  if(!punti.length)return vuoto('Nessun dato nel periodo.');
  var W=600,H=190,L=34,B=22,T=8,n=punti.length;
  var max=1;punti.forEach(function(p){max=Math.max(max,p[chiaveA]||0,chiaveB?(p[chiaveB]||0):0);});
  var cw=(W-L)/n,bw=Math.max(1,Math.min(18,cw/(chiaveB?2.6:1.5)));
  var s='<div class="leg"><b class="ba"></b>'+esc(nomeA)+(chiaveB?'<b class="bb"></b>'+esc(nomeB):'')+'</div>';
  s+='<svg class="g" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(nomeA)+'">';
  [0,0.5,1].forEach(function(f){var y=T+(H-B-T)*(1-f);s+='<line x1="'+L+'" x2="'+W+'" y1="'+y+'" y2="'+y+'"/><text x="2" y="'+(y+3)+'">'+esc(fmt?fmt(max*f):Math.round(max*f))+'</text>';});
  punti.forEach(function(p,i){
    var x=L+i*cw+cw/2,hA=(H-B-T)*((p[chiaveA]||0)/max),hB=chiaveB?(H-B-T)*((p[chiaveB]||0)/max):0;
    var xa=chiaveB?x-bw-1:x-bw/2,xb=x+1;
    s+='<rect class="a" x="'+xa+'" y="'+(H-B-hA)+'" width="'+bw+'" height="'+hA+'" rx="1.5"><title>'+esc(p.periodo+': '+nomeA+' '+(fmt?fmt(p[chiaveA]||0):(p[chiaveA]||0)))+'</title></rect>';
    if(chiaveB)s+='<rect class="b" x="'+xb+'" y="'+(H-B-hB)+'" width="'+bw+'" height="'+hB+'" rx="1.5"><title>'+esc(p.periodo+': '+nomeB+' '+(p[chiaveB]||0))+'</title></rect>';
    if(i===0||i===n-1||(n<=12))s+='<text x="'+x+'" y="'+(H-6)+'" text-anchor="middle">'+esc(p.periodo.slice(n>60?0:5))+'</text>';
  });
  return s+'</svg>';
}
function hbarre(righe,mappa){
  if(!righe||!righe.length)return vuoto('Nessun dato.');
  var max=Math.max.apply(null,righe.map(function(r){return r.n;}))||1;
  return righe.map(function(r){var nome=mappa&&mappa[r.voce]?mappa[r.voce]:r.voce;return '<div class="hb"><span>'+esc(nome)+'</span><span class="b"><i data-w="'+Math.round(r.n/max*100)+'"></i></span><span>'+num(r.n)+'</span></div>';}).join('');
}
function parametriPeriodo(){var f=S.filtri,p={business:f.business};if(f.giorni==='custom'){p.da=f.da;p.a=f.a;}else p.giorni=f.giorni;return p;}
function granularita(){var f=S.filtri;if(f.giorni==='custom'&&f.da&&f.a){var g=(new Date(f.a)-new Date(f.da))/864e5;return g>180?'mese':g>45?'settimana':'giorno';}var gg=Number(f.giorni);return gg>180?'mese':gg>45?'settimana':'giorno';}

// ---------------------------------------------------------------- cruscotto
function barraCruscotto(){
  var f=S.filtri,o=S.opz;
  var h='<label>Attività<select id="f-bus">'+opzioni(o.business,f.business,'Tutte le attività')+'</select></label>'+
    '<label>Periodo<select id="f-per">'+opzioni([['7','Ultimi 7 giorni'],['30','Ultimi 30 giorni'],['90','Ultimi 90 giorni'],['365','Ultimi 12 mesi'],['custom','Personalizzato']],f.giorni,null)+'</select></label>';
  if(f.giorni==='custom')h+=inp('f-da','Dal',f.da,'date')+inp('f-a','Al',f.a,'date');
  return h;
}
function legaBarraCruscotto(){
  var f=S.filtri;
  $('#f-bus').addEventListener('change',function(){f.business=this.value;carica();});
  $('#f-per').addEventListener('change',function(){f.giorni=this.value;if(f.giorni==='custom'&&!f.da){var o=new Date();f.a=o.toISOString().slice(0,10);f.da=new Date(o-30*864e5).toISOString().slice(0,10);}carica();});
  ['f-da','f-a'].forEach(function(id){var el=$('#'+id);if(el)el.addEventListener('change',function(){f[id==='f-da'?'da':'a']=this.value;if(f.da&&f.a)carica();});});
}
function cruscotto(){
  var p=parametriPeriodo();p.granularita=granularita();
  var richieste=[api('/kpi/panoramica',p),api('/ticket',{business:S.filtri.business,non_assegnati:'true',stato:APERTI,limite:1}),api('/attivita',{business:S.filtri.business,scadute:'true',limite:1}),api('/kpi/business',parametriPeriodo())];
  return Promise.all(richieste).then(function(r){
    var d=r[0],nonAss=r[1].totale,scadAtt=r[2].totale,bus=r[3].per_business;
    var t=d.ticket,c=d.clienti,f=d.fatturato,h='<div class="barra">'+barraCruscotto()+'</div><main>';
    h+='<div class="sez"><h2>Da fare adesso</h2><div class="griglia">'+
      kpi('Ticket da prendere',num(nonAss),'aperti e non assegnati',nonAss>0?'bad':'ok','ticket:non')+
      kpi('SLA scaduti',num(t.sla_risposta_scaduti+t.sla_risoluzione_scaduti),num(t.sla_risposta_scaduti)+' risposta · '+num(t.sla_risoluzione_scaduti)+' risoluzione',(t.sla_risposta_scaduti+t.sla_risoluzione_scaduti)>0?'bad':'ok','ticket:sla')+
      kpi('Attività scadute',num(scadAtt),'promemoria CRM',scadAtt>0?'bad':'ok','crm:dafare')+
      kpi('Urgenti / alti aperti',num(t.backlog_urgenti),'',t.backlog_urgenti>0?'bad':'')+
      '</div></div>';
    h+='<div class="sez"><h2>Ticket</h2><div class="griglia">'+
      kpi('Backlog',num(t.backlog),num(t.da_prendere)+' da prendere · '+num(t.in_lavorazione)+' in lavorazione · '+num(t.in_attesa_cliente)+' in attesa','','ticket:aperti')+
      kpi('SLA prima risposta',pc(t.sla_risposta_pct),'ticket con SLA del periodo')+
      kpi('SLA risoluzione',pc(t.sla_risoluzione_pct),'ticket con SLA risolti nel periodo')+
      kpi('Prima risposta',ore(t.prima_risposta_media_ore),'mediana '+ore(t.prima_risposta_mediana_ore))+
      kpi('Tempo di risoluzione',ore(t.risoluzione_media_ore),'media')+
      kpi('Età media backlog',ore(t.eta_media_backlog_ore))+
      kpi('Arrivati / risolti',num(t.arrivati)+' / '+num(t.risolti),'nel periodo')+
      '</div></div>';
    h+='<div class="sez"><h2>Clienti'+(f?' e fatturato':'')+'</h2><div class="griglia">'+
      kpi('Clienti',num(c.totali),num(c.nuovi)+' nuovi nel periodo','','crm:clienti')+
      kpi('Con ticket aperti',num(c.con_ticket_aperti))+
      (c.attivi_12m!=null?kpi('Clienti attivi 12 mesi',num(c.attivi_12m),'con almeno una fattura'):'')+
      kpi('Su più attività',num(c.multi_business))+
      (f?kpi('Fatturato',euro(f.fatturato),num(f.fatture)+' fatture · media '+euro(f.media_fattura),'','fatture:'):'')+
      '</div></div>';
    h+='<div class="due"><div class="sez"><h2>Ticket arrivati e risolti</h2>'+barreRaggruppate(d.serie,'ticket_arrivati','ticket_risolti','Arrivati','Risolti')+'</div>';
    h+=f?'<div class="sez"><h2>Fatturato</h2>'+barreRaggruppate(d.serie,'fatturato',null,'Fatturato',null,function(v){return euro(v);})+'</div>':'<div class="sez"><h2>Nuovi clienti</h2>'+barreRaggruppate(d.serie,'nuovi_clienti',null,'Nuovi clienti')+'</div>';
    h+='</div><div class="sez"><h2>Confronto tra attività</h2><div class="scroll"><table><thead><tr><th>Attività</th><th class="n">Clienti</th><th class="n">Backlog</th><th class="n">SLA scaduti</th><th class="n">Arrivati</th><th class="n">Risolti</th><th class="n">Prima risposta</th>'+(S.me.soldi?'<th class="n">Fatture</th><th class="n">Fatturato</th>':'')+'</tr></thead><tbody>';
    bus.forEach(function(x){h+='<tr><td>'+esc(x.business)+'</td><td class="n">'+num(x.clienti)+'</td><td class="n">'+num(x.backlog)+'</td><td class="n">'+(x.sla_scaduti?'<span class="chip bad">'+x.sla_scaduti+'</span>':'0')+'</td><td class="n">'+num(x.arrivati)+'</td><td class="n">'+num(x.risolti)+'</td><td class="n">'+ore(x.prima_risposta_media_ore)+'</td>'+(S.me.soldi?'<td class="n">'+num(x.fatture)+'</td><td class="n">'+euro(x.fatturato)+'</td>':'')+'</tr>';});
    h+='</tbody></table></div>'+(bus.length?'':vuoto('Nessun dato.'))+'</div>';
    h+='<div class="due">'+
      '<div class="sez"><h2>Ticket aperti ora, per stato</h2>'+hbarre(d.distribuzioni.per_stato,ST)+'</div>'+
      '<div class="sez"><h2>Per fonte (periodo)</h2>'+hbarre(d.distribuzioni.per_fonte)+'</div>'+
      '<div class="sez"><h2>Per priorità (periodo)</h2>'+hbarre(d.distribuzioni.per_priorita,PR)+'</div>'+
      '<div class="sez"><h2>Per categoria (periodo)</h2>'+hbarre(d.distribuzioni.per_categoria)+'</div>'+
      '<div class="sez"><h2>Per assegnatario (periodo)</h2>'+hbarre(d.distribuzioni.per_assegnato)+'</div>'+
      (f&&f.top_clienti.length?'<div class="sez"><h2>Primi clienti per fatturato</h2>'+hbarre(f.top_clienti.map(function(x){return {voce:x.nome,n:Math.round(x.fatturato)};}))+'</div>':'')+
      '</div></main>';
    $('#corpo-vista').innerHTML=h;stili($('#corpo-vista'));
    legaBarraCruscotto();
    $$('[data-vai]').forEach(function(k){k.addEventListener('click',function(){var v=k.getAttribute('data-vai').split(':');
      if(v[0]==='ticket'){S.t={preset:v[1]==='non'?'non':v[1]==='sla'?'sla':'aperti'};S.pag.ticket=0;}
      if(v[0]==='crm'&&v[1]==='dafare')S.a={stato:'scadute'};
      vai(v[0],v[1]||'');});});
    sincro(d.sync);
  });
}

// ---------------------------------------------------------------- viste salvate
function caricaViste(sezione){return api('/viste',{sezione:sezione}).then(function(r){S.viste=r.viste;}).catch(function(){S.viste=[];});}
function barraViste(sezione){
  return '<label>Viste salvate<select id="v-sel">'+opzioni(S.viste.map(function(v){return [String(v.id),v.nome+(v.condivisa?' (condivisa)':'')];}),'','Scegli una vista…')+'</select></label>'+
    '<button id="v-salva" class="s">Salva filtri come vista</button><button id="v-del" class="s rosso" disabled>Elimina vista</button>';
}
function legaViste(sezione,stato,ricarica){
  $('#v-sel').addEventListener('change',function(){
    var v=S.viste.filter(function(x){return String(x.id)===$('#v-sel').value;})[0];
    $('#v-del').disabled=!v;
    if(v){Object.keys(stato).forEach(function(k){delete stato[k];});Object.keys(v.filtro).forEach(function(k){stato[k]=v.filtro[k];});ricarica();$('#v-sel').value=String(v.id);$('#v-del').disabled=false;}
  });
  $('#v-del').addEventListener('click',function(){var id=$('#v-sel').value;if(!id)return;chiama('DELETE','/viste/'+id).then(function(){avviso('Vista eliminata');return caricaViste(sezione);}).then(ricarica).catch(fallita);});
  $('#v-salva').addEventListener('click',function(){
    modale('<h3>Salva vista</h3><div class="modulo">'+inp('vs-nome','Nome della vista','','text','maxlength="60"')+'<label class="ck largo"><input id="vs-cond" type="checkbox"> Condividi con gli altri utenti</label></div><div class="azioni"><button class="p" id="vs-ok">Salva</button><button data-chiudi>Annulla</button></div>');
    $('#vs-ok').addEventListener('click',function(){var nome=val('vs-nome');if(!nome){avviso('Scrivi un nome',true);return;}
      var filtro={};Object.keys(stato).forEach(function(k){if(stato[k]!==''&&stato[k]!==false&&stato[k]!=null)filtro[k]=stato[k];});
      chiama('POST','/viste',{sezione:sezione,nome:nome,filtro:filtro,condivisa:spunta('vs-cond')}).then(function(){chiudiModale();avviso('Vista salvata');return caricaViste(sezione);}).then(ricarica).catch(fallita);});
  });
}

// ---------------------------------------------------------------- paginazione
function paginazione(chiave,totale){
  var o=S.pag[chiave],da=totale?o+1:0,a=Math.min(o+PAG,totale);
  return '<div class="pag"><button data-pag="-1"'+(o<=0?' disabled':'')+'>Precedenti</button><span>'+da+'–'+a+' di '+num(totale)+'</span><button data-pag="1"'+(o+PAG>=totale?' disabled':'')+'>Successivi</button></div>';
}
function legaPaginazione(chiave){$$('[data-pag]').forEach(function(b){b.addEventListener('click',function(){S.pag[chiave]=Math.max(0,S.pag[chiave]+Number(b.getAttribute('data-pag'))*PAG);carica();});});}
function vaiCliente(id){return function(ev){ev.preventDefault();schedaCliente(id);};}

// ---------------------------------------------------------------- ticket
function scadenzaSla(t){
  if(t.stato==='risolto'||t.stato==='chiuso')return '';
  if(t.sla_risposta_scaduta)return chip('risposta scaduta','bad');
  if(t.sla_risoluzione_scaduta)return chip('risoluzione scaduta','bad');
  var s=t.prima_risposta_il?t.scade_risoluzione:t.scade_prima_risposta;
  if(!s)return t.piano_sla==='nessuno'?chip('senza SLA'):'';
  var h=(new Date(s)-Date.now())/36e5;
  return chip((t.prima_risposta_il?'risolvere entro ':'rispondere entro ')+ore(Math.max(h,0)),h<4?'warn':'');
}
var PRESET={aperti:'Aperti',non:'Da prendere',miei:'Assegnati a me',sla:'SLA scaduti',tutti:'Tutti'};
function paramTicket(){
  var t=S.t,p={q:t.q,priorita:t.priorita,fonte:t.fonte,piano:t.piano,assegnato:t.assegnato,ordine:t.ordine||'scadenza',business:S.filtri.business};
  p.stato=t.stato==='aperti'||(!t.stato&&(t.preset==='aperti'||t.preset==='non'||t.preset==='miei'||t.preset==='sla'))?APERTI:t.stato;
  if(t.preset==='non')p.non_assegnati='true';
  if(t.preset==='miei')p.assegnato=S.me.email||S.me.nome;
  if(t.preset==='sla'||t.scaduti)p.scaduti='true';
  if(t.preset==='tutti')p.stato=t.stato||'';
  return p;
}
function filtriTicket(){
  var f=S.opz,t=S.t;
  return '<div class="preset">'+Object.keys(PRESET).map(function(k){return '<button data-preset="'+k+'" class="'+((t.preset||'aperti')===k?'on':'')+'">'+PRESET[k]+'</button>';}).join('')+'</div>'+
    '<div class="filtri">'+
    inp('t-q','Cerca',t.q,'search','placeholder="oggetto, cliente, rif."')+
    sel('t-stato','Stato',opzioni([['aperti','Tutti gli aperti'],['aperto','Da prendere'],['in_lavorazione','In lavorazione'],['in_attesa_cliente','In attesa cliente'],['risolto','Risolto'],['chiuso','Chiuso']],t.stato||'','Come il filtro rapido'))+
    sel('t-prio','Priorità',opzioni(f.priorita,t.priorita||'','Tutte',PR))+
    sel('t-fonte','Fonte',opzioni(f.fonti,t.fonte||'','Tutte'))+
    sel('t-ass','Assegnato a',opzioni(f.assegnati,t.assegnato||'','Tutti'))+
    sel('t-piano','Piano SLA',opzioni([['standard','Standard'],['nessuno','Nessun SLA']].concat((S.piani.piani||[]).filter(function(x){return x!=='nessuno';}).map(function(x){return [x,'Piano '+x];})),t.piano||'','Tutti'))+
    sel('t-ord','Ordine',opzioni([['scadenza','Per scadenza SLA'],['recenti','Più recenti'],['vecchi','Più vecchi'],['priorita','Per priorità']],t.ordine||'scadenza',null))+
    '</div>';
}
function leggiFiltriTicket(){var t=S.t;t.q=val('t-q');t.stato=val('t-stato');t.priorita=val('t-prio');t.fonte=val('t-fonte');t.assegnato=val('t-ass');t.piano=val('t-piano');t.ordine=val('t-ord');}
function ticket(){
  var p=paramTicket();p.limite=PAG;p.offset=S.pag.ticket;
  return Promise.all([api('/ticket',p),caricaViste('ticket')]).then(function(r){
    var d=r[0],h='<div class="titolo"><h2>Ticket</h2>'+(permesso('ticketScrive')?'<button class="p" id="t-nuovo">Nuovo ticket</button>':'')+'</div><main><div class="sez">'+filtriTicket();
    h+='<div class="azioni">'+barraViste('ticket')+'<span class="sp"></span><button id="t-csv" class="s">Esporta CSV</button></div>';
    h+='<div class="scroll"><table><thead><tr><th>Aperto</th><th>Attività</th><th>Oggetto</th><th>Cliente</th><th>Priorità</th><th>Stato</th><th>Assegnato</th><th>SLA</th></tr></thead><tbody>';
    d.ticket.forEach(function(x){h+='<tr class="riga" data-ref="'+esc(x.ref)+'"><td>'+data(x.aperto_il)+'</td><td>'+esc(x.business)+'<br>'+chip(x.fonte)+'</td><td>'+esc(x.oggetto)+'</td><td>'+esc(x.cliente_nome||x.cliente_email||'-')+'</td><td>'+chip(PR[x.priorita],PRC[x.priorita])+'</td><td>'+chip(ST[x.stato]||x.stato)+'</td><td>'+esc(x.assegnato_a||'-')+'</td><td>'+scadenzaSla(x)+'</td></tr>';});
    h+='</tbody></table></div>'+(d.ticket.length?'':vuoto('Nessun ticket con questi filtri.'))+paginazione('ticket',d.totale)+'</div></main>';
    $('#corpo-vista').innerHTML=h;
    $$('[data-preset]').forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-preset');S.t={preset:k,q:S.t.q,ordine:S.t.ordine};S.pag.ticket=0;carica();});});
    ['t-q','t-stato','t-prio','t-fonte','t-ass','t-piano','t-ord'].forEach(function(id){$('#'+id).addEventListener('change',function(){leggiFiltriTicket();S.pag.ticket=0;carica();});});
    $('#t-q').addEventListener('keydown',function(e){if(e.key==='Enter'){leggiFiltriTicket();S.pag.ticket=0;carica();}});
    $$('tr.riga').forEach(function(tr){tr.addEventListener('click',function(){dettaglioTicket(tr.getAttribute('data-ref'));});});
    legaPaginazione('ticket');legaViste('ticket',S.t,function(){S.pag.ticket=0;carica();});
    $('#t-csv').addEventListener('click',function(){var q=paramTicket();delete q.ordine;location.href='/dashboard/api/export/ticket'+qs(q);});
    var nuovo=$('#t-nuovo');if(nuovo)nuovo.addEventListener('click',nuovoTicket);
  });
}
function nuovoTicket(){
  var bus=(S.me.business||S.opz.business||[]);
  modale('<h3>Nuovo ticket</h3><div class="modulo">'+
    sel('nt-bus','Attività',opzioni(bus,S.filtri.business||'',null))+
    sel('nt-prio','Priorità',opzioni(['normale','urgente','alta','bassa'],'normale',null,PR))+
    '<label class="largo">Oggetto<input id="nt-ogg" maxlength="300"></label>'+
    '<label class="largo">Descrizione<textarea id="nt-txt" maxlength="8000"></textarea></label>'+
    inp('nt-nome','Cliente (nome)','')+inp('nt-mail','Cliente (email)','','email')+
    inp('nt-cat','Categoria','')+sel('nt-piano','Piano SLA',pianiOpz('',true))+
    '</div><div class="azioni"><button class="p" id="nt-ok">Apri ticket</button><button data-chiudi>Annulla</button></div>');
  $('#nt-ok').addEventListener('click',function(){
    var b={business:val('nt-bus'),oggetto:val('nt-ogg'),priorita:val('nt-prio')};
    if(!b.business||!b.oggetto){avviso('Servono attività e oggetto',true);return;}
    if(val('nt-txt'))b.testo=val('nt-txt');if(val('nt-cat'))b.categoria=val('nt-cat');if(val('nt-piano'))b.piano_sla=val('nt-piano');
    var c={};if(val('nt-nome'))c.nome=val('nt-nome');if(val('nt-mail'))c.email=val('nt-mail');if(Object.keys(c).length)b.cliente=c;
    chiama('POST','/ticket',b).then(function(r){chiudiModale();avviso('Ticket aperto');carica();dettaglioTicket(r.ref);}).catch(fallita);
  });
}
function dettaglioTicket(ref){
  S.aperto={tipo:'ticket',id:ref};
  Promise.all([api('/ticket/'+encodeURIComponent(ref)),api('/ticket/'+encodeURIComponent(ref)+'/conversazione').catch(function(e){return {errore:e.message};})]).then(function(r){
    var t=r[0],conv=r[1],puo=permesso('ticketScrive');
    var h='<h3 class="p">'+esc(t.oggetto)+'</h3><div>'+chip(ST[t.stato]||t.stato)+chip(PR[t.priorita],PRC[t.priorita])+scadenzaSla(t)+chip(t.origine==='remoto'?'nel backend di '+t.fonte:'gestito qui')+'</div>';
    h+='<dl class="dl"><dt>Riferimento</dt><dd>'+esc(t.ref)+'</dd><dt>Attività</dt><dd>'+esc(t.business)+'</dd><dt>Fonte</dt><dd>'+esc(t.fonte)+(t.canale?' · '+esc(t.canale):'')+'</dd>'+
      '<dt>Cliente</dt><dd>'+esc(t.cliente_nome||'-')+(t.cliente_email?'<br>'+esc(t.cliente_email):'')+(t.cliente?'<br><a href="#" data-cli="'+esc(t.cliente.clickup_task_id)+'">Apri scheda cliente</a>':'')+'</dd>'+
      '<dt>Aperto</dt><dd>'+data(t.aperto_il)+'</dd><dt>Prima risposta</dt><dd>'+data(t.prima_risposta_il)+(t.scade_prima_risposta?' (entro '+data(t.scade_prima_risposta)+')':'')+'</dd>'+
      '<dt>Risolto</dt><dd>'+data(t.risolto_il)+(t.scade_risoluzione?' (entro '+data(t.scade_risoluzione)+')':'')+'</dd><dt>Piano SLA</dt><dd>'+esc(nomePiano(t.piano_sla))+'</dd></dl>';
    if(puo){
      h+='<h3>Gestione</h3><div class="modulo">'+sel('g-stato','Stato',opzioni(Object.keys(ST),t.stato,null,ST))+sel('g-prio','Priorità',opzioni(Object.keys(PR),t.priorita,null,PR))+
        sel('g-ass','Assegnato a',utentiOpz(t.assegnato_a))+inp('g-cat','Categoria',t.categoria)+sel('g-piano','Piano SLA',pianiOpz(t.piano_sla,true))+'</div>'+
        '<div class="azioni"><button class="p" id="g-salva">Salva</button><button id="g-me">Assegna a me</button></div>';
    }
    h+='<h3>Conversazione</h3>';
    if(conv.errore)h+='<div class="err">Non riesco a leggere i messaggi: '+esc(conv.errore)+'</div>';
    else h+='<div class="chat">'+(conv.messaggi.length?conv.messaggi.map(function(m){return '<div class="msg '+(m.interno?'int st':m.da==='staff'?'st':'cl')+'"><small>'+esc((m.interno?'Nota interna · ':'')+(m.autore||(m.da==='staff'?'Staff':'Cliente'))+' · '+data(m.quando))+'</small>'+esc(m.testo||'')+'</div>';}).join(''):vuoto('Nessun messaggio.'))+'</div>';
    if(puo)h+='<textarea id="r-testo" maxlength="8000" placeholder="Scrivi una risposta…"></textarea><div class="azioni"><label class="ck"><input id="r-int" type="checkbox"> Nota interna (non va al cliente)</label><span class="sp"></span><button class="p" id="r-invia">Invia</button></div>';
    h+='<h3>Cronologia</h3>'+(t.eventi.length?'<table><tbody>'+t.eventi.map(function(e){return '<tr><td>'+data(e.quando)+'</td><td>'+esc(e.tipo)+'</td><td>'+esc(e.da||'')+'</td><td>'+esc(e.dettaglio?JSON.stringify(e.dettaglio):'')+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessun evento.'));
    pannello(h);
    var a=$('[data-cli]');if(a)a.addEventListener('click',vaiCliente(a.getAttribute('data-cli')));
    if(puo){
      var salva=function(mod){return chiama('PATCH','/ticket/'+encodeURIComponent(ref),mod).then(function(){avviso('Salvato');carica();dettaglioTicket(ref);}).catch(fallita);};
      $('#g-salva').addEventListener('click',function(){var mod={};
        if(val('g-stato')!==t.stato)mod.stato=val('g-stato');if(val('g-prio')!==t.priorita)mod.priorita=val('g-prio');
        if(val('g-ass')!==(t.assegnato_a||''))mod.assegnato_a=val('g-ass');if(val('g-cat')!==(t.categoria||''))mod.categoria=val('g-cat');
        if(val('g-piano')!==(t.piano_sla||''))mod.piano_sla=val('g-piano')||'standard';
        if(!Object.keys(mod).length){avviso('Nessuna modifica');return;}salva(mod);});
      $('#g-me').addEventListener('click',function(){salva({assegnato_a:S.me.email||S.me.nome});});
      $('#r-invia').addEventListener('click',function(){var tx=val('r-testo');if(!tx){avviso('Scrivi un messaggio',true);return;}
        chiama('POST','/ticket/'+encodeURIComponent(ref)+'/messaggi',{testo:tx,interno:spunta('r-int')}).then(function(){avviso(spunta('r-int')?'Nota salvata':'Risposta inviata');carica();dettaglioTicket(ref);}).catch(fallita);});
    }
  }).catch(fallita);
}

// ---------------------------------------------------------------- CRM: clienti
function paramClienti(){var c=S.c;return {business:S.filtri.business,q:c.q,stato:c.stato,ordine:c.ordine||'nome',con_ticket_aperti:c.tk?'true':'',senza_fatture:c.sf?'true':''};}
function filtriClienti(){
  var f=S.opz,c=S.c;
  return '<div class="filtri">'+inp('c-q','Cerca',c.q,'search','placeholder="nome, email, P.IVA, telefono"')+
    sel('c-stato','Stato',opzioni(f.stati_cliente,c.stato||'','Tutti'))+
    sel('c-ord','Ordine',opzioni(S.me.soldi?['nome','recenti','ticket','fatturato']:['nome','recenti','ticket'],c.ordine||'nome',null,{nome:'Nome',recenti:'Più recenti',ticket:'Più ticket aperti',fatturato:'Fatturato 12 mesi'}))+
    lab('Con ticket aperti','<input id="c-tk" type="checkbox"'+(c.tk?' checked':'')+'>','ck')+
    (S.me.soldi?lab('Senza fatture','<input id="c-sf" type="checkbox"'+(c.sf?' checked':'')+'>','ck'):'')+'</div>';
}
function leggiFiltriClienti(){S.c={q:val('c-q'),stato:val('c-stato'),ordine:val('c-ord'),tk:spunta('c-tk'),sf:spunta('c-sf')};}
function clienti(){
  var soldi=S.me.soldi,p=paramClienti();p.limite=PAG;p.offset=S.pag.clienti;
  return Promise.all([api('/clienti',p),caricaViste('clienti')]).then(function(r){
    var d=r[0],h='<div class="titolo"><h2>Clienti</h2>'+(permesso('crmAnagrafica')?'<button class="p" id="c-nuovo">Nuovo cliente</button>':'')+'</div><main><div class="sez">'+filtriClienti();
    h+='<div class="azioni">'+barraViste('clienti')+'<span class="sp"></span><button id="c-csv" class="s">Esporta CSV</button></div>';
    h+='<div class="scroll"><table><thead><tr><th>Cliente</th><th>Contatti</th><th>Attività</th><th class="n">Ticket aperti</th>'+(soldi?'<th class="n">Fatture</th><th class="n">Fatturato 12 mesi</th><th>Ultima fattura</th>':'')+'</tr></thead><tbody>';
    d.clienti.forEach(function(x){h+='<tr class="riga" data-id="'+esc(x.clickup_task_id)+'"><td>'+esc(x.nome)+(x.stato?'<br>'+chip(x.stato):'')+'</td><td>'+esc(x.email||'')+(x.partita_iva?'<br>P.IVA '+esc(x.partita_iva):'')+(x.telefono?'<br>'+esc(x.telefono):'')+'</td><td>'+x.businesses.map(function(b){return chip(b,'acc');}).join('')+'</td><td class="n">'+(x.ticket_aperti?'<span class="chip warn">'+x.ticket_aperti+'</span>':'0')+'</td>'+(soldi?'<td class="n">'+num(x.fatture)+'</td><td class="n">'+euro(x.fatturato_12m)+'</td><td>'+giorno(x.ultima_fattura)+'</td>':'')+'</tr>';});
    h+='</tbody></table></div>'+(d.clienti.length?'':vuoto('Nessun cliente con questi filtri.'))+paginazione('clienti',d.totale)+'</div></main>';
    $('#corpo-vista').innerHTML=h;
    ['c-q','c-stato','c-ord','c-tk','c-sf'].forEach(function(id){var el=$('#'+id);if(el)el.addEventListener('change',function(){leggiFiltriClienti();S.pag.clienti=0;carica();});});
    $('#c-q').addEventListener('keydown',function(e){if(e.key==='Enter'){leggiFiltriClienti();S.pag.clienti=0;carica();}});
    $$('tr.riga').forEach(function(tr){tr.addEventListener('click',function(){schedaCliente(tr.getAttribute('data-id'));});});
    legaPaginazione('clienti');legaViste('clienti',S.c,function(){S.pag.clienti=0;carica();});
    $('#c-csv').addEventListener('click',function(){var q=paramClienti();delete q.ordine;location.href='/dashboard/api/export/clienti'+qs(q);});
    var n=$('#c-nuovo');if(n)n.addEventListener('click',nuovoCliente);
  });
}
function nuovoCliente(){
  modale('<h3>Nuovo cliente</h3><p class="sotto">La scheda viene creata in ClickUp (anagrafica unica di tutte le attività).</p><div class="modulo">'+
    '<label class="largo">Nome o ragione sociale<input id="nc-nome" maxlength="200"></label>'+inp('nc-mail','Email','','email')+inp('nc-tel','Telefono','')+inp('nc-piva','Partita IVA','')+inp('nc-cf','Codice fiscale','')+
    '<div class="largo"><div class="sotto">Attività</div>'+businessBox('nc-b',S.filtri.business?[S.filtri.business]:[])+'</div></div>'+
    '<div class="azioni"><button class="p" id="nc-ok">Crea cliente</button><button data-chiudi>Annulla</button></div>');
  $('#nc-ok').addEventListener('click',function(){
    var b={nome:val('nc-nome')};if(!b.nome){avviso('Scrivi il nome',true);return;}
    if(val('nc-mail'))b.email=val('nc-mail');if(val('nc-tel'))b.telefono=val('nc-tel');if(val('nc-piva'))b.partita_iva=val('nc-piva');if(val('nc-cf'))b.codice_fiscale=val('nc-cf');
    b.businesses=businessScelti('nc-b');
    chiama('POST','/clienti',b).then(function(r){chiudiModale();avviso('Cliente creato');carica();schedaCliente(r.clickup_task_id);}).catch(function(e){
      if(e.status===409&&e.dati&&e.dati.clickup_task_id){chiudiModale();avviso('Esiste già un cliente con questa email o P.IVA: apro la scheda',true);schedaCliente(e.dati.clickup_task_id);}else fallita(e);});
  });
}
function schedaCliente(id){
  S.aperto={tipo:'cliente',id:id};
  api('/clienti/'+encodeURIComponent(id)+'/scheda').then(function(c){
    var anag=permesso('crmAnagrafica'),scr=permesso('crmScrive');
    var h='<h3 class="p">'+esc(c.nome)+'</h3><div>'+c.businesses.map(function(b){return chip(b,'acc');}).join('')+(c.stato?chip(c.stato):'')+chip('assistenza: '+nomePiano(c.piano_sla),c.piano_sla&&c.piano_sla!=='nessuno'?'ok':'')+'</div>';
    if(anag){
      h+='<h3>Anagrafica</h3><div class="modulo">'+inp('a-nome','Nome',c.nome)+inp('a-mail','Email',c.email,'email')+inp('a-tel','Telefono',c.telefono)+inp('a-piva','Partita IVA',c.partita_iva)+inp('a-cf','Codice fiscale',c.codice_fiscale)+
        '<div class="largo"><div class="sotto">Attività</div>'+businessBox('a-b',c.businesses)+'</div>'+sel('a-piano','Piano di assistenza',pianiOpz(c.piano_sla,true))+'</div>'+
        '<div class="azioni"><button class="p" id="a-salva">Salva su ClickUp</button></div>';
    }else h+='<dl class="dl"><dt>Email</dt><dd>'+esc(c.email||'-')+'</dd><dt>Telefono</dt><dd>'+esc(c.telefono||'-')+'</dd><dt>P.IVA</dt><dd>'+esc(c.partita_iva||'-')+'</dd><dt>Cod. fiscale</dt><dd>'+esc(c.codice_fiscale||'-')+'</dd></dl>';
    h+='<dl class="dl"><dt>Cliente dal</dt><dd>'+giorno(c.creato_il)+'</dd></dl>';
    // contatti
    h+='<h3>Contatti</h3>'+(c.contatti.length?'<table><tbody>'+c.contatti.map(function(x){return '<tr><td>'+esc(x.nome)+(x.principale?' '+chip('principale','ok'):'')+'<br><span class="sotto">'+esc(x.ruolo||'')+'</span></td><td>'+esc(x.email||'')+'<br>'+esc(x.telefono||'')+'</td><td class="n">'+(scr?'<button class="s rosso" data-del-contatto="'+x.id+'">Elimina</button>':'')+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessun contatto.'));
    if(scr)h+='<div class="modulo">'+inp('k-nome','Nome','')+inp('k-ruolo','Ruolo','')+inp('k-mail','Email','','email')+inp('k-tel','Telefono','')+'</div><div class="azioni"><button id="k-add">Aggiungi contatto</button></div>';
    // attività
    h+='<h3>Attività e promemoria</h3>'+(c.attivita.length?'<table><tbody>'+c.attivita.map(function(x){return '<tr><td>'+(scr?'<input type="checkbox" data-att="'+x.id+'"'+(x.completata_il?' checked':'')+'>':'')+'</td><td>'+esc(x.titolo)+'<br><span class="sotto">'+esc(TIPI[x.tipo]||x.tipo)+(x.assegnato_a?' · '+esc(x.assegnato_a):'')+'</span></td><td>'+(x.completata_il?chip('fatta','ok'):(x.scadenza?chip(data(x.scadenza),x.scaduta?'bad':''):''))+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessuna attività.'));
    if(scr)h+='<div class="modulo">'+inp('n-tit','Cosa fare','','text','maxlength="300"')+sel('n-tipo','Tipo',opzioni(Object.keys(TIPI),'promemoria',null,TIPI))+inp('n-scad','Entro','','datetime-local')+sel('n-ass','Assegnata a',utentiOpz(S.me.email||S.me.nome))+'</div><div class="azioni"><button id="n-add">Aggiungi attività</button></div>';
    // note
    h+='<h3>Note</h3>'+(c.note.length?c.note.map(function(n){return '<div class="card">'+(n.fissata?chip('fissata','warn'):'')+esc(n.testo)+'<div class="sotto">'+esc(n.autore)+' · '+data(n.creato_il)+(scr?' · <a href="#" data-pin="'+n.id+'" data-v="'+(n.fissata?'0':'1')+'">'+(n.fissata?'stacca':'fissa')+'</a> · <a href="#" data-del-nota="'+n.id+'">elimina</a>':'')+'</div></div>';}).join(''):vuoto('Nessuna nota.'));
    if(scr)h+='<textarea id="no-testo" maxlength="4000" placeholder="Scrivi una nota sul cliente…"></textarea><div class="azioni"><button id="no-add">Aggiungi nota</button></div>';
    // trattative
    h+='<h3>Trattative</h3>'+(c.trattative.length?'<table><tbody>'+c.trattative.map(function(o){return '<tr><td>'+esc(o.titolo)+'<br><span class="sotto">'+esc(o.business)+'</span></td><td>'+chip(FASI[o.fase]||o.fase,o.fase==='vinta'?'ok':o.fase==='persa'?'bad':'')+'</td><td class="n">'+euro(o.valore)+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessuna trattativa.'));
    if(anag)h+='<div class="azioni"><button id="o-add">Nuova trattativa</button></div>';
    // ticket e documenti
    h+='<h3>Ticket</h3>'+(c.ticket.length?'<table><tbody>'+c.ticket.map(function(t){return '<tr class="riga" data-ref="'+esc(t.ref)+'"><td>'+data(t.aperto_il)+'</td><td>'+esc(t.oggetto)+'</td><td>'+chip(ST[t.stato]||t.stato)+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessun ticket.'));
    if(permesso('ticketScrive'))h+='<div class="azioni"><button id="t-apri">Apri un ticket per questo cliente</button></div>';
    if(c.documenti)h+='<h3>Documenti</h3>'+(c.documenti.length?'<table><tbody>'+c.documenti.map(function(x){return '<tr class="riga" data-doc="'+esc(x.ref)+'"><td>'+esc(x.tipo+' '+x.numero+'/'+x.anno)+'</td><td>'+giorno(x.data_riserva)+'</td><td>'+esc(x.business||'')+'</td><td>'+chip(DOCST[x.stato]||x.stato)+'</td><td class="n">'+euro(Number(x.totale))+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessun documento.'));
    h+='<h3>Cronologia</h3>'+(c.cronologia.length?'<table><tbody>'+c.cronologia.map(function(e){return '<tr><td>'+data(e.quando)+'</td><td>'+chip(e.tipo)+'</td><td>'+esc(e.titolo)+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessun evento.'));
    pannello(h);
    var rif=function(){carica();schedaCliente(id);};
    $$('#dettaglio tr[data-ref]').forEach(function(tr){tr.addEventListener('click',function(){dettaglioTicket(tr.getAttribute('data-ref'));});});
    $$('#dettaglio tr[data-doc]').forEach(function(tr){tr.addEventListener('click',function(){dettaglioDocumento(tr.getAttribute('data-doc'));});});
    var sa=$('#a-salva');if(sa)sa.addEventListener('click',function(){
      var b={nome:val('a-nome'),email:val('a-mail')||null,telefono:val('a-tel')||null,partita_iva:val('a-piva')||null,codice_fiscale:val('a-cf')||null,businesses:businessScelti('a-b')};
      var piano=val('a-piano');
      chiama('PATCH','/clienti/'+encodeURIComponent(id),b).then(function(){return chiama('PUT','/clienti/'+encodeURIComponent(id)+'/piano-sla',{piano_sla:piano||null});}).then(function(){avviso('Scheda salvata su ClickUp');rif();}).catch(fallita);});
    var ka=$('#k-add');if(ka)ka.addEventListener('click',function(){var b={nome:val('k-nome')};if(!b.nome){avviso('Scrivi il nome del contatto',true);return;}if(val('k-ruolo'))b.ruolo=val('k-ruolo');if(val('k-mail'))b.email=val('k-mail');if(val('k-tel'))b.telefono=val('k-tel');b.principale=!c.contatti.length;
      chiama('POST','/clienti/'+encodeURIComponent(id)+'/contatti',b).then(rif).catch(fallita);});
    $$('[data-del-contatto]').forEach(function(b){b.addEventListener('click',function(){chiama('DELETE','/contatti/'+b.getAttribute('data-del-contatto')).then(rif).catch(fallita);});});
    var na=$('#n-add');if(na)na.addEventListener('click',function(){var b={titolo:val('n-tit'),tipo:val('n-tipo'),cliente:id};if(!b.titolo){avviso('Scrivi cosa fare',true);return;}if(val('n-scad'))b.scadenza=new Date(val('n-scad')).toISOString();if(val('n-ass'))b.assegnato_a=val('n-ass');
      chiama('POST','/attivita',b).then(rif).catch(fallita);});
    $$('[data-att]').forEach(function(c2){c2.addEventListener('change',function(){chiama('PATCH','/attivita/'+c2.getAttribute('data-att'),{completata:c2.checked}).then(rif).catch(fallita);});});
    var noa=$('#no-add');if(noa)noa.addEventListener('click',function(){var tx=val('no-testo');if(!tx){avviso('Scrivi la nota',true);return;}chiama('POST','/clienti/'+encodeURIComponent(id)+'/note',{testo:tx}).then(rif).catch(fallita);});
    $$('[data-pin]').forEach(function(a){a.addEventListener('click',function(ev){ev.preventDefault();chiama('PATCH','/note/'+a.getAttribute('data-pin'),{fissata:a.getAttribute('data-v')==='1'}).then(rif).catch(fallita);});});
    $$('[data-del-nota]').forEach(function(a){a.addEventListener('click',function(ev){ev.preventDefault();chiama('DELETE','/note/'+a.getAttribute('data-del-nota')).then(rif).catch(fallita);});});
    var oa=$('#o-add');if(oa)oa.addEventListener('click',function(){nuovaTrattativa(c);});
    var ta=$('#t-apri');if(ta)ta.addEventListener('click',function(){nuovoTicketPerCliente(c);});
  }).catch(fallita);
}
function nuovoTicketPerCliente(c){
  var bus=c.businesses.length?c.businesses:(S.me.business||S.opz.business||[]);
  modale('<h3>Nuovo ticket per '+esc(c.nome)+'</h3><div class="modulo">'+sel('nt-bus','Attività',opzioni(bus,bus[0]||'',null))+sel('nt-prio','Priorità',opzioni(['normale','urgente','alta','bassa'],'normale',null,PR))+
    '<label class="largo">Oggetto<input id="nt-ogg" maxlength="300"></label><label class="largo">Descrizione<textarea id="nt-txt" maxlength="8000"></textarea></label></div>'+
    '<div class="azioni"><button class="p" id="nt-ok">Apri ticket</button><button data-chiudi>Annulla</button></div>');
  $('#nt-ok').addEventListener('click',function(){var b={business:val('nt-bus'),oggetto:val('nt-ogg'),priorita:val('nt-prio'),cliente:{}};if(!b.business||!b.oggetto){avviso('Servono attività e oggetto',true);return;}
    if(val('nt-txt'))b.testo=val('nt-txt');if(c.email)b.cliente.email=c.email;b.cliente.nome=c.nome;if(c.partita_iva)b.cliente.partita_iva=c.partita_iva;
    chiama('POST','/ticket',b).then(function(r){chiudiModale();avviso('Ticket aperto');carica();dettaglioTicket(r.ref);}).catch(fallita);});
}

// ---------------------------------------------------------------- CRM: trattative
function trattative(){
  var o=S.o;
  return api('/opportunita',{business:S.filtri.business,assegnato:o.assegnato,q:o.q,aperte:o.aperte?'true':''}).then(function(d){
    var h='<div class="titolo"><h2>Trattative</h2>'+(permesso('crmAnagrafica')?'<button class="p" id="o-nuova">Nuova trattativa</button>':'')+'</div><main><div class="sez"><div class="filtri">'+
      inp('o-q','Cerca',o.q,'search')+inp('o-ass','Assegnata a',o.assegnato)+lab('Nascondi vinte e perse','<input id="o-ap" type="checkbox"'+(o.aperte?' checked':'')+'>','ck')+'</div>';
    var fasi=o.aperte?['nuova','contattato','proposta','trattativa']:Object.keys(FASI);
    h+='<div class="kanban">'+fasi.map(function(f){var righe=d.opportunita.filter(function(x){return x.fase===f;}),riep=d.per_fase.filter(function(x){return x.fase===f;})[0];
      return '<div class="col"><h3><span>'+esc(FASI[f])+' ('+righe.length+')</span><span>'+(riep&&riep.valore!=null?euro(riep.valore):'')+'</span></h3>'+righe.map(function(x){
        return '<div class="card" data-opp="'+x.id+'"><b>'+esc(x.titolo)+'</b><div class="sotto">'+(x.cliente_task_id?'<a href="#" data-cli="'+esc(x.cliente_task_id)+'">'+esc(x.cliente_nome||'cliente')+'</a>':esc(x.cliente_nome||''))+' · '+esc(x.business)+'</div>'+
          '<div class="sotto">'+(x.valore!=null?euro(x.valore)+' · ':'')+(x.chiusura_prevista?'entro '+giorno(x.chiusura_prevista)+' · ':'')+esc(x.assegnato_a||'non assegnata')+'</div>'+
          (permesso('crmAnagrafica')?'<div><select data-fase="'+x.id+'">'+opzioni(Object.keys(FASI),x.fase,null,FASI)+'</select></div>':'')+'</div>';}).join('')+(righe.length?'':'<div class="sotto">Vuota</div>')+'</div>';}).join('')+'</div></div></main>';
    $('#corpo-vista').innerHTML=h;stili($('#corpo-vista'));
    $('#o-q').addEventListener('keydown',function(e){if(e.key==='Enter'){S.o.q=val('o-q');carica();}});
    $('#o-ass').addEventListener('change',function(){S.o.assegnato=val('o-ass');carica();});
    $('#o-ap').addEventListener('change',function(){S.o.aperte=spunta('o-ap');carica();});
    $$('[data-cli]').forEach(function(a){a.addEventListener('click',vaiCliente(a.getAttribute('data-cli')));});
    $$('[data-fase]').forEach(function(s){s.addEventListener('change',function(){var fase=s.value,motivo=null;
      if(fase==='persa'){motivo=window.prompt('Motivo della perdita (facoltativo)')||null;}
      chiama('PATCH','/opportunita/'+s.getAttribute('data-fase'),motivo?{fase:fase,motivo_perdita:motivo}:{fase:fase}).then(function(){avviso('Trattativa aggiornata');carica();}).catch(fallita);});});
    var n=$('#o-nuova');if(n)n.addEventListener('click',function(){nuovaTrattativa(null);});
  });
}
function nuovaTrattativa(c){
  var bus=(S.me.business||S.opz.business||[]);
  modale('<h3>Nuova trattativa'+(c?' per '+esc(c.nome):'')+'</h3><div class="modulo">'+inp('no-tit','Titolo','','text','maxlength="300"')+sel('no-bus','Attività',opzioni(c&&c.businesses.length?c.businesses:bus,S.filtri.business||'',null))+
    (c?'':inp('no-pro','Prospect (se non è ancora cliente)',''))+inp('no-val','Valore stimato (€)','','number','min="0" step="1"')+inp('no-data','Chiusura prevista','','date')+sel('no-fase','Fase',opzioni(Object.keys(FASI).slice(0,4),'nuova',null,FASI))+sel('no-ass','Assegnata a',utentiOpz(S.me.email||S.me.nome))+'</div>'+
    '<div class="azioni"><button class="p" id="no-ok">Crea</button><button data-chiudi>Annulla</button></div>');
  $('#no-ok').addEventListener('click',function(){var b={titolo:val('no-tit'),business:val('no-bus'),fase:val('no-fase')};if(!b.titolo||!b.business){avviso('Servono titolo e attività',true);return;}
    if(c)b.cliente=c.clickup_task_id;else if(val('no-pro'))b.prospect=val('no-pro');
    if(val('no-val'))b.valore=Number(val('no-val'));if(val('no-data'))b.chiusura_prevista=val('no-data');if(val('no-ass'))b.assegnato_a=val('no-ass');
    chiama('POST','/opportunita',b).then(function(){chiudiModale();avviso('Trattativa creata');carica();if(c)schedaCliente(c.clickup_task_id);}).catch(fallita);});
}

// ---------------------------------------------------------------- CRM: da fare e duplicati
function dafare(){
  var a=S.a;
  return api('/attivita',{business:S.filtri.business,stato:a.stato==='scadute'?'aperte':a.stato,scadute:a.stato==='scadute'?'true':'',assegnato:a.assegnato,limite:200}).then(function(d){
    var h='<div class="titolo"><h2>Da fare</h2>'+(permesso('crmScrive')?'<button class="p" id="a-nuova">Nuova attività</button>':'')+'</div><main><div class="sez"><div class="filtri">'+
      sel('a-stato','Mostra',opzioni([['aperte','Da fare'],['scadute','Scadute'],['completate','Completate'],['tutte','Tutte']],a.stato||'aperte',null))+
      sel('a-ass','Assegnate a',utentiOpz(a.assegnato||''))+'<button id="a-mie" class="s">Solo le mie</button></div>';
    h+='<div class="scroll"><table><thead><tr><th></th><th>Cosa</th><th>Cliente</th><th>Assegnata a</th><th>Scadenza</th></tr></thead><tbody>';
    d.attivita.forEach(function(x){h+='<tr><td>'+(permesso('crmScrive')?'<input type="checkbox" data-att="'+x.id+'"'+(x.completata_il?' checked':'')+'>':'')+'</td><td>'+esc(x.titolo)+'<br><span class="sotto">'+esc(TIPI[x.tipo]||x.tipo)+'</span></td><td>'+(x.cliente_task_id?'<a href="#" data-cli="'+esc(x.cliente_task_id)+'">'+esc(x.cliente_nome||'cliente')+'</a>':'-')+'</td><td>'+esc(x.assegnato_a||'-')+'</td><td>'+(x.completata_il?chip('fatta','ok'):x.scadenza?chip(data(x.scadenza),x.scaduta?'bad':''):'-')+'</td></tr>';});
    h+='</tbody></table></div>'+(d.attivita.length?'':vuoto('Niente da fare qui.'))+'</div></main>';
    $('#corpo-vista').innerHTML=h;
    $('#a-stato').addEventListener('change',function(){S.a.stato=val('a-stato');carica();});
    $('#a-ass').addEventListener('change',function(){S.a.assegnato=val('a-ass');carica();});
    $('#a-mie').addEventListener('click',function(){S.a.assegnato=S.me.email||S.me.nome;carica();});
    $$('[data-cli]').forEach(function(l){l.addEventListener('click',vaiCliente(l.getAttribute('data-cli')));});
    $$('[data-att]').forEach(function(c2){c2.addEventListener('change',function(){chiama('PATCH','/attivita/'+c2.getAttribute('data-att'),{completata:c2.checked}).then(function(){avviso('Aggiornata');carica();}).catch(fallita);});});
    var n=$('#a-nuova');if(n)n.addEventListener('click',function(){
      modale('<h3>Nuova attività</h3><div class="modulo">'+inp('n-tit','Cosa fare','','text','maxlength="300"')+sel('n-tipo','Tipo',opzioni(Object.keys(TIPI),'promemoria',null,TIPI))+inp('n-scad','Entro','','datetime-local')+sel('n-ass','Assegnata a',utentiOpz(S.me.email||S.me.nome))+sel('n-bus','Attività',opzioni(S.me.business||S.opz.business||[],S.filtri.business||'',null))+'</div><div class="azioni"><button class="p" id="n-ok">Crea</button><button data-chiudi>Annulla</button></div>');
      $('#n-ok').addEventListener('click',function(){var b={titolo:val('n-tit'),tipo:val('n-tipo'),business:val('n-bus')};if(!b.titolo||!b.business){avviso('Servono testo e attività',true);return;}if(val('n-scad'))b.scadenza=new Date(val('n-scad')).toISOString();if(val('n-ass'))b.assegnato_a=val('n-ass');
        chiama('POST','/attivita',b).then(function(){chiudiModale();avviso('Attività creata');carica();}).catch(fallita);});});
  });
}
function duplicati(){
  return api('/clienti-duplicati').then(function(d){
    var h='<div class="titolo"><h2>Possibili duplicati</h2></div><main><div class="sez"><p class="sotto">Schede con la stessa partita IVA o la stessa email. Si uniscono a mano in ClickUp.</p>';
    h+=d.duplicati.length?d.duplicati.map(function(x){return '<div class="card"><b>'+esc(x.motivo==='email'?'Stessa email':'Stessa partita IVA')+': '+esc(x.valore)+'</b>'+x.schede.map(function(s){return '<div><a href="#" data-cli="'+esc(s.id)+'">'+esc(s.nome)+'</a> '+s.businesses.map(function(b){return chip(b,'acc');}).join('')+'</div>';}).join('')+'</div>';}).join(''):vuoto('Nessun duplicato.');
    $('#corpo-vista').innerHTML=h+'</div></main>';
    $$('[data-cli]').forEach(function(l){l.addEventListener('click',vaiCliente(l.getAttribute('data-cli')));});
  });
}

// ---------------------------------------------------------------- fatturazione (sola lettura)
function paramFatture(){var f=S.f;return {business:S.filtri.business,q:f.q,tipo:f.tipo,stato:f.stato,fonte:f.fonte,anno:f.anno,da:f.da,a:f.a,importo_min:f.min,importo_max:f.max,ordine:f.ordine||'recenti'};}
function fatture(){
  var f=S.f,p=paramFatture();p.limite=PAG;p.offset=S.pag.fatture;
  return Promise.all([api('/documenti',p),api('/documenti-riepilogo',{business:S.filtri.business,anno:f.anno}),caricaViste('fatture')]).then(function(r){
    var d=r[0],mesi=r[1].mesi;
    var h='<div class="titolo"><h2>Fatturazione</h2><span class="sotto">sola lettura</span></div><main><div class="sez"><div class="filtri">'+
      inp('f-q','Cerca',f.q,'search','placeholder="cliente, P.IVA, numero, rif."')+
      sel('f-tipo','Tipo',opzioni([['fattura','Fatture'],['proforma','Proforme']],f.tipo||'','Tutti'))+
      sel('f-stato','Stato',opzioni(Object.keys(DOCST).map(function(k){return [k,DOCST[k]];}),f.stato||'','Tutti'))+
      sel('f-fonte','Origine',opzioni([['stripe','Stripe'],['gocardless','GoCardless'],['clickup','ClickUp'],['dashboard','Portale'],['n8n','n8n']],f.fonte||'','Tutte'))+
      inp('f-anno','Anno',f.anno,'number','min="2020" max="2100" step="1"')+inp('f-da','Dal',f.da,'date')+inp('f-a','Al',f.a,'date')+inp('f-min','Importo da',f.min,'number','step="1"')+inp('f-max','Importo a',f.max,'number','step="1"')+
      sel('f-ord','Ordine',opzioni([['recenti','Più recenti'],['vecchi','Più vecchi'],['importo','Importo'],['numero','Numero']],f.ordine||'recenti',null))+'</div>';
    h+='<div class="azioni">'+barraViste('fatture')+'<span class="sp"></span><button id="f-csv" class="s">Esporta CSV</button></div>';
    h+='<div class="tot"><span><b>'+num(d.totale)+'</b> documenti</span><span>Somma non annullati: <b>'+euro2(d.somma)+'</b> <i class="sotto">(prima del bollo)</i></span></div>';
    h+='<div class="scroll"><table><thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Attività</th><th>Origine</th><th>Stato</th><th class="n">Importo</th></tr></thead><tbody>';
    d.documenti.forEach(function(x){h+='<tr class="riga'+(x.stato==='annullato'?' annullato':'')+'" data-doc="'+esc(x.ref)+'"><td>'+esc((x.tipo==='fattura'?'Fattura ':'Proforma ')+x.numero+'/'+x.anno)+'</td><td>'+giorno(x.data_riserva)+'</td><td>'+esc(x.cliente_nome||'-')+(x.partita_iva?'<br><span class="sotto">P.IVA '+esc(x.partita_iva)+'</span>':'')+'</td><td>'+esc(x.business||'')+'</td><td>'+chip(x.fonte)+'</td><td>'+chip(DOCST[x.stato]||x.stato,x.stato==='annullato'?'bad':'')+'</td><td class="n">'+euro2(Number(x.totale))+'</td></tr>';});
    h+='</tbody></table></div>'+(d.documenti.length?'':vuoto('Nessun documento con questi filtri.'))+paginazione('fatture',d.totale)+'</div>';
    h+='<div class="sez"><h2>Importi per mese, anno '+esc(f.anno||'')+'</h2>'+hbarre(mesiAggregati(mesi))+'</div></main>';
    $('#corpo-vista').innerHTML=h;stili($('#corpo-vista'));
    ['f-tipo','f-stato','f-fonte','f-anno','f-da','f-a','f-min','f-max','f-ord'].forEach(function(id){$('#'+id).addEventListener('change',function(){leggiFiltriFatture();S.pag.fatture=0;carica();});});
    $('#f-q').addEventListener('keydown',function(e){if(e.key==='Enter'){leggiFiltriFatture();S.pag.fatture=0;carica();}});
    $$('tr.riga').forEach(function(tr){tr.addEventListener('click',function(){dettaglioDocumento(tr.getAttribute('data-doc'));});});
    legaPaginazione('fatture');legaViste('fatture',S.f,function(){S.pag.fatture=0;carica();});
    $('#f-csv').addEventListener('click',function(){var q=paramFatture();delete q.ordine;location.href='/dashboard/api/export/documenti'+qs(q);});
  });
}
function mesiAggregati(mesi){var m={};mesi.forEach(function(x){m[x.mese]=(m[x.mese]||0)+Number(x.totale);});return Object.keys(m).sort().map(function(k){return {voce:k+' — '+euro(m[k]),n:Math.round(m[k])};});}
function leggiFiltriFatture(){S.f={q:val('f-q'),tipo:val('f-tipo'),stato:val('f-stato'),fonte:val('f-fonte'),anno:val('f-anno'),da:val('f-da'),a:val('f-a'),min:val('f-min'),max:val('f-max'),ordine:val('f-ord')};}
function dettaglioDocumento(ref){
  S.aperto={tipo:'documento',id:ref};
  api('/documenti/'+encodeURIComponent(ref)).then(function(d){
    var p=d.payload||{},c=p.cliente||{},ind=c.indirizzo||{};
    var h='<h3 class="p">'+esc((d.tipo==='fattura'?'Fattura ':'Proforma ')+d.numero+'/'+d.anno)+'</h3><div>'+chip(DOCST[d.stato]||d.stato,d.stato==='annullato'?'bad':'ok')+chip(d.business||'-','acc')+chip(d.fonte)+'</div>';
    h+='<dl class="dl"><dt>Riferimento</dt><dd>'+esc(d.ref)+'</dd><dt>Data</dt><dd>'+data(d.data_riserva)+'</dd><dt>Cliente</dt><dd>'+esc(c.ragione_sociale||c.nome||'-')+(d.scheda_cliente?' <a href="#" data-cli="'+esc(d.scheda_cliente.clickup_task_id)+'">scheda</a>':'')+'</dd>'+
      '<dt>P.IVA / CF</dt><dd>'+esc((c.partita_iva||'-')+' / '+(c.codice_fiscale||'-'))+'</dd><dt>Email</dt><dd>'+esc(c.email||'-')+'</dd><dt>Indirizzo</dt><dd>'+esc([ind.via,ind.cap,ind.citta,ind.provincia].filter(Boolean).join(' ')||'-')+'</dd>'+
      (p.rif_proforma?'<dt>Da proforma</dt><dd>'+esc(p.rif_proforma)+'</dd>':'')+(d.note_annullo?'<dt>Annullo</dt><dd>'+esc(d.note_annullo)+'</dd>':'')+'</dl>';
    h+='<h3>Righe</h3><table><tbody>'+(p.righe||[]).map(function(r){return '<tr><td>'+esc(r.descrizione)+'</td><td class="n">'+euro2(r.importo)+'</td></tr>';}).join('')+'<tr><th>Totale (prima del bollo)</th><th class="n">'+euro2(Number(d.totale))+'</th></tr></tbody></table>';
    if(p.note)h+='<h3>Note</h3><p>'+esc(p.note)+'</p>';
    h+='<h3>Storico stati</h3>'+(d.storico.length?'<table><tbody>'+d.storico.map(function(s){return '<tr><td>'+data(s.quando)+'</td><td>'+esc((s.da_stato||'—')+' → '+s.a_stato)+'</td></tr>';}).join('')+'</tbody></table>':vuoto('Nessun passaggio.'));
    pannello(h);
    var a=$('#dettaglio [data-cli]');if(a)a.addEventListener('click',vaiCliente(a.getAttribute('data-cli')));
  }).catch(fallita);
}

// ---------------------------------------------------------------- navigazione
var VOCI=[['cruscotto','','Cruscotto'],['ticket','','Ticket'],['crm','clienti','CRM'],['fatture','','Fatturazione']];
var SOTTO=[['clienti','Clienti'],['trattative','Trattative'],['dafare','Da fare'],['duplicati','Duplicati']];
function vai(sez,sub){location.hash='#/'+sez+(sub?'/'+sub:'');}
function leggiHash(){var p=location.hash.replace(/^#\/?/,'').split('/');S.sez=p[0]||'cruscotto';S.sub=p[1]||(S.sez==='crm'?'clienti':'');if(S.sez==='fatture'&&!permesso('fatture'))S.sez='cruscotto';}
function menu(){
  var h='<h1>Gestione</h1>';
  VOCI.forEach(function(v){if(v[0]==='fatture'&&!permesso('fatture'))return;h+='<button class="m'+(S.sez===v[0]?' on':'')+'" data-m="'+v[0]+'" data-s="'+v[1]+'">'+esc(v[2])+'</button>';
    if(v[0]==='crm'&&S.sez==='crm')SOTTO.forEach(function(s){h+='<button class="m sm'+(S.sub===s[0]?' on':'')+'" data-m="crm" data-s="'+s[0]+'">'+esc(s[1])+'</button>';});});
  h+='<span class="sp"></span><div class="ut">'+esc(S.me.nome)+'<br>'+esc(S.me.ruoli.join(', '))+'</div><form method="post" action="/dashboard/logout"><button type="submit" class="m">Esci</button></form>';
  $('#lato').innerHTML=h;
  $$('#lato [data-m]').forEach(function(b){b.addEventListener('click',function(){S.pag={ticket:0,clienti:0,fatture:0};chiudiPannello();vai(b.getAttribute('data-m'),b.getAttribute('data-s'));});});
}
function sincro(righe){
  var out=[];(righe||[]).forEach(function(r){out.push(r.nome+': '+(r.ultimo_ok?data(r.ultimo_ok):'mai')+(r.ultimo_errore?' (ultimo tentativo fallito)':''));});
  $('#sync').textContent=out.length?'Ultimi aggiornamenti dei dati — '+out.join(' · '):'';
}
function carica(){
  leggiHash();menu();
  $('#corpo-vista').innerHTML='<div class="vuoto">Caricamento…</div>';
  var f=S.sez==='ticket'?ticket:S.sez==='fatture'?fatture:S.sez==='crm'?(S.sub==='trattative'?trattative:S.sub==='dafare'?dafare:S.sub==='duplicati'?duplicati:clienti):cruscotto;
  f().catch(function(e){$('#corpo-vista').innerHTML='<div class="err">'+esc(e.message||e)+'</div>';});
}
function avvia(){
  Promise.all([api('/me'),api('/filtri'),api('/utenti').catch(function(){return {utenti:[]};}),api('/piani-sla')]).then(function(r){
    S.me=r[0];S.opz=r[1];S.utenti=r[2].utenti;S.piani=r[3];
    // Attività configurate ma ancora senza dati (es. un'attività nuova) devono poter essere scelte nei moduli.
    var conf=(r[3].business||[]).filter(function(b){return S.me.business===null||S.me.business.indexOf(b)>=0;});
    S.opz.business=S.opz.business.concat(conf.filter(function(b){return S.opz.business.indexOf(b)<0;})).sort();
    window.addEventListener('hashchange',carica);
    $('#modale').addEventListener('click',function(ev){if(ev.target===this)chiudiModale();});
    document.addEventListener('keydown',function(ev){if(ev.key==='Escape'){chiudiModale();chiudiPannello();}});
    carica();
  }).catch(function(e){$('#corpo-vista').innerHTML='<div class="err">'+esc(e.message||e)+'</div>';});
}
avvia();
})();
`;

/** Pagina completa; `nonce` è quello della Content-Security-Policy di questa risposta. */
export function paginaDashboard(nonce: string): string {
  return (
    `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><title>Gestione</title><style nonce="${nonce}">${CSS}</style></head><body>` +
    `<div id="app"><nav id="lato"></nav><div id="corpo"><div id="corpo-vista"><div class="vuoto">Caricamento…</div></div><footer id="sync"></footer></div></div>` +
    `<aside id="dettaglio" hidden></aside><div id="modale" hidden></div><div id="avviso" hidden></div>` +
    `<script nonce="${nonce}">${SCRIPT}</script></body></html>`
  );
}

export const _perTest = { CSS, SCRIPT };
