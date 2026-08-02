# Solix Cloud Connector

FastAPI-Dashboard für die bestehenden Anker-Solix-Livedaten und eine optionale,
rein lesende Audi-Connect-Anbindung.

## Aktueller Audi-Stand (Phase 1)

`GET /api/audi` liest den Fahrzeug- und Ladestatus des ersten Fahrzeugs im
myAudi-Konto. Die VIN wird in der Antwort maskiert. Die Audi-Daten sind für
vier Stunden zwischengespeichert, damit Browser-Aufrufe das myAudi-Konto nicht
mit Cloud-Abfragen belasten. Bei fehlenden Zugangsdaten oder einem Audi-Fehler
startet die Anwendung trotzdem; alle bestehenden Solix-Endpunkte bleiben
unverändert.

Die Audi-Seite im Dashboard ist noch nicht umgesetzt. Der Menüpunkt ist bisher
nur ein Platzhalter. Phase 1 wird direkt über `/api/audi` geprüft.

## Render-Konfiguration

Unter **Environment** des Render-Web-Service setzen:

```text
AUDI_EMAIL=deine-myaudi-email
AUDI_PASSWORD=dein-myaudi-passwort
AUDI_COUNTRY=DE
AUDI_API_LEVEL=1
AUDI_CACHE_SECONDS=14400
```

Optional:

```text
AUDI_VIN=WAU...       # nur nötig, wenn nicht das erste Fahrzeug verwendet werden soll
AUDI_SPIN=1234        # für Phase 1 nicht erforderlich; es werden keine Befehle gesendet
```

`AUDI_CACHE_SECONDS` kann angepasst werden, wird zum Schutz vor zu häufigen
Audi-Abfragen aber nie unter 900 Sekunden gesetzt. Nach dem Render-Deploy lässt
sich die Verbindung über `https://<dein-service>.onrender.com/api/audi` prüfen.

## Technischer Hinweis

Die frühere Vorbereitung verwendete `audiconnectpy`. Dieses Paket ist nicht
mehr über PyPI verfügbar. Der benötigte Audi-Unterbau ist deshalb aus dem
MIT-lizenzierten Projekt `myaudi-api` fest eingebunden. Herkunft und Version
sind in `THIRD_PARTY_NOTICES.md` dokumentiert.
