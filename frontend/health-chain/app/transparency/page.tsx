import { Suspense } from 'react';
import { fetchPublicMetrics } from '../../lib/api/transparency.api';
import TransparencyDashboard from './TransparencyDashboard';

export const metadata = {
  title: 'Network Transparency | Health Chain',
  description:
    'Aggregate network impact metrics — fulfilled requests, donations, verified partners, and geographic coverage.',
};

export default async function TransparencyPage() {
  let metrics = null;
  let error: string | null = null;

  try {
    metrics = await fetchPublicMetrics();
  } catch {
    error = 'Metrics are temporarily unavailable. Please check back shortly.';
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="bg-brand-footer text-white py-12 px-6">
        <div className="max-w-5xl mx-auto">
          <h1 className="font-manrope font-bold text-3xl md:text-4xl mb-3">
            Network Transparency Portal
          </h1>
          <p className="font-roboto text-gray-300 text-base max-w-2xl">
            Aggregate impact data for the Health Chain network. All figures are
            derived from anonymised, non-personally-identifiable records. No
            patient, donor, or partner operational detail is exposed here.
          </p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700 font-roboto">
            {error}
          </div>
        ) : (
          <Suspense fallback={<LoadingSkeleton />}>
            <TransparencyDashboard metrics={metrics!} />
          </Suspense>
        )}

        <MethodologyNotes />
      </div>
    </main>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-28 rounded-xl bg-gray-100" />
      ))}
    </div>
  );
}

function MethodologyNotes() {
  return (
    <section className="mt-14 border-t pt-8">
      <h2 className="font-manrope font-bold text-xl text-brand-black mb-4">
        Methodology &amp; Data Notes
      </h2>
      <ul className="font-roboto text-sm text-gray-600 space-y-2 list-disc list-inside">
        <li>
          <strong>Fulfilled requests</strong> counts orders that reached{' '}
          <code>DELIVERED</code> status. Cancelled or disputed orders are
          excluded.
        </li>
        <li>
          <strong>Avg. response time</strong> is the mean elapsed time between
          order creation and delivery, rounded to one decimal place.
        </li>
        <li>
          <strong>Donations recorded</strong> is the total count of blood-unit
          entries in the inventory, regardless of current status.
        </li>
        <li>
          <strong>Verified partners</strong> are organisations whose
          registration was approved by a platform administrator.
        </li>
        <li>
          <strong>On-chain verified</strong> is the subset of approved
          organisations whose verification was also anchored to the Stellar
          Soroban registry contract.
        </li>
        <li>
          Geographic coverage groups organisations and fulfilled orders by city
          or country. Individual delivery addresses are never exposed.
        </li>
        <li>
          Data refreshes every 5 minutes. No personally identifiable
          information (names, emails, phone numbers, IDs) is included in any
          figure shown here.
        </li>
      </ul>
    </section>
  );
}
