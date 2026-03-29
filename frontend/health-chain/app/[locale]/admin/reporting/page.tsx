'use client';

import React from 'react';
import { FilterPanel } from '@/components/admin/reporting/FilterPanel';
import { SummaryCards } from '@/components/admin/reporting/SummaryCards';
import { ReportingTable } from '@/components/admin/reporting/ReportingTable';
import { useAuth } from '@/components/providers/auth-provider';
import { toast } from 'sonner';

export default function ReportingPage() {
  const [data, setData] = React.useState<any>(null);
  const [summary, setSummary] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const { user } = useAuth();

  const fetchSummary = async (filters: any) => {
    try {
      const queryParams = new URLSearchParams(filters).toString();
      const res = await fetch(`/api/reporting/summary?${queryParams}`);
      if (!res.ok) throw new Error('Failed to fetch summary');
      const json = await res.json();
      setSummary(json);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearch = async (filters: any) => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams(filters).toString();
      
      // Fetch both search results and updated summary
      const [searchRes, summaryRes] = await Promise.all([
        fetch(`/api/reporting/search?${queryParams}`),
        fetch(`/api/reporting/summary?${queryParams}`)
      ]);

      if (!searchRes.ok || !summaryRes.ok) throw new Error('Failed to fetch records');

      const [searchData, summaryData] = await Promise.all([
        searchRes.json(),
        summaryRes.json()
      ]);

      setData(searchData);
      setSummary(summaryData);
      toast.success('Search completed successfully');
    } catch (err: any) {
      toast.error(err.message || 'Error fetching reporting data');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (filters: any) => {
    try {
      const queryParams = new URLSearchParams(filters).toString();
      window.open(`/api/reporting/export?${queryParams}`, '_blank');
      toast.info('Export started. Check your downloads.');
    } catch (err) {
      toast.error('Failed to trigger export');
    }
  };

  // Initial fetch
  React.useEffect(() => {
    handleSearch({ domain: 'all' });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8 space-y-12">
      <div className="max-w-7xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
            Operations Reporting <span className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-sm font-semibold ml-2">Beta</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 max-w-2xl">
            Analyze records across donors, units, and orders with shared filters.
            Export reports for compliance and auditing.
          </p>
        </header>

        <SummaryCards data={summary} isLoading={loading} />

        <FilterPanel 
          onSearch={handleSearch} 
          onExport={() => handleExport(data?.filters || { domain: 'all' })} 
          isLoading={loading} 
        />

        <ReportingTable data={data} isLoading={loading} />
      </div>
    </div>
  );
}
