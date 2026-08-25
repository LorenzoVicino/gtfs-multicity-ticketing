# Security policy

## Versioni supportate

La linea supportata è la release stabile più recente. Le versioni precedenti sono materiale storico e non ricevono correzioni di sicurezza.

## Segnalare una vulnerabilità

Non aprire issue pubbliche con dettagli sfruttabili, credenziali, token o dati personali. Usa la funzione **Report a vulnerability** nella scheda Security del repository GitHub.

Indica, quando possibile:

- componente e versione coinvolti;
- passaggi minimi per riprodurre il problema;
- impatto osservato o potenziale;
- proposta di mitigazione.

Il maintainer confermerà la ricezione e coordinerà correzione e pubblicazione. Nessun segreto di produzione deve essere committato: `.env.local` e `deploy.env` restano esclusi da Git.

## Confini del progetto

GTFS Hub è un progetto dimostrativo self-hosted. Prima di un uso pubblico reale servono almeno TLS tramite reverse proxy, backup PostgreSQL, rotazione dei segreti, monitoraggio e un servizio di autenticazione/autorizzazione adeguato.
