import Link from 'next/link';
import LanguageToggle from '@/components/LanguageToggle';
import ThemeToggle from '@/components/ThemeToggle';
import WhatsAppFloatingButton from '@/components/WhatsAppFloatingButton';
import { StoreIcon, WalletIcon, TrendDownIcon, CashIcon, WhatsAppIcon } from '@/components/icons';
import { getServerT } from '@/lib/i18n-server';
import { SUPPORT_WHATSAPP_NUMBER } from '@/lib/constants';
import { SITE_NAME, SITE_URL } from '@/lib/seo';

export default async function Home() {
  const t = await getServerT();

  const features = [
    { title: t('landing.feature1Title'), body: t('landing.feature1Body') },
    { title: t('landing.feature2Title'), body: t('landing.feature2Body') },
    { title: t('landing.feature3Title'), body: t('landing.feature3Body') },
    { title: t('landing.feature4Title'), body: t('landing.feature4Body') },
    { title: t('landing.feature5Title'), body: t('landing.feature5Body') },
    { title: t('landing.feature6Title'), body: t('landing.feature6Body') }
  ];

  const trust = [
    { title: t('landing.trust1Title'), body: t('landing.trust1Body') },
    { title: t('landing.trust2Title'), body: t('landing.trust2Body') },
    { title: t('landing.trust3Title'), body: t('landing.trust3Body') }
  ];

  const faqs = [
    { q: t('landing.faq1Q'), a: t('landing.faq1A') },
    { q: t('landing.faq2Q'), a: t('landing.faq2A') },
    { q: t('landing.faq3Q'), a: t('landing.faq3A') },
    { q: t('landing.faq4Q'), a: t('landing.faq4A') },
    { q: t('landing.faq5Q'), a: t('landing.faq5A') },
    { q: t('landing.faq6Q'), a: t('landing.faq6A') }
  ];

  // Structured data. The FAQPage block is the one with a visible payoff:
  // Google can render these questions as an expandable block under the
  // result. Both are built from the same t() calls the page renders, so
  // the markup can never describe something different from the page —
  // which is exactly what gets structured data penalised.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#app`,
        name: SITE_NAME,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, Android, iOS',
        url: SITE_URL,
        inLanguage: ['ur', 'en'],
        description: t('landing.heroBody'),
        offers: {
          '@type': 'Offer',
          price: '999',
          priceCurrency: 'PKR',
          category: 'subscription',
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/signup`
        },
        featureList: features.map(f => f.title),
        audience: { '@type': 'Audience', audienceType: 'Kiryana and general store owners in Pakistan' }
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        mainEntity: faqs.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a }
        }))
      }
    ]
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="max-w-[1440px] mx-auto px-6 sm:px-10 lg:px-16 py-16">
        {/* Logo + toggles + Login + Signup used to sit in one unwrapped
            flex row — fine down to ~420px, but a narrow phone (375px
            and below) had nowhere for the last item (Login) to go and
            it ran straight off the right edge instead of wrapping. The
            "Free Trial" button (already the hero's own big CTA right
            below) hides below sm to declutter first; flex-wrap is the
            safety net if even that doesn't leave enough room. */}
        <div className="flex items-center justify-between mb-16 gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-haldi/15 text-haldi flex items-center justify-center shrink-0">
              <StoreIcon className="w-5 h-5" />
            </div>
            <div className="font-display text-xl font-800 text-haldi truncate">Dukaan ERP</div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            <LanguageToggle />
            <Link href="/login" className="btn-secondary text-sm whitespace-nowrap">{t('landing.login')}</Link>
            <Link href="/signup" className="btn-primary text-sm whitespace-nowrap hidden sm:inline-block">{t('landing.freeTrialNav')}</Link>
          </div>
        </div>

        {/* Hero + product preview, side by side on desktop — text takes
            the left column and gets to breathe at this container width
            instead of squeezing into a centered narrow column with the
            preview stacked underneath. Mobile/tablet keep the original
            centered single-column stack (order-first via source order,
            no lg: prefix needed there). */}
        <section className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center mb-20">
          <div className="text-center lg:text-left">
            <div className="inline-block bg-haldi/10 text-haldi text-xs font-600 px-3 py-1.5 rounded-full mb-6 max-w-md">
              {t('landing.usp')}
            </div>
            <h1 className="font-display text-5xl font-800 leading-tight mb-6">
              {t('landing.heroLine1')} <span className="text-haldi">{t('landing.heroLine1Highlight')}</span><br />{t('landing.heroLine2')}
            </h1>
            <p className="text-chalkdim text-lg max-w-xl mx-auto lg:mx-0 mb-8">
              {t('landing.heroBody')}
            </p>
            <Link href="/signup" className="btn-primary text-base inline-block">{t('landing.heroCta')}</Link>
          </div>

          {/* Product preview — an illustration built from the app's own
              design tokens, not a claimed screenshot, since sample data
              shouldn't be presented as if it were a real shop's data. */}
          <div className="mt-16 lg:mt-0">
            <div className="text-center lg:text-left text-xs text-chalkdim uppercase tracking-wide mb-3">{t('landing.previewLabel')}</div>
            <div className="card p-2 max-w-xl lg:max-w-none mx-auto overflow-hidden">
              <div className="bg-board3 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-md bg-haldi/20 text-haldi flex items-center justify-center">
                    <StoreIcon className="w-4 h-4" />
                  </div>
                  <div className="font-display font-700 text-sm">Meri Dukaan</div>
                </div>
                {/* Fixed 3 columns (not md:grid-cols-3 — this mockup is
                    meant to read as a phone screen at any viewport, not
                    reflow) — text sizes step down on the narrowest
                    phones so ₨50,000 etc. never gets tight enough to
                    wrap inside its own card. */}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
                  <div className="card p-2 sm:p-3">
                    <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-haldi/15 text-haldi flex items-center justify-center mb-1.5 sm:mb-2">
                      <WalletIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div className="text-[9px] sm:text-[10px] text-chalkdim uppercase tracking-wide truncate">{t('overview.totalBudget')}</div>
                    <div className="font-mono font-700 text-xs sm:text-sm">₨50,000</div>
                  </div>
                  <div className="card p-2 sm:p-3">
                    <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-mirch/15 text-mirch flex items-center justify-center mb-1.5 sm:mb-2">
                      <TrendDownIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div className="text-[9px] sm:text-[10px] text-chalkdim uppercase tracking-wide truncate">{t('overview.spent')}</div>
                    <div className="font-mono font-700 text-xs sm:text-sm text-mirch">₨18,400</div>
                  </div>
                  <div className="card p-2 sm:p-3">
                    <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-dhania/15 text-dhania flex items-center justify-center mb-1.5 sm:mb-2">
                      <CashIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div className="text-[9px] sm:text-[10px] text-chalkdim uppercase tracking-wide truncate">{t('overview.remaining')}</div>
                    <div className="font-mono font-700 text-xs sm:text-sm text-dhania">₨31,600</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-center lg:text-left text-[11px] text-chalkdim mt-2">{t('landing.previewNote')}</div>
          </div>
        </section>

        {/* Features */}
        <section className="grid md:grid-cols-3 gap-8 mb-20">
          {features.map(f => (
            <div key={f.title} className="card p-6">
              <div className="font-display text-lg font-700 text-haldi mb-2">{f.title}</div>
              <div className="text-chalkdim text-sm">{f.body}</div>
            </div>
          ))}
        </section>

        {/* Trust — a full-bleed band (negative margin cancels this
            page's own container padding, so the tinted background runs
            edge to edge) to break the visual rhythm of card-on-page
            sections repeating one after another. */}
        <section className="-mx-6 sm:-mx-10 lg:-mx-16 px-6 sm:px-10 lg:px-16 py-16 bg-board3 mb-20">
          <div className="max-w-[1440px] mx-auto">
            <h2 className="font-display text-2xl font-800 text-center mb-8">{t('landing.trustTitle')}</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {trust.map(item => (
                <div key={item.title} className="text-center">
                  <div className="font-display text-base font-700 text-haldi mb-1">{item.title}</div>
                  <div className="text-chalkdim text-sm">{item.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="card p-10 text-center max-w-md mx-auto mb-20">
          <div className="font-display text-xl font-700 mb-2">{t('landing.pricingTitle')}</div>
          <div className="font-mono text-4xl font-700 text-haldi mb-1">₨999<span className="text-base text-chalkdim">{t('landing.pricingSuffix')}</span></div>
          <div className="text-chalkdim text-sm mb-6">{t('landing.pricingBody')}</div>
          <Link href="/signup" className="btn-primary block">{t('landing.freeTrialNav')}</Link>
        </section>

        {/* FAQ */}
        <section className="max-w-2xl mx-auto mb-20">
          <h2 className="font-display text-2xl font-800 text-center mb-8">{t('landing.faqTitle')}</h2>
          <div className="space-y-3">
            {faqs.map(f => (
              <details key={f.q} className="card p-4 group">
                <summary className="font-600 cursor-pointer list-none flex items-center justify-between">
                  {f.q}
                  <span className="text-haldi text-lg leading-none group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="text-chalkdim text-sm mt-3">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Support */}
        <section className="card p-8 text-center max-w-md mx-auto mb-16">
          <div className="font-display text-lg font-700 mb-1">{t('landing.supportTitle')}</div>
          <div className="text-chalkdim text-sm mb-5">{t('landing.supportBody')}</div>
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(t('landing.whatsappMsg'))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-dhania text-white font-700 rounded-lg px-5 py-2.5 hover:brightness-110 transition"
          >
            <WhatsAppIcon className="w-5 h-5" />
            {t('landing.whatsappBtn')}
          </a>
        </section>

        {/* Footer */}
        <footer className="border-t border-chalk/10 pt-8 text-center text-chalkdim text-xs">
          <div className="flex items-center justify-center gap-4 mb-3">
            <Link href="/terms" className="hover:text-haldi">{t('landing.footerTerms')}</Link>
            <Link href="/privacy" className="hover:text-haldi">{t('landing.footerPrivacy')}</Link>
          </div>
          <div>© {new Date().getFullYear()} Dukaan ERP — {t('landing.footerRights')}</div>
        </footer>
      </main>

      <WhatsAppFloatingButton />
    </>
  );
}
