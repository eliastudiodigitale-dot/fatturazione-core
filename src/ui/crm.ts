// Sezione CRM: elenco clienti, scheda cliente a tre colonne (informazioni | cronologia | collegamenti), trattative a colonne trascinabili,
// attività raggruppate per scadenza, duplicati. Modello: i CRM professionali (HubSpot, Pipedrive).
export const CRM = String.raw`
// ---------------------------------------------------------------- viste salvate (comune a clienti e fatture)
function barraViste(sezione,stato,ricarica,campiStato){
  var s=sel('v-sel',S.viste.map(function(v){return [String(v.id),v.nome+(v.condivisa?' (condivisa)':'')];}),'','Viste salvate…');
  s.addEventListener('change',function(){
    var v=S.viste.filter(function(x){return String(x.id)===s.value;})[0];
    if(!v)return;
    Object.keys(stato).forEach(function(k){delete stato[k];});Object.keys(v.filtro||{}).forEach(function(k){stato[k]=v.filtro[k];});ricarica();
  });
  var salva=btn('Salva filtri',function(){
    modale('Salva vista',E('div',{class:'col'},[campo('Nome',inp('vs-nome','','text',{maxlength:'60'})),E('label',{class:'ck'},[E('input',{type:'checkbox',id:'vs-cond'}),'Condividi con gli altri utenti'])]),[{testo:'Annulla'},{testo:'Salva',pri:true,fn:function(){
      var n=val('vs-nome');if(!n){avviso('Scrivi un nome',true);return;}
      var filtro={};Object.keys(stato).forEach(function(k){if(stato[k]!==''&&stato[k]!==false&&stato[k]!=null&&k!=='righe'&&k!=='offset'&&k!=='totale')filtro[k]=stato[k];});
      chiama('POST','/viste',{sezione:sezione,nome:n,filtro:filtro,condivisa:spunta('vs-cond')}).then(function(){chiudiModale();avviso('Vista salvata');ricarica();}).catch(fallita);
    }}]);
  },'sm ghost');
  return E('span',{class:'row'},[s,salva]);
}

// ---------------------------------------------------------------- elenco clienti
function parametriClienti(){var c=S.c;return {business:bz(),q:c.q,stato:c.stato,ordine:c.ordine||'nome',con_ticket_aperti:c.tk?'true':'',senza_fatture:c.sf?'true':''};}
function clienti(){
  var c=S.c;
  return Promise.all([api('/viste',{sezione:'clienti'}).catch(function(){return {viste:[]};}),api('/clienti',Object.assign(parametriClienti(),{limite:PAG,offset:c.offset||0}))]).then(function(r){
    S.viste=r[0].viste;var d=r[1];
    c.righe=(c.offset?(c.righe||[]):[]).concat(d.clienti);
    var v=$('#vista');v.textContent='';
    v.appendChild(titoloPagina('Clienti',E('span',{class:'row'},[btn('CSV',function(){var p=parametriClienti();delete p.ordine;scarica('/export/clienti',p);},'sm','scarica'),puo('crmAnagrafica')?btn('Nuovo cliente',nuovoCliente,'pri','piu'):null]),num(d.totale)+' clienti'));
    var q=E('input',{type:'search',id:'c-q',value:c.q||'',placeholder:'Cerca per nome, email, P.IVA, telefono','aria-label':'Cerca clienti'});
    var riapplica=function(){c.q=q.value.trim();c.stato=val('c-stato');c.tk=spunta('c-tk');c.sf=spunta('c-sf');c.offset=0;carica();};
    q.addEventListener('keydown',function(e){if(e.key==='Enter')riapplica();});
    var ck=function(id,t,v){var i=E('input',{type:'checkbox',id:id});if(v)i.setAttribute('checked','');i.addEventListener('change',riapplica);return E('label',{class:'ck'},[i,t]);};
    var stati=sel('c-stato',(S.opz.stati_cliente||[]).map(function(x){return [x,x];}),c.stato,'Stato');stati.addEventListener('change',riapplica);
    var tb=E('div',{class:'barra-f'},[q,stati,ck('c-tk','Con ticket aperti',c.tk)].concat(S.me.soldi?[ck('c-sf','Senza fatture',c.sf)]:[]).concat([E('span',{class:'sp'}),barraViste('clienti',c,carica)]));
    var ord=function(k){return function(){c.ordine=k;c.offset=0;carica();};};
    var th=function(t,k,n){return E('th',{class:(n?'n ':'')+(k?'o':''),text:t+(k&&(c.ordine||'nome')===k?' ↓':''),on:k?{click:ord(k)}:{}});};
    var corpo=E('tbody');
    c.righe.forEach(function(x){
      corpo.appendChild(E('tr',{class:'cl',on:{click:function(){vai('crm/clienti/'+enc(x.clickup_task_id));}}},[
        E('td',null,[E('b',{text:x.nome}),x.stato?E('div',null,tag(x.stato)):null]),
        E('td',null,x.businesses.map(function(b){return tag(b,'blu');})),
        E('td',null,[x.email||'',x.telefono?E('div',{class:'mut',text:x.telefono}):null]),
        E('td',{class:'n'},x.ticket_aperti?tag(String(x.ticket_aperti),'ambra'):E('span',{class:'mut',text:'0'}))
      ].concat(S.me.soldi?[E('td',{class:'n',text:euro(x.fatturato_12m)}),E('td',{text:giorno(x.ultima_fattura)})]:[])));
    });
    var tab=E('table',{class:'tbl'},[E('thead',null,E('tr',null,[th('Cliente','nome'),th('Attività'),th('Contatto'),th('Ticket aperti','ticket',true)].concat(S.me.soldi?[th('Fatturato 12 mesi','fatturato',true),th('Ultima fattura')]:[]))),corpo]);
    var pn=E('div',{class:'pnl sp0'},[tb,E('div',{class:'scroll'},tab)]);
    if(!c.righe.length)pn.appendChild(vuoto('Nessun cliente con questi filtri','I clienti arrivano da ClickUp (lista Clienti) e dai primi pagamenti.'));
    if(c.righe.length<d.totale)pn.appendChild(E('div',{class:'more'},btn('Carica altri ('+num(d.totale-c.righe.length)+')',function(){c.offset=c.righe.length;carica();},'sm')));
    v.appendChild(E('div',{class:'pag-c'},pn));
    S.tasti=null;
  });
}
function nuovoCliente(){
  var bus=S.me.business||S.opz.business||[];
  var box=E('div',{class:'l'},[E('div',{class:'cap',text:'Attività'}),E('div',{class:'row w'},bus.map(function(b,i){return E('label',{class:'ck'},[E('input',{type:'checkbox',id:'nc-b'+i,'data-b':b,checked:S.business===b}),b]);}))]);
  var corpo=E('div',{class:'campi'},[campo('Nome o ragione sociale',inp('nc-nome','','text',{maxlength:'200'}),'l'),campo('Email',inp('nc-mail','','email')),campo('Telefono',inp('nc-tel','')),campo('Partita IVA',inp('nc-piva','')),campo('Codice fiscale',inp('nc-cf','')),box]);
  modale('Nuovo cliente (scheda su ClickUp)',corpo,[{testo:'Annulla'},{testo:'Crea cliente',pri:true,fn:function(){
    var b={nome:val('nc-nome')};if(!b.nome){avviso('Scrivi il nome',true);return;}
    if(val('nc-mail'))b.email=val('nc-mail');if(val('nc-tel'))b.telefono=val('nc-tel');if(val('nc-piva'))b.partita_iva=val('nc-piva');if(val('nc-cf'))b.codice_fiscale=val('nc-cf');
    b.businesses=$$('[data-b]',$('#modale')).filter(function(e){return e.checked;}).map(function(e){return e.getAttribute('data-b');});
    chiama('POST','/clienti',b).then(function(r){chiudiModale();avviso('Cliente creato');vai('crm/clienti/'+enc(r.clickup_task_id));}).catch(function(e){
      if(e.status===409&&e.dati&&e.dati.clickup_task_id){chiudiModale();avviso('Esiste già un cliente con questa email o P.IVA: apro la scheda',true);vai('crm/clienti/'+enc(e.dati.clickup_task_id));}else fallita(e);});
  }}]);
}

// ---------------------------------------------------------------- scheda cliente
function schedaCliente(id){
  return api('/clienti/'+enc(id)+'/scheda').then(function(c){
    var anag=puo('crmAnagrafica'),scr=puo('crmScrive'),v=$('#vista');v.textContent='';
    var ric=function(){return carica();};
    var docs=c.documenti||null;
    var fatt12=docs?docs.filter(function(d){return d.tipo==='fattura'&&d.stato!=='annullato'&&Date.now()-new Date(d.data_riserva).getTime()<365*864e5;}).reduce(function(s,d){return s+Number(d.totale);},0):null;
    v.appendChild(E('div',{class:'pag-t'},[
      E('a',{href:'#/crm/clienti',text:'← Clienti'}),E('h1',{text:c.nome}),c.businesses.map(function(b){return tag(b,'blu');}),c.stato?tag(c.stato):null,
      tag('Assistenza: '+nomePiano(c.piano_sla),c.piano_sla&&c.piano_sla!=='nessuno'?'verde':''),E('span',{class:'sp'}),
      puo('ticketScrive')?btn('Nuovo ticket',function(){ticketPerCliente(c);},'sm','piu'):null,
      anag?btn('Nuova trattativa',function(){modaleTrattativa(c);},'sm','trattativa'):null
    ]));
    var colonne=E('div',{class:'rec'});v.appendChild(E('div',{class:'pag-c'},colonne));

    // sinistra: informazioni
    var info=E('div',{class:'pnl'},[E('div',{class:'t'},['Informazioni',E('span',{class:'sp'}),anag?btn('Modifica',function(){modificaCliente(c,info);},'ghost sm','nota'):null])]);
    info.appendChild(E('div',{class:'c',id:'info-c'},schedaInfo(c,fatt12)));
    colonne.appendChild(info);

    // centro: scrivi + note + cronologia
    var centro=E('div',{class:'col'});colonne.appendChild(centro);
    if(scr)centro.appendChild(compositoreCliente(c));
    var note=E('div',{class:'pnl sp0'},[E('div',{class:'t'},['Note',E('span',{class:'mut',text:String(c.note.length)})])]);
    if(!c.note.length)note.appendChild(vuoto('Nessuna nota','Scrivi qui sopra ciò che serve ricordare del cliente.'));
    c.note.forEach(function(n){note.appendChild(E('div',{class:'nota-c'+(n.fissata?' fissata':'')},[n.testo,E('span',{class:'m'},[n.autore+' · '+data(n.creato_il)+(n.fissata?' · fissata':''),scr?[' · ',E('a',{href:'#',text:n.fissata?'stacca':'fissa',on:{click:function(e){e.preventDefault();chiama('PATCH','/note/'+n.id,{fissata:!n.fissata}).then(ric).catch(fallita);}}}),' · ',E('a',{href:'#',text:'elimina',on:{click:function(e){e.preventDefault();chiedi('Eliminare la nota?','La nota non sarà più visibile.','Elimina',function(){chiama('DELETE','/note/'+n.id).then(ric).catch(fallita);});}}})]:null])]));});
    centro.appendChild(note);
    var tl=E('div',{class:'pnl sp0'});
    var filtro=S.c.cron||'tutto';
    var chips=E('div',{class:'row w'},[['tutto','Tutto'],['ticket','Ticket'],['documento','Documenti'],['attivita','Attività'],['trattativa','Trattative'],['nota','Note']].map(function(f){return E('button',{type:'button',class:'btn sm'+(filtro===f[0]?' pri':' ghost'),text:f[1],on:{click:function(){S.c.cron=f[0];carica();}}});}));
    tl.appendChild(E('div',{class:'t'},['Cronologia',E('span',{class:'sp'}),chips]));
    var ev=c.cronologia.filter(function(e){return filtro==='tutto'||e.tipo===filtro;});
    var lista=E('div',{class:'tl'});
    if(!ev.length)lista.appendChild(vuoto('Niente da mostrare'));
    var IC={ticket:'ticket',nota:'nota',attivita:'orologio',trattativa:'trattativa',documento:'fatture'};
    ev.forEach(function(e){
      var clic=e.tipo==='ticket'?function(){S.t.vista='tutti';vai('ticket/'+enc(e.dettaglio.ref));}:e.tipo==='documento'?function(){vai('fatture/'+enc(e.dettaglio.ref));}:null;
      lista.appendChild(E('div',{class:'ev '+e.tipo+(clic?' cl':''),on:clic?{click:clic}:{}},[E('span',{class:'ic'},I(IC[e.tipo]||'nota')),E('div',{class:'bd'},[E('b',{text:e.titolo}),E('div',{class:'mut',text:data(e.quando)+' · '+e.tipo+(e.dettaglio&&e.dettaglio.stato?' · '+e.dettaglio.stato:'')+(e.dettaglio&&e.dettaglio.fase?' · '+FASI[e.dettaglio.fase]:'')+(e.dettaglio&&e.dettaglio.totale!=null?' · '+euro2(Number(e.dettaglio.totale)):'')})])]));
    });
    tl.appendChild(lista);centro.appendChild(tl);

    // destra: collegamenti
    var dx=E('div',{class:'col'});colonne.appendChild(dx);
    dx.appendChild(pannelloContatti(c,scr,ric));
    dx.appendChild(pannelloAttivita(c,scr,ric));
    dx.appendChild(E('div',{class:'pnl sp0'},[E('div',{class:'t',text:'Trattative'}),c.trattative.length?c.trattative.map(function(o){return E('div',{class:'li',on:{click:function(){vai('crm/trattative');}}},[E('div',{class:'tt'},[E('b',{text:o.titolo}),E('span',{text:o.business})]),tag(FASI[o.fase]||o.fase,o.fase==='vinta'?'verde':o.fase==='persa'?'rosso':'blu'),o.valore!=null?E('span',{class:'nb',text:euro(o.valore)}):null]);}):vuoto('Nessuna trattativa')]));
    dx.appendChild(E('div',{class:'pnl sp0'},[E('div',{class:'t',text:'Ticket'}),c.ticket.length?c.ticket.slice(0,6).map(function(t){return E('div',{class:'li',on:{click:function(){S.t.vista='tutti';vai('ticket/'+enc(t.ref));}}},[prio(t.priorita),E('div',{class:'tt'},[E('b',{text:t.oggetto}),E('span',{text:fa(t.aperto_il)})]),tag(ST[t.stato]||t.stato,STT[t.stato])]);}):vuoto('Nessun ticket')]));
    if(docs)dx.appendChild(E('div',{class:'pnl sp0'},[E('div',{class:'t',text:'Documenti'}),docs.length?docs.slice(0,6).map(function(d){return E('div',{class:'li',on:{click:function(){vai('fatture/'+enc(d.ref));}}},[E('div',{class:'tt'},[E('b',{text:(d.tipo==='fattura'?'Fattura ':'Proforma ')+d.numero+'/'+d.anno}),E('span',{text:giorno(d.data_riserva)+' · '+d.stato})]),E('span',{class:'nb',text:euro2(Number(d.totale))})]);}):vuoto('Nessun documento')]));
    S.tasti=null;
  });
}
function schedaInfo(c,fatt12){
  return kv([
    ['Email',c.email||'-'],['Telefono',c.telefono||'-'],['P.IVA',c.partita_iva||'-'],['Cod. fiscale',c.codice_fiscale||'-'],
    ['Attività',c.businesses.length?c.businesses.join(', '):'-'],['Cliente dal',giorno(c.creato_il)],
    fatt12!=null?['Fatturato 12 mesi',euro(fatt12)]:null,['Piano assistenza',nomePiano(c.piano_sla)]
  ]);
}
function modificaCliente(c,pannello){
  var box=$('#info-c');box.textContent='';
  var bus=S.me.business||S.opz.business||[];
  var piano=sel('a-piano',pianiOpz(c.businesses,true),c.piano_sla||'');
  var corpo=E('div',{class:'col'},[
    campo('Nome',inp('a-nome',c.nome)),campo('Email',inp('a-mail',c.email,'email')),campo('Telefono',inp('a-tel',c.telefono)),campo('Partita IVA',inp('a-piva',c.partita_iva)),campo('Codice fiscale',inp('a-cf',c.codice_fiscale)),
    E('div',null,[E('div',{class:'cap',text:'Attività'}),E('div',{class:'row w'},bus.map(function(b,i){return E('label',{class:'ck'},[E('input',{type:'checkbox',id:'a-b'+i,'data-b':b,checked:c.businesses.indexOf(b)>=0}),b]);}))]),
    campo('Piano di assistenza',piano),
    E('div',{class:'row'},[btn('Salva su ClickUp',function(){
      var b={nome:val('a-nome'),email:val('a-mail')||null,telefono:val('a-tel')||null,partita_iva:val('a-piva')||null,codice_fiscale:val('a-cf')||null,businesses:$$('[data-b]',box).filter(function(e){return e.checked;}).map(function(e){return e.getAttribute('data-b');})};
      chiama('PATCH','/clienti/'+enc(c.clickup_task_id),b).then(function(){return chiama('PUT','/clienti/'+enc(c.clickup_task_id)+'/piano-sla',{piano_sla:val('a-piano')||null});}).then(function(){avviso('Scheda salvata su ClickUp');carica();}).catch(fallita);
    },'pri sm'),btn('Annulla',carica,'sm')])
  ]);
  box.appendChild(corpo);
}
function compositoreCliente(c){
  var id=c.clickup_task_id,modo='nota';
  var area=E('textarea',{id:'no-testo',maxlength:'4000',placeholder:'Scrivi una nota sul cliente…'});
  var titolo=inp('n-tit','','text',{maxlength:'300',placeholder:'Cosa fare (es. richiamare per il rinnovo)'});
  var tipo=sel('n-tipo',Object.keys(TIPI).map(function(k){return [k,TIPI[k]];}),'promemoria');
  var scad=inp('n-scad','','datetime-local');
  var ass=sel('n-ass',utentiOpz(),io());
  var formAtt=E('div',{class:'hid col',id:'f-att'},[titolo,E('div',{class:'row w'},[tipo,scad,ass])]);
  var tn=E('button',{type:'button',class:'btn sm pri',text:'Nota'}),ta=E('button',{type:'button',class:'btn sm ghost',text:'Attività'});
  var ok=btn('Aggiungi nota',function(){
    if(modo==='nota'){var tx=area.value.trim();if(!tx){avviso('Scrivi la nota',true);return;}chiama('POST','/clienti/'+enc(id)+'/note',{testo:tx}).then(function(){avviso('Nota aggiunta');carica();}).catch(fallita);}
    else{var b={titolo:titolo.value.trim(),tipo:tipo.value,cliente:id};if(!b.titolo){avviso('Scrivi cosa fare',true);return;}if(scad.value)b.scadenza=new Date(scad.value).toISOString();if(ass.value)b.assegnato_a=ass.value;chiama('POST','/attivita',b).then(function(){avviso('Attività aggiunta');aggiornaBadge();carica();}).catch(fallita);}
  },'pri sm');
  function imposta(m){modo=m;tn.className='btn sm '+(m==='nota'?'pri':'ghost');ta.className='btn sm '+(m==='attivita'?'pri':'ghost');area.classList.toggle('hid',m!=='nota');formAtt.classList.toggle('hid',m==='nota');ok.textContent=m==='nota'?'Aggiungi nota':'Aggiungi attività';}
  tn.addEventListener('click',function(){imposta('nota');});ta.addEventListener('click',function(){imposta('attivita');});
  return E('div',{class:'pnl'},[E('div',{class:'c col'},[E('div',{class:'row'},[tn,ta]),area,formAtt,E('div',{class:'row'},[E('span',{class:'sp'}),ok])])]);
}
function pannelloContatti(c,scr,ric){
  var p=E('div',{class:'pnl sp0'},[E('div',{class:'t',text:'Contatti'})]);
  if(!c.contatti.length)p.appendChild(vuoto('Nessun contatto'));
  c.contatti.forEach(function(x){p.appendChild(E('div',{class:'li'},[av(x.nome),E('div',{class:'tt'},[E('b',{text:x.nome+(x.ruolo?' · '+x.ruolo:'')}),E('span',{text:[x.email,x.telefono].filter(Boolean).join(' · ')})]),x.principale?tag('principale','verde'):null,scr?E('button',{class:'btn ghost sm',type:'button','aria-label':'Elimina contatto',on:{click:function(e){e.stopPropagation();chiama('DELETE','/contatti/'+x.id).then(ric).catch(fallita);}}},I('chiudi')):null]));});
  if(scr)p.appendChild(E('div',{class:'c'},btn('Aggiungi contatto',function(){
    modale('Nuovo contatto',E('div',{class:'campi'},[campo('Nome',inp('k-nome','')),campo('Ruolo',inp('k-ruolo','')),campo('Email',inp('k-mail','','email')),campo('Telefono',inp('k-tel',''))]),[{testo:'Annulla'},{testo:'Aggiungi',pri:true,fn:function(){
      var b={nome:val('k-nome')};if(!b.nome){avviso('Scrivi il nome',true);return;}if(val('k-ruolo'))b.ruolo=val('k-ruolo');if(val('k-mail'))b.email=val('k-mail');if(val('k-tel'))b.telefono=val('k-tel');b.principale=!c.contatti.length;
      chiama('POST','/clienti/'+enc(c.clickup_task_id)+'/contatti',b).then(function(){chiudiModale();ric();}).catch(fallita);
    }}]);
  },'sm','piu')));
  return p;
}
function pannelloAttivita(c,scr,ric){
  var p=E('div',{class:'pnl sp0'},[E('div',{class:'t',text:'Da fare'})]);
  var aperte=c.attivita.filter(function(x){return !x.completata_il;});
  if(!aperte.length)p.appendChild(vuoto('Niente in sospeso'));
  aperte.forEach(function(x){p.appendChild(E('div',{class:'li'},[
    scr?E('input',{type:'checkbox','aria-label':'Fatta',on:{change:function(e){chiama('PATCH','/attivita/'+x.id,{completata:e.target.checked}).then(function(){aggiornaBadge();ric();}).catch(fallita);}}}):null,
    E('div',{class:'tt'},[E('b',{text:x.titolo}),E('span',{text:[TIPI[x.tipo],x.assegnato_a].filter(Boolean).join(' · ')})]),x.scadenza?tag(data(x.scadenza),x.scaduta?'rosso':''):null]));});
  return p;
}
function ticketPerCliente(c){
  var bus=c.businesses.length?c.businesses:(S.me.business||S.opz.business||[]);
  modale('Nuovo ticket per '+c.nome,E('div',{class:'campi'},[campo('Attività',sel('nt-bus',bus.map(function(x){return [x,x];}),bus[0])),campo('Priorità',sel('nt-prio',['normale','urgente','alta','bassa'].map(function(x){return [x,PR[x]];}),'normale')),campo('Oggetto',inp('nt-ogg','','text',{maxlength:'300'}),'l'),campo('Descrizione',E('textarea',{id:'nt-txt',maxlength:'8000'}),'l')]),[{testo:'Annulla'},{testo:'Apri ticket',pri:true,fn:function(){
    var b={business:val('nt-bus'),oggetto:val('nt-ogg'),priorita:val('nt-prio'),cliente:{nome:c.nome}};if(!b.business||!b.oggetto){avviso('Servono attività e oggetto',true);return;}
    if(val('nt-txt'))b.testo=val('nt-txt');if(c.email)b.cliente.email=c.email;if(c.partita_iva)b.cliente.partita_iva=c.partita_iva;
    chiama('POST','/ticket',b).then(function(r){chiudiModale();avviso('Ticket aperto');S.t.vista='tutti';vai('ticket/'+enc(r.ref));}).catch(fallita);
  }}]);
}

// ---------------------------------------------------------------- trattative
var FASI_APERTE=['nuova','contattato','proposta','trattativa'];
function modaleTrattativa(c){
  var bus=c&&c.businesses.length?c.businesses:(S.me.business||S.opz.business||[]);
  var corpo=E('div',{class:'campi'},[
    campo('Titolo',inp('no-tit','','text',{maxlength:'300'}),'l'),campo('Attività',sel('no-bus',bus.map(function(x){return [x,x];}),S.business||bus[0])),
    c?null:campo('Prospect (se non è ancora cliente)',inp('no-pro','')),campo('Valore stimato (€)',inp('no-val','','number',{min:'0',step:'1'})),
    campo('Chiusura prevista',inp('no-data','','date')),campo('Fase',sel('no-fase',FASI_APERTE.map(function(k){return [k,FASI[k]];}),'nuova')),campo('Responsabile',sel('no-ass',utentiOpz(),io()))
  ]);
  modale('Nuova trattativa'+(c?' per '+c.nome:''),corpo,[{testo:'Annulla'},{testo:'Crea',pri:true,fn:function(){
    var b={titolo:val('no-tit'),business:val('no-bus'),fase:val('no-fase')};if(!b.titolo||!b.business){avviso('Servono titolo e attività',true);return;}
    if(c)b.cliente=c.clickup_task_id;else if(val('no-pro'))b.prospect=val('no-pro');else{avviso('Indica un prospect',true);return;}
    if(val('no-val'))b.valore=Number(val('no-val'));if(val('no-data'))b.chiusura_prevista=val('no-data');if(val('no-ass'))b.assegnato_a=val('no-ass');
    chiama('POST','/opportunita',b).then(function(){chiudiModale();avviso('Trattativa creata');carica();}).catch(fallita);
  }}]);
}
function spostaTrattativa(id,fase){
  function vai2(extra){chiama('PATCH','/opportunita/'+id,Object.assign({fase:fase},extra||{})).then(function(){avviso('Trattativa spostata in "'+FASI[fase]+'"');carica();}).catch(function(e){fallita(e);carica();});}
  if(fase==='persa')modale('Motivo della perdita',E('div',null,campo('Perché è stata persa? (facoltativo)',inp('no-mot','','text',{maxlength:'300'}))),[{testo:'Annulla',fn:function(){chiudiModale();carica();}},{testo:'Segna come persa',pri:true,fn:function(){var m=val('no-mot');chiudiModale();vai2(m?{motivo_perdita:m}:null);}}]);
  else vai2();
}
function trattative(){
  var o=S.o,mie=o.mie===true;
  return api('/opportunita',{business:bz(),assegnato:mie?io():undefined,q:o.q,aperte:o.chiuse?'':'true'}).then(function(d){
    var v=$('#vista');v.textContent='';
    v.appendChild(titoloPagina('Trattative',puo('crmAnagrafica')?btn('Nuova trattativa',function(){modaleTrattativa(null);},'pri','piu'):null));
    var q=E('input',{type:'search',id:'o-q',value:o.q||'',placeholder:'Cerca trattative','aria-label':'Cerca trattative'});
    q.addEventListener('keydown',function(e){if(e.key==='Enter'){o.q=q.value.trim();carica();}});
    var ck=function(t,v2,k){var i=E('input',{type:'checkbox'});if(v2)i.setAttribute('checked','');i.addEventListener('change',function(){o[k]=i.checked;carica();});return E('label',{class:'ck'},[i,t]);};
    var tot=d.per_fase.filter(function(f){return FASI_APERTE.indexOf(f.fase)>=0;});
    var totale=tot.reduce(function(s,f){return s+(f.valore||0);},0),nAperte=tot.reduce(function(s,f){return s+f.n;},0);
    var corpo=E('div',{class:'pag-c'});v.appendChild(corpo);
    corpo.appendChild(E('div',{class:'row w',},[q,ck('Solo le mie',mie,'mie'),ck('Mostra anche vinte e perse',o.chiuse,'chiuse'),E('span',{class:'sp'}),E('span',{class:'mut',text:nAperte+' aperte'+(S.me.soldi?' · '+euro(totale)+' in corso':'')})]));
    var fasi=o.chiuse?Object.keys(FASI):FASI_APERTE;
    var kb=E('div',{class:'kb'});corpo.appendChild(kb);
    fasi.forEach(function(f){
      var righe=d.opportunita.filter(function(x){return x.fase===f;}),riep=d.per_fase.filter(function(x){return x.fase===f;})[0];
      var col=E('div',{class:'kc','data-fase':f},[E('h3',null,[E('span',{text:FASI[f]+' · '+righe.length}),E('span',{text:riep&&riep.valore!=null?euro(riep.valore):''})])]);
      col.addEventListener('dragover',function(e){if(puo('crmAnagrafica')){e.preventDefault();col.classList.add('over');}});
      col.addEventListener('dragleave',function(){col.classList.remove('over');});
      col.addEventListener('drop',function(e){e.preventDefault();col.classList.remove('over');var id=e.dataTransfer&&e.dataTransfer.getData('text/plain');if(id&&puo('crmAnagrafica')){var orig=d.opportunita.filter(function(x){return String(x.id)===id;})[0];if(orig&&orig.fase!==f)spostaTrattativa(id,f);}});
      righe.forEach(function(x){
        var giorni=Math.floor((Date.now()-new Date(x.aggiornato_il).getTime())/864e5);
        var card=E('div',{class:'kd'+(giorni>=14&&FASI_APERTE.indexOf(x.fase)>=0?' fermo':''),draggable:puo('crmAnagrafica')?'true':null,'data-id':x.id},[
          E('b',{text:x.titolo}),
          E('div',{class:'mut'},[x.cliente_task_id?E('a',{href:'#/crm/clienti/'+enc(x.cliente_task_id),text:x.cliente_nome||'cliente'}):(x.cliente_nome||'Prospect'),' · '+x.business]),
          E('div',{class:'row'},[x.valore!=null?E('span',{class:'v',text:euro(x.valore)}):null,E('span',{class:'sp'}),giorni>=14&&FASI_APERTE.indexOf(x.fase)>=0?tag('ferma da '+giorni+' g','ambra'):null,x.chiusura_prevista?E('span',{class:'mut',text:giorno(x.chiusura_prevista)}):null,av(x.assegnato_a)])
        ]);
        card.addEventListener('dragstart',function(e){e.dataTransfer.setData('text/plain',String(x.id));e.dataTransfer.effectAllowed='move';});
        col.appendChild(card);
      });
      if(!righe.length)col.appendChild(E('div',{class:'mut tc',text:'Nessuna'}));
      kb.appendChild(col);
    });
    S.tasti=null;
  });
}

// ---------------------------------------------------------------- da fare
function dafare(){
  var a=S.a,mie=a.solo_mie!==false;
  return api('/attivita',{business:bz(),stato:a.stato==='completate'?'completate':'aperte',assegnato:mie?io():undefined,limite:200}).then(function(d){
    var v=$('#vista');v.textContent='';
    v.appendChild(titoloPagina('Da fare'));
    var corpo=E('div',{class:'pag-c'});v.appendChild(corpo);
    var nuova=inp('d-tit','','text',{maxlength:'300',placeholder:'Nuova attività: scrivi e premi Invio',class:'sp'});
    var quando=inp('d-quando','','datetime-local');
    var aggiungi=function(){
      var t=nuova.value.trim();if(!t)return;
      var bus=S.business||(S.me.business&&S.me.business[0])||(S.opz.business||[])[0];
      if(!bus){avviso('Nessuna attività disponibile',true);return;}
      var b={titolo:t,tipo:'promemoria',business:bus,assegnato_a:io()};if(quando.value)b.scadenza=new Date(quando.value).toISOString();
      chiama('POST','/attivita',b).then(function(){avviso('Attività aggiunta');aggiornaBadge();carica();}).catch(fallita);
    };
    nuova.addEventListener('keydown',function(e){if(e.key==='Enter')aggiungi();});
    var ck=function(t,v2,fn){var i=E('input',{type:'checkbox'});if(v2)i.setAttribute('checked','');i.addEventListener('change',function(){fn(i.checked);});return E('label',{class:'ck'},[i,t]);};
    corpo.appendChild(E('div',{class:'row w'},[puoScrivere()?[nuova,quando,btn('Aggiungi',aggiungi,'pri sm')]:null,E('span',{class:'sp'}),ck('Solo le mie',mie,function(x){a.solo_mie=x;carica();}),ck('Mostra le completate',a.stato==='completate',function(x){a.stato=x?'completate':'aperte';carica();})]));
    function puoScrivere(){return puo('crmScrive');}
    var inizio=new Date();inizio.setHours(0,0,0,0);var fineOggi=new Date(inizio.getTime()+864e5),fra7=new Date(inizio.getTime()+8*864e5);
    var gruppi=[['Scadute',function(x){return x.scaduta&&new Date(x.scadenza)<inizio;},'rosso'],['Oggi',function(x){return x.scadenza&&new Date(x.scadenza)>=inizio&&new Date(x.scadenza)<fineOggi;}],['Prossimi 7 giorni',function(x){return x.scadenza&&new Date(x.scadenza)>=fineOggi&&new Date(x.scadenza)<fra7;}],['Più avanti',function(x){return x.scadenza&&new Date(x.scadenza)>=fra7;}],['Senza scadenza',function(x){return !x.scadenza;}]];
    if(a.stato==='completate')gruppi=[['Completate',function(){return true;}]];
    var usati={},mostrate=0;
    gruppi.forEach(function(g){
      var righe=d.attivita.filter(function(x){return !usati[x.id]&&g[1](x);});righe.forEach(function(x){usati[x.id]=1;});
      if(!righe.length)return;mostrate+=righe.length;
      corpo.appendChild(E('div',{class:'gr '+(g[2]||'')},[E('h3',{text:g[0]+' · '+righe.length}),E('div',{class:'pnl sp0'},righe.map(function(x){
        return E('div',{class:'li'},[
          puo('crmScrive')?E('input',{type:'checkbox',checked:Boolean(x.completata_il),'aria-label':'Fatta',on:{change:function(e){chiama('PATCH','/attivita/'+x.id,{completata:e.target.checked}).then(function(){aggiornaBadge();carica();}).catch(fallita);}}}):null,
          E('div',{class:'tt'},[E('b',{text:x.titolo}),E('span',{text:[TIPI[x.tipo]||x.tipo,x.assegnato_a].filter(Boolean).join(' · ')})]),
          x.cliente_task_id?E('a',{href:'#/crm/clienti/'+enc(x.cliente_task_id),text:x.cliente_nome||'cliente'}):null,
          x.scadenza?tag(data(x.scadenza),x.scaduta?'rosso':''):null
        ]);
      }))]));
    });
    if(!mostrate)corpo.appendChild(vuoto(a.stato==='completate'?'Nessuna attività completata':'Niente da fare','Le attività si creano qui sopra o dalla scheda di un cliente.'));
    S.tasti=null;
  });
}
function duplicati(){
  return api('/clienti-duplicati').then(function(d){
    var v=$('#vista');v.textContent='';
    v.appendChild(titoloPagina('Possibili duplicati',null,'stessa partita IVA o stessa email'));
    var corpo=E('div',{class:'pag-c'});v.appendChild(corpo);
    if(!d.duplicati.length){corpo.appendChild(E('div',{class:'pnl'},vuoto('Nessun duplicato','Le schede con la stessa P.IVA o email compaiono qui; si uniscono a mano in ClickUp.')));return;}
    d.duplicati.forEach(function(x){corpo.appendChild(E('div',{class:'pnl'},[E('div',{class:'t',text:(x.motivo==='email'?'Stessa email: ':'Stessa partita IVA: ')+x.valore}),E('div',{class:'sp0'},x.schede.map(function(s){return E('div',{class:'li',on:{click:function(){vai('crm/clienti/'+enc(s.id));}}},[E('div',{class:'tt'},E('b',{text:s.nome})),s.businesses.map(function(b){return tag(b,'blu');})]);}))]));});
    S.tasti=null;
  });
}
`;
