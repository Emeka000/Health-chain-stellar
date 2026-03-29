'use client';

import SignInPage from '../../../components/auth/SignInPage';
import { useRouter } from 'next/navigation';

export default function SignIn() {
  const router = useRouter();

  const handleBack = () => {
    router.push('/');
  };

  const handleSignUpClick = () => {
    router.push('/auth/signup');
  };

  const handleForgotPassword = () => {
    // Handle forgot password logic
    console.log('Forgot password clicked');
  };

  const handleGoogleSignIn = () => {
    // Handle Google sign in logic
    console.log('Google sign in clicked');
  };

  return (
    <SignInPage 
      onBack={handleBack}
      onForgotPassword={handleForgotPassword}
      onGoogleSignIn={handleGoogleSignIn}
      onSignUpClick={handleSignUpClick}
    />
  );
}