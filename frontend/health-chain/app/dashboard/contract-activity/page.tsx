import ContractActivityFeed from "@/components/blockchain/ContractActivityFeed";

export default function ContractActivityPage() {
  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-black">Contract Activity</h1>
        <p className="text-sm text-gray-500">
          Indexed Soroban contract events across identity, request, inventory, delivery, and payment contracts.
        </p>
      </div>
      <ContractActivityFeed />
    </div>
  );
}
