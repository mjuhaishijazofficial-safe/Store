'use client';

import { WhatsAppIcon } from '@/components/icons';
import { useLang } from '@/lib/i18n-context';

const SUPPORT_WHATSAPP = '923336687817';

export default function WhatsAppFloatingButton() {
  const { t } = useLang();

  function open() {
    const msg = t('landing.whatsappMsg');
    window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  return (
    <button
      onClick={open}
      aria-label={t('landing.whatsappBtn')}
      className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-dhania text-white flex items-center justify-center shadow-lg hover:brightness-110 transition"
    >
      <WhatsAppIcon className="w-7 h-7" />
    </button>
  );
}
