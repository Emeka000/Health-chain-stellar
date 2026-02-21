"use client";
import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { 
  LayoutGrid, 
  GitPullRequest, 
  HandHeart, 
  Building2, 
  Bike, 
  Settings, 
  LogOut, 
  Menu,
  X,
} from "lucide-react";

function classNames(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

const sidebarLinks = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { name: "Blood Requests", href: "/dashboard/requests", icon: GitPullRequest },
  { name: "Orders", href: "/dashboard/orders", icon: Package },
  { name: "Donors Lists", href: "/dashboard/donors", icon: HandHeart },
  { name: "Hospitals", href: "/dashboard/hospitals", icon: Building2 },
  { name: "Track Riders", href: "/dashboard/track-riders", icon: Bike },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#F5F7FA] font-poppins text-brand-black">
      
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 xl:hidden" onClick={() => setIsMobileMenuOpen(false)}/>
      )}

      {/* --- SIDEBAR --- */}
      <aside className={classNames(
        "fixed xl:sticky top-0 left-0 z-50 h-screen bg-white border-r border-gray-100 flex flex-col transition-transform duration-300 ease-in-out shrink-0",
        "w-[280px] 2xl:w-[368px]", 
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0"
      )}>
        
        {/* Logo Area */}
        <div className="pt-[30px] 2xl:pt-[39px] pl-[30px] 2xl:pl-[48px] pr-[15px] flex items-center gap-[10px] mb-[40px] 2xl:mb-[60px]">
           <div className="w-[50px] h-[50px] 2xl:w-[61px] 2xl:h-[62px] rounded-full bg-white shadow-[0px_4px_10px_rgba(0,0,0,0.1)] flex items-center justify-center">
             <Image src="/logo-drop.svg" alt="Logo" width={30} height={36} className="w-[24px] h-[28px] 2xl:w-[30px] 2xl:h-[36.3px]" />
           </div>
           <button onClick={() => setIsMobileMenuOpen(false)} className="xl:hidden ml-auto text-gray-500">
             <X className="w-6 h-6" />
           </button>
        </div>

        {/* Navigatione */}
        <nav className="flex-1 px-[20px] 2xl:pl-[27px] 2xl:pr-[62px] space-y-[12px] 2xl:space-y-[17px] overflow-y-auto no-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <style jsx>{`
            nav::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          {sidebarLinks.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={classNames(
                  isActive 
                    ? "bg-[#D32F2F] text-white shadow-md" 
                    : "text-[#827D7D] hover:bg-gray-50",
                  "flex items-center gap-[12px] w-full h-[48px] 2xl:h-[52px] px-[10px] transition-all duration-200 group font-poppins font-semibold text-[16px] 2xl:text-[20px] tracking-[0.05em]",
                  "rounded-tr-[12px] rounded-bl-[12px] rounded-tl-none rounded-br-none"
                )}
              >
                <item.icon className={classNames(isActive ? "text-white" : "text-[#827D7D]", "w-[24px] h-[24px] 2xl:w-[32px] 2xl:h-[32px]")} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="mt-auto mb-[40px] space-y-[14px]">
          <button className="flex items-center justify-center gap-[10px] w-full h-[52px] px-[10px] text-brand-black hover:bg-gray-50 font-poppins font-medium text-[16px]">
            <Settings className="w-[24px] h-[24px] 2xl:w-[32px] 2xl:h-[32px]" />
            Settings
          </button>
          <button className="flex items-center justify-center gap-[10px] w-full h-[52px] px-[10px] text-brand-black hover:bg-gray-50 font-poppins font-medium text-[16px]">
            <LogOut className="w-[24px] h-[24px] 2xl:w-[32px] 2xl:h-[32px]" />
            Log out
          </button>
        </div>
      </aside>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 w-full min-w-0 p-4 md:p-8 xl:pt-[60px] xl:px-[40px] overflow-hidden">
        {/* Mobile Toggle */}
        <div className="xl:hidden flex items-center justify-between mb-6">
            <button onClick={() => setIsMobileMenuOpen(true)}>
                <Menu className="w-8 h-8 text-gray-700"/>
            </button>
            <div className="w-[40px] h-[40px] rounded-full overflow-hidden">
                <Image src="/health-agency.jpg" alt="Profile" width={40} height={40} className="object-cover"/>
            </div>
        </div>

        {children}
      </main>
    </div>
  );
}