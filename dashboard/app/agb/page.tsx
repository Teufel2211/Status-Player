import type { Metadata } from "next"
import LegalLayout from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "AGB — Status Player Dashboard",
  description: "Allgemeine Geschäftsbedingungen für Status Player",
}

export default function AGBPage() {
  return (
    <LegalLayout title="Allgemeine Geschäftsbedingungen (AGB)" updated="31. Juli 2026">
      <h2>1. Geltungsbereich</h2>
      <p>
        Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für die Nutzung des Status Player Dashboards und der damit
        verbundenen Dienste (im Folgenden „Dienst"). Mit der Nutzung des Dienstes erkennt der Nutzer diese AGB an.
      </p>

      <h2>2. Beschreibung des Dienstes</h2>
      <p>
        Status Player ist ein Minecraft-Mod, der es Serverbetreibern ermöglicht, Statusanzeigen, Spielerinformationen und
        Shop-Funktionen für ihren Minecraft-Server über ein webbasiertes Dashboard zu verwalten. Der Dienst stellt die
        Verbindung zwischen dem Minecraft-Server und dem Dashboard her.
      </p>

      <h2>3. Nutzerkonto</h2>
      <ul>
        <li>Die Registrierung erfolgt über einen einmaligen Setup-Code, der vom Minecraft-Server generiert wird.</li>
        <li>Der Nutzer ist verpflichtet, Zugangsdaten vertraulich zu behandeln.</li>
        <li>Der Nutzer haftet für alle Handlungen, die über sein Konto vorgenommen werden.</li>
      </ul>

      <h2>4. Pflichten des Nutzers</h2>
      <ul>
        <li>Der Nutzer darf den Dienst nicht missbrauchen, insbesondere nicht zur Umgehung von Sicherheitsmaßnahmen.</li>
        <li>Der Nutzer stellt sicher, dass er berechtigt ist, den angemeldeten Minecraft-Server zu verwalten.</li>
        <li>Es ist untersagt, Inhalte zu verbreiten, die gegen geltendes Recht oder die Rechte Dritter verstoßen.</li>
      </ul>

      <h2>5. Haftung</h2>
      <p>
        Der Betreiber haftet unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie für Schäden aus der Verletzung von
        Leben, Körper oder Gesundheit. Für einfache Fahrlässigkeit haftet der Betreiber nur bei Verletzung
        vertragswesentlicher Pflichten (Kardinalpflichten), begrenzt auf den vertragstypischen, vorhersehbaren Schaden.
      </p>

      <h2>6. Verfügbarkeit</h2>
      <p>
        Der Betreiber bemüht sich um eine hohe Verfügbarkeit des Dienstes, übernimmt jedoch keine Garantie für eine
        ununterbrochene Verfügbarkeit. Wartungsarbeiten können zu vorübergehenden Einschränkungen führen.
      </p>

      <h2>7. Datenverarbeitung</h2>
      <p>
        Die Verarbeitung personenbezogener Daten erfolgt gemäß der Datenschutzerklärung, die unter
        <a href="/datenschutz"> /datenschutz</a> abrufbar ist.
      </p>

      <h2>8. Laufzeit und Kündigung</h2>
      <p>
        Der Betreiber kann den Dienst oder einzelne Nutzerkonten jederzeit mit angemessener Frist kündigen oder sperren,
        insbesondere bei Verstoß gegen diese AGB. Der Nutzer kann sein Konto jederzeit über die entsprechende Funktion
        oder durch Kontaktaufnahme löschen.
      </p>

      <h2>9. Änderungen dieser AGB</h2>
      <p>
        Der Betreiber behält sich vor, diese AGB mit angemessener Frist zu ändern. Der Nutzer wird auf wesentliche
        Änderungen hingewiesen. Bei Fortsetzung der Nutzung gelten die geänderten AGB als angenommen.
      </p>

      <h2>10. Schlussbestimmungen</h2>
      <p>
        Es gilt das Recht der Bundesrepublik Deutschland. Sollten einzelne Bestimmungen dieser AGB unwirksam sein, bleibt
        die Wirksamkeit der übrigen Bestimmungen unberührt.
      </p>
    </LegalLayout>
  )
}
