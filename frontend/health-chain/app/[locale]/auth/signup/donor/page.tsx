'use client';

import BloodDonorSignup from '../../../../components/auth/BloodDonorSignup';
import { useRouter } from 'next/navigation';

export default function DonorSignup() {
  const router = useRouter();

  const handleBack = () => {
    router.push('/auth/signup');
  };

  const handleSuccess = () => {
    // Handle successful signup
    router.push('/dashboard');
  };

  return (
    <BloodDonorSignup 
      onBack={handleBack}
      onSuccess={handleSuccess}
    />
  );
}