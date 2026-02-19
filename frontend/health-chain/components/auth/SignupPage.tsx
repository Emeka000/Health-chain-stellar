import React, { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

interface SignupFormData {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
  userType: 'blood_donor' | 'hospital_institution';
}

interface SignupPageProps {
  onUserTypeSelect?: (userType: 'blood_donor' | 'hospital_institution') => void;
  onSignInClick?: () => void;
  onBack?: () => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ onUserTypeSelect, onSignInClick, onBack }) => {
  const [activeTab, setActiveTab] = useState<'signup' | 'signin'>('signup');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<SignupFormData>({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: '',
    userType: 'blood_donor'
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    
    if (activeTab === 'signup') {
      if (formData.password !== formData.confirmPassword) {
        alert('Passwords do not match');
        setIsLoading(false);
        return;
      }

      // Navigate to detailed signup form based on user type
      if (onUserTypeSelect) {
        // Short delay to show the user the "Continue" action is processing
        await new Promise(resolve => setTimeout(resolve, 600));
        onUserTypeSelect(formData.userType);
        setIsLoading(false);
        return;
      }
    }

    try {
      // API call logic simulation
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log('Auth data:', formData);
      if (activeTab === 'signup') {
        alert('Account created successfully! Please check your email for verification.');
      } else {
        alert('Signed in successfully!');
      }
    } catch (error) {
      console.error('Auth error:', error);
      alert(`Failed to ${activeTab === 'signup' ? 'create account' : 'sign in'}. Please try again.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    if (isLoading) return;
    // Google OAuth logic will go here
    console.log('Google signup clicked');
  };

  return (
    <div className="flex min-h-screen font-system bg-gray-50 overflow-hidden">
      {/* Left Panel - Hidden on mobile/tablet, visible on desktop */}
      <div className="hidden xl:flex w-1/2 bg-gradient-to-br from-red-600 via-burgundy-800 to-burgundy-950 items-center justify-center relative overflow-hidden">
        {/* Subtle pattern overlay */}
        <div 
          className="absolute inset-0 opacity-10 bg-no-repeat bg-cover"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0c30 0 60 30 100 0v100H0V0z' fill='%23ffffff' fill-opacity='0.1'/%3E%3C/svg%3E")`
          }}
        />
        
        {/* Brand Content */}
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
            Join Healthy Stellar
          </h1>
          <p className="text-lg opacity-90 leading-relaxed">
            Create your account and start making a difference in healthcare today.
          </p>
        </div>
      </div>

      {/* Right Panel - Full width on mobile/tablet, half width on desktop */}
      <div className="flex-1 xl:w-1/2 bg-white flex flex-col justify-center items-center p-6 sm:p-8 lg:p-12 xl:p-16 min-h-screen xl:min-h-0 relative">
        {/* Back Button */}
        {onBack && (
          <button 
            disabled={isLoading}
            className="absolute top-6 left-6 xl:top-8 xl:left-8 flex items-center gap-2 bg-none border-none text-burgundy-950 cursor-pointer text-sm xl:text-base p-2 rounded-lg transition-all duration-300 hover:bg-burgundy-950/10 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-burgundy-950/20 disabled:opacity-50" 
            onClick={onBack}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="xl:w-5 xl:h-5">
              <path d="m12 19-7-7 7-7"/>
              <path d="m19 12H5"/>
            </svg>
            <span className="font-medium">Back</span>
          </button>
        )}
        {/* Mobile Logo */}
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

        {/* Main Content Container */}
        <div className="w-full max-w-md xl:max-w-lg 2xl:max-w-xl">
          {/* Header */}
          <div className="text-center mb-8 xl:mb-10">
            <h1 className="text-2xl xl:text-3xl 2xl:text-4xl font-bold text-gray-900 mb-2">
              {activeTab === 'signup' ? 'Create Account' : 'Welcome back'}
            </h1>
            <p className="text-gray-600 text-sm xl:text-base">
              {activeTab === 'signup' 
                ? 'Join our community and start making a difference' 
                : 'Sign in to your account to continue'
              }
            </p>
          </div>

          {/* Auth Tabs */}
          <div className="flex mb-8 xl:mb-10 border-b border-gray-200 w-full relative">
            <button 
              disabled={isLoading}
              className={`flex-1 py-3 xl:py-4 bg-none border-none text-base xl:text-lg font-medium cursor-pointer transition-all duration-300 relative z-10 ${
                activeTab === 'signup' 
                  ? 'text-burgundy-950 font-semibold' 
                  : 'text-gray-500 hover:text-burgundy-950 hover:bg-gray-50'
              } rounded-t-lg disabled:cursor-not-allowed`}
              onClick={() => setActiveTab('signup')}
            >
              Sign Up
            </button>
            <button 
              disabled={isLoading}
              className={`flex-1 py-3 xl:py-4 bg-none border-none text-base xl:text-lg font-medium cursor-pointer transition-all duration-300 relative z-10 ${
                activeTab === 'signin' 
                  ? 'text-burgundy-950 font-semibold' 
                  : 'text-gray-500 hover:text-burgundy-950 hover:bg-gray-50'
              } rounded-t-lg disabled:cursor-not-allowed`}
              onClick={() => {
                if (onSignInClick) {
                  onSignInClick();
                } else {
                  setActiveTab('signin');
                }
              }}
            >
              Sign In
            </button>
            {/* Sliding underline */}
            <div 
              className={`absolute bottom-0 h-0.5 bg-burgundy-950 rounded-full transition-all duration-300 ease-out ${
                activeTab === 'signup' ? 'left-0 w-1/2' : 'left-1/2 w-1/2'
              }`}
            ></div>
          </div>

          {activeTab === 'signup' && (
            <form className="space-y-5 xl:space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-4 xl:space-y-5">
                <div className="relative">
                  <input
                    disabled={isLoading}
                    type="email"
                    name="email"
                    placeholder="Email address"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 hover:border-gray-400 disabled:bg-gray-50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 xl:gap-5">
                  <div className="relative">
                    <input
                      disabled={isLoading}
                      type="text"
                      name="firstName"
                      placeholder="First name"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      required
                      className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 hover:border-gray-400 disabled:bg-gray-50"
                    />
                  </div>
                  <div className="relative">
                    <input
                      disabled={isLoading}
                      type="text"
                      name="lastName"
                      placeholder="Last name"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      required
                      className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 hover:border-gray-400 disabled:bg-gray-50"
                    />
                  </div>
                </div>

                <div className="relative">
                  <input
                    disabled={isLoading}
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Enter password"
                    value={formData.password}
                    onChange={handleInputChange}
                    required
                    className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 hover:border-gray-400 disabled:bg-gray-50"
                  />
                  <button
                    disabled={isLoading}
                    type="button"
                    className="absolute right-4 xl:right-5 top-1/2 transform -translate-y-1/2 bg-none border-none text-gray-500 cursor-pointer p-1 flex items-center justify-center hover:text-gray-700 transition-colors duration-200 rounded-md hover:bg-gray-100 disabled:opacity-50"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={20} className="xl:w-6 xl:h-6" /> : <Eye size={20} className="xl:w-6 xl:h-6" />}
                  </button>
                </div>

                <div className="relative">
                  <input
                    disabled={isLoading}
                    type={showConfirmPassword ? "text" : "password"}
                    name="confirmPassword"
                    placeholder="Re-enter password"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    required
                    className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 hover:border-gray-400 disabled:bg-gray-50"
                  />
                  <button
                    disabled={isLoading}
                    type="button"
                    className="absolute right-4 xl:right-5 top-1/2 transform -translate-y-1/2 bg-none border-none text-gray-500 cursor-pointer p-1 flex items-center justify-center hover:text-gray-700 transition-colors duration-200 rounded-md hover:bg-gray-100 disabled:opacity-50"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff size={20} className="xl:w-6 xl:h-6" /> : <Eye size={20} className="xl:w-6 xl:h-6" />}
                  </button>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full py-3 xl:py-4 bg-burgundy-950 text-white border-none rounded-xl text-base xl:text-lg font-semibold cursor-pointer transition-all duration-300 mt-6 xl:mt-8 shadow-lg hover:shadow-xl hover:bg-burgundy-800 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 disabled:bg-burgundy-900/80 disabled:scale-100"
              >
                {isLoading ? <Loader2 className="animate-spin" size={20} /> : null}
                {isLoading ? 'Processing...' : 'Continue'}
              </button>

              <div className="flex items-center my-6 xl:my-8 text-gray-500">
                <div className="flex-1 h-px bg-gray-300"></div>
                <span className="px-4 text-sm xl:text-base font-medium">or</span>
                <div className="flex-1 h-px bg-gray-300"></div>
              </div>

              <button 
                type="button" 
                disabled={isLoading}
                className="w-full py-3 xl:py-4 bg-white border border-gray-300 rounded-xl text-base xl:text-lg cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-400 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100" 
                onClick={handleGoogleSignup}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" className="xl:w-6 xl:h-6">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign up with Google
              </button>
            </form>
          )}

          {activeTab === 'signin' && (
            <form className="space-y-5 xl:space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-4 xl:space-y-5">
                <div className="relative">
                  <input
                    disabled={isLoading}
                    type="email"
                    name="email"
                    placeholder="Email address"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 hover:border-gray-400 disabled:bg-gray-50"
                  />
                </div>

                <div className="relative">
                  <input
                    disabled={isLoading}
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Enter password"
                    value={formData.password}
                    onChange={handleInputChange}
                    required
                    className="w-full py-3 xl:py-4 px-4 xl:px-5 border border-gray-300 rounded-xl text-base xl:text-lg transition-all duration-300 bg-white placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-4 focus:ring-burgundy-950/10 hover:border-gray-400 disabled:bg-gray-50"
                  />
                  <button
                    disabled={isLoading}
                    type="button"
                    className="absolute right-4 xl:right-5 top-1/2 transform -translate-y-1/2 bg-none border-none text-gray-500 cursor-pointer p-1 flex items-center justify-center hover:text-gray-700 transition-colors duration-200 rounded-md hover:bg-gray-100 disabled:opacity-50"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={20} className="xl:w-6 xl:h-6" /> : <Eye size={20} className="xl:w-6 xl:h-6" />}
                  </button>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full py-3 xl:py-4 bg-burgundy-950 text-white border-none rounded-xl text-base xl:text-lg font-semibold cursor-pointer transition-all duration-300 mt-6 xl:mt-8 shadow-lg hover:shadow-xl hover:bg-burgundy-800 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 disabled:bg-burgundy-900/80 disabled:scale-100"
              >
                {isLoading ? <Loader2 className="animate-spin" size={20} /> : null}
                {isLoading ? 'Processing...' : 'Continue'}
              </button>

              <div className="flex items-center my-6 xl:my-8 text-gray-500">
                <div className="flex-1 h-px bg-gray-300"></div>
                <span className="px-4 text-sm xl:text-base font-medium">or</span>
                <div className="flex-1 h-px bg-gray-300"></div>
              </div>

              <button 
                type="button" 
                disabled={isLoading}
                className="w-full py-3 xl:py-4 bg-white border border-gray-300 rounded-xl text-base xl:text-lg cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-400 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100" 
                onClick={handleGoogleSignup}
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
          )}
        </div>
      </div>
    </div>
  );
};

export default SignupPage;