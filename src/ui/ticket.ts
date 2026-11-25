// Sezione Ticket: viste con i numeri | elenco | area di lavoro (conversazione, risposta/nota, proprietà). Modello: gli help desk professionali.
export const TICKET = String.raw`
var VISTE=[
  ['da_prendere','Da prendere','da_prendere','blu'],
  ['miei','Assegnati a me','miei'],
  ['non_assegnati','Non assegnati','non_assegnati'],
  ['in_attesa','In attesa del cliente','in_attesa'],
  ['sla_scaduti','SLA scaduti','sla_scaduti','rosso'],
  ['sla_rischio','SLA a rischio (4 h)','sla_a_rischio','ambra'],
  ['aperti','Tutti gli aperti','aperti'],
  ['risolti','Risolti di recente','risolti_7g'],
  ['tutti','Tutti i ticket',null]
];
function parametriTicket(){
  var t=S.t,p={business:bz(),q:t.q,priorita:t.prio,fonte:t.fonte,piano:t.piano,ordine:t.ordine};
  switch(t.vista){
    case 'da_prendere':p.stato='aperto';p.non_assegnati='true';p.ordine=p.ordine||'scadenza';break;
    case 'miei':p.stato=APERTI;p.assegnato=io();p.ordine=p.ordine||'scadenza';break;
    case 'non_assegnati':p.stato=APERTI;p.non_assegnati='true';p.ordine=p.ordine||'scadenza';break;
    case 'in_attesa':p.stato='in_attesa_cliente';break;
    case 'sla_scaduti':p.scaduti='true';p.ordine=p.ordine||'scadenza';break;
    case 'sla_rischio':p.a_rischio='true';p.ordine=p.ordine||'scadenza';break;
    case 'aperti':p.stato=APERTI;p.ordine=p.ordine||'scadenza';break;
    case 'risolti':p.stato='risolto,chiuso';p.ordine=p.ordine||'recenti';break;
    default:break;
  }
  return p;
}
function sostituisciSegnaposto(testo,t){
  return String(testo).split('{{cliente}}').join(t.cliente_nome||'cliente').split('{{agente}}').join(S.me.nome).split('{{rif}}').join(t.ref);
}

function ticketPagina(){
  var R=rotta(),t=S.t;
  if(!t.righe)t.righe=[];
  t.sel=t.sel||{};
  return Promise.all([api('/ticket-viste',{business:bz()}),api('/viste',{sezione:'ticket'}).catch(function(){return {viste:[]};}),S.risposte?Promise.resolve(null):api('/risposte-rapide').then(function(r){S.risposte=r.risposte;}).catch(function(){S.risposte=[];})]).then(function(r){
    t.conti=r[0];S.viste=r[1].viste;
    var v=$('#vista');v.textContent='';
    var vw=E('div',{class:'vw',id:'vw'});
    var elc=E('div',{class:'elc'});
    var ws=E('div',{class:'ws vuota',id:'ws'},E('div',{class:'vuoto'},[E('b',{text:'Nessun ticket selezionato'}),'Scegli un ticket dall’elenco, oppure usa j e k per scorrere.']));
    v.appendChild(E('div',{class:'tk'},[vw,elc,ws]));
    disegnaVisteTicket(vw);
    disegnaElencoTicket(elc);
    S.tasti=tastiTicket;
    return caricaRighe(true).then(function(){
      if(R.id)apriTicket(R.id);
      else if(t.aperto&&t.righe.some(function(x){return x.ref===t.aperto;}))apriTicket(t.aperto);
    });
  });
}
function disegnaVisteTicket(vw){
  var t=S.t,c=t.conti||{};
  vw.textContent='';
  vw.appendChild(E('div',{class:'cap',text:'Viste'}));
  VISTE.forEach(function(x){
    var n=x[2]?c[x[2]]:null;
    vw.appendChild(E('button',{type:'button',class:'v'+(t.vista===x[0]?' on':'')+(x[3]&&n>0&&(x[3]==='rosso'||x[3]==='ambra')?' '+x[3]:''),on:{click:function(){t.vista=x[0];t.offset=0;t.sel={};t.aperto=null;history.replaceState(null,'','#/ticket');ticketPagina();}}},[x[1],n!=null?E('span',{class:'c',text:n}):null]));
  });
  vw.appendChild(E('div',{class:'cap',text:'Le mie viste'}));
  if(!S.viste.length)vw.appendChild(E('div',{class:'mut',text:'Nessuna vista salvata.'}));
  S.viste.forEach(function(x){
    vw.appendChild(E('div',{class:'row'},[
      E('button',{type:'button',class:'v'+(t.vista==='v:'+x.id?' on':''),on:{click:function(){var f=x.filtro||{};S.t={vista:'v:'+x.id,q:f.q,prio:f.prio,fonte:f.fonte,piano:f.piano,ordine:f.ordine,filtroVista:f};ticketPagina();}}},[x.nome+(x.condivisa?' (condivisa)':'')]),
      x.mia?E('button',{class:'btn ghost sm',type:'button',title:'Elimina vista','aria-label':'Elimina vista',on:{click:function(){chiama('DELETE','/viste/'+x.id).then(function(){avviso('Vista eliminata');ticketPagina();}).catch(fallita);}}},I('chiudi')):null
    ]));
  });
  vw.appendChild(E('div',{class:'row'},btn('Salva filtri attuali',salvaVistaTicket,'sm ghost','piu')));
}
function salvaVistaTicket(){
  var t=S.t;
  var nome=inp('vs-nome','','text',{maxlength:'60',placeholder:'Es. Urgenti da richiamare'}),cond=E('input',{type:'checkbox',id:'vs-cond'});
  modale('Salva vista',E('div',{class:'col'},[campo('Nome',nome),E('label',{class:'ck'},[cond,'Condividi con gli altri utenti'])]),[{testo:'Annulla'},{testo:'Salva',pri:true,fn:function(){
    var n=val('vs-nome');if(!n){avviso('Scrivi un nome',true);return;}
    var filtro={q:t.q,prio:t.prio,fonte:t.fonte,piano:t.piano,ordine:t.ordine,vista:t.vista.indexOf('v:')===0?'tutti':t.vista};
    chiama('POST','/viste',{sezione:'ticket',nome:n,filtro:filtro,condivisa:spunta('vs-cond')}).then(function(){chiudiModale();avviso('Vista salvata');ticketPagina();}).catch(fallita);
  }}]);
}
function disegnaElencoTicket(elc){
  var t=S.t;elc.textContent='';
  var q=E('input',{type:'search',id:'t-q',placeholder:'Cerca nei ticket',value:t.q||'','aria-label':'Cerca nei ticket'});
  var applica=function(){t.q=q.value.trim();t.prio=val('t-prio');t.fonte=val('t-fonte');t.piano=val('t-piano');t.ordine=val('t-ord');t.offset=0;caricaRighe(true);};
  q.addEventListener('keydown',function(e){if(e.key==='Enter')applica();});
  var pianiTutti=[];Object.keys(S.piani.per_business||{}).forEach(function(b){S.piani.per_business[b].forEach(function(x){if(x!=='nessuno'&&pianiTutti.indexOf(x)<0)pianiTutti.push(x);});});
  var filtri=E('div',{class:'row w'},[
    sel('t-prio',['urgente','alta','normale','bassa'].map(function(x){return [x,PR[x]];}),t.prio,'Priorità'),
    sel('t-fonte',(S.opz.fonti||[]).map(function(x){return [x,x];}),t.fonte,'Fonte'),
    sel('t-piano',[['standard','Standard'],['nessuno','Nessun SLA']].concat(pianiTutti.map(function(x){return [x,'Piano '+x];})),t.piano,'Piano SLA'),
    sel('t-ord',[['scadenza','Per scadenza SLA'],['recenti','Più recenti'],['vecchi','Più vecchi'],['priorita','Per priorità']],t.ordine,'Ordine')
  ]);
  $$('select',filtri).forEach(function(s){s.addEventListener('change',applica);});
  elc.appendChild(E('div',{class:'top'},[
    E('div',{class:'row'},[q,puo('ticketScrive')?btn('Nuovo',nuovoTicket,'pri sm','piu'):null,btn('CSV',function(){var p=parametriTicket();delete p.ordine;scarica('/export/ticket',p);},'sm','scarica')]),
    filtri,
    E('div',{class:'mut',id:'t-conta'})
  ]));
  elc.appendChild(E('div',{id:'t-bulk'}));
  elc.appendChild(E('div',{id:'t-righe'}));
  elc.appendChild(E('div',{class:'more',id:'t-altri'}));
}
function caricaRighe(reset){
  var t=S.t,p=parametriTicket();
  if(reset){t.righe=[];t.offset=0;}
  p.limite=PAG;p.offset=t.offset||0;
  return api('/ticket',p).then(function(d){
    t.righe=t.righe.concat(d.ticket);t.totale=d.totale;disegnaRighe();
  }).catch(fallita);
}
function evidenzia(){$$('.tr').forEach(function(r){r.classList.toggle('sel',r.getAttribute('data-ref')===S.t.aperto);});}
function rigaTicketLista(x){
  var t=S.t,s=statoSla(x);
  var cb=E('input',{type:'checkbox','aria-label':'Seleziona',on:{click:function(e){e.stopPropagation();},change:function(e){if(e.target.checked)t.sel[x.ref]=true;else delete t.sel[x.ref];disegnaBulk();}}});
  if(t.sel[x.ref])cb.setAttribute('checked','');
  return E('div',{class:'tr '+x.priorita+(t.aperto===x.ref?' sel':''),'data-ref':x.ref,on:{click:function(){selezionaTicket(x.ref);}}},[
    puo('ticketScrive')?cb:null,
    E('div',{class:'cn'},[
      E('div',{class:'og',text:x.oggetto}),
      E('div',{class:'sb',text:[x.cliente_nome||x.cliente_email||'Cliente sconosciuto',x.business,fa(x.aperto_il)].filter(Boolean).join(' · ')})
    ]),
    E('div',{class:'dx'},[s?tag(s.corto,s.tono):null,E('span',{class:'row'},[x.stato!=='aperto'?tag(ST[x.stato]||x.stato,STT[x.stato]):null,av(x.assegnato_a)])])
  ]);
}
function disegnaRighe(){
  var t=S.t,box=$('#t-righe');if(!box)return;
  box.textContent='';
  if(!t.righe.length)box.appendChild(vuoto('Nessun ticket in questa vista','Quando arrivano dai backend dei business compaiono qui.'));
  t.righe.forEach(function(x){box.appendChild(rigaTicketLista(x));});
  $('#t-conta').textContent=num(t.totale||0)+' ticket';
  var altri=$('#t-altri');altri.textContent='';
  if(t.righe.length<(t.totale||0))altri.appendChild(btn('Carica altri ('+num(t.totale-t.righe.length)+')',function(){t.offset=t.righe.length;caricaRighe(false);},'sm'));
  disegnaBulk();
}
function disegnaBulk(){
  var t=S.t,box=$('#t-bulk');if(!box)return;box.textContent='';
  var refs=Object.keys(t.sel||{});
  if(!refs.length||!puo('ticketScrive'))return;
  function su(mod,msg){
    Promise.all(refs.map(function(r){return chiama('PATCH','/ticket/'+enc(r),mod);})).then(function(){t.sel={};avviso(refs.length+' ticket aggiornati'+(msg?': '+msg:''));aggiornaTutto();}).catch(function(e){fallita(e);aggiornaTutto();});
  }
  box.appendChild(E('div',{class:'bulk'},[
    E('b',{text:refs.length+' selezionati'}),
    btn('Assegna a me',function(){su({assegnato_a:io()});},'sm'),
    (function(){var s=sel('b-ass',utentiOpz(),'','Assegna a…');s.addEventListener('change',function(){if(s.value)su({assegnato_a:s.value});});return s;})(),
    (function(){var s=sel('b-st',Object.keys(ST).map(function(k){return [k,ST[k]];}),'','Stato…');s.addEventListener('change',function(){if(s.value)su({stato:s.value});});return s;})(),
    btn('Annulla',function(){t.sel={};disegnaRighe();},'ghost sm')
  ]));
}
function aggiornaTutto(){
  var t=S.t;
  return Promise.all([api('/ticket-viste',{business:bz()}).then(function(c){t.conti=c;S.badge.ticket=c.da_prendere;}),caricaRighe(true)]).then(function(){var vw=$('#vw');if(vw)disegnaVisteTicket(vw);menu();});
}
function selezionaTicket(ref){
  S.t.aperto=ref;history.replaceState(null,'','#/ticket/'+enc(ref));evidenzia();apriTicket(ref);
}
function tastiTicket(ev){
  var t=S.t,i=t.righe.findIndex(function(x){return x.ref===t.aperto;});
  if(ev.key==='j'||ev.key==='k'){
    var n=ev.key==='j'?Math.min(i+1,t.righe.length-1):Math.max(i<0?0:i-1,0);
    if(t.righe[n]){selezionaTicket(t.righe[n].ref);var el=$('.tr[data-ref="'+(window.CSS&&CSS.escape?CSS.escape(t.righe[n].ref):t.righe[n].ref)+'"]');if(el&&el.scrollIntoView)el.scrollIntoView({block:'nearest'});}
    return;
  }
  if(ev.key==='Escape'&&t.aperto){t.aperto=null;history.replaceState(null,'','#/ticket');evidenzia();var ws=$('#ws');ws.className='ws vuota';ws.textContent='';ws.appendChild(E('div',{class:'vuoto',text:'Nessun ticket selezionato'}));return;}
  if(!t.aperto||!puo('ticketScrive'))return;
  if(ev.key==='a'){ev.preventDefault();modificaTicket(t.aperto,{assegnato_a:io()},'Assegnato a te');}
  else if(ev.key==='e'){ev.preventDefault();modificaTicket(t.aperto,{stato:'risolto'},'Ticket risolto');}
  else if(ev.key==='r'){ev.preventDefault();var ta=$('#r-testo');if(ta)ta.focus();}
}
function modificaTicket(ref,mod,msg){
  return chiama('PATCH','/ticket/'+enc(ref),mod).then(function(){avviso(msg||'Salvato');return aggiornaTutto();}).then(function(){if(S.t.aperto===ref)apriTicket(ref);}).catch(function(e){fallita(e);if(S.t.aperto===ref)apriTicket(ref);});
}
function nuovoTicket(){
  var bus=(S.me.business||S.opz.business||[]);
  var bsel=sel('nt-bus',bus.map(function(x){return [x,x];}),S.business||bus[0]||'');
  var psel=sel('nt-piano',pianiOpz([bsel.value],true),'');
  bsel.addEventListener('change',function(){psel.textContent='';pianiOpz([bsel.value],true).forEach(function(o){psel.appendChild(E('option',{value:o[0],text:o[1]}));});});
  var corpo=E('div',{class:'campi'},[
    campo('Attività',bsel),campo('Priorità',sel('nt-prio',['normale','urgente','alta','bassa'].map(function(x){return [x,PR[x]];}),'normale')),
    campo('Oggetto',inp('nt-ogg','','text',{maxlength:'300'}),'l'),campo('Descrizione',E('textarea',{id:'nt-txt',maxlength:'8000'}),'l'),
    campo('Cliente (nome)',inp('nt-nome','')),campo('Cliente (email)',inp('nt-mail','','email')),
    campo('Categoria',inp('nt-cat','')),campo('Piano SLA',psel)
  ]);
  modale('Nuovo ticket',corpo,[{testo:'Annulla'},{testo:'Apri ticket',pri:true,fn:function(){
    var b={business:val('nt-bus'),oggetto:val('nt-ogg'),priorita:val('nt-prio')};
    if(!b.business||!b.oggetto){avviso('Servono attività e oggetto',true);return;}
    if(val('nt-txt'))b.testo=val('nt-txt');if(val('nt-cat'))b.categoria=val('nt-cat');if(val('nt-piano'))b.piano_sla=val('nt-piano');
    var c={};if(val('nt-nome'))c.nome=val('nt-nome');if(val('nt-mail'))c.email=val('nt-mail');if(Object.keys(c).length)b.cliente=c;
    chiama('POST','/ticket',b).then(function(r){chiudiModale();avviso('Ticket aperto');S.t.vista='tutti';return aggiornaTutto().then(function(){selezionaTicket(r.ref);});}).catch(fallita);
  }}]);
}

// ---------------------------------------------------------------- area di lavoro del ticket
function apriTicket(ref){
  var ws=$('#ws');if(!ws)return;
  S.t.aperto=ref;evidenzia();
  ws.className='ws vuota';ws.textContent='';ws.appendChild(E('div',{class:'vuoto',text:'Caricamento…'}));
  return Promise.all([api('/ticket/'+enc(ref)),api('/ticket/'+enc(ref)+'/conversazione').catch(function(e){return {errore:e.message};})]).then(function(r){
    if(S.t.aperto!==ref)return;
    disegnaAreaTicket(r[0],r[1]);
  }).catch(function(e){ws.textContent='';ws.appendChild(E('div',{class:'err'},e.message||String(e)));});
}
function kv(righe){var dl=E('dl',{class:'kv'});righe.forEach(function(r){if(!r)return;dl.appendChild(E('dt',{text:r[0]}));dl.appendChild(E('dd',null,r[1]));});return dl;}
function slaBlocco(etichetta,scadenza,fatto,piano){
  if(fatto)return E('div',{class:'sla verde'},[I('fatto'),etichetta,E('b',{text:data(fatto)})]);
  if(!scadenza)return E('div',{class:'sla'},[I('orologio'),etichetta,E('b',{text:piano==='nessuno'?'senza SLA':'-'})]);
  var ms=new Date(scadenza).getTime()-Date.now();
  return E('div',{class:'sla '+(ms<0?'rosso':ms<4*3600e3?'ambra':'')},[I('orologio'),etichetta,E('b',{text:ms<0?'scaduta da '+durata(ms):'entro '+durata(ms)})]);
}
function disegnaAreaTicket(t,conv){
  var ws=$('#ws'),puoS=puo('ticketScrive'),ref=t.ref;
  ws.className='ws';ws.textContent='';
  var chiuso=t.stato==='risolto'||t.stato==='chiuso';
  var head=E('div',{class:'head'},[
    E('h2',{text:t.oggetto}),
    E('div',{class:'row w'},[tag(ST[t.stato]||t.stato,STT[t.stato]),prio(t.priorita),tag(t.business,'blu'),E('span',{class:'mut',text:t.ref+' · aperto '+fa(t.aperto_il)}),E('span',{class:'sp'}),
      puoS&&!t.assegnato_a?btn('Assegna a me',function(){modificaTicket(ref,{assegnato_a:io()},'Assegnato a te');},'sm pri'):null,
      puoS&&!chiuso?btn('Risolvi',function(){modificaTicket(ref,{stato:'risolto'},'Ticket risolto');},'sm','fatto'):null,
      puoS&&chiuso?btn('Riapri',function(){modificaTicket(ref,{stato:'aperto'},'Ticket riaperto');},'sm'):null,
      btn('Chiudi',function(){S.t.aperto=null;history.replaceState(null,'','#/ticket');evidenzia();ws.className='ws vuota';ws.textContent='';},'ghost sm','chiudi')])
  ]);
  var thread=E('div',{class:'thread'});
  if(conv.errore)thread.appendChild(E('div',{class:'err'},['Non riesco a leggere i messaggi: '+conv.errore]));
  else if(!conv.messaggi.length)thread.appendChild(vuoto('Nessun messaggio'));
  else conv.messaggi.forEach(function(m){
    thread.appendChild(E('div',{class:'msg '+(m.interno?'nt':m.da==='staff'?'st':'cl')},[
      av(m.autore||(m.da==='staff'?'Staff':t.cliente_nome),true),
      E('div',{class:'bd'},[E('div',{class:'mh'},[E('b',{text:m.autore||(m.da==='staff'?'Staff':'Cliente')}),' · '+data(m.quando)+(m.interno?' · nota interna':'')]),E('div',{class:'tx',text:m.testo||''})])
    ]));
  });
  var conv2=E('div',{class:'conv'},[head,thread]);
  if(puoS)conv2.appendChild(composer(t));
  // proprietà
  var prop=E('div',{class:'prop'});
  function cambio(id,opz,corrente,campoApi,disabil){
    var s=sel(id,opz,corrente);if(disabil||!puoS)s.setAttribute('disabled','');
    s.addEventListener('change',function(){var m={};m[campoApi]=s.value;modificaTicket(ref,m,'Salvato');});
    return s;
  }
  prop.appendChild(E('section',null,[E('h3',{text:'SLA'}),slaBlocco('Prima risposta',t.scade_prima_risposta,t.prima_risposta_il,t.piano_sla),slaBlocco('Risoluzione',t.scade_risoluzione,t.risolto_il,t.piano_sla)]));
  prop.appendChild(E('section',null,[E('h3',{text:'Gestione'}),kv([
    ['Stato',cambio('p-st',Object.keys(ST).map(function(k){return [k,ST[k]];}),t.stato,'stato')],
    ['Priorità',cambio('p-pr',Object.keys(PR).map(function(k){return [k,PR[k]];}),t.priorita,'priorita')],
    ['Assegnato a',cambio('p-as',utentiOpz().concat(t.assegnato_a&&!utentiOpz().some(function(u){return u[0]===t.assegnato_a;})?[[t.assegnato_a,t.assegnato_a]]:[]),t.assegnato_a||'','assegnato_a')],
    ['Categoria',(function(){var i=inp('p-ca',t.categoria||'','text',{maxlength:'80'});if(!puoS)i.setAttribute('disabled','');i.addEventListener('change',function(){modificaTicket(ref,{categoria:i.value.trim()},'Salvato');});return i;})()],
    ['Piano SLA',(function(){var s=sel('p-pi',pianiOpz([t.business],true),t.piano_sla||'');if(!puoS)s.setAttribute('disabled','');s.addEventListener('change',function(){modificaTicket(ref,{piano_sla:s.value||'standard'},'Piano aggiornato, scadenze ricalcolate');});return s;})()]
  ])]));
  var cl=t.cliente;
  var altri=E('div',{id:'p-altri'});
  prop.appendChild(E('section',null,[E('h3',{text:'Cliente'}),kv([
    ['Nome',cl?E('a',{href:'#/crm/clienti/'+enc(cl.clickup_task_id),text:cl.nome}):(t.cliente_nome||'-')],
    ['Email',t.cliente_email||(cl&&cl.email)||'-'],
    cl?['Attività',cl.businesses.join(', ')]:null
  ]),altri]));
  if(cl)api('/ticket',{cliente:cl.clickup_task_id,limite:6}).then(function(d){
    var altro=d.ticket.filter(function(x){return x.ref!==ref;});
    if(!altro.length)return;
    altri.appendChild(E('div',{class:'cap',text:'Altri ticket del cliente'}));
    altro.slice(0,5).forEach(function(x){altri.appendChild(E('div',{class:'li'},[E('div',{class:'tt'},[E('a',{href:'#/ticket/'+enc(x.ref),text:x.oggetto,on:{click:function(e){e.preventDefault();selezionaTicket(x.ref);}}}),E('span',{text:ST[x.stato]+' · '+fa(x.aperto_il)})])]));});
  }).catch(function(){});
  prop.appendChild(E('section',null,[E('h3',{text:'Dettagli'}),kv([
    ['Riferimento',t.ref],['Fonte',t.fonte+(t.canale?' · '+t.canale:'')],['Dove vive',t.origine==='remoto'?'nel backend di '+t.fonte:'in questo servizio'],
    ['Aperto',data(t.aperto_il)],['Risolto',data(t.risolto_il)]
  ])]));
  var cron=E('details',{class:'mut'},[E('summary',{text:'Cronologia ('+t.eventi.length+')'}),E('div',null,t.eventi.map(function(e){return E('div',{class:'sb'},[data(e.quando)+' · '+e.tipo+(e.da?' · '+e.da:'')+(e.dettaglio&&e.dettaglio.a!==undefined?' → '+(e.dettaglio.a==null?'nessuno':e.dettaglio.a):'')]);}))]);
  prop.appendChild(E('section',null,cron));
  ws.appendChild(conv2);ws.appendChild(prop);
  var th=$('.thread',ws);if(th)th.scrollTop=th.scrollHeight;conv2.scrollTop=conv2.scrollHeight;
}
function composer(t){
  var ref=t.ref,modo='risposta';
  var area=E('textarea',{id:'r-testo',maxlength:'8000',placeholder:'Scrivi una risposta al cliente…'});
  var box=E('div',{class:'comp'});
  var tabRis=E('button',{type:'button',class:'btn sm pri'},'Rispondi'),tabNota=E('button',{type:'button',class:'btn sm ghost'},'Nota interna');
  var rapide=E('select',{id:'r-rapide','aria-label':'Risposte rapide'},[E('option',{value:'',text:'Risposte rapide…'})].concat((S.risposte||[]).filter(function(x){return !x.business||x.business===t.business;}).map(function(x){return E('option',{value:x.id,text:x.nome});})));
  rapide.addEventListener('change',function(){
    var r=(S.risposte||[]).filter(function(x){return String(x.id)===rapide.value;})[0];
    if(r){area.value=(area.value?area.value+'\n':'')+sostituisciSegnaposto(r.testo,t);area.focus();}
    rapide.value='';
  });
  var bInvia=btn('Invia',function(){invia(false);},'pri'),bRisolvi=btn('Invia e risolvi',function(){invia(true);},'');
  function invia(risolvi){
    var testo=area.value.trim();if(!testo){avviso('Scrivi un messaggio',true);return;}
    var interno=modo==='nota';
    chiama('POST','/ticket/'+enc(ref)+'/messaggi',{testo:testo,interno:interno}).then(function(){
      if(risolvi&&!interno)return chiama('PATCH','/ticket/'+enc(ref),{stato:'risolto'});
    }).then(function(){avviso(interno?'Nota aggiunta':risolvi?'Risposta inviata, ticket risolto':'Risposta inviata');return aggiornaTutto();}).then(function(){apriTicket(ref);}).catch(fallita);
  }
  function imposta(m){
    modo=m;box.classList.toggle('nota',m==='nota');
    tabRis.className='btn sm '+(m==='risposta'?'pri':'ghost');tabNota.className='btn sm '+(m==='nota'?'pri':'ghost');
    area.placeholder=m==='nota'?'Nota visibile solo allo staff…':'Scrivi una risposta al cliente…';
    bInvia.textContent=m==='nota'?'Aggiungi nota':'Invia';bRisolvi.classList.toggle('hid',m==='nota');rapide.classList.toggle('hid',m==='nota');
  }
  tabRis.addEventListener('click',function(){imposta('risposta');});tabNota.addEventListener('click',function(){imposta('nota');});
  box.appendChild(E('div',{class:'row'},[tabRis,tabNota]));
  box.appendChild(E('div',{class:'col'},[area,E('div',{class:'row'},[rapide,E('span',{class:'sp'}),bRisolvi,bInvia])]));
  return box;
}
`;
