import Link from 'next/link';
import LanguageToggle from '@/components/LanguageToggle';
import { getServerT } from '@/lib/i18n-server';

export default async function Home() {
  const t = await getServerT();

  return (
    <main className="max-w-5xl mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-20 gap-3">
        <div className="font-display text-2xl font-800 text-haldi">Dukaan ERP</div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <Link href="/login" className="btn-secondary text-sm">{t('landing.login')}</Link>
          <Link href="/signup" className="btn-primary text-sm">{t('landing.freeTrialNav')}</Link>
        </div>
      </div>

      <section className="text-center mb-20">
        <h1 className="font-display text-5xl font-800 leading-tight mb-6">
          {t('landing.heroLine1')} <span className="text-haldi">{t('landing.heroLine1Highlight')}</span><br />{t('landing.heroLine2')}
        </h1>
        <p className="text-chalkdim text-lg max-w-xl mx-auto mb-8">
          {t('landing.heroBody')}
        </p>
        <Link href="/signup" className="btn-primary text-base inline-block">{t('landing.heroCta')}</Link>
      </section>

      <section className="grid md:grid-cols-3 gap-6 mb-20">
        {[
          { title: t('landing.feature1Title'), body: t('landing.feature1Body') },
          { title: t('landing.feature2Title'), body: t('landing.feature2Body') },
          { title: t('landing.feature3Title'), body: t('landing.feature3Body') }
        ].map(f => (
          <div key={f.title} className="card p-6">
            <div className="font-display text-lg font-700 text-haldi mb-2">{f.title}</div>
            <div className="text-chalkdim text-sm">{f.body}</div>
          </div>
        ))}
      </section>

      <section className="card p-10 text-center max-w-md mx-auto">
        <div className="font-display text-xl font-700 mb-2">{t('landing.pricingTitle')}</div>
        <div className="font-mono text-4xl font-700 text-haldi mb-1">₨999<span className="text-base text-chalkdim">{t('landing.pricingSuffix')}</span></div>
        <div className="text-chalkdim text-sm mb-6">{t('landing.pricingBody')}</div>
        <Link href="/signup" className="btn-primary block">{t('landing.freeTrialNav')}</Link>
      </section>
    </main>
  );
}
