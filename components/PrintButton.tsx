'use client';

export default function PrintButton({ label }: { label: string }) {
  return (
    <button onClick={() => window.print()} className="btn-secondary w-full">
      {label}
    </button>
  );
}
