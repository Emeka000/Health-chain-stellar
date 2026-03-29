import LiveOpsCenter from "@/components/dashboard/LiveOpsCenter";

export default function LiveOpsPage() {
  return (
    <div className="p-6 h-[calc(100vh-80px)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-black">Live Operations Center</h1>
        <p className="text-sm text-gray-500">Real-time rider positions, open requests, and incident updates.</p>
      </div>
      <div className="flex-1">
        <LiveOpsCenter />
      </div>
    </div>
  );
}
