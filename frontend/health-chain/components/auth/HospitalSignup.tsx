import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface HospitalSignupProps {
  onBack: () => void;
  onComplete: () => void;
}

const HospitalSignup: React.FC<HospitalSignupProps> = ({ onBack, onComplete }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    hospitalName: '',
    registrationNumber: '',
    address: '',
    contactPerson: '',
    phoneNumber: ''
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);

    try {
      // Mock API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('Hospital Registration:', formData);
      onComplete();
    } catch {
      alert('Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Hospital Registration</h2>
        <p className="text-gray-600">Complete your institution profile to join the network.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Hospital/Clinic Name</label>
          <input
            disabled={isLoading}
            required
            name="hospitalName"
            value={formData.hospitalName}
            onChange={handleInputChange}
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-burgundy-950/10 focus:border-burgundy-950 outline-none disabled:bg-gray-50"
            placeholder="e.g. City General Hospital"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Medical License Number</label>
          <input
            disabled={isLoading}
            required
            name="registrationNumber"
            value={formData.registrationNumber}
            onChange={handleInputChange}
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-burgundy-950/10 focus:border-burgundy-950 outline-none disabled:bg-gray-50"
            placeholder="REG-123456"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Official Address</label>
          <input
            disabled={isLoading}
            required
            name="address"
            value={formData.address}
            onChange={handleInputChange}
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-burgundy-950/10 focus:border-burgundy-950 outline-none disabled:bg-gray-50"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mt-8">
          <button
            type="button"
            disabled={isLoading}
            onClick={onBack}
            className="flex-1 py-3 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex-[2] py-3 bg-burgundy-950 text-white rounded-xl font-semibold shadow-lg hover:bg-burgundy-800 flex items-center justify-center gap-2 disabled:bg-burgundy-900/70"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Saving...
              </>
            ) : 'Complete Registration'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default HospitalSignup;