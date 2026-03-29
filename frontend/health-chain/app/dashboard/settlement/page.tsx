export default function SettlementIndexPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Settlement Review</h1>
      <p className="text-gray-500 text-sm">
        Navigate to{" "}
        <code className="bg-gray-100 px-1 rounded text-xs">/dashboard/settlement/[paymentId]</code>{" "}
        to review proof bundles and release escrow for a specific payment.
      </p>
    </div>
  );
}
