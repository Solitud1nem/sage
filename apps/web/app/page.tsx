import { Composition } from '@/components/home/composition';
import { DemoCta } from '@/components/home/demo-cta';
import { Hero } from '@/components/home/hero';
import { HowItWorks } from '@/components/home/how-it-works';
import { Integrate } from '@/components/home/integrate';
import { LiveStream } from '@/components/home/live-stream';
import { Patterns } from '@/components/home/patterns';

/**
 * Home landing.
 *
 * Sections in scroll order: Hero → How it works → Integrate → Patterns → Composition → Live tx stream → Demo CTA.
 * Anchor ids: #how-it-works, #integrate, #patterns, #composition, #live (consumed by nav links).
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Integrate />
      <Patterns />
      <Composition />
      <LiveStream />
      <DemoCta />
    </>
  );
}
