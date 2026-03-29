'use client';

import SignupPage from '../../../components/auth/SignupPage';
import { useRouter } from 'next/navigation';

export default function SignUp() {
  const router = useRouter();

  const handleUserTypeSelect = (userType: 'blood_donor' | 'hospital_institution') => {
    // Navigate to specific signup form based on user type
    if (userType === 'blood_donor') {
      router.push('/auth/signup/donor');
    } else {
      router.push('/auth/signup/hospital');
    }
  };

  const handleSignInClick = () => {
    router.push('/auth/signin');
  };

  const handleBack = () => {
    router.push('/');
  };

  return (
    <SignupPage 
      onUserTypeSelect={handleUserTypeSelect}
      onSignInClick={handleSignInClick}
      onBack={handleBack}
    />
  );
}