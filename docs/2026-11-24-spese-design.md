# Spese — documento di progetto

Data: 2026-11-24

## Perché e per chi

Un'app sul telefono per una persona sola che vuole sapere **quanto spende e in cosa**.
Il successo è questo: segnare una spesa richiede pochi secondi, e aprendo l'app si capisce
subito dove vanno i soldi questo mese, rispetto al mese scorso e ai limiti che ci si è dati.
Deve essere bella da usare, altrimenti non la si apre.

## Obiettivi

- Inserimento rapidissimo: importo → categoria → fatto (data di oggi già impostata, nota facoltativa).
- Totale del mese e ripartizione per categoria, con navigazione tra i mesi.
- Spese ricorrenti che si aggiungono da sole.
- Limiti di spesa mensili per categoria e totale, con avvisi visivi.
- Confronto con il mese precedente e andamento sugli ultimi 6–12 mesi.
- Ricerca e filtri sulle spese.
- Suggerimenti durante la scrittura della nota, con categoria scelta in automatico.
- Tema chiaro/scuro automatico.
- Promemoria e notifiche (vedi i limiti tecnici sotto).
- Funziona offline; si installa sulla schermata Home di iPhone e Android.

## Non-obiettivi

- Entrate, saldo, obiettivi di risparmio.
- Account, login, sincronizzazione tra dispositivi, server di qualsiasi tipo.
- Più valute: solo euro.
- Foto degli scontrini.
- Pubblicazione su App Store / Play Store.

## Anti-obiettivi (sarebbe un fallimento anche se "funziona")

- Inserire una spesa richiede più di 3 tocchi oltre all'importo.
- Perdere i dati senza che l'utente sia mai stato avvisato di fare un backup.
- Aspetto da gestionale: tabelle dense, colori a caso, testo minuscolo.
- Notifiche inaffidabili presentate come affidabili.

## Vincoli

- Nessuna dipendenza esterna e nessun passaggio di build: HTML, CSS e JavaScript (moduli ES) scritti a mano.
- I dati restano solo sul dispositivo (IndexedDB). Va chiesta la memoria persistente
  (`navigator.storage.persist()`).
- Deve stare su HTTPS per essere installabile (service worker + manifest).
- Codice nella cartella `spese/` di questo repository, separata dal resto.

## Approcci considerati

1. **Web app installabile (PWA)** — scelta. Si installa dalla schermata Home senza store, funziona
   offline su iPhone e Android, nessun server.
2. **App nativa (Flutter/React Native)** — scartata: compilazione, account sviluppatore Apple o
   reinstallazione ogni 7 giorni su iPhone; troppo costo per un'app di registrazione spese.
3. **Foglio Google + modulo** — scartata: inserimento lento dal telefono, grafici rigidi.

L'utente ha scelto la 1.

## Cosa fa l'app (deciso nella conversazione)

### Struttura

Barra in basso con quattro sezioni: **Mese**, **Andamento**, **Ricorrenti**, **Impostazioni**.
Pulsante **+** grande e sempre raggiungibile col pollice per aggiungere una spesa.

### Aggiungere / modificare una spesa

- Tastierino numerico per l'importo (virgola decimale all'italiana), poi griglia delle categorie;
  toccare la categoria salva.
- Campi facoltativi: nota, data (di default oggi), "ripeti" (vedi Ricorrenti).
- Toccando una spesa nell'elenco la si modifica o la si elimina (con possibilità di annullare).

### Mese (home)

- Selettore del mese con frecce.
- Totale speso; sotto, per il mese corrente, "in arrivo questo mese: € X" dalle ricorrenti non ancora scattate.
- Categorie ordinate dalla più costosa, ciascuna con barra. Se la categoria ha un limite, la barra si
  riempie verso il limite: normale sotto l'80%, arancione dall'80%, rossa oltre il 100%.
  Stessa logica per il limite totale sul totale del mese.
- Accanto a ogni categoria il confronto col mese precedente ("+€ 40 rispetto a ottobre").
- Elenco delle spese del mese raggruppate per giorno.

