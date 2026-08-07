'use client';

export default function ShareWhatsAppButton({ text, label }: { text: string; label: string }) {
  function share() {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  return (
    <button onClick={share} className="btn-secondary w-full">
      {label}
    </button>
  );
}
