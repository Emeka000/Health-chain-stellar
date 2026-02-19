'use client';

import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';

interface BloodDonorFormData {
  // Basic Info
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
  
  // Personal Info
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  phoneNumber: string;
  bloodType: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  weight: string;
  height: string;
  
  // Address
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  
  // Emergency Contact
  emergencyContactName: string;
  emergencyContactPhone: string;
  
  // Medical Info
  medicalConditions: string[];
  medications: string[];
  hasRecentTattoo: boolean;
  hasRecentPiercing: boolean;
  hasRecentTravel: boolean;
  travelDetails: string;
  isAvailableForEmergency: boolean;
  
  // Consent
  agreeToTerms: boolean;
  agreeToPrivacyPolicy: boolean;
  consentToMedicalScreening: boolean;
}

interface BloodDonorSignupProps {
  onBack: () => void;
  onSuccess?: () => void;
}

const BloodDonorSignup: React.FC<BloodDonorSignupProps> = ({ onBack, onSuccess }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<BloodDonorFormData>({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: '',
    dateOfBirth: '',
    gender: 'male',
    phoneNumber: '',
    bloodType: 'O+',
    weight: '',
    height: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'United States',
    emergencyContactName: '',
    emergencyContactPhone: '',
    medicalConditions: [],
    medications: [],
    hasRecentTattoo: false,
    hasRecentPiercing: false,
    hasRecentTravel: false,
    travelDetails: '',
    isAvailableForEmergency: true,
    agreeToTerms: false,
    agreeToPrivacyPolicy: false,
    consentToMedicalScreening: false,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1 && !isLoading) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isLoading) return;

    if (formData.password !== formData.confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    if (!formData.agreeToTerms || !formData.agreeToPrivacyPolicy || !formData.consentToMedicalScreening) {
      alert('Please agree to all terms and conditions');
      return;
    }

    setIsLoading(true);

    try {
      // API call logic
      console.log('Blood donor signup data:', formData);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      alert('Registration successful! Please check your email for verification.');
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Signup error:', error);
      alert('Failed to create account. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep1 = () => (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-800 mb-6 lg:text-lg md:text-base">Basic Information</h3>
      
      <div className="space-y-4">
        <div className="relative">
          <input
            type="email"
            name="email"
            placeholder="Email address"
            value={formData.email}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type="text"
            name="firstName"
            placeholder="First name"
            value={formData.firstName}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
        <div className="relative">
          <input
            type="text"
            name="lastName"
            placeholder="Last name"
            value={formData.lastName}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-none border-none text-gray-500 cursor-pointer p-0 flex items-center justify-center hover:text-gray-700 disabled:opacity-50"
            onClick={() => setShowPassword(!showPassword)}
            disabled={isLoading}
          >
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
        <div className="relative">
          <input
            type={showConfirmPassword ? "text" : "password"}
            name="confirmPassword"
            placeholder="Confirm password"
            value={formData.confirmPassword}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-none border-none text-gray-500 cursor-pointer p-0 flex items-center justify-center hover:text-gray-700 disabled:opacity-50"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            disabled={isLoading}
          >
            {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-800 mb-6 lg:text-lg md:text-base">Personal Details</h3>
      
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type="date"
            name="dateOfBirth"
            placeholder="Date of Birth"
            value={formData.dateOfBirth}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
        <div className="relative">
          <select
            name="gender"
            value={formData.gender}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border text-gray-700 cursor-pointer focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type="tel"
            name="phoneNumber"
            placeholder="Phone number"
            value={formData.phoneNumber}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          />
        </div>
        <div className="relative">
          <select
            name="bloodType"
            value={formData.bloodType}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border text-gray-700 cursor-pointer focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          >
            <option value="A+">A+</option>
            <option value="A-">A-</option>
            <option value="B+">B+</option>
            <option value="B-">B-</option>
            <option value="AB+">AB+</option>
            <option value="AB-">AB-</option>
            <option value="O+">O+</option>
            <option value="O-">O-</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type="number"
            name="weight"
            placeholder="Weight (kg)"
            value={formData.weight}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
            min="40"
            max="200"
          />
        </div>
        <div className="relative">
          <input
            type="number"
            name="height"
            placeholder="Height (cm)"
            value={formData.height}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
            min="120"
            max="250"
          />
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-800 mb-6 lg:text-lg md:text-base">Address & Emergency Contact</h3>
      
      <div className="relative">
        <textarea
          name="address"
          placeholder="Street address"
          value={formData.address}
          onChange={handleInputChange}
          required
          disabled={isLoading}
          className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type="text"
            name="city"
            placeholder="City"
            value={formData.city}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          />
        </div>
        <div className="relative">
          <input
            type="text"
            name="state"
            placeholder="State"
            value={formData.state}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type="text"
            name="zipCode"
            placeholder="ZIP Code"
            value={formData.zipCode}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          />
        </div>
        <div className="relative">
          <input
            type="text"
            name="country"
            placeholder="Country"
            value={formData.country}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          />
        </div>
      </div>

      <h4 className="text-lg font-semibold text-gray-700 mt-6 mb-4 lg:text-base md:text-sm">Emergency Contact</h4>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 md:gap-3.5 sm:gap-3">
        <div className="relative">
          <input
            type="text"
            name="emergencyContactName"
            placeholder="Emergency contact name"
            value={formData.emergencyContactName}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          />
        </div>
        <div className="relative">
          <input
            type="tel"
            name="emergencyContactPhone"
            placeholder="Emergency contact phone"
            value={formData.emergencyContactPhone}
            onChange={handleInputChange}
            required
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 disabled:bg-gray-50"
          />
        </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-800 mb-6 lg:text-lg md:text-base">Medical Information & Consent</h3>
      
      <div className="space-y-4 mb-6 md:space-y-3.5 sm:space-y-3">
        <label className="flex items-start gap-3 text-gray-700 cursor-pointer text-sm leading-6 md:text-xs sm:text-xs">
          <input
            type="checkbox"
            name="hasRecentTattoo"
            checked={formData.hasRecentTattoo}
            onChange={handleInputChange}
            disabled={isLoading}
            className="w-4 h-4 accent-burgundy-950 cursor-pointer flex-shrink-0 mt-0.5"
          />
          I have gotten a tattoo in the last 3 months
        </label>
        
        <label className="flex items-start gap-3 text-gray-700 cursor-pointer text-sm leading-6 md:text-xs sm:text-xs">
          <input
            type="checkbox"
            name="hasRecentPiercing"
            checked={formData.hasRecentPiercing}
            onChange={handleInputChange}
            disabled={isLoading}
            className="w-4 h-4 accent-burgundy-950 cursor-pointer flex-shrink-0 mt-0.5"
          />
          I have gotten a piercing in the last 3 months
        </label>
        
        <label className="flex items-start gap-3 text-gray-700 cursor-pointer text-sm leading-6 md:text-xs sm:text-xs">
          <input
            type="checkbox"
            name="hasRecentTravel"
            checked={formData.hasRecentTravel}
            onChange={handleInputChange}
            disabled={isLoading}
            className="w-4 h-4 accent-burgundy-950 cursor-pointer flex-shrink-0 mt-0.5"
          />
          I have traveled internationally in the last 3 months
        </label>
        
        <label className="flex items-start gap-3 text-gray-700 cursor-pointer text-sm leading-6 md:text-xs sm:text-xs">
          <input
            type="checkbox"
            name="isAvailableForEmergency"
            checked={formData.isAvailableForEmergency}
            onChange={handleInputChange}
            disabled={isLoading}
            className="w-4 h-4 accent-burgundy-950 cursor-pointer flex-shrink-0 mt-0.5"
          />
          I am available for emergency blood donations
        </label>
      </div>

      {formData.hasRecentTravel && (
        <div className="relative">
          <textarea
            name="travelDetails"
            placeholder="Please provide travel details"
            value={formData.travelDetails}
            onChange={handleInputChange}
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-300 rounded-lg text-base transition-all duration-300 bg-white box-border placeholder-gray-400 focus:outline-none focus:border-burgundy-950 focus:ring-3 focus:ring-burgundy-950/10 md:py-3 md:px-4 md:text-sm sm:py-2.5 sm:px-3.5 sm:text-sm"
            rows={3}
          />
        </div>
      )}

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h4 className="text-lg font-semibold text-gray-700 mb-4 lg:text-base md:text-sm">Required Consents</h4>
        <div className="space-y-4 md:space-y-3.5 sm:space-y-3">
          <label className="flex items-start gap-3 text-gray-700 cursor-pointer text-sm leading-6 font-medium md:text-xs sm:text-xs">
            <input
              type="checkbox"
              name="agreeToTerms"
              checked={formData.agreeToTerms}
              onChange={handleInputChange}
              required
              disabled={isLoading}
              className="w-4 h-4 accent-burgundy-950 cursor-pointer flex-shrink-0 mt-0.5"
            />
            I agree to the Terms and Conditions
          </label>
          
          <label className="flex items-start gap-3 text-gray-700 cursor-pointer text-sm leading-6 font-medium md:text-xs sm:text-xs">
            <input
              type="checkbox"
              name="agreeToPrivacyPolicy"
              checked={formData.agreeToPrivacyPolicy}
              onChange={handleInputChange}
              required
              disabled={isLoading}
              className="w-4 h-4 accent-burgundy-950 cursor-pointer flex-shrink-0 mt-0.5"
            />
            I agree to the Privacy Policy
          </label>
          
          <label className="flex items-start gap-3 text-gray-700 cursor-pointer text-sm leading-6 font-medium md:text-xs sm:text-xs">
            <input
              type="checkbox"
              name="consentToMedicalScreening"
              checked={formData.consentToMedicalScreening}
              onChange={handleInputChange}
              required
              disabled={isLoading}
              className="w-4 h-4 accent-burgundy-950 cursor-pointer flex-shrink-0 mt-0.5"
            />
            I consent to medical screening for blood donation eligibility
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto p-8 font-system lg:p-6 md:p-4 sm:p-3">
      <div className="flex items-center gap-4 mb-8 lg:mb-6 sm:mb-4">
        <button 
          className="flex items-center gap-2 bg-none border-none text-burgundy-950 cursor-pointer text-base p-2 rounded transition-colors duration-300 hover:bg-burgundy-950/10 md:text-sm md:p-1.5 sm:text-xs sm:p-1 disabled:opacity-50" 
          onClick={onBack}
          disabled={isLoading}
        >
          <ArrowLeft size={20} className="md:w-4 md:h-4 sm:w-3.5 sm:h-3.5" />
          Back
        </button>
        <h2 className="text-2xl font-semibold text-gray-800 m-0 lg:text-xl md:text-lg sm:text-base">
          Blood Donor Registration
        </h2>
      </div>

      {/* Progress Bar */}
      <div className="mb-8 relative lg:mb-6 sm:mb-4">
        <div className="flex justify-between relative z-10">
          {[1, 2, 3, 4].map((step) => (
            <div
              key={step}
              className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all duration-300 ${
                currentStep >= step 
                  ? 'bg-burgundy-950 text-white' 
                  : 'bg-gray-200 text-gray-500'
              } lg:w-9 lg:h-9 lg:text-sm md:w-8 md:h-8 md:text-xs sm:w-6 sm:h-6 sm:text-xs`}
            >
              {step}
            </div>
          ))}
        </div>
        <div className="absolute top-1/2 left-5 right-5 h-0.5 bg-gray-200 transform -translate-y-1/2 z-0 lg:left-4.5 lg:right-4.5 md:left-4 md:right-4 sm:left-3 sm:right-3">
          <div 
            className="h-full bg-burgundy-950 transition-all duration-300" 
            style={{ width: `${((currentStep - 1) / 3) * 100}%` }}
          />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl p-8 shadow-md lg:p-6 md:p-5 sm:p-4">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}

        <div className="flex justify-between gap-4 mt-8 pt-6 border-t border-gray-200 lg:flex-col lg:gap-3.5 md:mt-6 md:pt-5 sm:mt-4 sm:pt-4">
          {currentStep > 1 && (
            <button 
              type="button" 
              onClick={handlePrevious} 
              disabled={isLoading}
              className="px-8 py-3.5 bg-gray-100 text-gray-700 border border-gray-300 rounded-lg text-base font-semibold cursor-pointer transition-all duration-300 hover:bg-gray-200 active:translate-y-px lg:ml-0 md:px-6 md:py-3 md:text-sm sm:px-5 sm:py-2.5 sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
          )}
          
          {currentStep < 4 ? (
            <button 
              type="button" 
              onClick={handleNext} 
              className="px-8 py-3.5 bg-burgundy-950 text-white border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-300 ml-auto hover:bg-burgundy-800 active:translate-y-px lg:ml-0 md:px-6 md:py-3 md:text-sm sm:px-5 sm:py-2.5 sm:text-sm"
            >
              Next
            </button>
          ) : (
            <button 
              type="submit" 
              disabled={isLoading}
              className={`px-8 py-3.5 border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-300 ml-auto shadow-lg active:translate-y-px lg:ml-0 md:px-6 md:py-3 md:text-sm sm:px-5 sm:py-2.5 sm:text-sm ${
                isLoading 
                  ? 'bg-gray-400 text-white cursor-not-allowed' 
                  : 'bg-burgundy-950 text-white hover:bg-burgundy-800'
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Processing...
                </span>
              ) : (
                'Complete Registration'
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default BloodDonorSignup;