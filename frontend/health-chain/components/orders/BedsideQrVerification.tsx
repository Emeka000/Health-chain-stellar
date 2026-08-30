"use client";
import { useState } from "react";
import { ScanLine, CheckCircle2, XCircle } from "lucide-react";
import { verifyQr, fetchVerificationHistory, type QrVerificationLog } from "@/lib/api/qrVerification.api";

interface Props {
  orderId: string;
  scannedBy: string;
}

export default function BedsideQrVerification({ orderId, scannedBy }: Props) {
  const [qrInput, setQrInput] = useState("");
  const [result, setResult] = useState<{ verified: boolean; unitNumber: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QrVerificationLog[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [scanning, setScanning] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanning(true);
    setResult(null);
    setError(null);
    try {
      const res = await verifyQr({ qrPayload: qrInput, orderId, scannedBy });
      if (res.verified) {
        setResult(res);
      } else {
        setError(`Unit mismatch — ${res.unitNumber} does not match this order.`);
      }
    } catch (err: any) {
      setError(err?.message ?? "Verification failed — unit does not match order.");
    } finally {
      setScanning(false);
    }
  };

  const loadHistory = async () => {
    const logs = await fetchVerificationHistory(orderId);
    setHistory(logs);
    setShowHistory(true);
  };

  return (
    <div className="space-y-5 font-poppins max-w-lg">
      <div>
        <h3 className="text-lg font-bold text-black flex items-center gap-2">
          <ScanLine className="w-5 h-5 text-[#D32F2F]" /> Bedside QR Verification
        </h3>
        <p className="text-sm text-gray-500">Scan or paste the QR payload to confirm unit identity before delivery completion.</p>
      </div>

      <form onSubmit={handleVerify} className="space-y-3">
        <textarea
          required
          rows={3}
          placeholder='Paste QR payload JSON, e.g. {"unitNumber":"BU-001","bloodType":"O+","bankId":"..."}'
          className="w-full border rounded-xl px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#D32F2F]"
          value={qrInput}
          onChange={(e) => setQrInput(e.target.value)}
        />
        <button
          type="submit"
          disabled={scanning}
          className="w-full bg-[#D32F2F] text-white font-medium py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 text-sm"
        >
          {scanning ? "Verifying…" : "Verify Unit"}
        </button>
      </form>

      {result && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">Unit Verified</p>
            <p className="text-sm text-green-700">Unit <span className="font-mono">{result.unitNumber}</span> matches this order.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <XCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-800">Verification Failed</p>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      <button onClick={loadHistory} className="text-sm text-gray-500 underline hover:text-gray-700">
        View verification history
      </button>

      {showHistory && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                {["Unit", "Result", "Scanned At"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400">No scans recorded.</td></tr>
              ) : history.map((log) => (
                <tr key={log.id}>
                  <td className="px-3 py-2 font-mono">{log.unitNumber}</td>
                  <td className="px-3 py-2">
                    <span className={`font-medium ${log.result === "MATCH" ? "text-green-600" : "text-red-600"}`}>
                      {log.result}
                    </span>
                    {log.failureReason && <p className="text-gray-400">{log.failureReason}</p>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{new Date(log.scannedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
