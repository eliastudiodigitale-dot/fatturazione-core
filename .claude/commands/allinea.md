---
description: Compila la memoria di progetto (STATO, decisioni, wiki) leggendo il repo esistente
---
Allinea la memoria di questo repo alla realtà del codice. Scrivi solo dentro docs/. Non modificare codice, CLAUDE.md, .cursor/ né altri file.

1. Esplorazione: usa il subagent Explore (livello medium) per mappare struttura, stack, comandi di sviluppo/test/build, deploy documentato (README, docs/, .cursor/skills/deploy.md), servizi esterni e variabili d'ambiente. Delle variabili prendi SOLO i nomi da .env.example o dal codice, mai valori. Non leggere file .env.
2. Storia: leggi i docs esistenti e git log -60 per ricavare cosa è fatto, cosa è in corso e le decisioni evidenti (es. migrazioni di framework).
3. Scrivi:
   - docs/STATO.md (max 80 righe): fatto, in corso, prossimo passo, bloccanti, link.
   - docs/decisions.md: solo decisioni evidenti da docs o commit, con data e fonte (hash del commit). Se incerte, marca [DA VERIFICARE]. Non inventare.
   - docs/wiki/indice.md, stack.md, architettura.md, comandi.md, deploy.md, variabili.md. Se esiste già una wiki nel repo (es. WIKI-*.md), non duplicarla: linkala da indice.md.
   - docs/VPS.md: compila solo ciò che è documentato nel repo, il resto lascia [DA VERIFICARE]. Non eseguire comandi sul VPS.
4. Invoca il subagent verificatore sui file scritti.
5. Fai un commit locale dei soli file in docs/ con messaggio "docs: allinea memoria di progetto". Nessun push.
6. Rispondi in max 5 righe: file scritti, voci marcate [DA VERIFICARE], commit creato.
