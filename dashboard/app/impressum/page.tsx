import type { Metadata } from "next"
import LegalLayout from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Impressum — Status Player Dashboard",
  description: "Impressum für das Status Player Dashboard",
}

export default function ImpressumPage() {
  return (
    <LegalLayout title="Impressum" updated="31. Juli 2026">
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        Status Player Dashboard
        <br />
        [Dein vollständiger Name]
        <br />
        [Straße und Hausnummer]
        <br />
        [Postleitzahl und Ort]
        <br />
        Deutschland
      </p>

      <h2>Kontakt</h2>
      <p>
        Telefon: [Deine Telefonnummer]
        <br />
        E-Mail: [Deine E-Mail-Adresse]
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>
        [Dein vollständiger Name]
        <br />
        [Straße und Hausnummer]
        <br />
        [Postleitzahl und Ort]
      </p>

      <h2>Hinweis auf EU-Streitschlichtung</h2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
        <a href="https://ec.europa.eu/consumers/odr/"> https://ec.europa.eu/consumers/odr/</a>. Wir sind nicht
        bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
        teilzunehmen.
      </p>

      <h2>Haftung für Inhalte</h2>
      <p>
        Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen
        Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet,
        übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf
        eine rechtswidrige Tätigkeit hinweisen.
      </p>

      <h2>Haftung für Links</h2>
      <p>
        Unser Angebot enthält gegebenenfalls Links zu externen Websites Dritter, auf deren Inhalte wir keinen
        Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte
        der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
      </p>

      <h2>Urheberrecht</h2>
      <p>
        Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen
        Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der
        Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
      </p>
    </LegalLayout>
  )
}
