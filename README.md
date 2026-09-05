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

Die App bewertet die Ladebedingungen standardmäßig jede Minute. Audi Connect
wird dabei weiterhin höchstens alle 15 Minuten aus der Cloud aktualisiert
(vier Cloud-Abfragen pro Stunde); die übrigen Minuten wird der geschützte
Audi-Cache zusammen mit den aktuellen Solix-Daten ausgewertet:

- Audi-Ladestecker verbunden und Solix-Akku am gewählten Startwert: Smart Plug
  an. Der Startwert lässt sich im Dashboard geschützt zwischen **20 % und
  90 %** einstellen.
- Solix-Akku **unter 10 %**: Smart Plug aus.
- Audi-Akku bei **100 %**: Smart Plug aus.
- Audi außerhalb des Heimradius: Smart Plug aus. Ist der Heimradius
  eingerichtet und der Standort vorübergehend unbekannt (zum Beispiel während
  des Wegfahrens), wird ebenfalls sicher ausgeschaltet.
- Zwischen 10 % und dem gewählten Startwert bleibt der letzte Zustand
  bestehen. Diese Hysterese verhindert schnelles Ein-/Ausschalten an einem
  Grenzwert.
- Ladestecker getrennt oder unbekannt: Smart Plug aus.
- Solix-Ladestand unbekannt: Smart Plug aus.
- Veraltete Audi-Daten werden deutlich markiert und niemals zum Einschalten
  verwendet. Bei einem abgelaufenen Audi-Zugriffstoken versucht die App genau
  eine sofortige Erneuerung; weitere Fehler werden höchstens alle 15 Minuten
  erneut geprüft, um das Audi-Konto nicht mit Anfragen zu belasten.

Bei genau einem Smart Plug wird er automatisch gewählt. Sind später mehrere
Smart Plugs im Konto, muss `SOLIX_SMARTPLUG_SN` auf die Seriennummer des
Wallbox-Plugs gesetzt werden. Seriennummern und Tokens werden von den neuen
öffentlichen Status-Endpunkten nicht ausgegeben.

`GET /api/automation` liefert ausschließlich den letzten sicheren
Automatikstatus. Das Dashboard zeigt Audi-Stecker, Solix-Ladestand,
Smart-Plug-Zustand und den Grund der letzten Entscheidung.

Das Dashboard zeigt zusätzlich Audi-Akkustand und elektrische Reichweite. Ein
manueller Ein-/Ausschalter ist nur verfügbar, wenn er auf dem Server aktiviert
und mit einem geheimen Test-Code geschützt wurde. Einschalten ist ausschließlich
bei verbundenem Audi-Ladestecker und mindestens 10 % Solix-Ladestand möglich;
Ausschalten bleibt immer möglich. Der manuelle Test ändert den Dry-Run-Modus der
Automatik nicht.

Der gleiche Steuer-Code schützt den Startwert-Regler. Eine Änderung wird ab der
nächsten Minutenprüfung verwendet und löst beim Speichern selbst noch keinen
Smart-Plug-Befehl aus. Nach einem Neustart des Render-Dienstes gilt wieder der
mit `AUTOMATION_ON_SOC` konfigurierte Standardwert.

Vor der echten Freigabe läuft die Steuerung mit `AUTOMATION_DRY_RUN=true` im
Testbetrieb. Dabei werden Audi, Solix und Smart Plug vollständig geprüft und
die beabsichtigte Schaltaktion angezeigt, aber es wird kein MQTT-Schaltbefehl
gesendet.

## Mobile Darstellung und Haus-Baumodus

Die 3D-Ansicht wählt auf iPhone und anderen mobilen Geräten automatisch ein
leichteres Renderprofil. Auflösung, Schatten, Wetterpartikel und die Zahl der
gleichzeitig animierten Vögel werden reduziert, ohne Energie- oder
Automatikdaten zu verändern. Im Menü kann zusätzlich **Flüssig / Sparmodus**
gewählt werden; **Automatisch** ist die empfohlene Einstellung.

Über **Eigenes Haus bauen** öffnet sich der erste 20 × 20-m-Baumodus. Wände,
Fenster und Türen lassen sich in mehreren Modellen und Farben auf einem
Meter-Raster setzen, drehen und rückgängig machen. Der Entwurf wird vorerst
lokal im jeweiligen Browser gespeichert. Diese erste Ausbaustufe greift nicht
in die bestehende Live-Grundstücksansicht oder die Ladeautomatik ein.

## Optionales Smart-Life-Garagentor

Das mittlere Garagentor kann über die offizielle Tuya-Cloudschnittstelle eines
Smart-Life-Geräts angebunden werden. Ohne vollständige Konfiguration bleibt die
Torbedienung eine deutlich gekennzeichnete 3D-Simulation; es wird kein externer
Befehl gesendet. Vor jedem echten Befehl fragt die Oberfläche nach Bestätigung
und dem geschützten Steuer-Code.

Der Datenpunkt eines Garagentormoduls ist nicht allgemein festgelegt. Deshalb
müssen `TUYA_GARAGE_MIDDLE_COMMAND_CODE` sowie Öffnen-/Schließen-Wert exakt aus
den Gerätefunktionen des eigenen Tuya-Cloudprojekts übernommen werden. Die App
rät diese sicherheitsrelevanten Werte nicht. Der Karoq nutzt die linke Garage
rein visuell; Yeti, Karoq und Fox können unabhängig wegfahren und zurückkehren.

## Render-Konfiguration

Unter **Environment** des Render-Web-Service setzen:

```text
AUDI_REFRESH_TOKEN=token-aus-der-gerätefreigabe
AUDI_COUNTRY=DE
AUDI_API_LEVEL=1
AUDI_CACHE_SECONDS=900
AUDI_HOME_LATITUDE=48.123456
AUDI_HOME_LONGITUDE=8.123456
AUDI_HOME_RADIUS_METERS=120
AUDI_POSITION_INTERVAL_SECONDS=120
SOLIX_CACHE_SECONDS=30
SOLIX_TELEMETRY_INTERVAL_SECONDS=60
# Optional mit persistentem Render-Datenträger, damit Tageskurven auch
# Deploys und Instanzwechsel überstehen:
SOLIX_HISTORY_FILE=/var/data/solix-telemetry.json
# Optional auf demselben Datenträger für Futter, Wasser, Tierpflege und Positionen:
ANIMAL_STATE_FILE=/var/data/solix-animal-state.json
SOLIX_SOLARBANK_PN=AE103
SOLIX_BATTERY_CAPACITY_WH=10400
AUTOMATION_ENABLED=true
AUTOMATION_DRY_RUN=true
AUTOMATION_ON_SOC=30
AUTOMATION_OFF_SOC=10
AUTOMATION_INTERVAL_SECONDS=60
SMARTPLUG_MANUAL_CONTROL=true
SMARTPLUG_CONTROL_TOKEN=langer-zufaelliger-test-code
# Erst nach Prüfung der Gerätefunktion aktivieren:
GARAGE_CONTROL_ENABLED=false
GARAGE_CONTROL_TOKEN=anderer-langer-zufaelliger-code
TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
TUYA_ACCESS_ID=access-id-des-tuya-cloudprojekts
TUYA_ACCESS_SECRET=access-secret-des-tuya-cloudprojekts
TUYA_GARAGE_MIDDLE_DEVICE_ID=geraete-id-des-mittleren-tors
TUYA_GARAGE_MIDDLE_COMMAND_CODE=exakter-befehlscode-des-moduls
TUYA_GARAGE_MIDDLE_STATUS_CODE=optionaler-statuscode
TUYA_GARAGE_MIDDLE_OPEN_VALUE=true
TUYA_GARAGE_MIDDLE_CLOSE_VALUE=false
```

Optional:

```text
AUDI_VIN=WAU...       # nur nötig, wenn nicht das erste Fahrzeug verwendet werden soll
AUDI_SPIN=1234        # nicht erforderlich; die Audi-Anbindung bleibt lesend
SOLIX_SMARTPLUG_SN=... # nur nötig, wenn mehrere Smart Plugs vorhanden sind
SOLIX_SOLARBANK_SN=... # nur nötig, wenn mehrere Solarbanken dasselbe Modell haben
```

Ohne `SOLIX_HISTORY_FILE` legt der Dienst die laufenden Tageswerte
kontobezogen unter `/tmp` ab. Dadurch beginnen die Diagramme beim späteren
Öffnen des Dashboards nicht erst im Browser, sondern enthalten die bereits vom
eigenständigen Hintergrundrekorder erfassten Messpunkte. Der Rekorder läuft
auch dann, wenn kein Browser geöffnet und die Ladeautomatik abgeschaltet ist;
das Intervall wird mit `SOLIX_TELEMETRY_INTERVAL_SECONDS` festgelegt. Für den
Erhalt über Render-
Deploys oder einen vollständigen Instanzwechsel hinweg wird ein persistenter
Datenträger (zum Beispiel unter `/var/data`) benötigt.

Heu, Wasser, Hundefutter und Hinterlassenschaften werden serverseitig geteilt,
sodass alle Browser denselben Stand sehen. Auch die Bewegungen von Pferd,
Kamelen, Rottweiler, Vögeln und Fischen folgen auf allen geöffneten Geräten
derselben laufenden Simulation. `ANIMAL_STATE_FILE` speichert die Pflegewerte
optional ebenfalls auf dem persistenten Render-Datenträger.

Sind mehrere Solix-Systeme im Konto, wählt `SOLIX_SOLARBANK_PN` das Modell für
Dashboard und Ladeautomatik eindeutig aus. Für die vorhandene Solarbank 4 ist
das `AE103`; die kleinere A17C5 bleibt dadurch von der Ladeautomatik getrennt.
Da die Solix-Cloud die zwei BP2700-Zusatzakkus bei dieser Anlage mit einer zu
hohen Kapazität meldet, setzt `SOLIX_BATTERY_CAPACITY_WH=10400` die reale
Gesamtkapazität für die Anzeige. Die gespeicherte Energie wird daraus zusammen
mit dem gemeldeten Akkustand berechnet.
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

`AUDI_HOME_LATITUDE` und `AUDI_HOME_LONGITUDE` definieren ausschließlich auf
dem Server den Mittelpunkt des Hausbereichs. Die App veröffentlicht weder diese
Hauskoordinaten noch die von Audi gelieferte Parkposition, sondern nur
`at_home=true/false`. Der Radius ist mit 120 Metern bewusst tolerant gegenüber
GPS-Abweichungen. Audi liefert eine Parkposition und kein Live-GPS während der
Fahrt; ein Wechsel wird deshalb nach dem Abstellen des Fahrzeugs erkannt.
Die Live-Wetteranzeige verwendet dieselben serverseitigen Hauskoordinaten und
gibt sie ebenfalls nicht an den Browser weiter. Falls für das Wetter ein
anderer Punkt verwendet werden soll, können optional `HOUSE_LATITUDE` und
`HOUSE_LONGITUDE` als private Render-Variablen gesetzt werden. Falls Open-Meteo
vom Render-Netz vorübergehend nicht erreichbar ist, verwendet die App
automatisch Bright Sky mit Messwerten des Deutschen Wetterdienstes.

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