### Categorie

Iniziali: Spesa, Casa, Bollette, Trasporti, Fuori (ristoranti e bar), Svago, Salute,
Abbigliamento, Altro. Ognuna con icona e colore. Si possono aggiungere, rinominare, eliminare
(eliminando una categoria con spese, le spese passano ad "Altro").

### Limiti di spesa

Limite mensile facoltativo per ogni categoria e uno per il totale. Si impostano dalle Impostazioni
o toccando una categoria.

### Ricorrenti

- Una spesa può essere marcata come ricorrente: ogni settimana, ogni mese (giorno X), ogni anno.
- All'apertura dell'app vengono create tutte le occorrenze scadute dall'ultima apertura
  (anche se l'app non è stata aperta per settimane).
- Sezione con l'elenco delle ricorrenti attive, prossima data, modifica e stop.

### Andamento

- Istogramma del totale mensile degli ultimi 6 o 12 mesi, filtrabile per una categoria.
- Toccando una barra si apre quel mese.

### Ricerca e filtri

Ricerca testuale sulle note; filtri per categoria, intervallo di date, importo minimo/massimo.
Mostra risultati e totale dei risultati.

### Suggerimenti

Scrivendo la nota, l'app propone le note già usate (più frequenti e recenti prima); scegliendone
una imposta la categoria usata l'ultima volta con quella nota.

### Backup

- Esporta un file JSON completo (spese, categorie, limiti, ricorrenti) e un CSV per Excel.
- Importa il JSON (sostituisce i dati attuali dopo conferma).
- Se l'ultimo backup ha più di 30 giorni, la home mostra un avviso discreto.

### Notifiche

L'utente le ha chieste esplicitamente. Limite tecnico: una web app senza server **non può
programmare notifiche a un orario** quando è chiusa (né su iPhone né su Android).
Si realizza quindi:

- **Avvisi sui limiti**: al salvataggio di una spesa che porta una categoria (o il totale) oltre
  l'80% o il 100% del limite, appare un avviso nell'app e, se il permesso è concesso, una notifica di sistema.
- **Promemoria serale**: dalle Impostazioni si sceglie un orario e l'app genera un evento
  ricorrente giornaliero da aggiungere al calendario del telefono (file `.ics`). È affidabile su
  entrambi i sistemi e non richiede server. *Scelta del progettista:* l'evento **non contiene un
  link**, solo il testo "Segna le spese di oggi in Spese": su iPhone un link dal Calendario aprirebbe
  Safari, che ha una memoria separata dall'app installata, e le spese finirebbero in un archivio vuoto.

### Protezione "non installata"

*Scelta del progettista:* se l'app viene aperta nel browser invece che dalla schermata Home
(rilevabile con `display-mode: standalone`), mostra un banner che spiega come installarla o aprirla
dalla Home, perché i dati del browser e dell'app installata sono separati.

### Aspetto

Pulito, caldo, leggibile: schede arrotondate, molto spazio, numeri grandi, una palette di colori
per le categorie coerente in chiaro e in scuro, icone uniformi, animazioni brevi e discrete
(apertura del foglio di inserimento, riempimento delle barre). Font di sistema. Tema chiaro/scuro
automatico secondo il telefono. Pensata per una mano sola: comandi principali in basso.
Rispetta le aree sicure di iPhone (notch, barra home).

## Lasciato a chi costruisce

- Struttura dei file, schema IndexedDB, nomi.
- Icone (SVG inline) e palette precise, nel rispetto della sezione Aspetto.
- Come disegnare i grafici (SVG a mano).
- Gestione dei casi limite delle ricorrenti (es. giorno 31 nei mesi più corti → ultimo giorno del mese).
- Per il confronto col mese precedente nel mese in corso: decidere se confrontare con lo stesso
  periodo del mese precedente (consigliato) o col mese intero, e scriverlo chiaramente nell'interfaccia.
- Test: logica pura (ricorrenze, totali, CSV) con test automatici; verifica dell'interfaccia in un
  browser simulando un telefono.
