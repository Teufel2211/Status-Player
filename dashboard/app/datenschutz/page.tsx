import type { Metadata } from "next"
import LegalLayout from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Datenschutzerklärung — StatusMod Dashboard",
  description: "Datenschutzerklärung für das StatusMod Dashboard",
}

export default function DatenschutzPage() {
  return (
    <LegalLayout title="Datenschutzerklärung" updated="18. Oktober 2026">
      <h2>1. Verantwortlicher</h2>
      <p>
        Verantwortlicher für die Datenverarbeitung im Sinne der Datenschutz-Grundverordnung (DSGVO) ist der Betreiber
        des StatusMod-Dashboards. Die Kontaktdaten finden sich im <a href="/impressum">Impressum</a>.
      </p>

      <h2>2. Allgemeine Hinweise</h2>
      <p>
        Der Schutz Ihrer personenbezogenen Daten ist uns ein wichtiges Anliegen. Diese Datenschutzerklärung informiert
        Sie darüber, welche Daten wir erheben, wie wir sie verwenden und welche Rechte Ihnen zustehen.
      </p>

      <h2>3. Datenverarbeitung auf dieser Website</h2>
      <h3>3.1 Server-Log-Dateien</h3>
      <p>
        Der Provider der Seiten erhebt und speichert automatisch Informationen in Server-Log-Dateien, die Ihr Browser
        automatisch an uns übermittelt. Dies sind: Browsertyp und -version, verwendetes Betriebssystem, Referrer-URL,
        Hostname des zugreifenden Rechners, IP-Adresse sowie Uhrzeit der Serveranfrage. Diese Daten werden für den
        Betrieb und die Sicherheit der Website verarbeitet (Art. 6 Abs. 1 lit. f DSGVO).
      </p>

      <h3>3.2 Cookies und Anmeldung</h3>
      <p>
        Zur Anmeldung verwenden wir ein Refresh-Token, das in einem sicheren HttpOnly-Cookie gespeichert wird. Dieses
        Cookie ist erforderlich, um Sie während Ihrer Sitzung angemeldet zu halten (Art. 6 Abs. 1 lit. b DSGVO). Es
        handelt sich nicht um ein Tracking-Cookie.
      </p>

      <h3>3.3 Konten und Serverdaten</h3>
      <p>
        Bei der Registrierung über einen Setup-Code verarbeiten wir: Server-ID, Nutzername, Rollen-Zuordnung sowie
        technische Daten des Minecraft-Servers. Diese Daten sind erforderlich, um den Dienst bereitzustellen
        (Art. 6 Abs. 1 lit. b DSGVO).
      </p>

      <h3>3.4 Spielerdaten</h3>
      <p>
        Im Rahmen des Dienstes können Spielerinformationen (Nutzername, UUID, Status) verarbeitet werden, die vom
        Minecraft-Server des Nutzers übermittelt werden. Die Verantwortung für diese Daten liegt beim jeweiligen
        Serverbetreiber als Auftraggeber.
      </p>

      <h3>3.5 Ingame-Bug-Meldungen (/bug) und Screenshots</h3>
      <p>
        Meldet ein Spieler über den Ingame-Befehl <code>/bug</code> einen Fehler, übermittelt der Minecraft-Server des
        Betreibers den Meldetext, den Spielernamen sowie technische Angaben (Server-ID, Mod-Version, Minecraft-Version,
        Loader) an das Dashboard. Die Meldung wird dort für die Administratoren des jeweiligen Servers gespeichert und
        angezeigt. Optional kann der Spieler bis zu drei Screenshots anhängen — über die Upload-Seite im Browser oder
        mit installierter Client-Mod direkt im Spiel. Bilder werden vor dem Upload im Browser bzw. auf dem Client auf
        maximal 1920 Pixel verkleinert und als JPEG neu kodiert; dadurch entfallene Bild-Metadaten werden nicht
        übertragen. Die Bilder liegen im privaten Speicher des Dashboards und sind ausschließlich für die
        Administratoren des jeweiligen Servers über kurzlebige, signierte Links abrufbar. Upload-Codes sind 30 Minuten
        gültig und werden nur als Hash gespeichert. Die Verarbeitung dient der Fehleranalyse und Nachvollziehbarkeit
        (Art. 6 Abs. 1 lit. f DSGVO). Die Nutzung des Befehls und der Bild-Upload sind freiwillig; Administratoren
        können Meldungen inklusive aller Bilder jederzeit löschen.
      </p>

      <h2>4. Sicherheit der Verarbeitung</h2>
      <p>
        Passwörter und Zugangs-Codes werden ausschließlich in gehashter Form gespeichert. Alle Verbindungen erfolgen
        verschlüsselt über HTTPS. Tokens werden serverseitig ausschließlich als Hash gespeichert.
      </p>

      <h2>5. Weitergabe von Daten</h2>
      <p>
        Eine Übermittlung Ihrer personenbezogenen Daten an Dritte findet nicht statt, es sei denn, dies ist zur
        Erbringung des Dienstes erforderlich (z. B. Hosting-Dienstleister) oder gesetzlich vorgeschrieben.
      </p>

      <h2>6. Speicherdauer</h2>
      <p>
        Personenbezogene Daten werden nur so lange gespeichert, wie dies für die genannten Zwecke erforderlich ist.
        Gesetzliche Aufbewahrungsfristen bleiben unberührt. Auf Antrag werden personenbezogene Daten unverzüglich
        gelöscht bzw. anonymisiert.
      </p>

      <h2>7. Ihre Rechte als betroffene Person</h2>
      <ul>
        <li>Recht auf Auskunft (Art. 15 DSGVO)</li>
        <li>Recht auf Berichtigung (Art. 16 DSGVO)</li>
        <li>Recht auf Löschung (Art. 17 DSGVO)</li>
        <li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
        <li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</li>
        <li>Widerspruchsrecht (Art. 21 DSGVO)</li>
        <li>Recht auf Widerruf erteilter Einwilligungen (Art. 7 Abs. 3 DSGVO)</li>
        <li>Beschwerderecht bei einer Aufsichtsbehörde (Art. 77 DSGVO)</li>
      </ul>

      <h2>8. Datenschutzanfragen und Löschung</h2>
      <p>
        Du kannst jederzeit eine Anfrage zu deinen gespeicherten Daten stellen oder die Löschung deiner Daten
        verlangen. Nutze dazu die dafür vorgesehene Funktion im Dashboard oder kontaktiere uns über die im Impressum
        angegebenen Kontaktdaten.
      </p>

      <h2>9. Änderungen dieser Datenschutzerklärung</h2>
      <p>
        Wir behalten uns vor, diese Datenschutzerklärung anzupassen, um sie an geänderte Rechtslagen oder Änderungen
        des Dienstes anzupassen. Es gilt jeweils die aktuell veröffentlichte Fassung.
      </p>
    </LegalLayout>
  )
}
