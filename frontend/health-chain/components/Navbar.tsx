"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="absolute top-0 md:top-[59px] w-full z-50 flex justify-center">
      <div className="w-full max-w-[1288px] mx-auto flex items-center justify-between px-6 py-4 md:py-0">
        
        {/* Logo Section */}
        <Link href="/" className="relative z-50 shrink-0">
          <div className="w-[50px] h-[50px] md:w-[61px] md:h-[62px] bg-white rounded-full border-2 border-black flex items-center justify-center shadow-md">
             <Image src="/logo-drop.svg" alt="Health Chain Logo" width={30} height={30} />
          </div>
        </Link>

        {/* Hamburger Icon (Mobile Only) */}
        <button 
          className="md:hidden z-50 text-brand-black p-2"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? (
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          )}
        </button>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-[40px] font-poppins text-brand-black text-[18px]">
          <Link href="/" className="group relative py-2">
            Home
            <span className="absolute left-0 bottom-0 w-full h-[3px] bg-[#4b4949] transition-all duration-300"></span>
          </Link>
          <Link href="#about" className="group relative py-2 hover:text-brand-loginBtn transition-colors">
            About Us
            <span className="absolute left-0 bottom-0 w-0 h-[3px] bg-[#4b4949] group-hover:w-full transition-all duration-300"></span>
          </Link>
          <Link href="#find" className="group relative py-2 hover:text-brand-loginBtn transition-colors">
            Find Blood
            <span className="absolute left-0 bottom-0 w-0 h-[3px] bg-[#4b4949] group-hover:w-full transition-all duration-300"></span>
          </Link>
          <Link href="/transparency" className="group relative py-2 hover:text-brand-loginBtn transition-colors">
            Transparency
            <span className="absolute left-0 bottom-0 w-0 h-[3px] bg-[#4b4949] group-hover:w-full transition-all duration-300"></span>
          </Link>
          
          <div className="flex items-center gap-2 cursor-pointer hover:text-brand-loginBtn transition group py-2 relative">
            <Link href="/auth/signup" className="flex items-center gap-2">
              Register Now 
              <svg width="12" height="8" viewBox="0 0 12 8" fill="none" className="stroke-current transition-transform group-hover:rotate-180">
                <path d="M1 1.5L6 6.5L11 1.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
          
          <Link href="/auth/signin">
            <button className="bg-brand-loginBtn text-[#fffbfb] w-[167px] h-[49px] rounded shadow-md hover:opacity-90 transition font-roboto font-semibold text-base ml-8">
              Enter App
            </button>
          </Link>
        </div>

        {/* Mobile Menu Dropdown */}
        {isOpen && (
          <div className="absolute top-full left-0 w-full bg-white shadow-xl flex flex-col items-center gap-6 py-8 md:hidden border-t border-gray-100 font-poppins">
            <Link href="/" onClick={() => setIsOpen(false)} className="text-xl text-brand-black">Home</Link>
            <Link href="#about" onClick={() => setIsOpen(false)} className="text-xl text-brand-black">About Us</Link>
            <Link href="#find" onClick={() => setIsOpen(false)} className="text-xl text-brand-black">Find Blood</Link>
            <Link href="/transparency" onClick={() => setIsOpen(false)} className="text-xl text-brand-black">Transparency</Link>
            <Link href="/auth/signup" onClick={() => setIsOpen(false)} className="text-xl text-brand-black">Register Now</Link>
            <Link href="/auth/signin" onClick={() => setIsOpen(false)}>
              <button className="bg-brand-loginBtn text-[#fffbfb] w-[167px] h-[49px] rounded shadow-md font-roboto font-semibold text-base">
                Enter App
              </button>
            </Link>
          </div>
        )}

      </div>
    </nav>
  );
}