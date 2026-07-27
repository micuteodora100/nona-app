import MarketingLayout from "../components/MarketingLayout"

export default function Terms() {
  return (
    <MarketingLayout
      title="Terms of Service"
      description="The terms for using Nona."
    >
      <section className="block" style={{ borderTop: "none", paddingTop: "48px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "10px" }}>Terms of Service</h1>
        <p className="lead">Last updated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.</p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>The short version</h2>
        <p className="body-text">
          Nona is an MVP, built and maintained by a solo founder, provided as-is and
          without warranty while it's in active development. By using it, you agree to
          the terms below.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Using the service</h2>
        <p className="body-text">
          You're responsible for the accuracy of what you enter and for keeping your
          account credentials secure. Don't use Nona for anything unlawful, or in a way
          that disrupts the service for others.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Third-party connections</h2>
        <p className="body-text">
          Connecting Gmail or Outlook is optional and read-only, governed by Google's and
          Microsoft's own terms in addition to these. You can disconnect at any time.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>No warranty</h2>
        <p className="body-text">
          Nona is provided "as is." As an MVP under active development, features can
          change, break, or be temporarily unavailable. Don't rely on it as the sole
          record of anything time-sensitive or critical.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Limitation of liability</h2>
        <p className="body-text">
          To the fullest extent permitted by law, Nona and its founder aren't liable for
          indirect, incidental, or consequential damages arising from use of the service.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Changes</h2>
        <p className="body-text">
          These terms may be updated as the product evolves. Continued use after a change
          means you accept the updated terms.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Contact</h2>
        <p className="body-text">
          Questions about these terms? Reach out via the{" "}
          <a href="/contact" style={{ color: "var(--coral)", fontWeight: 600 }}>contact page</a>.
        </p>
      </section>
    </MarketingLayout>
  )
}
