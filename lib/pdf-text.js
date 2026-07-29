// pdf-parse extracts text based on the PDF's internal glyph-positioning data,
// not visual word boundaries — many PDFs (Luxair e-tickets among them) end up
// with runs like "MicuTeodoraMrs" and "14Aug2026" with no space at all where
// a human reader would see clear word breaks. Left alone, this is a real risk
// for the AI actually reading the date correctly, worse in a large prompt
// with many competing emails. Re-insert spaces at the boundaries pdf-parse
// drops: lowercase→uppercase ("TeodoraMrs" → "Teodora Mrs") and
// digit↔letter ("14Aug2026" → "14 Aug 2026").
export function cleanPdfText(rawText) {
  return (rawText || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
}
