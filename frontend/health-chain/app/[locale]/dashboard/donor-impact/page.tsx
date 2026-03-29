import DonorImpactDashboard from "@/components/dashboard/DonorImpactDashboard";

// In a real app donorId comes from the session/auth context
export default function DonorImpactPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <DonorImpactDashboard donorId="DONOR_ID_FROM_SESSION" />
    </div>
  );
}
