'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';

interface SignInFormData {
  email: string;
  password: string;
  rememberMe: boolean;
}

interface SignInPageProps {
  onBack?: () => void;
  onForgotPassword?: () => void;
  onGoogleSignIn?: () => void;
  onSignUpClick?: () => void;
}

const SignInPage: React.FC<SignInPageProps> = ({ 
  onBack, 
  onForgotPassword, 
  onGoogleSignIn,
  onSignUpClick 
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState<SignInFormData>({
    email: '',
    password: '',
    rememberMe: false,
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Safety check to prevent double execution
    if (isLoading) return;

    setIsLoading(true);

    try {
      console.log('Sign in data:', formData);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      alert('Signed in successfully!');
      // Note: If redirecting here, we don't set isLoading(false) 
      // to keep the button disabled during the page transition.
    } catch (error) {
      console.error('Sign in error:', error);
      alert('Failed to sign in. Please check your credentials and try again.');
      setIsLoading(false); // Only re-enable if there is an error
    } finally {
      // For the sake of this demo/simulation, we re-enable it.
      // In a real app, you'd only do this if the user stays on the page.
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      if (onGoogleSignIn) {
        await onGoogleSignIn();
      } else {
        console.log('Google sign in clicked');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = () => {
    if (isLoading) return;
    if (onForgotPassword) {
      onForgotPassword();
    } else {
      const email = prompt('Please enter your email address:');
      if (email) {
        console.log('Password reset requested for:', email);
        alert('Password reset link has been sent to your email.');
      }
    }
  };

  return (
    <div className="flex min-h-screen font-system bg-gray-50">
      {/* Left Panel - Hidden on mobile/tablet, visible on desktop */}
      <div className="hidden xl:flex w-1/2 bg-gradient-to-br from-red-600 via-burgundy-800 to-burgundy-950 items-center justify-center relative overflow-hidden">
        <div 
          className="absolute inset-0 opacity-10 bg-no-repeat bg-cover"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0c30 0 60 30 100 0v100H0V0z' fill='%23ffffff' fill-opacity='0.1'/%3E%3C/svg%3E")`
          }}
        />
        
        <div className="relative z-10 text-center text-white max-w-md px-8">
          <div className="mb-8">
            <div className="animate-float inline-block">
              <svg width="120" height="120" viewBox="0 0 80 80" fill="none" className="mx-auto">
                <circle cx="40" cy="40" r="40" fill="white"/>
                <path 
                  d="M40 15C40 15 25 30 25 45C25 53.284 31.716 60 40 60C48.284 60 55 53.284 55 45C55 30 40 15 40 15Z" 
                  stroke="#7f1d1d" 
                  strokeWidth="3" 
                  fill="none"
                />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-4 leading-tight">
            Welcome to Healthy Stellar
          </h1>
          <p className="text-lg opacity-90 leading-relaxed">
            Your trusted platform for blood donation management and healthcare services.
          </p>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 xl:w-1/2 bg-white flex flex-col justify-center items-center p-6 sm:p-8 lg:p-12 xl:p-16 relative min-h-screen xl:min-h-0">
        {onBack && (
          <button 
            className="absolute top-6 left-6 xl:top-8 xl:left-8 flex items-center gap-2 bg-none border-none text-burgundy-950 cursor-pointer text-sm xl:text-base p-2 rounded-lg transition-all duration-300 hover:bg-burgundy-950/10 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-burgundy-950/20 disabled:opacity-50" 
            onClick={onBack}
            disabled={isLoading}
          >
            <ArrowLeft size={18} className="xl:w-5 xl:h-5" />
            <span className="font-medium">Back</span>
          </button>
        )}

        <div className="w-full max-w-md xl:max-w-lg 2xl:max-w-xl">
          <div className="text-center mb-8 xl:mb-10">
            <div className="xl:hidden mb-6">
              <svg width="60" height="60" viewBox="0 0 80 80" fill="none" className="mx-auto">
                <circle cx="40" cy="40" r="40" fill="#7f1d1d"/>
                <path 
                  d="M40 15C40 15 25 30 25 45C25 53.284 31.716 60 40 60C48.284 60 55 53.284 55 45C55 30 40 15 40 15Z" 
                  stroke="white" 
                  strokeWidth="3" 
                  fill="none"
                />
              </svg>
            </div>
            
            <h1 className="text-2xl xl:text-3xl 2xl:text-4xl font-bold text-gray-900 mb-2">
              Welcome back
            </h1>
            <p className="text-gray-600 text-sm xl:text-base">
              Sign in to your account to continue
            </p>
          </div>

          <div className="flex mb-8 xl:mb-10 border-b border-gray-200 w-full relative">
            <button 
              className="flex-1 py-3 xl:py-4 bg-none border-none text-base xl:text-lg font-medium text-gray-500 cursor-pointer transition-all duration-300 hover:text-burgundy-950 hover:bg-gray-50 rounded-t-lg relative z-10 disabled:cursor-not-allowed"
              onClick={onSignUpClick}
              disabled={isLoading}
            >
              Sign Up
            </button>
            <button className="flex-1 py-3 xl:py-4 bg-none border-none text-base xl:text-lg font-medium cursor-pointer transition-all duration-300 text-burgundy-950 font-semibold relative z-10 rounded-t-lg">
              Sign In
            </button>
            <div className="absolute bottom-0 left-1/2 w-1/2 h-0.5 bg-burgundy-950 rounded-full"></div>
          </div>

          <form className="space-y-5 xl:space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4 xl:space-y-5">
              <div className="relative">
                <input
                  type="email"
                  name="email"
                  placeholder="Email address"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  disabled={isLoading}
                  className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed hover:border-gray-400"
                />
              </div>

              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="Enter password"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  disabled={isLoading}
                  className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed hover:border-gray-400"
                />
                <button
                  type="button"
                  className="absolute right-4 xl:right-5 top-1/2 transform -translate-y-1/2 bg-none border-none text-gray-500 cursor-pointer p-1 flex items-center justify-center hover:text-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors duration-200 rounded-md hover:bg-gray-100"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOff size={20} className="xl:w-6 xl:h-6" /> : <Eye size={20} className="xl:w-6 xl:h-6" />}
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <label className="flex items-center gap-3 text-sm xl:text-base text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  className="w-4 h-4 xl:w-5 xl:h-5 accent-burgundy-950 cursor-pointer rounded focus:ring-2 focus:ring-burgundy-950/20"
                />
                <span className="select-none">Remember me</span>
              </label>
              
              <button 
                type="button" 
                className="bg-none border-none text-burgundy-950 text-sm xl:text-base cursor-pointer underline p-0 hover:text-burgundy-800 disabled:text-gray-400 disabled:cursor-not-allowed disabled:no-underline transition-colors duration-200 font-medium"
                onClick={handleForgotPassword}
                disabled={isLoading}
              >
                Forgot password?
              </button>
            </div>

            <button 
              type="submit" 
              className={`w-full py-3 xl:py-4 border-none rounded-xl text-base xl:text-lg font-semibold cursor-pointer transition-all duration-300 mt-6 xl:mt-8 relative shadow-lg hover:shadow-xl ${
                isLoading 
                  ? 'bg-gray-400 text-white cursor-not-allowed' 
                  : 'bg-burgundy-950 text-white hover:bg-burgundy-800 hover:scale-[1.02] active:scale-[0.98]'
              }`}
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Continue'
              )}
            </button>

            <div className="flex items-center my-6 xl:my-8 text-gray-500">
              <div className="flex-1 h-px bg-gray-300"></div>
              <span className="px-4 text-sm xl:text-base font-medium">or</span>
              <div className="flex-1 h-px bg-gray-300"></div>
            </div>

            <button 
              type="button" 
              className={`w-full py-3 xl:py-4 bg-white border border-gray-300 rounded-xl text-base xl:text-lg cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 font-medium text-gray-700 shadow-sm ${
                isLoading 
                  ? 'bg-gray-50 text-gray-400 cursor-not-allowed' 
                  : 'hover:bg-gray-50 hover:border-gray-400 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'
              }`}
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" className="xl:w-6 xl:h-6">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>
          </form>

          <div className="mt-8 xl:mt-10 text-center">
            <p className="text-gray-600 text-sm xl:text-base">
              Don&apos;t have an account? 
              <button 
                className="bg-none border-none text-burgundy-950 cursor-pointer underline text-sm xl:text-base ml-1 hover:text-burgundy-800 transition-colors duration-200 font-medium disabled:opacity-50" 
                onClick={onSignUpClick}
                disabled={isLoading}
              >
                Sign up here
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;