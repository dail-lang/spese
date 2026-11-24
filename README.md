# Spese

App per il telefono che mostra quanto spendi e in cosa. È una web app installabile (PWA): si aggiunge alla schermata Home di iPhone o Android e funziona offline. Non ha server né account, e i dati restano solo sul telefono.

## Cosa fa
- Inserimento rapido: scrivi l'importo, tocchi la categoria e la spesa è salvata. Nota, data e ripetizione sono facoltative.
- Mese: totale, ripartizione per categoria, confronto col mese precedente a pari giorni, elenco dei movimenti.
- Limiti di spesa mensili per categoria e per il totale. La barra diventa arancione dall'80% e rossa oltre il 100%, con un avviso.
- Spese ricorrenti (ogni settimana, mese o anno), aggiunte da sole alla data prevista, comprese quelle arretrate.
- Andamento degli ultimi 6 o 12 mesi, filtrabile per categoria.
- Ricerca per nota, categoria, date e importo.
- Suggerimenti mentre scrivi la nota, con la categoria scelta in automatico.
- Notifiche quando superi i limiti. Il promemoria serale si aggiunge come evento del calendario (.ics).
- Backup in JSON con importazione, esportazione CSV per Excel, tema chiaro e scuro automatico.

## Provarla sul computer
```bash
cd spese && python3 -m http.server 8000
```
Poi apri http://localhost:8000.

## Pubblicarla (per installarla sul telefono)
Serve un indirizzo `https://` stabile. Tutti i percorsi sono relativi, quindi funziona in qualsiasi cartella. Per esempio con GitHub Pages:
1. Copia il contenuto di `spese/` nella radice di un repository (per esempio `spese`).
2. Vai in Settings → Pages → Deploy from a branch → `main` / root.
3. Apri `https://<utente>.github.io/spese/` dal telefono e aggiungi l'app alla schermata Home.

Non cambiare indirizzo dopo l'installazione: i dati sono legati all'indirizzo. Se lo cambi, esporta prima un backup e importalo nella nuova app.

Per pubblicare un aggiornamento, alza `VERSION` in `sw.js`: l'app proporrà "Aggiorna".

## Test
```bash
cd spese && npm test
```
