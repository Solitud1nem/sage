import { DemoCta } from '@/components/home/demo-cta';
import { Hero } from '@/components/home/hero';
import { HowItWorks } from '@/components/home/how-it-works';
import { Integrate } from '@/components/home/integrate';
import { LiveStream } from '@/components/home/live-stream';
import { Patterns } from '@/components/home/patterns';

/**
 * Home landing.
 *
 * Sections in scroll order: Hero → How it works → Integrate → Patterns → Live tx stream → Demo CTA.
 * Anchor ids: #how-it-works, #integrate, #patterns, #live (consumed by nav links).
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Integrate />
      <Patterns />
      <LiveStream />
      <DemoCta />
    </>
  );
}
