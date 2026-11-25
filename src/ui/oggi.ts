// Pagina "Oggi" (cosa richiede azione adesso) e "Report" (numeri, pochi e raggruppati). Niente dati di esempio: tutto arriva dall'API.
export const OGGI = String.raw`
function pannelloLista(titolo,righe,vediTutti,vuotoMsg){
  var c=E('div');
  if(righe.length)righe.forEach(function(r){c.appendChild(r);});else c.appendChild(vuoto(vuotoMsg||'Niente da fare qui.'));
  return E('div',{class:'pnl sp0'},[E('div',{class:'t'},[titolo,E('span',{class:'sp'}),vediTutti?E('a',{href:'#',text:'Vedi tutti',on:{click:function(e){e.preventDefault();vediTutti();}}}):null]),c]);
}
function rigaTicket(t){
  var s=statoSla(t);
  return E('div',{class:'li',on:{click:function(){S.t.vista='tutti';vai('ticket/'+enc(t.ref));}}},[
    prio(t.priorita),
    E('div',{class:'tt'},[E('b',{text:t.oggetto}),E('span',{text:[t.cliente_nome||t.cliente_email||'',t.business,t.assegnato_a?'':'non assegnato'].filter(Boolean).join(' · ')})]),
    s?tag(s.corto,s.tono):null
  ]);
}
function oggi(){
  var b=bz();
  var richieste=[
    api('/ticket-viste',{business:b}),
    api('/ticket',{business:b,stato:APERTI,ordine:'scadenza',limite:8,non_assegnati:'true'}),
    api('/ticket',{business:b,stato:APERTI,ordine:'scadenza',limite:6,assegnato:io()}),
    api('/attivita',{business:b,stato:'aperte',assegnato:io(),limite:200}),
    api('/opportunita',{business:b,ferme_giorni:14}),
    puo('fatture')?api('/documenti',{business:b,limite:6,ordine:'recenti'}):Promise.resolve(null)
  ];
  return Promise.all(richieste).then(function(r){
    var c=r[0],daPrendere=r[1].ticket,miei=r[2].ticket,att=r[3].attivita,ferme=r[4].opportunita,docs=r[5];
    var fine=new Date();fine.setHours(23,59,59,999);
    var oggiAtt=att.filter(function(x){return x.scadenza&&new Date(x.scadenza)<=fine;});
    var scadute=att.filter(function(x){return x.scaduta;}).length;
    var v=$('#vista');v.textContent='';
    v.appendChild(titoloPagina('Oggi',null,new Date().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Rome'})));
    var corpo=E('div',{class:'pag-c'});v.appendChild(corpo);
    function cd(etichetta,n,tono,vaiA){
      return E('button',{class:'cd '+tono+(n>0?' attivo':' zero'),type:'button',on:{click:vaiA}},[E('div',{class:'v',text:n}),E('div',{class:'e',text:etichetta})]);
    }
    corpo.appendChild(E('div',{class:'code'},[
      cd('Ticket da prendere',c.da_prendere,'blu',function(){S.t.vista='da_prendere';vai('ticket');}),
      cd('SLA scaduti',c.sla_scaduti,'rosso',function(){S.t.vista='sla_scaduti';vai('ticket');}),
      cd('SLA a rischio (entro 4 h)',c.sla_a_rischio,'ambra',function(){S.t.vista='sla_rischio';vai('ticket');}),
      cd('Mie attività scadute',scadute,'rosso',function(){S.a={stato:'aperte',solo_mie:true};vai('crm/dafare');})
    ]));
    var colonne=E('div',{class:'griglia2'});corpo.appendChild(colonne);
    colonne.appendChild(pannelloLista('Ticket da prendere o in scadenza',daPrendere.map(rigaTicket),function(){S.t.vista='non_assegnati';vai('ticket');},'Nessun ticket in attesa di qualcuno.'));
    colonne.appendChild(pannelloLista('I miei ticket aperti',miei.map(rigaTicket),function(){S.t.vista='miei';vai('ticket');},'Non hai ticket aperti assegnati.'));
    colonne.appendChild(pannelloLista('Le mie attività di oggi',oggiAtt.slice(0,8).map(function(x){
      return E('div',{class:'li',on:{click:function(){if(x.cliente_task_id)vai('crm/clienti/'+enc(x.cliente_task_id));else vai('crm/dafare');}}},[
        E('input',{type:'checkbox',title:'Fatta',on:{click:function(e){e.stopPropagation();},change:function(e){chiama('PATCH','/attivita/'+x.id,{completata:e.target.checked}).then(function(){avviso('Attività completata');aggiornaBadge();carica();}).catch(fallita);}}}),
        E('div',{class:'tt'},[E('b',{text:x.titolo}),E('span',{text:[TIPI[x.tipo]||x.tipo,x.cliente_nome].filter(Boolean).join(' · ')})]),
        x.scadenza?tag(data(x.scadenza),x.scaduta?'rosso':''):null
      ]);
    }),function(){S.a={stato:'aperte',solo_mie:true};vai('crm/dafare');},'Nessuna attività per oggi.'));
    colonne.appendChild(pannelloLista('Trattative ferme da più di 14 giorni',ferme.slice(0,6).map(function(o){
      return E('div',{class:'li',on:{click:function(){vai('crm/trattative');}}},[
        E('div',{class:'tt'},[E('b',{text:o.titolo}),E('span',{text:[o.cliente_nome,o.business,FASI[o.fase]].filter(Boolean).join(' · ')})]),
        o.valore!=null?E('span',{class:'nb',text:euro(o.valore)}):null
      ]);
    }),function(){vai('crm/trattative');},'Nessuna trattativa ferma.'));
    if(docs)colonne.appendChild(pannelloLista('Ultimi documenti',docs.documenti.map(function(d){
      return E('div',{class:'li',on:{click:function(){vai('fatture/'+enc(d.ref));}}},[
        E('div',{class:'tt'},[E('b',{text:(d.tipo==='fattura'?'Fattura ':'Proforma ')+d.numero+'/'+d.anno+' · '+(d.cliente_nome||'')}),E('span',{text:giorno(d.data_riserva)+' · '+(d.business||'')})]),
        E('span',{class:'nb',text:euro2(Number(d.totale))})
      ]);
    }),function(){vai('fatture');},'Nessun documento ancora.'));
    S.badge.ticket=c.da_prendere;S.badge.attivita=scadute;menu();
  });
}

// ---------------------------------------------------------------- report
function periodoRep(){
  var f=S.f.rep||(S.f.rep={giorni:'30',da:'',a:''});return f;
}
function parametriRep(){var f=periodoRep(),p={business:bz()};if(f.giorni==='custom'){p.da=f.da;p.a=f.a;}else p.giorni=f.giorni;return p;}
function granRep(){var f=periodoRep(),g=f.giorni==='custom'&&f.da&&f.a?(new Date(f.a)-new Date(f.da))/864e5:Number(f.giorni);return g>180?'mese':g>45?'settimana':'giorno';}
function barreGr(punti,chA,chB,nA,nB,fmt){
  if(!punti.length)return vuoto('Nessun dato nel periodo.');
  var W=640,H=190,L=34,B=22,T0=8,n=punti.length,max=1;
  punti.forEach(function(p){max=Math.max(max,p[chA]||0,chB?(p[chB]||0):0);});
  var cw=(W-L)/n,bw=Math.max(1,Math.min(18,cw/(chB?2.6:1.5)));
  var NS='http://www.w3.org/2000/svg';
  function S2(tag,a,txt){var e=document.createElementNS(NS,tag);Object.keys(a||{}).forEach(function(k){e.setAttribute(k,a[k]);});if(txt!=null)e.textContent=txt;return e;}
  var svg=S2('svg',{'class':'g',viewBox:'0 0 '+W+' '+H,role:'img','aria-label':nA});
  [0,0.5,1].forEach(function(f){var y=T0+(H-B-T0)*(1-f);svg.appendChild(S2('line',{x1:L,x2:W,y1:y,y2:y}));svg.appendChild(S2('text',{x:2,y:y+3},fmt?fmt(max*f):Math.round(max*f)));});
  punti.forEach(function(p,i){
    var x=L+i*cw+cw/2,hA=(H-B-T0)*((p[chA]||0)/max),hB=chB?(H-B-T0)*((p[chB]||0)/max):0,xa=chB?x-bw-1:x-bw/2;
    var ra=S2('rect',{'class':'a',x:xa,y:H-B-hA,width:bw,height:hA,rx:1.5});ra.appendChild(S2('title',{},p.periodo+': '+nA+' '+(fmt?fmt(p[chA]||0):(p[chA]||0))));svg.appendChild(ra);
    if(chB){var rb=S2('rect',{'class':'b',x:x+1,y:H-B-hB,width:bw,height:hB,rx:1.5});rb.appendChild(S2('title',{},p.periodo+': '+nB+' '+(p[chB]||0)));svg.appendChild(rb);}
    if(i===0||i===n-1||n<=12)svg.appendChild(S2('text',{x:x,y:H-6,'text-anchor':'middle'},p.periodo.slice(n>60?0:5)));
  });
  return E('div',null,[E('div',{class:'leg'},[E('b',{class:'ba'}),nA,chB?E('b',{class:'bb'}):null,chB?nB:null]),svg]);
}
function barreOr(righe,mappa){
  if(!righe||!righe.length)return vuoto('Nessun dato nel periodo.');
  var max=Math.max.apply(null,righe.map(function(r){return r.n;}))||1;
  return E('div',null,righe.map(function(r){
    var i=E('i');i.style.width=Math.round(r.n/max*100)+'%';
    return E('div',{class:'hb'},[E('span',{text:mappa&&mappa[r.voce]?mappa[r.voce]:r.voce}),E('span',{class:'b'},i),E('span',{class:'n',text:num(r.n)})]);
  }));
}
function kp(titolo,valore,sotto){return E('div',null,[E('div',{class:'t',text:titolo}),E('div',{class:'v',text:valore}),sotto?E('div',{class:'s',text:sotto}):null]);}
function pnl(titolo,corpo){return E('div',{class:'pnl'},[E('div',{class:'t',text:titolo}),E('div',{class:'c'},corpo)]);}
function report(){
  var R=rotta(),sub=R.sub||'ticket',f=periodoRep();
  var p=parametriRep();p.granularita=granRep();
  return Promise.all([api('/kpi/panoramica',p),api('/kpi/business',parametriRep())]).then(function(r){
    var d=r[0],bus=r[1].per_business,t=d.ticket,c=d.clienti,fa2=d.fatturato;
    var v=$('#vista');v.textContent='';
    var per=E('div',{class:'row'},[
      sel('r-per',[['7','Ultimi 7 giorni'],['30','Ultimi 30 giorni'],['90','Ultimi 90 giorni'],['365','Ultimi 12 mesi'],['custom','Personalizzato']],f.giorni)
    ]);
    if(f.giorni==='custom'){per.appendChild(inp('r-da',f.da,'date'));per.appendChild(inp('r-a',f.a,'date'));}
    v.appendChild(titoloPagina('Report',per));
    var schede=[['ticket','Ticket'],['clienti','Clienti']].concat(fa2?[['fatturato','Fatturato']]:[]);
    v.appendChild(E('div',{class:'tabs'},schede.map(function(s){return E('button',{type:'button',class:sub===s[0]?'on':'',text:s[1],on:{click:function(){vai('report/'+s[0]);}}});})));
    var corpo=E('div',{class:'pag-c'});v.appendChild(corpo);
    if(sub==='ticket'){
      corpo.appendChild(E('div',{class:'kp'},[
        kp('Aperti ora',num(t.backlog),num(t.da_prendere)+' da prendere'),
        kp('SLA prima risposta',pc(t.sla_risposta_pct),'sui ticket con SLA'),
        kp('SLA risoluzione',pc(t.sla_risoluzione_pct),'sui ticket con SLA risolti'),
        kp('Prima risposta (mediana)',ore(t.prima_risposta_mediana_ore)),
        kp('Tempo di risoluzione',ore(t.risoluzione_media_ore),'media')
      ]));
      corpo.appendChild(E('div',{class:'griglia2'},[
        pnl('Arrivati e risolti',barreGr(d.serie,'ticket_arrivati','ticket_risolti','Arrivati','Risolti')),
        pnl('Aperti ora, per stato',barreOr(d.distribuzioni.per_stato,ST)),
        pnl('Per priorità',barreOr(d.distribuzioni.per_priorita,PR)),
        pnl('Per assegnatario',barreOr(d.distribuzioni.per_assegnato)),
        pnl('Per fonte',barreOr(d.distribuzioni.per_fonte)),
        pnl('Per categoria',barreOr(d.distribuzioni.per_categoria))
      ]));
    }else if(sub==='clienti'){
      corpo.appendChild(E('div',{class:'kp'},[
        kp('Clienti',num(c.totali)),kp('Nuovi nel periodo',num(c.nuovi)),
        c.attivi_12m!=null?kp('Attivi negli ultimi 12 mesi',num(c.attivi_12m),'con almeno una fattura'):null,
        kp('Su più attività',num(c.multi_business)),kp('Con ticket aperti',num(c.con_ticket_aperti))
      ]));
      var th=['Attività','Clienti','Ticket aperti','SLA scaduti','Arrivati','Risolti','Prima risposta'].concat(S.me.soldi?['Fatture','Fatturato']:[]);
      corpo.appendChild(E('div',{class:'pnl sp0'},[E('div',{class:'t',text:'Confronto tra attività'}),E('div',{class:'scroll'},E('table',{class:'tbl'},[
        E('thead',null,E('tr',null,th.map(function(h,i){return E('th',{class:i?'n':'',text:h});}))),
        E('tbody',null,bus.map(function(x){return E('tr',null,[E('td',{text:x.business}),E('td',{class:'n',text:num(x.clienti)}),E('td',{class:'n',text:num(x.backlog)}),E('td',{class:'n'},x.sla_scaduti?tag(String(x.sla_scaduti),'rosso'):'0'),E('td',{class:'n',text:num(x.arrivati)}),E('td',{class:'n',text:num(x.risolti)}),E('td',{class:'n',text:ore(x.prima_risposta_media_ore)})].concat(S.me.soldi?[E('td',{class:'n',text:num(x.fatture)}),E('td',{class:'n',text:euro(x.fatturato)})]:[]));}))
      ]))]));
      if(!bus.length)corpo.appendChild(vuoto('Nessun dato','Compariranno quando i dati arrivano dalle integrazioni.'));
    }else if(fa2){
      corpo.appendChild(E('div',{class:'kp'},[kp('Fatturato',euro(fa2.fatturato),'prima del bollo'),kp('Fatture',num(fa2.fatture)),kp('Media per fattura',euro(fa2.media_fattura))]));
      corpo.appendChild(E('div',{class:'griglia2'},[
        pnl('Fatturato nel tempo',barreGr(d.serie,'fatturato',null,'Fatturato',null,function(x){return euro(x);})),
        pnl('Primi clienti',fa2.top_clienti.length?barreOr(fa2.top_clienti.map(function(x){return {voce:x.nome,n:Math.round(x.fatturato)};})):vuoto('Nessun dato'))
      ]));
    }
    $('#r-per').addEventListener('change',function(){f.giorni=$('#r-per').value;if(f.giorni==='custom'&&!f.da){var o=new Date();f.a=o.toISOString().slice(0,10);f.da=new Date(o-30*864e5).toISOString().slice(0,10);}carica();});
    ['r-da','r-a'].forEach(function(id){var e=$('#'+id);if(e)e.addEventListener('change',function(){f[id==='r-da'?'da':'a']=e.value;if(f.da&&f.a)carica();});});
  });
}
`;
