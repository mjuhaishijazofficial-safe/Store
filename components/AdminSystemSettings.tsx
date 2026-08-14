'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminSystemSettings({
  defaultTrialDays,
  maintenanceMode,
  featureFlags
}: {
  defaultTrialDays: number;
  maintenanceMode: boolean;
  featureFlags: Record<string, boolean>;
}) {
  const router = useRouter();
  const [trialDays, setTrialDays] = useState(defaultTrialDays);
  const [maintenance, setMaintenance] = useState(maintenanceMode);
  const [smartReorder, setSmartReorder] = useState(featureFlags?.smart_reorder ?? true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    const res = await fetch('/api/admin/settings/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultTrialDays: trialDays,
        maintenanceMode: maintenance,
        featureFlags: { ...featureFlags, smart_reorder: smartReorder }
      })
    });
    setSaving(false);
    if (res.ok) { setSaved(true); router.refresh(); }
  }

  return (
    <div className="space-y-4 max-w-sm">
      <div className="card p-5">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">Default Trial Length</div>
        <p className="text-[11px] text-chalkdim mb-3">Naye signup ka trial kitne din ka ho — abhi turant lagu hota hai, koi redeploy nahi chahiye.</p>
        <input type="number" min={1} max={90} className="input" value={trialDays} onChange={e => setTrialDays(Number(e.target.value))} />
      </div>

      <div className="card p-5">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">Feature Flags</div>
        <p className="text-[11px] text-chalkdim mb-3">Poore platform ke liye ek feature ko on/off karein (jaise rollout ke dauran).</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={smartReorder} onChange={e => setSmartReorder(e.target.checked)} />
          <span>Smart Reorder</span>
        </label>
      </div>

      <div className="card p-5 border-mirch/40">
        <div className="text-xs text-mirch uppercase tracking-wide mb-1">Maintenance Mode</div>
        <p className="text-[11px] text-chalkdim mb-3">On karne se har (non-admin) dukaan ke liye app view-only ho jayegi, ek maintenance banner ke sath — data safe rehta hai, koi naya likhna rukta hai.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={maintenance} onChange={e => setMaintenance(e.target.checked)} />
          <span className="font-700 text-mirch">Maintenance Mode ON karein</span>
        </label>
      </div>

      <button onClick={save} disabled={saving} className="btn-primary w-full">{saving ? 'Saving...' : 'Save Settings'}</button>
      {saved && <div className="text-dhania text-xs text-center">Saved ✓</div>}
    </div>
  );
}
