// Stile del portale: sobrio, denso, da strumento di lavoro. Un solo colore di marca; rosso, ambra e verde solo dove significano qualcosa
// (scadenze, priorità, esiti). Chiaro, scuro o automatico (Impostazioni > Personalizza). Nessun attributo style="" nella pagina (la CSP li blocca).
// Regola per chi modifica: niente backtick né "${" qui dentro (è String.raw).
export const CSS = String.raw`
:root,html[data-tema="chiaro"]{
  --bg:#f4f5f7;--sup:#ffffff;--sup2:#fafbfc;--hov:#f1f3f6;--sel:#e8f0fb;
  --line:#dfe2e8;--line2:#c8ced8;
  --ink:#1b2433;--ink2:#46526a;--mut:#6c778c;
  --pri:#0b5cad;--pri2:#094a8c;--priSoft:#e6f0fa;--onpri:#ffffff;
  --rosso:#b42318;--rossoSoft:#fdecea;--ambra:#a45a00;--ambraSoft:#fff3dc;--verde:#18794e;--verdeSoft:#e3f5ec;--grigioSoft:#eceff3;
  --lato:#1c2a3f;--latoTesto:#c5cedc;--latoHov:rgba(255,255,255,.07);--latoSel:rgba(255,255,255,.13);--latoLinea:rgba(255,255,255,.12);
  --ombra:0 1px 2px rgba(16,24,40,.06),0 8px 24px rgba(16,24,40,.12);
  --r:4px;--riga:9px;--fs:13px;--fs2:14px;
}
html[data-tema="scuro"]{
  --bg:#0d131c;--sup:#141c28;--sup2:#111823;--hov:#1b2536;--sel:#18304f;
  --line:#243044;--line2:#33425a;
  --ink:#dde4ef;--ink2:#a9b6ca;--mut:#7f8da4;
  --pri:#4c93e0;--pri2:#6aa6e8;--priSoft:#16304f;--onpri:#06111f;
  --rosso:#ff8a80;--rossoSoft:#3a1b1a;--ambra:#f0b04f;--ambraSoft:#3a2a10;--verde:#5fcf9a;--verdeSoft:#12301f;--grigioSoft:#1e2838;
  --lato:#0a0f17;--latoTesto:#a7b3c6;--latoHov:rgba(255,255,255,.06);--latoSel:rgba(255,255,255,.11);--latoLinea:rgba(255,255,255,.1);
  --ombra:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.5);
}
@media (prefers-color-scheme:dark){
  html[data-tema="auto"]{
    --bg:#0d131c;--sup:#141c28;--sup2:#111823;--hov:#1b2536;--sel:#18304f;
    --line:#243044;--line2:#33425a;
    --ink:#dde4ef;--ink2:#a9b6ca;--mut:#7f8da4;
    --pri:#4c93e0;--pri2:#6aa6e8;--priSoft:#16304f;--onpri:#06111f;
    --rosso:#ff8a80;--rossoSoft:#3a1b1a;--ambra:#f0b04f;--ambraSoft:#3a2a10;--verde:#5fcf9a;--verdeSoft:#12301f;--grigioSoft:#1e2838;
    --lato:#0a0f17;--latoTesto:#a7b3c6;--latoHov:rgba(255,255,255,.06);--latoSel:rgba(255,255,255,.11);--latoLinea:rgba(255,255,255,.1);
    --ombra:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.5);
  }
}
html[data-densita="compatta"]{--riga:5px;--fs:12.5px;--fs2:13px}
*{box-sizing:border-box}
html{color-scheme:light dark}
html[data-tema="chiaro"]{color-scheme:light}
html[data-tema="scuro"]{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--fs)/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;font-weight:600}
a{color:var(--pri);text-decoration:none}a:hover{text-decoration:underline}
button,select,input,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--pri);outline-offset:1px}
svg.i{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none;vertical-align:-3px}
.mut{color:var(--mut)}.ink2{color:var(--ink2)}.nb{white-space:nowrap}.sp{flex:1}.cap{text-transform:uppercase;letter-spacing:.05em;font-size:11px;color:var(--mut);font-weight:600}
.row{display:flex;align-items:center;gap:8px}.row.w{flex-wrap:wrap}.col{display:flex;flex-direction:column;gap:8px}
.n{text-align:right;font-variant-numeric:tabular-nums}.tc{text-align:center}
.hid{display:none!important}

/* ---------- pulsanti e campi */
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--sup);border:1px solid var(--line2);border-radius:var(--r);padding:5px 11px;cursor:pointer;line-height:1.3;white-space:nowrap}
.btn:hover:not(:disabled){background:var(--hov)}
.btn:disabled{opacity:.5;cursor:default}
.btn.pri{background:var(--pri);border-color:var(--pri);color:var(--onpri);font-weight:600}
.btn.pri:hover:not(:disabled){background:var(--pri2)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--ink2)}
.btn.ghost:hover:not(:disabled){background:var(--hov)}
.btn.sm{padding:2px 8px;font-size:12px}
.btn.rosso{color:var(--rosso)}
select,input,textarea{background:var(--sup);border:1px solid var(--line2);border-radius:var(--r);padding:5px 8px;min-width:0;max-width:100%}
input[type=checkbox],input[type=radio]{padding:0;accent-color:var(--pri)}
textarea{width:100%;min-height:84px;resize:vertical;line-height:1.5}
label.f{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--mut)}
label.f>input,label.f>select,label.f>textarea{font-size:var(--fs);color:var(--ink)}
label.ck{display:flex;align-items:center;gap:6px;color:var(--ink2);font-size:var(--fs)}
.campi{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.campi .l{grid-column:1/-1}

/* ---------- impianto */
#app{display:grid;grid-template-columns:216px minmax(0,1fr);min-height:100vh}
#lato{background:var(--lato);color:var(--latoTesto);position:sticky;top:0;height:100vh;overflow:auto;display:flex;flex-direction:column;padding:12px 8px;gap:2px}
#lato .logo{font-weight:700;color:#fff;font-size:15px;letter-spacing:.01em;padding:4px 10px 12px}
#lato .m{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:7px 10px;border-radius:var(--r);cursor:pointer;font-size:13.5px}
#lato .m:hover{background:var(--latoHov)}
#lato .m.on{background:var(--latoSel);color:#fff;font-weight:600}
#lato .m.sub{padding-left:35px;font-size:13px}
#lato .m .nb2{margin-left:auto;background:var(--rosso);color:#fff;border-radius:9px;min-width:18px;padding:0 6px;font-size:11px;font-weight:700;text-align:center;line-height:18px}
html[data-tema="scuro"] #lato .m .nb2{color:#2a0907}
#lato .m .nb2.b{background:var(--pri);color:var(--onpri)}
#lato .fine{margin-top:auto;border-top:1px solid var(--latoLinea);padding:10px 10px 4px;font-size:12px}
#lato .fine b{display:block;color:#fff;font-weight:600;font-size:13px}
#corpo{min-width:0;display:flex;flex-direction:column;min-height:100vh}
#barra{position:sticky;top:0;z-index:20;background:var(--sup);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:8px 18px;min-height:48px}
#cerca{position:relative;flex:1;max-width:560px}
#cerca input{width:100%;padding-left:30px;background:var(--bg);border-color:var(--line)}
#cerca .i{position:absolute;left:9px;top:8px;color:var(--mut)}
#cerca kbd{position:absolute;right:8px;top:6px;font:11px/1 ui-monospace,Menlo,monospace;color:var(--mut);border:1px solid var(--line2);border-radius:3px;padding:2px 5px;background:var(--sup)}
#risultati{position:absolute;top:36px;left:0;right:0;background:var(--sup);border:1px solid var(--line2);border-radius:var(--r);box-shadow:var(--ombra);max-height:70vh;overflow:auto;z-index:30}
#risultati h4{padding:8px 12px 4px}
#risultati .r{display:flex;gap:8px;align-items:center;padding:6px 12px;cursor:pointer}
#risultati .r:hover,#risultati .r.on{background:var(--sel)}
#vista{flex:1;min-width:0}
.pag-t{display:flex;align-items:center;gap:10px;padding:16px 20px 4px;flex-wrap:wrap}
.pag-t h1{font-size:19px}
.pag-c{padding:10px 20px 28px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);padding:0 20px;margin-top:8px;overflow-x:auto}
.tabs button{background:transparent;border:0;border-bottom:2px solid transparent;padding:8px 12px;cursor:pointer;color:var(--ink2);white-space:nowrap}
.tabs button:hover{color:var(--ink)}
.tabs button.on{color:var(--pri);border-bottom-color:var(--pri);font-weight:600}
.tabs.in{padding:0;margin:0 0 10px}

/* ---------- pannelli, tabelle, etichette */
.pnl{background:var(--sup);border:1px solid var(--line);border-radius:var(--r)}
.pnl>.t{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line);font-weight:600}
.pnl>.t .mut{font-weight:400}
.pnl>.c{padding:12px}
.pnl.sp0>.c{padding:0}
.griglia2{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(360px,1fr))}
table.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);font-weight:600;text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);background:var(--sup2);white-space:nowrap}
.tbl th.o{cursor:pointer}.tbl th.o:hover{color:var(--ink)}
.tbl td{padding:var(--riga) 10px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tr:last-child td{border-bottom:0}
.tbl tr.cl{cursor:pointer}.tbl tr.cl:hover td{background:var(--hov)}
.tbl tr.ann td{color:var(--mut);text-decoration:line-through}
.scroll{overflow-x:auto}
.tag{display:inline-block;border-radius:3px;padding:1px 7px;font-size:11.5px;font-weight:500;background:var(--grigioSoft);color:var(--ink2);white-space:nowrap;margin-right:4px;line-height:1.5}
.tag.blu{background:var(--priSoft);color:var(--pri)}.tag.rosso{background:var(--rossoSoft);color:var(--rosso)}
.tag.ambra{background:var(--ambraSoft);color:var(--ambra)}.tag.verde{background:var(--verdeSoft);color:var(--verde)}
.tag.fill{background:var(--rosso);color:#fff}
.pr{display:inline-flex;align-items:center;gap:5px;font-size:12px}
.pr i{width:8px;height:8px;border-radius:2px;background:var(--line2);display:inline-block}
.pr.urgente i{background:var(--rosso)}.pr.alta i{background:var(--ambra)}.pr.bassa i{background:var(--mut);opacity:.5}
.av{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--grigioSoft);color:var(--ink2);font-size:10.5px;font-weight:700;flex:none}
.av.me{background:var(--priSoft);color:var(--pri)}.av.g{width:28px;height:28px;font-size:12px}
.vuoto{color:var(--mut);padding:26px 14px;text-align:center}
.vuoto b{display:block;color:var(--ink2);margin-bottom:4px;font-weight:600}
.err{background:var(--rossoSoft);border:1px solid var(--rosso);color:var(--rosso);border-radius:var(--r);padding:10px 12px;margin:14px 20px}
.barra-f{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line)}
.barra-f input[type=search]{min-width:200px}
.tot{display:flex;gap:18px;flex-wrap:wrap;padding:9px 12px;border-bottom:1px solid var(--line);color:var(--mut);background:var(--sup2)}
.tot b{color:var(--ink)}
.more{display:flex;justify-content:center;padding:10px}

/* ---------- Oggi */
.code{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:14px}
.cd{background:var(--sup);border:1px solid var(--line);border-left:3px solid var(--line2);border-radius:var(--r);padding:11px 14px;cursor:pointer;text-align:left}
.cd:hover{background:var(--hov)}
.cd .v{font-size:26px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}
.cd .e{color:var(--ink2);margin-top:2px}
.cd.zero .v{color:var(--mut)}
.cd.rosso.attivo{border-left-color:var(--rosso)}.cd.rosso.attivo .v{color:var(--rosso)}
.cd.ambra.attivo{border-left-color:var(--ambra)}.cd.ambra.attivo .v{color:var(--ambra)}
.cd.blu.attivo{border-left-color:var(--pri)}.cd.blu.attivo .v{color:var(--pri)}
.li{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);cursor:pointer}
.li:last-child{border-bottom:0}.li:hover{background:var(--hov)}
.li .tt{min-width:0;flex:1}
.li .tt b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.li .tt span{color:var(--mut);font-size:12px}

/* ---------- Ticket: viste | elenco | area di lavoro */
.tk{display:grid;grid-template-columns:208px minmax(300px,420px) minmax(0,1fr);height:calc(100vh - 49px)}
.tk>div{min-height:0;overflow:auto}
.vw{border-right:1px solid var(--line);background:var(--sup2);padding:12px 8px}
.vw .cap{padding:10px 10px 4px}
.vw .v{display:flex;align-items:center;gap:6px;width:100%;text-align:left;background:transparent;border:0;border-radius:var(--r);padding:6px 10px;cursor:pointer;color:var(--ink2)}
.vw .v:hover{background:var(--hov)}
.vw .v.on{background:var(--sel);color:var(--pri);font-weight:600}
.vw .v .c{margin-left:auto;color:var(--mut);font-variant-numeric:tabular-nums}
.vw .v.rosso .c{color:var(--rosso);font-weight:700}.vw .v.ambra .c{color:var(--ambra);font-weight:700}
.elc{border-right:1px solid var(--line);background:var(--sup);display:flex;flex-direction:column}
.elc .top{position:sticky;top:0;background:var(--sup);z-index:3;border-bottom:1px solid var(--line);padding:8px 10px;display:flex;flex-direction:column;gap:7px}
.elc .top .row input[type=search]{flex:1}
.bulk{background:var(--sel);padding:6px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.tr{display:flex;gap:8px;padding:var(--riga) 10px;border-bottom:1px solid var(--line);border-left:3px solid transparent;cursor:pointer;align-items:flex-start}
.tr:hover{background:var(--hov)}
.tr.sel{background:var(--sel)}
.tr.urgente{border-left-color:var(--rosso)}.tr.alta{border-left-color:var(--ambra)}
.tr input{margin-top:3px}
.tr .cn{min-width:0;flex:1}
.tr .og{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr .sb{color:var(--mut);font-size:12px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr .dx{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.ws{background:var(--bg);display:grid;grid-template-columns:minmax(0,1fr) 290px}
.ws.vuota{display:flex;align-items:center;justify-content:center;color:var(--mut)}
.ws .conv{display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--line);min-height:0;overflow:auto}
.ws .head{background:var(--sup);border-bottom:1px solid var(--line);padding:12px 16px;position:sticky;top:0;z-index:2}
.ws .head h2{font-size:16px;margin-bottom:6px}
.thread{padding:14px 16px;display:flex;flex-direction:column;gap:12px;flex:1}
.msg{display:flex;gap:10px}
.msg .bd{background:var(--sup);border:1px solid var(--line);border-radius:var(--r);padding:8px 11px;max-width:100%;min-width:0;flex:1}
.msg.st .bd{background:var(--priSoft);border-color:transparent}
.msg.nt .bd{background:var(--ambraSoft);border-color:transparent}
.msg .mh{font-size:12px;color:var(--mut);margin-bottom:3px}.msg .mh b{color:var(--ink);font-weight:600}
.msg .tx{white-space:pre-wrap;word-break:break-word;font-size:var(--fs2)}
.comp{background:var(--sup);border-top:1px solid var(--line);padding:10px 16px 14px;position:sticky;bottom:0}
.comp.nota{background:var(--ambraSoft)}
.comp textarea{min-height:92px}
.prop{background:var(--sup);overflow:auto;padding:12px 14px}
.prop section{padding:0 0 12px;margin-bottom:12px;border-bottom:1px solid var(--line)}
.prop section:last-child{border-bottom:0}
.prop h3{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin-bottom:8px}
.kv{display:grid;grid-template-columns:96px minmax(0,1fr);gap:5px 8px;align-items:center}
.kv dt{color:var(--mut);font-size:12px}.kv dd{margin:0;min-width:0;word-break:break-word}
.kv select,.kv input{width:100%;padding:3px 6px}
.sla{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:var(--r);background:var(--grigioSoft);margin-bottom:5px;font-size:12.5px}
.sla.rosso{background:var(--rossoSoft);color:var(--rosso)}.sla.ambra{background:var(--ambraSoft);color:var(--ambra)}.sla.verde{background:var(--verdeSoft);color:var(--verde)}
.sla b{margin-left:auto;font-weight:600}

/* ---------- CRM */
.rec{display:grid;gap:14px;grid-template-columns:270px minmax(0,1fr) 300px;align-items:start}
.rec .pnl>.t{font-size:12.5px}
.tl{display:flex;flex-direction:column}
.tl .ev{display:flex;gap:10px;padding:9px 12px;border-bottom:1px solid var(--line)}
.tl .ev:last-child{border-bottom:0}
.tl .ev.cl{cursor:pointer}.tl .ev.cl:hover{background:var(--hov)}
.tl .ic{width:26px;height:26px;border-radius:50%;background:var(--grigioSoft);color:var(--ink2);display:flex;align-items:center;justify-content:center;flex:none}
.tl .ev.ticket .ic{background:var(--priSoft);color:var(--pri)}.tl .ev.documento .ic{background:var(--verdeSoft);color:var(--verde)}
.tl .ev.attivita .ic{background:var(--ambraSoft);color:var(--ambra)}
.tl .bd{min-width:0;flex:1}.tl .bd b{font-weight:500}
.nota-c{padding:9px 12px;border-bottom:1px solid var(--line);white-space:pre-wrap}
.nota-c.fissata{background:var(--ambraSoft)}
.nota-c .m{display:block;color:var(--mut);font-size:12px;margin-top:3px;white-space:normal}
.kb{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(250px,1fr);gap:12px;overflow-x:auto;padding-bottom:10px;align-items:start}
.kc{background:var(--grigioSoft);border-radius:var(--r);padding:8px;min-height:140px}
.kc.over{outline:2px dashed var(--pri);background:var(--priSoft)}
.kc h3{display:flex;justify-content:space-between;gap:8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);padding:2px 4px 8px}
.kc h3 span:last-child{font-variant-numeric:tabular-nums}
.kd{background:var(--sup);border:1px solid var(--line);border-radius:var(--r);padding:8px 10px;margin-bottom:8px;cursor:grab}
.kd:active{cursor:grabbing}
.kd.fermo{border-left:3px solid var(--ambra)}
.kd .v{font-weight:600;font-variant-numeric:tabular-nums}
.gr{margin-bottom:14px}.gr>h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}.gr.rosso>h3{color:var(--rosso)}

/* ---------- report, impostazioni */
.kp{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px}
.kp>div{background:var(--sup);border:1px solid var(--line);border-radius:var(--r);padding:10px 12px}
.kp .v{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums}.kp .t{color:var(--mut);font-size:12px}.kp .s{color:var(--mut);font-size:12px}
.hb{display:grid;grid-template-columns:minmax(80px,32%) 1fr 44px;gap:8px;align-items:center;margin:4px 0}
.hb .b{height:8px;background:var(--grigioSoft);border-radius:2px;overflow:hidden}.hb .b i{display:block;height:100%;background:var(--pri)}
svg.g{width:100%;height:190px;display:block}
svg.g .a{fill:var(--pri)}svg.g .b{fill:var(--mut);opacity:.55}svg.g text{fill:var(--mut);font-size:10px}svg.g line{stroke:var(--line)}
.leg{font-size:12px;color:var(--mut);margin-bottom:6px}.leg b{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}.leg b.ba{background:var(--pri)}.leg b.bb{background:var(--mut);opacity:.55}
.scelte{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,230px))}
.sc{border:1px solid var(--line2);border-radius:var(--r);padding:10px;cursor:pointer;background:var(--sup);text-align:left}
.sc.on{border-color:var(--pri);box-shadow:0 0 0 1px var(--pri)}
.sc .an{height:54px;border-radius:3px;margin-bottom:8px;border:1px solid var(--line);display:flex;overflow:hidden}
.sc .an i{display:block;height:100%}
.sc .an .l{width:28%}.sc .an .r{flex:1}
.sc.chiaro .an .l{background:#1c2a3f}.sc.chiaro .an .r{background:#f4f5f7}
.sc.scuro .an .l{background:#0a0f17}.sc.scuro .an .r{background:#141c28}
.sc.auto .an .l{background:linear-gradient(90deg,#1c2a3f 50%,#0a0f17 50%)}.sc.auto .an .r{background:linear-gradient(90deg,#f4f5f7 50%,#141c28 50%)}
.sc.comoda .an{flex-direction:column;gap:7px;padding:8px}.sc.compatta .an{flex-direction:column;gap:3px;padding:5px}
.sc .an u{display:block;height:7px;background:var(--line2);border-radius:2px}.sc.compatta .an u{height:4px}

/* ---------- sovrapposizioni */
#dettaglio{position:fixed;top:0;right:0;bottom:0;width:min(600px,100%);background:var(--sup);border-left:1px solid var(--line2);overflow:auto;box-shadow:var(--ombra);z-index:40}
#dettaglio[hidden],#modale[hidden],#avviso[hidden],#risultati[hidden]{display:none}
#dettaglio .hd{position:sticky;top:0;background:var(--sup);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:8px}
#dettaglio .bd{padding:14px 16px}
#modale{position:fixed;inset:0;background:rgba(10,16,26,.5);display:flex;align-items:flex-start;justify-content:center;padding:7vh 12px;z-index:60;overflow:auto}
#modale .sc2{background:var(--sup);border:1px solid var(--line2);border-radius:6px;padding:18px;width:min(560px,100%);box-shadow:var(--ombra)}
#modale h3{font-size:16px;margin-bottom:10px}
#modale .az{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
#avviso{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 16px;border-radius:var(--r);z-index:80;max-width:90vw;box-shadow:var(--ombra)}
#avviso.e{background:var(--rosso);color:#fff}
footer{padding:0 20px 18px;color:var(--mut);font-size:12px}
@media (max-width:1180px){.tk{grid-template-columns:190px minmax(260px,1fr)}.ws{position:fixed;top:0;right:0;bottom:0;width:min(900px,100%);z-index:45;box-shadow:var(--ombra)}.ws.vuota{display:none}.rec{grid-template-columns:1fr}}
@media (max-width:760px){#app{grid-template-columns:1fr}#lato{position:static;height:auto;flex-direction:row;flex-wrap:wrap}#lato .logo,#lato .fine{display:none}#lato .m.sub{padding-left:10px}.tk{display:block;height:auto}.vw{border-right:0;border-bottom:1px solid var(--line)}.ws{grid-template-columns:1fr}.prop{display:none}}
`;
