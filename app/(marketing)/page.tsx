import { AgenticActionsSection } from "@/components/home/agentic-actions";
import { AiCapabilitiesSection } from "@/components/home/ai-capabilities";
import { BusinessModulesSection } from "@/components/home/business-modules";
import { CtaSection } from "@/components/home/cta-section";
import { HeroSection } from "@/components/home/hero";
import { LanguageSupportSection } from "@/components/home/language-support";
import { ProductExplanationSection } from "@/components/home/product-explanation";
import { SecurityControlSection } from "@/components/home/security-control";
import { VoiceCapabilitySection } from "@/components/home/voice-capability";

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <div className="container-page">
        <div className="hairline" aria-hidden />
      </div>
      <ProductExplanationSection />
      <AiCapabilitiesSection />
      <BusinessModulesSection />
      <AgenticActionsSection />
      <LanguageSupportSection />
      <VoiceCapabilitySection />
      <SecurityControlSection />
      <CtaSection />
    </>
  );
}
