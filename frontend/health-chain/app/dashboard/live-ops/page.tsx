import dynamic from "next/dynamic";

const LiveOpsCenter = dynamic(() => import("@/components/dashboard/LiveOpsCenter"), {
  ssr: false,
  loading: () => <div className="flex-1 h-96 bg-gray-100 rounded-2xl animate-pulse" />,
});

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
