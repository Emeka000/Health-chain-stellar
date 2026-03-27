'use client';

interface FeeBreakdown {
    deliveryFee: number;
    platformFee: number;
    performanceFee: number;
    fixedFee: number;
    totalFee: number;
    baseAmount: number;
    appliedPolicyId: string;
    auditHash: string;
}

interface FeePreviewProps {
    breakdown: FeeBreakdown | null;
    loading: boolean;
}

export function FeePreview({ breakdown, loading }: FeePreviewProps) {
    if (loading || !breakdown) {
        return <div className="p-4 border rounded-lg bg-gray-50">Calculating fees...</div>;
    }

    return (
        <div className="p-4 border rounded-lg bg-white shadow-sm">
            <h3 className="font-semibold text-lg mb-4">Fee Breakdown</h3>
            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span>Base Amount</span>
                    <span>${breakdown.baseAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Delivery Fee</span>
                    <span>${breakdown.deliveryFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Platform Fee</span>
                    <span>${breakdown.platformFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Performance Fee</span>
                    <span>${breakdown.performanceFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Fixed Fee</span>
                    <span>${breakdown.fixedFee.toFixed(2)}</span>
                </div>
                <div className="border-t pt-2 font-bold flex justify-between">
                    <span>Total Fee</span>
                    <span>${breakdown.totalFee.toFixed(2)}</span>
                </div>
            </div>
            <div className="mt-3 text-xs text-gray-500">
                Policy: {breakdown.appliedPolicyId.slice(0, 8)}... | Audit: {breakdown.auditHash.slice(0, 8)}...
            </div>
        </div>
    );
}

