// Impostazioni (solo owner, tranne Personalizza che vale per tutti): SLA, risposte rapide, aspetto.
export const IMPOSTAZIONI = String.raw`
function impostazioni(){
  var R=rotta(),sub=R.sub||(puo('impostazioni')?'sla':'personalizza');
  var v=$('#vista');v.textContent='';
  v.appendChild(titoloPagina('Impostazioni'));
  var schede=(puo('impostazioni')?[['sla','SLA'],['risposte','Risposte rapide']]:[]).concat([['personalizza','Personalizza']]);
  v.appendChild(E('div',{class:'tabs'},schede.map(function(s){return E('button',{type:'button',class:sub===s[0]?'on':'',text:s[1],on:{click:function(){vai('impostazioni/'+s[0]);}}});})));
  var corpo=E('div',{class:'pag-c'});v.appendChild(corpo);
  S.tasti=null;
  if(sub==='personalizza'){personalizza(corpo);return Promise.resolve();}
  if(!puo('impostazioni')){corpo.appendChild(vuoto('Non disponibile per il tuo ruolo'));return Promise.resolve();}
  if(sub==='risposte')return risposteRapide(corpo);
  return slaImpostazioni(corpo);
}

// ---------------------------------------------------------------- Personalizza
function personalizza(corpo){
  function scelta(chiave,valore,titolo,descr,classe){
    return E('button',{type:'button',class:'sc '+classe+(pref(chiave,chiave==='tema'?'auto':'comoda')===valore?' on':''),on:{click:function(){setPref(chiave,valore);applicaTema();avviso('Preferenza salvata');carica();}}},[
      E('div',{class:'an'},classe==='comoda'||classe==='compatta'?[E('u'),E('u'),E('u')]:[E('i',{class:'l'}),E('i',{class:'r'})]),E('b',{text:titolo}),E('div',{class:'mut',text:descr})]);
  }
  corpo.appendChild(E('div',{class:'pnl'},[E('div',{class:'t',text:'Tema'}),E('div',{class:'c col'},[
    E('div',{class:'mut',text:'Come appare il portale. "Automatico" segue il tema del tuo computer.'}),
    E('div',{class:'scelte'},[scelta('tema','chiaro','Chiaro','Sfondo chiaro, adatto agli ambienti luminosi','chiaro'),scelta('tema','scuro','Scuro','Sfondo scuro, riposa gli occhi la sera','scuro'),scelta('tema','auto','Automatico','Segue il sistema operativo','auto')])
  ])]));
  corpo.appendChild(E('div',{class:'pnl'},[E('div',{class:'t',text:'Densità'}),E('div',{class:'c col'},[
    E('div',{class:'mut',text:'Quante righe vedi nello stesso spazio.'}),
    E('div',{class:'scelte'},[scelta('densita','comoda','Comoda','Più respiro tra le righe','comoda'),scelta('densita','compatta','Compatta','Più righe a schermo','compatta')])
  ])]));
  corpo.appendChild(E('div',{class:'mut',text:'Le preferenze valgono per questo browser.'}));
}

// ---------------------------------------------------------------- risposte rapide
function risposteRapide(corpo){
  return api('/risposte-rapide').then(function(d){
    S.risposte=d.risposte;
    var bus=S.opz.business||[];
    function modaleRisposta(x){
      var nome=inp('rr-nome',x?x.nome:'','text',{maxlength:'80'});
      var testo=E('textarea',{id:'rr-testo',maxlength:'4000'},x?x.testo:'');
      var biz=sel('rr-bus',bus.map(function(b){return [b,b];}),x&&x.business?x.business:'','Tutte le attività');
      modale(x?'Modifica risposta':'Nuova risposta rapida',E('div',{class:'col'},[campo('Nome (come appare nel menu)',nome),campo('Testo',testo),campo('Vale per',biz),E('div',{class:'mut',text:'Segnaposto: {{cliente}} nome del cliente, {{agente}} il tuo nome, {{rif}} riferimento del ticket.'})]),[{testo:'Annulla'},{testo:'Salva',pri:true,fn:function(){
        var b={nome:val('rr-nome'),testo:$('#rr-testo').value.trim(),business:val('rr-bus')||null};
        if(!b.nome||!b.testo){avviso('Servono nome e testo',true);return;}
        (x?chiama('PATCH','/risposte-rapide/'+x.id,b):chiama('POST','/risposte-rapide',b)).then(function(){chiudiModale();avviso('Salvata');S.risposte=null;carica();}).catch(fallita);
      }}]);
    }
    var pn=E('div',{class:'pnl sp0'},[E('div',{class:'t'},['Risposte rapide',E('span',{class:'sp'}),btn('Nuova risposta',function(){modaleRisposta(null);},'pri sm','piu')])]);
    if(!d.risposte.length)pn.appendChild(vuoto('Nessuna risposta rapida','Sono testi pronti da inserire nelle risposte ai ticket: presa in carico, richiesta di informazioni, chiusura.'));
    d.risposte.forEach(function(x){pn.appendChild(E('div',{class:'li'},[E('div',{class:'tt'},[E('b',{text:x.nome}),E('span',{text:x.testo.slice(0,140)})]),tag(x.business||'Tutte le attività',x.business?'blu':''),btn('Modifica',function(){modaleRisposta(x);},'sm'),btn('Elimina',function(){chiedi('Eliminare la risposta?','"'+x.nome+'" non comparirà più nel menu.','Elimina',function(){chiama('DELETE','/risposte-rapide/'+x.id).then(function(){avviso('Eliminata');S.risposte=null;carica();}).catch(fallita);});},'sm rosso')]));});
    corpo.appendChild(pn);
  });
}

// ---------------------------------------------------------------- SLA
function rigaPiano(x){
  var r=E('div',{class:'campi','data-piano':'1'},[
    campo('Nome del piano (es. 48h)',inp('',x.piano,'text',{maxlength:'16','data-n':'1'})),
    campo('Prima risposta (ore)',inp('',x.prima_risposta_ore,'number',{min:'1',max:'720','data-pr':'1'})),
    campo('Risoluzione (ore)',inp('',x.risoluzione_ore,'number',{min:'1',max:'2160','data-ri':'1'})),
    E('div',{class:'row'},btn('Togli',function(){var p=r.parentNode;p.removeChild(r);p.dispatchEvent(new Event('piani'));},'sm rosso'))
  ]);
  return r;
}
function schedaSla(b,i){
  var p='s'+i+'-';
  var chk=E('input',{type:'checkbox',id:p+'st',checked:Boolean(b.standard)});
  var piani=E('div',{id:p+'piani','data-piani':'1'},b.piani.map(rigaPiano));
  var def=E('select',{id:p+'def'});
  function riempi(corrente){
    def.textContent='';
    var nomi=$$('[data-n]',piani).map(function(e){return e.value.trim();}).filter(Boolean);
    [['','SLA standard'],['nessuno','Nessun SLA (best effort)']].concat(nomi.map(function(n){return [n,'Piano '+n];})).forEach(function(o){var op=E('option',{value:o[0],text:o[1]});if(o[0]===corrente)op.setAttribute('selected','');def.appendChild(op);});
  }
  riempi(b.piano_predefinito||'');
  piani.addEventListener('input',function(){riempi(def.value);});piani.addEventListener('piani',function(){riempi(def.value);});
  return E('div',{class:'pnl','data-bus':b.business},[E('div',{class:'t',text:b.business}),E('div',{class:'c col'},[
    E('label',{class:'ck'},[chk,'Questa attività ha un SLA standard proprio (altrimenti vale il valore di partenza)']),
    E('div',{class:'campi'},[campo('Prima risposta (ore)',inp(p+'pr',b.standard?b.standard.prima_risposta_ore:'','number',{min:'1',max:'720'})),campo('Risoluzione (ore)',inp(p+'ri',b.standard?b.standard.risoluzione_ore:'','number',{min:'1',max:'2160'}))]),
    E('div',{class:'mut',text:'La priorità accorcia o allunga lo SLA standard (urgente ×0,25, alta ×0,5, bassa ×2). I piani a pagamento hanno termini fissi.'}),
    E('div',{class:'cap',text:'Piani a pagamento'}),piani,
    E('div',{class:'row'},btn('Aggiungi piano',function(){piani.appendChild(rigaPiano({piano:'',prima_risposta_ore:24,risoluzione_ore:72}));riempi(def.value);},'sm','piu')),
    campo('Piano dei ticket senza piano indicato',def)
  ])]);
}
function leggiSla(){
  var out={predefinito:{prima_risposta_ore:Number(val('s-prima')),risoluzione_ore:Number(val('s-ris'))},business:[]};
  $$('[data-bus]').forEach(function(box,i){
    var p='s'+i+'-',st=spunta(p+'st');
    out.business.push({business:box.getAttribute('data-bus'),standard:st?{prima_risposta_ore:Number(val(p+'pr')),risoluzione_ore:Number(val(p+'ri'))}:null,piano_predefinito:val(p+'def')||null,
      piani:$$('[data-piano]',box).map(function(r){return {piano:$('[data-n]',r).value.trim(),prima_risposta_ore:Number($('[data-pr]',r).value),risoluzione_ore:Number($('[data-ri]',r).value)};}).filter(function(x){return x.piano;})});
  });
  return out;
}
function slaImpostazioni(corpo){
  return api('/impostazioni/sla').then(function(d){
    corpo.appendChild(E('div',{class:'pnl'},[E('div',{class:'t',text:'SLA: tempi di assistenza per attività'}),E('div',{class:'c col'},[
      E('div',{class:'mut',text:'Ore di calendario dall’apertura del ticket. Le modifiche valgono subito per i ticket nuovi; i ticket già aperti non cambiano (per ricalcolarne uno cambia il suo piano dal ticket). I piani tolti restano nello storico e si possono rimettere.'}),
      E('div',{class:'campi'},[campo('Valore di partenza: prima risposta (ore)',inp('s-prima',d.predefinito.prima_risposta_ore,'number',{min:'1',max:'720'})),campo('Valore di partenza: risoluzione (ore)',inp('s-ris',d.predefinito.risoluzione_ore,'number',{min:'1',max:'2160'}))])
    ])]));
    d.business.forEach(function(b,i){corpo.appendChild(schedaSla(b,i));});
    if(!d.business.length)corpo.appendChild(vuoto('Nessuna attività','Compaiono qui le attività configurate nelle fonti ticket e in ClickUp.'));
    corpo.appendChild(E('div',{class:'row'},btn('Salva tutte le impostazioni SLA',function(){
      chiama('PUT','/impostazioni/sla',leggiSla()).then(function(){avviso('Impostazioni SLA salvate');return api('/piani-sla');}).then(function(p){S.piani=p;carica();}).catch(fallita);
    },'pri')));
  });
}
`;
