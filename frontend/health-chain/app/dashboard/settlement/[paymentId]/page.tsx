import { SettlementReview } from "@/components/payments/SettlementReview";
import { fetchBundlesByPayment } from "@/lib/api/proof-bundle.api";

interface Props {
  params: { paymentId: string };
}

export default async function SettlementReviewPage({ params }: Props) {
  const bundles = await fetchBundlesByPayment(params.paymentId).catch(() => []);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <SettlementReview
        paymentId={params.paymentId}
        bundles={bundles}
      />
    </div>
  );
}
