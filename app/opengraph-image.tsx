import { ImageResponse } from 'next/og';

// Generated at request time by Next's built-in ImageResponse rather than
// shipping a static PNG — keeps the card in sync with the brand colors
// and needs no image tooling or external font fetch (system sans only,
// since a webfont here would be a network dependency on every render).
export const alt = 'Dukaan ERP — Apni Dukaan Digitalize Karein';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 90px',
          background: '#F7F2E7',
          color: '#1F2B24'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 40 }}>
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 20,
              background: '#1F2B24',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontWeight: 800,
              color: '#E0A32E'
            }}
          >
            {/* Plain latin only — Satori has no glyph for ₨ in the
                built-in font and its dynamic-font fetch fails at build
                time, which would render an empty tofu box on the card. */}
            Rs
          </div>
          <div style={{ fontSize: 52, fontWeight: 800, color: '#B8791A' }}>Dukaan ERP</div>
        </div>

        <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.15, maxWidth: 900 }}>
          Apni dukaan ka hisaab, phone par
        </div>

        <div style={{ fontSize: 30, color: '#6F6555', marginTop: 26, maxWidth: 880 }}>
          Khata · Inventory · Suppliers · Staff · Reports — sab ek jagah
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 46 }}>
          {['14 din free trial', 'Card ki zaroorat nahi', 'Urdu + English'].map(chip => (
            <div
              key={chip}
              style={{
                fontSize: 24,
                padding: '11px 24px',
                borderRadius: 999,
                background: '#FFFFFF',
                border: '1px solid #1F2B2422',
                color: '#4A4235'
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
