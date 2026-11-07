-- NON APPLICATO. Richiede approvazione di Elia (modifica permessi DB).
-- Perché: il controllo all'avvio (SPEC 7, "contatore >= massimo numero in ClickUp"), /readyz e la
-- riconciliazione (buchi, divergenze di contatore) devono LEGGERE contatori. Oggi fatturazione_app
-- non ha alcun permesso su contatori: senza questa migrazione il servizio resta in modalità bloccata.
-- Solo lettura: l'app continua a NON poter modificare contatori (lo fa solo riserva_numero, SECURITY DEFINER).
-- Eseguire con il ruolo owner 'fatturazione' (Job di migrazione), nel DB fatturazione.
GRANT SELECT ON contatori TO fatturazione_app;
