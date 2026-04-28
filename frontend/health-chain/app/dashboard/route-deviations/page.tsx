import RouteDeviationPanel from "@/components/dispatch/RouteDeviationPanel";

export default function RouteDeviationsPage() {
  return (
    <div className="p-6 h-[calc(100vh-80px)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-black">Route Deviation Monitoring</h1>
        <p className="text-sm text-gray-500">
          Live alerts when riders deviate from planned delivery corridors.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <RouteDeviationPanel />
      </div>
    </div>
  );
}
