import { NextResponse } from 'next/server';

// Best-effort barcode -> product name lookup via Open Food Facts (free,
// no API key). Barcodes only encode an ID number, never a name or price
// — this is the only way to guess a name for an unrecognized barcode,
// and it only works when the product is in their database. Coverage
// skews toward branded packaged food/drink (Coca-Cola, Lays, Nestlé —
// common in a kiryana store); it has essentially nothing for loose/
// unbranded local products. Price is never returned by any such
// database — that's always the shopkeeper's own to set.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const barcode = searchParams.get('barcode');
  if (!barcode) return NextResponse.json({ found: false }, { status: 400 });

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
      headers: { 'User-Agent': 'DukaanERP/1.0 (kiryana shop inventory app)' }
    });
    const data = await res.json();

    if (data.status === 1 && data.product) {
      const name = data.product.product_name || data.product.product_name_en || null;
      const category = (data.product.categories || '').split(',')[0]?.trim() || null;
      if (name) {
        return NextResponse.json({ found: true, name, category });
      }
    }
  } catch {
    // best-effort — fall through to "not found" below
  }

  return NextResponse.json({ found: false });
}
