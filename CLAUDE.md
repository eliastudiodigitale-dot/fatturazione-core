
<!-- hub:start v1 -->
## Memoria di progetto (standard hub, non modificare questo blocco)
@docs/STATO.md
@docs/decisions.md

Regole:
- Inizio lavoro: STATO e decisioni sono già caricati sopra. docs/VPS.md solo se tocchi il deploy. docs/wiki/ solo su richiesta.
- Se la richiesta contraddice una decisione attiva, segnalalo prima di procedere.
- Non decidere da solo su: schema DB, autenticazione, deploy in produzione, costi, dipendenze major, cancellazione dati. Chiedi con opzioni e un default consigliato.
- Segreti: mai leggere, stampare o citare valori. Si usano solo via codice dalle variabili d'ambiente. Nei docs solo i nomi.
- Fine blocco di lavoro: /chiudi.
<!-- hub:end -->


## Rilascio in produzione
Rilascio manuale, lo esegue solo Elia. Tu verifichi test e build in locale sul commit di origin/main, poi descrivi i passi di docs/deploy.manifest.md: non li lanci.

## Memoria: regole aggiuntive di questo repo
- Quando dico o scelgo qualcosa di durevole ("decido", "d'ora in poi", "scelgo A"), esegui i passi di /decidi e rispondi in una riga "annotato: <decisione>". Le tue proposte non contano finché non le confermo io.
- Se la richiesta cambia argomento rispetto alla sessione, suggerisci /chiudi e una nuova sessione.

## Push: lo propone Claude, lo esegue Elia
- Non eseguire mai git push. A fine /chiudi, se ci sono commit non pushati, proponi UN solo comando da copiare e incollare nel terminale del Mac, in questa forma (sostituisci il percorso con quello assoluto del repo):
  cd /percorso/del/repo && B=$(git branch --show-current); echo "commit da inviare:"; git log --oneline @{u}..HEAD; S=$(git diff --name-only @{u}..HEAD | grep -ciE '\.env|secret|\.key|\.pem|credential|token'); if [ "$S" = 0 ]; then git push origin "$B"; else echo "STOP: file sensibili, non pusho"; fi
- Sotto il comando scrivi in due righe cosa fa e quale rischio ha. Se i commit da inviare sono più di quelli del lavoro appena chiuso, dillo prima del comando.
