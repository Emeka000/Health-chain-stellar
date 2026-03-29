"use client";

import HospitalSignup from "@/components/auth/HospitalSignup";
import { useRouter } from "next/navigation";

export default function HospitalSignupPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <HospitalSignup 
        onBack={() => router.push('/auth/signup')}
        onComplete={() => router.push('/dashboard')}
      />
    </div>
  );
}
