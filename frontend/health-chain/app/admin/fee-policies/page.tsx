'use client';

export default function FeePoliciesPage() {
    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Fee Policies</h1>
                <p className="text-gray-600">Manage delivery, platform, and performance fee rules.</p>
            </div>
            <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b">
                    <h2 className="text-xl font-semibold">Add New Policy</h2>
                    {/* Form placeholder */}
                    <div className="mt-4 p-4 bg-gray-50 rounded">
                        <p>Form for geography, urgency, distance, rates (integrate API POST /fee-policy)</p>
                    </div>
                </div>
                <div className="p-6">
                    <h3 className="text-lg font-medium mb-4">Active Policies</h3>
                    {/* Table placeholder */}
                    <div className="grid gap-4 text-sm">
                        <div className="grid grid-cols-12 font-medium border-b pb-2">
                            <span>Geography</span>
                            <span>Urgency</span>
                            <span>Distance</span>
                            <span>Service</span>
                            <span>Rates</span>
                            <span>Effective</span>
                            <span>Actions</span>
                        </div>
                        <div className="grid grid-cols-12">
                            <span>LAG</span>
                            <span>Emergency</span>
                            <span>0-10km</span>
                            <span>Premium</span>
                            <span>5% + $2</span>
                            <span>Now</span>
                            <span>Edit/Delete</span>
                        </div>
                    </div>
                    <p className="mt-4 text-gray-500 text-xs">Fetch from /fee-policy API</p>
                </div>
            </div>
        </div>
    );
}

