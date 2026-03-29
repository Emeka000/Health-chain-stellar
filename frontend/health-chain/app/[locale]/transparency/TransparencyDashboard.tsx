'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

import type { PublicMetrics } from '../../lib/api/transparency.api';

const BLOOD_TYPE_COLORS: Record<string, string> = {
  'A+': '#B32346',
  'A-': '#c0394f',
  'B+': '#8b1a2e',
  'B-': '#a02535',
  'AB+': '#6a0b37',
  'AB-': '#7d1040',
  'O+': '#d94f6a',
  'O-': '#e8738a',
};

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-card p-5 flex flex-col gap-1">
      <span className="font-roboto text-xs text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      <span className="font-manrope font-bold text-3xl text-brand-black">
        {value}
      </span>
      {sub && (
        <span className="font-roboto text-xs text-gray-400">{sub}</span>
      )}
    </div>
  );
}

export default function TransparencyDashboard({
  metrics,
}: {
  metrics: PublicMetrics;
}) {
  const bloodTypeData = Object.entries(metrics.bloodTypeBreakdown).map(
    ([type, count]) => ({ type, count }),
  );

  const regionData = metrics.geographicCoverage.slice(0, 8);

  const generatedAt = new Date(metrics.generatedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-10">
      <p className="font-roboto text-xs text-gray-400">
        Last updated: {generatedAt}
      </p>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Fulfilled Requests"
          value={metrics.fulfilledRequests.toLocaleString()}
          sub="Delivered orders"
        />
        <StatCard
          label="Avg. Response Time"
          value={
            metrics.avgResponseTimeHours !== null
              ? `${metrics.avgResponseTimeHours}h`
              : '—'
          }
          sub="Creation → delivery"
        />
        <StatCard
          label="Donations Recorded"
          value={metrics.totalDonationsRecorded.toLocaleString()}
          sub="Blood units in inventory"
        />
        <StatCard
          label="Verified Partners"
          value={metrics.verifiedPartners.toLocaleString()}
          sub={`${metrics.onChainVerifiedOrgs} on-chain anchored`}
        />
      </div>

      {/* ── Blood Type Breakdown ── */}
      {bloodTypeData.length > 0 && (
        <section>
          <h2 className="font-manrope font-bold text-lg text-brand-black mb-4">
            Fulfilled Requests by Blood Type
          </h2>
          <div className="rounded-xl border border-gray-100 bg-white shadow-card p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bloodTypeData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis
                  dataKey="type"
                  tick={{ fontFamily: 'var(--font-roboto)', fontSize: 12 }}
                />
                <YAxis
                  tick={{ fontFamily: 'var(--font-roboto)', fontSize: 12 }}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(v: number) => [v.toLocaleString(), 'Fulfilled']}
                  contentStyle={{ fontFamily: 'var(--font-roboto)', fontSize: 12 }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {bloodTypeData.map((entry) => (
                    <Cell
                      key={entry.type}
                      fill={BLOOD_TYPE_COLORS[entry.type] ?? '#B32346'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── Geographic Coverage ── */}
      {regionData.length > 0 && (
        <section>
          <h2 className="font-manrope font-bold text-lg text-brand-black mb-4">
            Geographic Coverage
          </h2>
          <div className="rounded-xl border border-gray-100 bg-white shadow-card overflow-hidden">
            <table className="w-full text-sm font-roboto">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
                <tr>
                  <th className="text-left px-5 py-3">Region</th>
                  <th className="text-right px-5 py-3">Fulfilled Requests</th>
                  <th className="text-right px-5 py-3">Verified Partners</th>
                </tr>
              </thead>
              <tbody>
                {regionData.map((row, i) => (
                  <tr
                    key={row.region}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="px-5 py-3 text-brand-black font-medium">
                      {row.region}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {row.fulfilledRequests.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {row.verifiedPartners.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── On-chain Verification Note ── */}
      {metrics.onChainVerifiedOrgs > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 font-roboto text-sm text-gray-600">
          <strong className="text-brand-black">On-chain verification:</strong>{' '}
          {metrics.onChainVerifiedOrgs} of {metrics.verifiedPartners} verified
          partners have their approval anchored to the Stellar Soroban registry
          contract. You can cross-check any organisation by querying the
          contract directly on the Stellar network.
        </div>
      )}
    </div>
  );
}
