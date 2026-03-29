import EmergencyOperationsPanel from '@/components/dashboard/EmergencyOperationsPanel';

export const metadata = { title: 'Emergency Operations' };

export default function EmergencyPage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <EmergencyOperationsPanel />
    </div>
  );
}
