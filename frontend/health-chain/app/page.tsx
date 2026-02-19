import Image from "next/image";
import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-white overflow-x-hidden relative">
      <Navbar />
      <Hero />

      {/* --- Mission Section --- */}
      <section className="relative w-full max-w-[1345px] mx-auto mt-10 md:mt-0 mb-32 px-6 z-20">
        <h2 className="font-roboto font-bold text-[32px] md:text-[36px] text-brand-black mb-6 text-center md:text-left">Our Mission</h2>
        <p className="font-roboto font-normal text-[16px] text-brand-black leading-relaxed text-justify md:text-left">
          At MDrips, our mission is to bring hope, healing, and humanity closer to everyone who needs it. 
          We believe that every drop of blood carries the power to save a life, and no one should struggle 
          to find help in moments of urgency. That&apos;s why we are building a community where generosity flows 
          freely and compassion moves without barriers.
        </p>
      </section>

      {/* --- Collaborators Section --- */}
      <section className="relative w-full max-w-[1235px] mx-auto mb-40 px-6">
        <h2 className="font-manrope font-bold text-[32px] md:text-[36px] text-brand-black mb-12 text-center md:text-left">Our Collaborators</h2>
        
        <div className="flex flex-wrap justify-center md:justify-between gap-8">
          
          {/* Card 1 */}
          <div className="relative w-[341px] h-[317px] rounded-xl overflow-hidden shadow-card group bg-gray-100">
            <Image src="/FK-kit.jpg" alt="NGO Kit" fill className="object-cover" sizes="(max-width: 768px) 100vw, 341px" />
            <div className="absolute inset-0 bg-black/10"></div>
            <div className="absolute bottom-[24px] w-full flex justify-center z-10">
                <button className="bg-brand-requestBtn text-[#fffbfb] w-[167px] h-[49px] rounded font-roboto font-semibold text-[16px]">
                  NGOs
                </button>
            </div>
          </div>

          {/* Card 2 */}
          <div className="relative w-[341px] h-[317px] rounded-xl overflow-hidden shadow-card group bg-gray-100">
            <Image src="/hospital.jpg" alt="Hospital" fill className="object-cover" sizes="(max-width: 768px) 100vw, 341px" />
            <div className="absolute inset-0 bg-black/10"></div>
            <div className="absolute bottom-[24px] w-full flex justify-center z-10">
                <button className="bg-brand-requestBtn text-[#fffbfb] w-[247px] h-[49px] rounded font-roboto font-semibold text-[16px]">
                  Hospitals/Medical Centers
                </button>
            </div>
          </div>

          {/* Card 3 */}
          <div className="relative w-[341px] h-[317px] rounded-xl overflow-hidden shadow-card group bg-gray-100">
            <Image src="/health-agency.jpg" alt="Gov Agencies" fill className="object-cover" sizes="(max-width: 768px) 100vw, 341px" />
            <div className="absolute inset-0 bg-black/10"></div>
            <div className="absolute bottom-[24px] w-full flex justify-center z-10">
                <button className="bg-brand-requestBtn text-[#fffbfb] w-[200px] h-[49px] rounded font-roboto font-semibold text-[16px]">
                  Gov Health Agencies
                </button>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-3 mt-12">
            <span className="w-[15px] h-[15px] rounded-full bg-[#d9d9d9]"></span>
            <span className="w-[15px] h-[15px] rounded-full bg-brand-black"></span>
            <span className="w-[15px] h-[15px] rounded-full bg-[#d9d9d9]"></span>
        </div>
      </section>

      {/* --- How to section --- */}
      <section className="relative w-full max-w-[1280px] mx-auto min-h-auto md:min-h-[900px] mb-20 px-4">
        <h2 className="font-manrope font-bold text-[32px] md:text-[36px] text-brand-black mb-10 text-center md:text-left">
          How to get <br/> Blood?
        </h2>
        
        {/* Mobile: Flex Column, Desktop: Relative Container for Absolute items */}
        <div className="relative w-full flex flex-col items-center gap-16 md:block md:h-[800px]">
            
            {/* Heartbeat Line - Hidden on Mobile */}
            <div className="hidden md:block absolute bottom-[180px] left-1/2 -translate-x-1/2 w-[350px] h-[150px] z-0">
                <Image 
                  src="/pngwing 1.jpg" 
                  alt="Heartbeat" 
                  fill
                  className="object-contain" 
                />
            </div>

            {/* Step 1: Stacked on Mobile, Top-Center on Desktop */}
            <div className="relative md:absolute md:top-0 md:left-1/2 md:-translate-x-1/2 z-10 flex flex-col items-center">
                <div className="relative w-[280px] h-[285px] md:w-[363px] md:h-[370px] rounded-full overflow-hidden border-[6px] border-white shadow-2xl bg-white">
                    <Image src="/envelope.webp" alt="Share Need" fill className="object-cover" />
                </div>
                <div className="absolute top-[20px] left-[-20px] md:top-[30px] md:left-[-30px] w-[90px] h-[92px] md:w-[124px] md:h-[126px] bg-white rounded-full flex items-center justify-center border-2 border-black shadow-[0px_4px_10px_2px_rgba(165,164,164,0.5)] z-20">
                    <span className="font-manrope font-bold text-[48px] md:text-[64px]">1</span>
                </div>
                <p className="mt-6 font-manrope font-semibold text-[24px]">Share Your Need</p>
            </div>

            {/* Step 2: Stacked on Mobile, Bottom-Left on Desktop */}
            <div className="relative md:absolute md:bottom-[50px] md:left-[20px] xl:left-[60px] z-10 flex flex-col items-center">
                 <div className="relative w-[280px] h-[285px] md:w-[363px] md:h-[370px] rounded-full overflow-hidden border-[6px] border-white shadow-2xl bg-white">
                    <Image src="/together.webp" alt="Matched" fill className="object-cover" />
                </div>
                <div className="absolute top-[20px] left-[-20px] md:top-[30px] md:left-[-30px] w-[90px] h-[92px] md:w-[124px] md:h-[126px] bg-white rounded-full flex items-center justify-center border-2 border-black shadow-[0px_4px_10px_2px_rgba(165,164,164,0.5)] z-20">
                    <span className="font-manrope font-bold text-[48px] md:text-[64px]">2</span>
                </div>
                <p className="mt-6 font-manrope font-semibold text-[24px]">Get Matched With Donors</p>
            </div>

            {/* Step 3: Stacked on Mobile, Bottom-Right on Desktop */}
            <div className="relative md:absolute md:bottom-[50px] md:right-[20px] xl:right-[60px] z-10 flex flex-col items-center">
                 <div className="relative w-[280px] h-[285px] md:w-[363px] md:h-[370px] rounded-full overflow-hidden border-[6px] border-white shadow-2xl bg-white">
                    <Image src="/donate.webp" alt="Receive" fill className="object-cover" />
                </div>
                <div className="absolute top-[20px] left-[-20px] md:top-[30px] md:left-[-30px] w-[90px] h-[92px] md:w-[124px] md:h-[126px] bg-white rounded-full flex items-center justify-center border-2 border-black shadow-[0px_4px_10px_2px_rgba(165,164,164,0.5)] z-20">
                    <span className="font-manrope font-bold text-[48px] md:text-[64px]">3</span>
                </div>
                <p className="mt-6 font-manrope font-semibold text-[24px] text-center">Receive Safely <br className="md:hidden"/> With Support</p>
            </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}