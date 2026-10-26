import type { Metadata } from "next"
import LegalLayout from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Nutzungsbedingungen — Status Player Dashboard",
  description: "Nutzungsbedingungen für das Status Player Dashboard",
}

export default function NutzungsbedingungenPage() {
  return (
    <LegalLayout title="Nutzungsbedingungen" updated="31. Juli 2026">
      <h2>1. Zweck des Dienstes</h2>
      <p>
        Der Dienst von Status Player stellt eine Verbindung zwischen einem Minecraft-Server und einem webbasierten Dashboard
        her. Er ermöglicht die Verwaltung von Statusanzeigen, Spielerinformationen und Shop-Funktionen. Die folgenden
        Bedingungen regeln die Nutzung des Dienstes durch Serverbetreiber und Nutzer.
      </p>

      <h2>2. Voraussetzungen für die Nutzung</h2>
      <ul>
        <li>Du musst mindestens 18 Jahre alt oder mit Einwilligung deiner gesetzlichen Vertreter handlungsfähig sein.</li>
        <li>Du benötigst einen Minecraft-Server, auf dem der Status Player Mod installiert ist.</li>
        <li>Du musst berechtigt sein, den jeweiligen Server zu verwalten.</li>
      </ul>

      <h2>3. Zulässige Nutzung</h2>
      <ul>
        <li>Nutzung des Dienstes für die Verwaltung deines eigenen Minecraft-Servers.</li>
        <li>Einrichtung von Shop-Produkten und Statusanzeigen gemäß der bereitgestellten Funktionen.</li>
      </ul>

      <h2>4. Verbotene Nutzung</h2>
      <ul>
        <li>Missbrauch, Überlastung oder Beeinträchtigung des Dienstes oder seiner Infrastruktur.</li>
        <li>Versuch, auf Konten Dritter oder nicht autorisierte Systeme zuzugreifen.</li>
        <li>Verbreitung von Inhalten, die gegen Gesetze, Rechte Dritter oder die guten Sitten verstoßen.</li>
        <li>Weitergabe oder Verkauf eigener Zugangsdaten an Dritte.</li>
        <li>Umgehung von Zugriffsbeschränkungen oder Sicherheitsmaßnahmen.</li>
      </ul>

      <h2>5. Konto-Sicherheit</h2>
      <p>
        Du bist für die Sicherheit deines Kontos verantwortlich. Gib Zugangsdaten niemals weiter und verwende sichere
        Geräte für den Zugriff. Bei Verdacht auf unbefugte Nutzung informiere uns umgehend über die im Impressum
        angegebenen Kontaktdaten.
      </p>

      <h2>6. Verfügbarkeit und Änderungen</h2>
      <p>
        Wir bemühen uns um eine dauerhafte Verfügbarkeit, garantieren diese jedoch nicht. Funktionen des Dienstes
        können sich im Laufe der Zeit ändern oder entfallen. Wir informieren nach Möglichkeit im Voraus über
        wesentliche Änderungen.
      </p>

      <h2>7. Gewährleistung und Haftung</h2>
      <p>
        Der Dienst wird mit angemessener Sorgfalt bereitgestellt. Für weitergehende Ansprüche gilt § 5 der
        <a href="/agb"> AGB</a>. Eine Haftung für mittelbare Schäden, entgangenen Gewinn oder Datenverlust besteht
        nur bei Vorsatz oder grober Fahrlässigkeit.
      </p>

      <h2>8. Datenschutz</h2>
      <p>
        Informationen zur Verarbeitung deiner Daten findest du in unserer
        <a href="/datenschutz"> Datenschutzerklärung</a>.
      </p>

      <h2>9. Rechte von Dritten</h2>
      <p>
        Minecraft ist eine Marke von Mojang Synergies AB. Der Dienst von Status Player ist ein unabhängiges Projekt und steht
        in keiner Verbindung zu Mojang oder Microsoft und wird von diesen nicht unterstützt.
      </p>

      <h2>10. Änderungen und Kontakt</h2>
      <p>
        Diese Nutzungsbedingungen können von Zeit zu Zeit angepasst werden. Die jeweils aktuelle Fassung ist unter
        dieser Adresse abrufbar. Bei Fragen wende dich an die im Impressum genannten Kontaktmöglichkeiten.
      </p>
    </LegalLayout>
  )
}
