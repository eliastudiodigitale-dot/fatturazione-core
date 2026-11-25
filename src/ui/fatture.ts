// Fatturazione: sola lettura, filtri, somma sulla selezione, dettaglio, CSV.
export const FATTURE = String.raw`
function parametriFatture(){var f=S.f;return {business:bz(),q:f.q,tipo:f.tipo,stato:f.stato,fonte:f.fonte,anno:f.anno,da:f.da,a:f.a,importo_min:f.min,importo_max:f.max,ordine:f.ordine||'recenti'};}
function fatture(){
  var f=S.f,R=rotta();
  return Promise.all([api('/documenti',Object.assign(parametriFatture(),{limite:PAG,offset:f.offset||0})),api('/documenti-riepilogo',{business:bz(),anno:f.anno}),api('/viste',{sezione:'fatture'}).catch(function(){return {viste:[]};})]).then(function(r){
    var d=r[0],mesi=r[1].mesi;S.viste=r[2].viste;
    f.righe=(f.offset?(f.righe||[]):[]).concat(d.documenti);
    var v=$('#vista');v.textContent='';
    v.appendChild(titoloPagina('Fatturazione',btn('CSV',function(){var p=parametriFatture();delete p.ordine;scarica('/export/documenti',p);},'sm','scarica'),'sola lettura'));
    var riapplica=function(){f.q=val('f-q');f.tipo=val('f-tipo');f.stato=val('f-stato');f.fonte=val('f-fonte');f.anno=val('f-anno');f.da=val('f-da');f.a=val('f-a');f.min=val('f-min');f.max=val('f-max');f.ordine=val('f-ord');f.offset=0;carica();};
    var q=E('input',{type:'search',id:'f-q',value:f.q||'',placeholder:'Cliente, P.IVA, numero, riferimento','aria-label':'Cerca documenti'});
    q.addEventListener('keydown',function(e){if(e.key==='Enter')riapplica();});
    var sels=[
      sel('f-tipo',[['fattura','Fatture'],['proforma','Proforme']],f.tipo,'Tipo'),
      sel('f-stato',Object.keys(DOCST).map(function(k){return [k,DOCST[k]];}),f.stato,'Stato'),
      sel('f-fonte',[['stripe','Stripe'],['gocardless','GoCardless'],['clickup','ClickUp'],['dashboard','Portale'],['n8n','n8n']],f.fonte,'Origine'),
      inp('f-anno',f.anno,'number',{min:'2020',max:'2100',step:'1',title:'Anno','aria-label':'Anno'}),
      inp('f-da',f.da,'date',{title:'Dal','aria-label':'Dal'}),inp('f-a',f.a,'date',{title:'Al','aria-label':'Al'}),
      inp('f-min',f.min,'number',{placeholder:'Importo da',step:'1','aria-label':'Importo minimo'}),inp('f-max',f.max,'number',{placeholder:'a',step:'1','aria-label':'Importo massimo'}),
      sel('f-ord',[['recenti','Più recenti'],['vecchi','Più vecchi'],['importo','Importo'],['numero','Numero']],f.ordine||'recenti')
    ];
    sels.forEach(function(s){s.addEventListener('change',riapplica);});
    var corpo=E('tbody');
    f.righe.forEach(function(x){
      corpo.appendChild(E('tr',{class:'cl'+(x.stato==='annullato'?' ann':''),on:{click:function(){dettaglioDocumento(x.ref);}}},[
        E('td',{class:'nb'},E('b',{text:(x.tipo==='fattura'?'Fattura ':'Proforma ')+x.numero+'/'+x.anno})),E('td',{text:giorno(x.data_riserva)}),
        E('td',null,[x.cliente_nome||'-',x.partita_iva?E('div',{class:'mut',text:'P.IVA '+x.partita_iva}):null]),
        E('td',{text:x.business||''}),E('td',null,tag(x.fonte)),E('td',null,tag(DOCST[x.stato]||x.stato,x.stato==='annullato'?'rosso':x.stato==='consegnato'?'verde':'')),
        E('td',{class:'n',text:euro2(Number(x.totale))})
      ]));
    });
    var tab=E('table',{class:'tbl'},[E('thead',null,E('tr',null,['Documento','Data','Cliente','Attività','Origine','Stato'].map(function(h){return E('th',{text:h});}).concat([E('th',{class:'n',text:'Importo'})]))),corpo]);
    var pn=E('div',{class:'pnl sp0'},[
      E('div',{class:'barra-f'},[q].concat(sels).concat([E('span',{class:'sp'}),barraViste('fatture',f,carica)])),
      E('div',{class:'tot'},[E('span',null,[E('b',{text:num(d.totale)}),' documenti']),E('span',null,['Somma (annullati esclusi): ',E('b',{text:euro2(d.somma)}),E('span',{class:'mut',text:' · prima del bollo'})])]),
      E('div',{class:'scroll'},tab)
    ]);
    if(!f.righe.length)pn.appendChild(vuoto('Nessun documento con questi filtri','I documenti compaiono quando Stripe, GoCardless, n8n o il portale li emettono.'));
    if(f.righe.length<d.totale)pn.appendChild(E('div',{class:'more'},btn('Carica altri ('+num(d.totale-f.righe.length)+')',function(){f.offset=f.righe.length;carica();},'sm')));
    var tot=mesi.reduce(function(m,x){m[x.mese]=(m[x.mese]||0)+Number(x.totale);return m;},{});
    var mesiOrd=Object.keys(tot).sort().map(function(k){return {voce:k+'/'+(f.anno||'')+' · '+euro(tot[k]),n:Math.round(tot[k])};});
    var contenuto=E('div',{class:'pag-c col'},[pn,E('div',{class:'pnl'},[E('div',{class:'t',text:'Importi per mese'+(f.anno?', '+f.anno:'')}),E('div',{class:'c'},barreOr(mesiOrd))])]);
    v.appendChild(contenuto);
    S.tasti=null;
    if(R.sub)dettaglioDocumento(R.sub);
  });
}
function dettaglioDocumento(ref){
  return api('/documenti/'+enc(ref)).then(function(d){
    var p=d.payload||{},c=p.cliente||{},ind=c.indirizzo||{};
    var corpo=E('div',{class:'col'},[
      E('div',{class:'row w'},[tag(DOCST[d.stato]||d.stato,d.stato==='annullato'?'rosso':'verde'),tag(d.business||'-','blu'),tag(d.fonte)]),
      kv([['Riferimento',d.ref],['Data',data(d.data_riserva)],['Cliente',[c.ragione_sociale||c.nome||'-',d.scheda_cliente?[' · ',E('a',{href:'#/crm/clienti/'+enc(d.scheda_cliente.clickup_task_id),text:'scheda cliente',on:{click:chiudiDrawer}})]:null]],
        ['P.IVA / CF',(c.partita_iva||'-')+' / '+(c.codice_fiscale||'-')],['Email',c.email||'-'],['Indirizzo',[ind.via,ind.cap,ind.citta,ind.provincia].filter(Boolean).join(' ')||'-'],
        p.rif_proforma?['Da proforma',p.rif_proforma]:null,d.note_annullo?['Annullo',d.note_annullo]:null]),
      E('table',{class:'tbl'},[E('thead',null,E('tr',null,[E('th',{text:'Righe'}),E('th',{class:'n',text:'Importo'})])),E('tbody',null,(p.righe||[]).map(function(r){return E('tr',null,[E('td',{text:r.descrizione}),E('td',{class:'n',text:euro2(r.importo)})]);}).concat([E('tr',null,[E('td',null,E('b',{text:'Totale (prima del bollo)'})),E('td',{class:'n'},E('b',{text:euro2(Number(d.totale))}))])]))]),
      p.note?E('div',null,[E('div',{class:'cap',text:'Note'}),p.note]):null,
      E('div',null,[E('div',{class:'cap',text:'Storico stati'}),d.storico.length?d.storico.map(function(s){return E('div',{class:'sb',text:data(s.quando)+' · '+(s.da_stato||'—')+' → '+s.a_stato});}):'Nessun passaggio.'])
    ]);
    drawer((d.tipo==='fattura'?'Fattura ':'Proforma ')+d.numero+'/'+d.anno,corpo);
  }).catch(fallita);
}
`;
