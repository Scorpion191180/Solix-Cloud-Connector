# Solix Cloud Connector

FastAPI-Dashboard für Anker-Solix-Livedaten, eine rein lesende
Audi-Connect-Anbindung und eine abgesicherte Ladeautomatik für den Anker SOLIX
Smart Plug A17X8.

## Audi-Integration

`GET /api/audi` liest den Fahrzeug- und Ladestatus des ersten Fahrzeugs im
myAudi-Konto. Die VIN wird in der Antwort maskiert. Die Audi-Daten sind für
mindestens 15 Minuten zwischengespeichert, damit Browser- und Automatik-Aufrufe
das myAudi-Konto nicht mit Cloud-Abfragen belasten. Bei fehlender Autorisierung
oder einem Audi-Fehler startet die Anwendung trotzdem.

Audi hat den früheren E-Mail-/Passwort-Login im Juli 2026 durch eine
Gerätefreigabe im Browser ersetzt. Das Passwort wird daher weder von der App
noch von Render benötigt. Ein einmalig erstellter Refresh-Token wird als
Render-Secret gespeichert.

Die Audi-Verbindung bleibt vollständig lesend. Geschaltet wird ausschließlich
der Anker Smart Plug über die von `anker-solix-api` unterstützte MQTT-Methode.

## Ladeautomatik

Die App prüft standardmäßig alle 15 Minuten:

- Audi-Ladestecker verbunden und Solix-Akku **über 30 %**: Smart Plug an.
- Solix-Akku **unter 10 %**: Smart Plug aus.
- Zwischen 10 % und 30 % bleibt der letzte Zustand bestehen. Diese Hysterese
  verhindert schnelles Ein-/Ausschalten an einem Grenzwert.
- Ladestecker getrennt oder unbekannt: Smart Plug aus.
- Solix-Ladestand unbekannt: Smart Plug aus.

Bei genau einem Smart Plug wird er automatisch gewählt. Sind später mehrere
Smart Plugs im Konto, muss `SOLIX_SMARTPLUG_SN` auf die Seriennummer des
Wallbox-Plugs gesetzt werden. Seriennummern und Tokens werden von den neuen
öffentlichen Status-Endpunkten nicht ausgegeben.

`GET /api/automation` liefert ausschließlich den letzten sicheren
Automatikstatus. Das Dashboard zeigt Audi-Stecker, Solix-Ladestand,
Smart-Plug-Zustand und den Grund der letzten Entscheidung.

Vor der echten Freigabe läuft die Steuerung mit `AUTOMATION_DRY_RUN=true` im
Testbetrieb. Dabei werden Audi, Solix und Smart Plug vollständig geprüft und
die beabsichtigte Schaltaktion angezeigt, aber es wird kein MQTT-Schaltbefehl
gesendet.

## Render-Konfiguration

Unter **Environment** des Render-Web-Service setzen:

```text
AUDI_REFRESH_TOKEN=token-aus-der-gerätefreigabe
AUDI_COUNTRY=DE
AUDI_API_LEVEL=1
AUDI_CACHE_SECONDS=900
SOLIX_CACHE_SECONDS=30
SOLIX_SOLARBANK_PN=AE103
AUTOMATION_ENABLED=true
AUTOMATION_DRY_RUN=true
AUTOMATION_ON_SOC=30
AUTOMATION_OFF_SOC=10
AUTOMATION_INTERVAL_SECONDS=900
```

Optional:

```text
AUDI_VIN=WAU...       # nur nötig, wenn nicht das erste Fahrzeug verwendet werden soll
AUDI_SPIN=1234        # nicht erforderlich; die Audi-Anbindung bleibt lesend
SOLIX_SMARTPLUG_SN=... # nur nötig, wenn mehrere Smart Plugs vorhanden sind
SOLIX_SOLARBANK_SN=... # nur nötig, wenn mehrere Solarbanken dasselbe Modell haben
```

Sind mehrere Solix-Systeme im Konto, wählt `SOLIX_SOLARBANK_PN` das Modell für
Dashboard und Ladeautomatik eindeutig aus. Für die vorhandene Solarbank 4 ist
das `AE103`; die kleinere A17C5 bleibt dadurch von der Ladeautomatik getrennt.
Der Live-Ticker fragt die lokale App alle fünf Sekunden ab. Neue Anker-Cloud-
Daten werden zum Schutz vor Drosselung höchstens alle 30 Sekunden geladen.

Die einmalige Gerätefreigabe wird lokal ausgeführt:

```bash
python scripts/audi_device_auth.py --token-output /tmp/audi-refresh-token
```

Das Skript zeigt eine Audi-URL und einen Code an. Nach der Bestätigung schreibt
es ausschließlich den Refresh-Token mit Besitzerrechten in die angegebene
Datei; der Token wird nicht in der Konsole ausgegeben. Den Dateiinhalt als
`AUDI_REFRESH_TOKEN` in Render hinterlegen und die Datei danach löschen.

`AUDI_CACHE_SECONDS` kann angepasst werden, wird zum Schutz vor zu häufigen
Audi-Abfragen aber nie unter 900 Sekunden gesetzt. Nach dem Render-Deploy lässt
sich die Verbindung über `https://<dein-service>.onrender.com/api/audi` prüfen.

`AUTOMATION_ENABLED` ist in `render.yaml` absichtlich standardmäßig `false`.
Für den ersten gemeinsamen Test wird `AUTOMATION_ENABLED=true` zusammen mit
`AUTOMATION_DRY_RUN=true` gesetzt. Erst wenn Audi-Stecker, Solix-Ladestand und
Smart-Plug-Zustand korrekt angezeigt werden, darf `AUTOMATION_DRY_RUN=false`
gesetzt werden.

> **Render Free:** Kostenlose Web-Services werden nach 15 Minuten ohne
> eingehenden Traffic angehalten. Während dieser Zeit kann die
> Hintergrundautomatik nicht prüfen oder schalten. Für eine verlässliche,
> dauerhafte Ladeautomatik ist daher ein Render-Instanztyp erforderlich, der
> nicht in den Ruhezustand geht. Siehe
> [Render-Dokumentation zu Free-Services](https://render.com/docs/free#spinning-down-on-idle).

## Technischer Hinweis

Die frühere Vorbereitung verwendete `audiconnectpy`. Dieses Paket ist nicht
mehr über PyPI verfügbar. Der benötigte Audi-Unterbau ist deshalb aus dem
MIT-lizenzierten Projekt `myaudi-api` fest eingebunden. Herkunft und Version
sind in `THIRD_PARTY_NOTICES.md` dokumentiert. Der Gerätecode-Ablauf basiert
auf dem ebenfalls MIT-lizenzierten Fix aus `audi_connect_ha` PR 777.
