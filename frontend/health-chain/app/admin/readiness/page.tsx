import ReadinessDashboard from "@/components/onboarding/ReadinessDashboard";

export default function ReadinessPage() {
  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-black">Operational Readiness</h1>
        <p className="text-sm text-gray-500">
          Track partner and region readiness checklists before activation into live operations.
        </p>
      </div>
      <ReadinessDashboard />
    </div>
  );
}
